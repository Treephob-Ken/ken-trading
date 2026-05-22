// Indicator-signal trading bots.
//
// Each SignalBot evaluates one technical strategy on one market and fires a
// market order whenever a fresh BUY/SELL signal prints on a newly-closed bar.
// Multiple bots run concurrently in the same process — each with its own
// config, scoped logger, and persisted state file — mirroring the multi grid
// bot setup. The web UI is a view/control layer; all state reads back here.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearLogBuffer, createLogger, type Logger } from './logger.js'
import { fetchKlines } from './strategy/market-data.js'
import {
  STRATEGIES,
  generateSignals,
  type Signal,
  type StrategyId,
} from './strategy/strategies.js'
import { executeMarketTrade } from './trade.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIGNAL_DIR = join(__dirname, '..', 'signal-bots')
const LEGACY_PATH = join(__dirname, '..', 'signal-bot.json')

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
  id: string
  name: string
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

export interface SignalBotSummary {
  id: string
  name: string
  running: boolean
  strategyId: StrategyId
  symbol: string
  timeframe: string
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

interface PersistedSignalBot {
  id: string
  name: string
  config: SignalBotConfig
  running: boolean
}

class SignalBot {
  readonly id: string
  name: string
  private config: SignalBotConfig
  private log: Logger
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
  // True once the first poll has recorded the current bar — only bars that
  // close after that are genuine signals we should act on.
  private primed = false

  constructor(id: string, name: string, config: SignalBotConfig) {
    this.id = id
    this.name = name
    this.config = config
    this.log = createLogger('signal-' + id)
  }

  getConfig(): SignalBotConfig {
    return this.config
  }

  isRunning(): boolean {
    return this.running
  }

  summary(): SignalBotSummary {
    return {
      id: this.id,
      name: this.name,
      running: this.running,
      strategyId: this.config.strategyId,
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
    }
  }

  getStatus(): SignalBotStatus {
    return {
      id: this.id,
      name: this.name,
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

  // Replace the config. Only allowed while stopped — a running strategy
  // shouldn't have the ground shift under it mid-evaluation.
  setConfig(cfg: SignalBotConfig): void {
    if (this.running) throw new Error('Stop the bot before changing its config')
    this.config = cfg
    this.persist()
  }

  rename(name: string): void {
    this.name = name.trim() || this.name
    this.persist()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.startedAt = Date.now()
    this.lastError = null
    // Skip the very first closed bar so we don't fire on an old signal.
    this.lastClosedBarTime = null
    this.primed = false
    this.persist()
    this.log.ok(
      `Started — ${this.config.strategyId.toUpperCase()} on ` +
        `${this.config.symbol} ${this.config.timeframe}`,
    )
    void this.tick()
    this.timer = setInterval(() => void this.tick(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.running) this.log.warn('Stopped')
    this.running = false
    this.startedAt = null
    this.persist()
  }

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

  persist(): void {
    const state: PersistedSignalBot = {
      id: this.id,
      name: this.name,
      config: this.config,
      running: this.running,
    }
    try {
      ensureDir()
      writeFileSync(join(SIGNAL_DIR, this.id + '.json'), JSON.stringify(state, null, 2))
    } catch (e) {
      this.log.err(`Could not persist signal-bot state: ${(e as Error).message}`)
    }
  }
}

// ─────────────────────────── Manager ───────────────────────────

const bots = new Map<string, SignalBot>()
let loaded = false

function ensureDir(): void {
  if (!existsSync(SIGNAL_DIR)) mkdirSync(SIGNAL_DIR, { recursive: true })
}

function slugify(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bot'
  )
}

function uniqueId(base: string): string {
  let id = base
  let n = 2
  while (bots.has(id) || existsSync(join(SIGNAL_DIR, id + '.json'))) {
    id = `${base}-${n}`
    n++
  }
  return id
}

// Read every persisted bot into memory. Bots are loaded stopped; resuming
// happens in maybeAutostartSignalBots so the running flag survives a restart.
function loadAll(): void {
  if (loaded) return
  loaded = true
  ensureDir()

  // Migrate the legacy single-bot file into a per-bot file.
  if (existsSync(LEGACY_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(LEGACY_PATH, 'utf8'))
      const cfg = parseSignalConfig(raw.config)
      const id = uniqueId(slugify(`${cfg.strategyId}-${cfg.symbol}`))
      const persisted: PersistedSignalBot = {
        id,
        name: `${cfg.strategyId.toUpperCase()} ${cfg.symbol}`,
        config: cfg,
        running: Boolean(raw.running),
      }
      writeFileSync(join(SIGNAL_DIR, id + '.json'), JSON.stringify(persisted, null, 2))
      unlinkSync(LEGACY_PATH)
    } catch {
      /* ignore an unreadable legacy file */
    }
  }

  for (const file of readdirSync(SIGNAL_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(join(SIGNAL_DIR, file), 'utf8')) as PersistedSignalBot
      if (!raw.id || bots.has(raw.id)) continue
      bots.set(raw.id, new SignalBot(raw.id, raw.name || raw.id, parseSignalConfig(raw.config)))
    } catch {
      /* skip a corrupt bot file */
    }
  }
}

export function listSignalBots(): SignalBotSummary[] {
  loadAll()
  return [...bots.values()].map((b) => b.summary())
}

export function getSignalBot(id: string): SignalBot {
  loadAll()
  const b = bots.get(id)
  if (!b) throw new Error(`Signal bot not found: ${id}`)
  return b
}

export function createSignalBot(name: string, config: SignalBotConfig): SignalBot {
  loadAll()
  const label = name.trim() || `${config.strategyId.toUpperCase()} ${config.symbol}`
  const id = uniqueId(slugify(label))
  const bot = new SignalBot(id, label, config)
  bots.set(id, bot)
  bot.persist()
  return bot
}

export function deleteSignalBot(id: string): void {
  const bot = getSignalBot(id)
  bot.stop()
  bots.delete(id)
  clearLogBuffer('signal-' + id)
  try {
    unlinkSync(join(SIGNAL_DIR, id + '.json'))
  } catch {
    /* already gone */
  }
}

// Called on server boot — resumes every bot that was running when the process
// last exited, so a restart doesn't silently stop trading.
export function maybeAutostartSignalBots(): void {
  loadAll()
  if (!existsSync(SIGNAL_DIR)) return
  for (const file of readdirSync(SIGNAL_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(join(SIGNAL_DIR, file), 'utf8')) as PersistedSignalBot
      const bot = bots.get(raw.id)
      if (bot && raw.running && !bot.isRunning()) {
        createLogger('signal-' + raw.id).info('Resuming from saved running state')
        bot.start()
      }
    } catch {
      /* ignore */
    }
  }
}
