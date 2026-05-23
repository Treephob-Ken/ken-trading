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
  defaultParams,
  generateSignals,
  type Signal,
  type StrategyId,
} from './strategy/strategies.js'
import { cancelAssetOrders, getAccountState, placeOrder } from './trade.js'

export interface TradeRecord {
  time: number         // Unix ms
  side: 'buy' | 'sell'
  asset: string
  size: number
  price: number | null // avgPx if filled
  filled: boolean
}

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
  // Budget mode: size is computed at start as (investment × leverage) / currentPrice.
  // Manual mode: size is specified directly. Exactly one must be provided.
  investment?: number // USDC budget
  leverage?: number   // multiplier (used only when investment is set)
  size: number        // fixed size; 0 signals budget mode (size computed at runtime)
  slippagePct: number
  cooldownSec: number
  tradeSide: 'both' | 'buy' | 'sell'
  tpPct?: number   // take-profit as % from fill price (e.g. 3 = +3%); bracket order placed after fill
  slPct?: number   // stop-loss as % from fill price (e.g. 2 = −2%); bracket order placed after fill
  // Ensemble mode — run multiple strategies and only trade when ≥ ensembleThreshold agree.
  // When false/absent, strategyId + params drive the single-strategy path.
  ensembleMode?: boolean
  ensembleStrategyIds?: StrategyId[]
  ensembleThreshold?: number // defaults to majority (ceil(n/2))
  // Multi-timeframe filter — before entering, check that the last signal on a
  // higher timeframe agrees with the current signal. Skip the trade if it doesn't.
  mtfEnabled?: boolean
  mtfTimeframe?: string // e.g. '4h' when the bot runs on '15m'
  // Daily loss circuit-breaker — pause new entries for the rest of the UTC day
  // once the account drops more than this % below its value at UTC midnight.
  dailyLossLimitPct?: number
}

export interface SignalBotStatus {
  id: string
  name: string
  running: boolean
  startedAt: number | null
  config: SignalBotConfig
  // Effective size actually used for trades. Equals config.size in manual mode;
  // in budget mode it is computed from (investment × leverage) / price on first tick.
  computedSize: number | null
  lastSignal: Signal
  lastSignalAt: number | null
  lastClosedBarTime: number | null
  lastEvaluatedAt: number | null
  lastError: string | null
  tradesExecuted: number
  // Ensemble mode: vote breakdown from the last evaluation (null in single mode).
  lastVotes: { buy: number; sell: number; abstain: number; threshold: number } | null
  // MTF filter: last signal direction seen on the higher timeframe (null = not checked yet).
  mtfTrend: Signal
  // Daily loss circuit-breaker state (null when feature is off).
  dailyPnlPct: number | null
  dailyPaused: boolean
}

export interface SignalBotSummary {
  id: string
  name: string
  running: boolean
  strategyId: StrategyId
  symbol: string
  timeframe: string
  ensembleMode?: boolean
  ensembleCount?: number
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

  // Budget mode — investment + leverage derive size at runtime from live price.
  const invRaw = typeof b.investment === 'string' ? Number(b.investment) : b.investment
  const investment =
    typeof invRaw === 'number' && Number.isFinite(invRaw) && invRaw > 0 ? invRaw : undefined

  const levRaw = typeof b.leverage === 'string' ? Number(b.leverage) : b.leverage
  const leverage =
    typeof levRaw === 'number' && Number.isFinite(levRaw) && levRaw >= 1 ? levRaw : undefined

