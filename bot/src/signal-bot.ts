// Indicator-signal trading bot.
//
// Unlike the grid bot, this engine evaluates a technical strategy on a
// timeframe of candles and fires a market order whenever a fresh BUY/SELL
// signal prints on a newly-closed bar. It runs entirely server-side so it
// keeps trading with no browser open; the web UI is just a view/control
// layer that reads state back from here.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, type Logger } from './logger.js'
import { fetchKlines } from './strategy/market-data.js'
import {
  STRATEGIES,
  defaultParams,
  generateSignals,
  type Signal,
  type StrategyId,
} from './strategy/strategies.js'
import { executeMarketTrade } from './trade.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_PATH = join(__dirname, '..', 'signal-bot.json')

const BOT_ID = 'signal'
const POLL_MS = 30_000
const CANDLE_LIMIT = 400
const VALID_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']

export interface SignalBotConfig {
  symbol: string // Binance symbol, e.g. ETHUSDT
  timeframe: string
  strategyId: StrategyId
  params: Record<string, number>
  asset: string // Hyperliquid asset, e.g. ETH
  size: number
  slippagePct: number
  cooldownSec: number
  tradeSide: 'both' | 'buy' | 'sell'
}

export interface SignalBotStatus {
  running: boolean
  startedAt: number | null
  config: SignalBotConfig
  lastSignal: Signal
  lastSignalAt: number | null
  lastClosedBarTime: number | null
  lastEvaluatedAt: number | null
  lastError: string | null
  tradesExecuted: number
}

const DEFAULT_CONFIG: SignalBotConfig = {
  symbol: 'ETHUSDT',
  timeframe: '1h',
  strategyId: 'macd',
  params: defaultParams('macd'),
  asset: 'ETH',
  size: 0.1,
  slippagePct: 2,
  cooldownSec: 60,
  tradeSide: 'both',
}

// Validate a raw config object into a typed SignalBotConfig. Throws on bad
// input so the API can return a precise 400.
export function parseSignalConfig(body: unknown): SignalBotConfig {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Config must be a JSON object')
  }
  const b = body as Record<string, unknown>

  const symbol = typeof b.symbol === 'string' ? b.symbol.trim().toUpperCase() : ''
  if (!symbol) throw new Error('symbol is required')

  const timeframe = typeof b.timeframe === 'string' ? b.timeframe : ''
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    throw new Error(`timeframe must be one of: ${VALID_TIMEFRAMES.join(', ')}`)
  }

  const strategyId = b.strategyId as StrategyId
  const meta = STRATEGIES.find((s) => s.id === strategyId)
  if (!meta) throw new Error(`Unknown strategyId: ${String(b.strategyId)}`)

  // Keep only known params for the strategy, fall back to defaults.
  const rawParams = (typeof b.params === 'object' && b.params) || {}
  const params: Record<string, number> = {}
  for (const def of meta.params) {
    const v = (rawParams as Record<string, unknown>)[def.key]
    const num = typeof v === 'string' ? Number(v) : v
    params[def.key] = typeof num === 'number' && Number.isFinite(num) ? num : def.default
  }

  const asset = typeof b.asset === 'string' && b.asset.trim()
    ? b.asset.trim().toUpperCase()
    : symbol.replace(/USDT$/, '')

  const size = typeof b.size === 'string' ? Number(b.size) : b.size
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    throw new Error('size must be a positive number')
  }

  const slipRaw = typeof b.slippagePct === 'string' ? Number(b.slippagePct) : b.slippagePct
  const slippagePct = typeof slipRaw === 'number' && Number.isFinite(slipRaw) && slipRaw > 0
    ? slipRaw
    : 2

  const cdRaw = typeof b.cooldownSec === 'string' ? Number(b.cooldownSec) : b.cooldownSec
  const cooldownSec = typeof cdRaw === 'number' && Number.isFinite(cdRaw) && cdRaw >= 0
    ? cdRaw
    : 60

  const tradeSide =
    b.tradeSide === 'buy' || b.tradeSide === 'sell' ? b.tradeSide : 'both'

  return { symbol, timeframe, strategyId, params, asset, size, slippagePct, cooldownSec, tradeSide }
}

interface PersistedState {
  config: SignalBotConfig
  running: boolean
}

function readState(): PersistedState {
  if (existsSync(STATE_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
      return {
        config: parseSignalConfig(raw.config),
        running: Boolean(raw.running),
      }
    } catch {
      /* fall through to defaults */
    }
  }
  return { config: { ...DEFAULT_CONFIG }, running: false }
}

class SignalBot {
  private config: SignalBotConfig
  private log: Logger = createLogger(BOT_ID)
  private timer: NodeJS.Timeout | null = null
  private running = false
  private startedAt: number | null = null
  private lastSignal: Signal = null
  private lastSignalAt: number | null = null
  private lastClosedBarTime: number | null = null
  private lastEvaluatedAt: number | null = null
  private lastError: string | null = null
  private lastTradeAt = 0
  private tradesExecuted = 0
  private evaluating = false

  constructor() {
    const state = readState()
    this.config = state.config
  }

  getConfig(): SignalBotConfig {
    return this.config
  }

  // Replace the config. Only allowed while stopped — a running strategy
  // shouldn't have the ground shift under it mid-evaluation.
  setConfig(cfg: SignalBotConfig): void {
    if (this.running) throw new Error('Stop the signal bot before changing its config')
    this.config = cfg
    this.persist()
  }

  getStatus(): SignalBotStatus {
    return {
      running: this.running,
      startedAt: this.startedAt,
      config: this.config,
      lastSignal: this.lastSignal,
      lastSignalAt: this.lastSignalAt,
      lastClosedBarTime: this.lastClosedBarTime,
      lastEvaluatedAt: this.lastEvaluatedAt,
      lastError: this.lastError,
      tradesExecuted: this.tradesExecuted,
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.startedAt = Date.now()
    this.lastError = null
    // Skip the very first closed bar so we don't fire on an old signal the
    // moment the bot starts — only act on bars that close from now on.
    this.lastClosedBarTime = null
    this.primed = false
    this.persist()
    this.log.ok(
      `Signal bot started — ${this.config.strategyId.toUpperCase()} on ` +
        `${this.config.symbol} ${this.config.timeframe}`,
    )
    void this.tick()
    this.timer = setInterval(() => void this.tick(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.running) this.log.warn('Signal bot stopped')
    this.running = false
    this.startedAt = null
    this.persist()
  }

  // True once the first poll has recorded the current bar — subsequent new
  // bars are genuine closes that happened while we were watching.
  private primed = false

  private async tick(): Promise<void> {
    if (this.evaluating) return
    this.evaluating = true
    try {
      const cfg = this.config
      const candles = await fetchKlines(cfg.symbol, cfg.timeframe, CANDLE_LIMIT)
      this.lastEvaluatedAt = Date.now()
      this.lastError = null
      if (candles.length < 30) {
        this.log.warn(`Only ${candles.length} candles — not enough to evaluate`)
        return
      }

      // The last element is the still-forming bar; the one before it is the
      // most recent fully-closed bar.
      const closedIdx = candles.length - 2
      const closedBar = candles[closedIdx]

      if (!this.primed) {
        this.primed = true
        this.lastClosedBarTime = closedBar.time
        this.log.info(
          `Watching — first signal will be evaluated on the next ${cfg.timeframe} close`,
        )
        return
      }

      if (closedBar.time === this.lastClosedBarTime) return // no new bar yet
      this.lastClosedBarTime = closedBar.time

      const signals = generateSignals(cfg.strategyId, candles, cfg.params)
      const sig = signals[closedIdx]
      if (!sig) return

      this.lastSignal = sig
      this.lastSignalAt = Date.now()

      if (cfg.tradeSide !== 'both' && cfg.tradeSide !== sig) {
        this.log.info(`${sig.toUpperCase()} signal ignored (bot set to ${cfg.tradeSide}-only)`)
        return
      }

      const cooldownMs = cfg.cooldownSec * 1000
      const sinceLast = Date.now() - this.lastTradeAt
      if (cooldownMs > 0 && sinceLast < cooldownMs) {
        this.log.warn(
          `${sig.toUpperCase()} signal skipped — cooldown ` +
            `(${Math.ceil((cooldownMs - sinceLast) / 1000)}s left)`,
        )
        return
      }

      this.log.info(`${sig.toUpperCase()} signal on ${cfg.symbol} ${cfg.timeframe} close — executing`)
      this.lastTradeAt = Date.now()
      try {
        const result = await executeMarketTrade({
          asset: cfg.asset,
          side: sig,
          size: cfg.size,
          maxSlippagePct: cfg.slippagePct,
        })
        if (result.filled) this.tradesExecuted++
        this.log.fill(result.message)
      } catch (e) {
        this.lastError = (e as Error).message
        this.log.err(`Trade failed: ${this.lastError}`)
      }
    } catch (e) {
      this.lastError = (e as Error).message
      this.log.err(`Evaluation failed: ${this.lastError}`)
    } finally {
      this.evaluating = false
    }
  }

  private persist(): void {
    const state: PersistedState = { config: this.config, running: this.running }
    try {
      writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
    } catch (e) {
      this.log.err(`Could not persist signal-bot state: ${(e as Error).message}`)
    }
  }
}

export const signalBot = new SignalBot()

// Called on server boot — resumes the bot if it was running when the
// process last exited, so a restart doesn't silently stop trading.
export function maybeAutostartSignalBot(): void {
  if (readState().running) {
    createLogger(BOT_ID).info('Resuming signal bot from saved running state')
    signalBot.start()
  }
}