  const sizeRaw = typeof b.size === 'string' ? Number(b.size) : b.size
  const sizeOk = typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) && sizeRaw > 0
  // size = 0 is the sentinel for "budget mode — compute at runtime".
  const size = sizeOk ? sizeRaw : 0

  if (!investment && !sizeOk) {
    throw new Error('Provide either investment + leverage (budget mode) or a positive size')
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

  // Ensemble mode
  const ensembleMode = b.ensembleMode === true
  let ensembleStrategyIds: StrategyId[] | undefined
  let ensembleThreshold: number | undefined
  if (ensembleMode) {
    const rawIds = Array.isArray(b.ensembleStrategyIds) ? b.ensembleStrategyIds : []
    ensembleStrategyIds = (rawIds as unknown[])
      .filter((id) => STRATEGIES.some((s) => s.id === id)) as StrategyId[]
    if (ensembleStrategyIds.length < 2) {
      throw new Error('Ensemble mode requires at least 2 valid strategy IDs in ensembleStrategyIds')
    }
    const tRaw = typeof b.ensembleThreshold === 'string' ? Number(b.ensembleThreshold) : b.ensembleThreshold
    ensembleThreshold =
      typeof tRaw === 'number' && tRaw >= 1
        ? Math.round(tRaw)
        : Math.ceil(ensembleStrategyIds.length / 2)
  }

  // MTF filter
  const mtfEnabled = b.mtfEnabled === true
  const mtfTimeframeRaw = typeof b.mtfTimeframe === 'string' ? b.mtfTimeframe : ''
  const mtfTimeframe =
    mtfEnabled && VALID_TIMEFRAMES.includes(mtfTimeframeRaw) ? mtfTimeframeRaw : undefined

  // Daily loss circuit-breaker
  const dlRaw = typeof b.dailyLossLimitPct === 'string' ? Number(b.dailyLossLimitPct) : b.dailyLossLimitPct
  const dailyLossLimitPct =
    typeof dlRaw === 'number' && dlRaw > 0 && dlRaw <= 100 ? dlRaw : undefined

  // TP / SL as % from fill price
  const tpRaw = typeof b.tpPct === 'string' ? Number(b.tpPct) : b.tpPct
  const tpPct = typeof tpRaw === 'number' && tpRaw > 0 ? tpRaw : undefined
  const slRaw = typeof b.slPct === 'string' ? Number(b.slPct) : b.slPct
  const slPct = typeof slRaw === 'number' && slRaw > 0 ? slRaw : undefined

  return {
    symbol, timeframe, strategyId, params, asset,
    investment, leverage, size, slippagePct, cooldownSec, tradeSide,
    ...(tpPct !== undefined ? { tpPct } : {}),
    ...(slPct !== undefined ? { slPct } : {}),
    ...(ensembleMode ? { ensembleMode, ensembleStrategyIds, ensembleThreshold } : {}),
    ...(mtfEnabled && mtfTimeframe ? { mtfEnabled, mtfTimeframe } : {}),
    ...(dailyLossLimitPct !== undefined ? { dailyLossLimitPct } : {}),
  }
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
  // In budget mode (investment + leverage set), the effective trade size is
  // computed from (investment × leverage) / currentPrice on the first tick.
  private computedSize: number | null = null
  // Ensemble mode: vote breakdown from the last evaluation.
  private lastVotes: SignalBotStatus['lastVotes'] = null
  // MTF filter: last HTF signal direction observed.
  private mtfTrend: Signal = null
  // Daily loss circuit-breaker state.
  private dailyDate = ''
  private dailyStartEquity: number | null = null
  private dailyPaused = false
  private dailyPnlPct: number | null = null
  // In-session trade journal (last 100 fills, reset on restart).
  private trades: TradeRecord[] = []
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
      ensembleMode: this.config.ensembleMode,
      ensembleCount: this.config.ensembleStrategyIds?.length,
    }
  }

  getStatus(): SignalBotStatus {
    return {
      id: this.id,
      name: this.name,
      running: this.running,
      startedAt: this.startedAt,
      config: this.config,
      computedSize: this.computedSize,
      lastSignal: this.lastSignal,
      lastSignalAt: this.lastSignalAt,
      lastClosedBarTime: this.lastClosedBarTime,
      lastEvaluatedAt: this.lastEvaluatedAt,
      lastError: this.lastError,
      tradesExecuted: this.tradesExecuted,
      lastVotes: this.lastVotes,
      mtfTrend: this.mtfTrend,
      dailyPnlPct: this.dailyPnlPct,
      dailyPaused: this.dailyPaused,
    }
  }

  getTrades(): TradeRecord[] {
    return [...this.trades]
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
    this.lastClosedBarTime = null
    this.primed = false
    this.computedSize = null
    this.lastVotes = null
    this.mtfTrend = null
    this.dailyDate = ''
    this.dailyStartEquity = null
    this.dailyPaused = false
    this.dailyPnlPct = null
    this.trades = []
    this.persist()
    const cfg = this.config
    if (cfg.ensembleMode && cfg.ensembleStrategyIds?.length) {
      const total = cfg.ensembleStrategyIds.length
      const threshold = cfg.ensembleThreshold ?? Math.ceil(total / 2)
      this.log.ok(
        `Started — Ensemble (${threshold}/${total} votes needed): ` +
          `[${cfg.ensembleStrategyIds.join('+')}] on ${cfg.symbol} ${cfg.timeframe}`,
      )
    } else {
      this.log.ok(
        `Started — ${cfg.strategyId.toUpperCase()} on ` +
          `${cfg.symbol} ${cfg.timeframe}`,
      )
    }
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

      // Budget mode: derive order size from investment × leverage / current price.
      // Computed once per session (resets on restart) so price drift doesn't
      // silently change position size mid-run.
      if (this.computedSize === null && cfg.investment && cfg.leverage) {
        const livePrice = candles[candles.length - 1].close
        this.computedSize = (cfg.investment * cfg.leverage) / livePrice
        this.log.info(
          `Budget mode: $${cfg.investment} × ${cfg.leverage}x` +
            ` = $${(cfg.investment * cfg.leverage).toFixed(2)} notional` +
            ` / ${livePrice} = ${this.computedSize.toFixed(6)} ${cfg.asset} per trade`,
        )
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

      // ── Signal evaluation: ensemble or single-strategy ──────────────────
      let sig: Signal
      if (cfg.ensembleMode && cfg.ensembleStrategyIds && cfg.ensembleStrategyIds.length >= 2) {
        let buy = 0, sell = 0, abstain = 0
        for (const stratId of cfg.ensembleStrategyIds) {
          const sigs = generateSignals(stratId, candles, defaultParams(stratId))
          const s = sigs[closedIdx]
          if (s === 'buy') buy++
          else if (s === 'sell') sell++
          else abstain++
        }
        const total = cfg.ensembleStrategyIds.length
        const threshold = cfg.ensembleThreshold ?? Math.ceil(total / 2)
        this.lastVotes = { buy, sell, abstain, threshold }
        sig = buy >= threshold ? 'buy' : sell >= threshold ? 'sell' : null
        this.log.info(
          `Ensemble [${cfg.ensembleStrategyIds.map((id) => id.toUpperCase()).join('+')}]: ` +
            `BUY=${buy} SELL=${sell} ABSTAIN=${abstain} (need ${threshold})` +
            (sig ? ` → ${sig.toUpperCase()} ✓` : ' → no consensus'),
        )
      } else {
        this.lastVotes = null
        const signals = generateSignals(cfg.strategyId, candles, cfg.params)
        sig = signals[closedIdx]
      }

      if (!sig) return

      // ── MTF filter ─────────────────────────────────────────────────────────
      // Check that the last signal on the higher timeframe agrees before entering.
      if (cfg.mtfEnabled && cfg.mtfTimeframe) {
        try {
          const htfCandles = await fetchKlines(cfg.symbol, cfg.mtfTimeframe, CANDLE_LIMIT)
          if (htfCandles.length >= 30) {
            const htfSigs = generateSignals(cfg.strategyId, htfCandles, cfg.params)
            let htfLast: Signal = null
            for (let i = htfSigs.length - 2; i >= 0; i--) {
              if (htfSigs[i] !== null) { htfLast = htfSigs[i]; break }
            }
            this.mtfTrend = htfLast
            if (htfLast !== null && htfLast !== sig) {
              this.log.info(
                `MTF filter (${cfg.mtfTimeframe}): ${sig.toUpperCase()} blocked` +
                  ` — HTF last signal: ${htfLast.toUpperCase()}`,
              )
              return
            }
          }
        } catch (e) {
          this.log.warn(`MTF filter error: ${(e as Error).message} — proceeding without filter`)
        }
      }

      // ── Daily loss circuit-breaker ──────────────────────────────────────────
      if (cfg.dailyLossLimitPct && cfg.dailyLossLimitPct > 0) {
        const today = new Date().toISOString().slice(0, 10)
        if (today !== this.dailyDate) {
          // UTC day rolled over — snapshot fresh start equity.
          this.dailyDate = today
          this.dailyPaused = false
          this.dailyPnlPct = null
          try {
            const acct = await getAccountState()
            this.dailyStartEquity = acct.accountValue
            this.log.info(`Daily reset: start equity $${this.dailyStartEquity.toFixed(2)}`)
          } catch {
            this.dailyStartEquity = null
          }
        }
        if (this.dailyStartEquity !== null) {
          try {
            const acct = await getAccountState()
            const lossPct = ((this.dailyStartEquity - acct.accountValue) / this.dailyStartEquity) * 100
            this.dailyPnlPct = -lossPct // positive = profit, negative = loss
            if (lossPct >= cfg.dailyLossLimitPct) {
              if (!this.dailyPaused) {
                this.dailyPaused = true
                this.log.warn(
                  `Daily loss limit hit: −${lossPct.toFixed(1)}%` +
                    ` (limit: ${cfg.dailyLossLimitPct}%) — no new entries until tomorrow UTC`,
                )
              }
              return
            }
            this.dailyPaused = false
          } catch {
            // Can't reach Hyperliquid for balance check — don't block trading.
          }
        }
      }

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

      const tradeSize = (cfg.investment && cfg.leverage && this.computedSize !== null)
        ? this.computedSize
        : cfg.size
      this.log.info(`${sig.toUpperCase()} signal on ${cfg.symbol} ${cfg.timeframe} close — executing`)
      this.lastTradeAt = Date.now()
      try {
        // Cancel stale TP/SL bracket orders from the previous trade so they
        // don't double-close the position when the new signal fires.
        const cancelled = await cancelAssetOrders(cfg.asset)
        if (cancelled > 0) this.log.info(`Cleared ${cancelled} stale order(s) for ${cfg.asset}`)

        const result = await placeOrder({
          asset: cfg.asset,
          side: sig,
          size: tradeSize,
          orderType: 'market',
          maxSlippagePct: cfg.slippagePct,
          tpPct: cfg.tpPct,
          slPct: cfg.slPct,
        })
        if (result.filled) this.tradesExecuted++
        if (result.filled && (result.tpPlaced || result.slPlaced)) {
          this.log.info(`Bracket orders: ${result.tpPlaced ? 'TP✓' : 'TP✗'} ${result.slPlaced ? 'SL✓' : 'SL✗'}`)
        }
        // Append to in-session trade journal (capped at 100 entries).
        this.trades.push({
          time: Date.now(),
          side: sig,
          asset: cfg.asset,
          size: result.filledSize,
          price: result.avgPx,
          filled: result.filled,
        })
        if (this.trades.length > 100) this.trades = this.trades.slice(-100)
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

export function listSignalBotTrades(id: string): TradeRecord[] {
  return getSignalBot(id).getTrades()
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
