// Indicator-signal trading bots.
//
// Each SignalBot evaluates one technical strategy on one market and fires a
// market order whenever a fresh BUY/SELL signal prints on a newly-closed bar.
// Multiple bots run concurrently in the same process — each with its own
// config, scoped logger, and persisted state file — mirroring the multi grid
// bot setup. The web UI is a view/control layer; all state reads back here.
//
// Multi-user mode: each bot belongs to a userId. Data is stored under
// data/<userId>/signal-bots/. All manager functions accept an optional userId;
// when omitted, the legacy single-tenant paths are used.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
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
import { cancelOrdersByOid, getAccountState, getAssetInfo, placeOrder, snapshotAssetOrderOids } from './trade.js'
import { MULTI_USER } from './auth.js'
import type { EnvConfig } from './config.js'

export interface TradeRecord {
  time: number         // Unix ms
  side: 'buy' | 'sell'
  asset: string
  size: number
  price: number | null // avgPx if filled
  filled: boolean
  riskUsd?: number     // risk per trade in USDC (risk mode)
  slPct?: number       // SL % used to compute position (risk mode)
  positionUsd?: number // notional position value at entry
}

const __dirname = dirname(fileURLToPath(import.meta.url))
// Single-tenant (legacy) paths
const SIGNAL_DIR_LEGACY = join(__dirname, '..', 'signal-bots')
const LEGACY_PATH = join(__dirname, '..', 'signal-bot.json')
// Multi-tenant base
const DATA_DIR = join(__dirname, '..', 'data')

const POLL_MS = 30_000
const CANDLE_LIMIT = 400
const VALID_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']

function signalDirForUser(userId?: string): string {
  if (userId) return join(DATA_DIR, userId, 'signal-bots')
  return SIGNAL_DIR_LEGACY
}

export interface SignalBotConfig {
  symbol: string // Binance symbol, e.g. ETHUSDT
  timeframe: string
  strategyId: StrategyId
  params: Record<string, number>
  asset: string // Hyperliquid asset, e.g. ETH
  // Risk mode: positionUsd = riskUsd / (slPct/100); size = positionUsd / currentPrice.
  // Budget mode (legacy): size = (investment × leverage) / currentPrice.
  // Manual mode: size is specified directly. Exactly one must be provided.
  riskUsd?: number    // risk per trade in USDC; requires slPct to be set
  investment?: number // USDC budget (legacy budget mode)
  leverage?: number   // multiplier (legacy budget mode only)
  size: number        // fixed size; 0 signals computed mode (risk or budget)
  slippagePct: number
  cooldownSec: number
  tradeSide: 'both' | 'buy' | 'sell'
  tpPct?: number   // take-profit as % from fill price; bracket order placed after fill
  slPct?: number   // stop-loss as % from fill price; bracket order placed after fill
  // Ensemble mode — run multiple strategies and only trade when ≥ ensembleThreshold agree.
  ensembleMode?: boolean
  ensembleStrategyIds?: StrategyId[]
  ensembleThreshold?: number // defaults to majority (ceil(n/2))
  // Multi-timeframe filter — before entering, check that the last signal on a
  // higher timeframe agrees with the current signal.
  mtfEnabled?: boolean
  mtfTimeframe?: string // e.g. '4h' when the bot runs on '15m'
  // Daily loss circuit-breaker — pause new entries for the rest of the UTC day
  // once the account drops more than this % below its value at UTC midnight.
  dailyLossLimitPct?: number
  // Pre-trade slippage gate — abort the trade if HL's current mid differs
  // from the Binance signal close (the price the bot saw when deciding) by
  // more than this %. Catches Binance↔HL divergence during fast moves where
  // the bot would otherwise enter at an adverse HL price. Default 0.30%.
  maxDivergencePct?: number
}

export interface SignalBotStatus {
  id: string
  name: string
  running: boolean
  startedAt: number | null
  config: SignalBotConfig
  computedSize: number | null
  lastSignal: Signal
  lastSignalAt: number | null
  lastClosedBarTime: number | null
  lastEvaluatedAt: number | null
  lastError: string | null
  tradesExecuted: number
  lastVotes: { buy: number; sell: number; abstain: number; threshold: number } | null
  mtfTrend: Signal
  dailyPnlPct: number | null
  dailyPaused: boolean
  pausedForNetworkSwitch: boolean
  // Set when the bot auto-stopped after 3+ consecutive failed orders (most
  // commonly insufficient margin). Null when the bot is healthy.
  autoPausedReason: string | null
  // Signal funnel — counts since last start. Lets the UI explain
  // "why didn't it trade?" without scraping the log.
  signalsSeen: number          // actionable signals on a freshly closed bar (post ensemble consensus)
  signalsExecuted: number      // signals that reached placeOrder (pre-fill)
  blockedByMtf: number
  blockedByCooldown: number
  blockedByDailyPause: number
  blockedByEnsemble: number    // ensemble had votes but didn't reach threshold
  blockedBySlippage: number    // HL price drifted too far from Binance signal price
  lastTradeAt: number          // 0 if never traded this session
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
  pausedForNetworkSwitch?: boolean
}

// Validate a raw config object into a typed SignalBotConfig. Throws on bad
// input so the API can return a precise 400.
export function parseSignalConfig(body: unknown): SignalBotConfig {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Config must be a JSON object')
  }
  const b = body as Record<string, unknown>

  // For HIP-3 (colon names) the dex prefix MUST stay lowercase or HL's
  // candleSnapshot 500s. Uppercase plain crypto tickers as before.
  const symbolRaw = typeof b.symbol === 'string' ? b.symbol.trim() : ''
  const symbol = symbolRaw.includes(':')
    ? symbolRaw.slice(0, symbolRaw.indexOf(':')).toLowerCase() + ':' + symbolRaw.slice(symbolRaw.indexOf(':') + 1).toUpperCase()
    : symbolRaw.toUpperCase()
  if (!symbol) throw new Error('symbol is required')

  const timeframe = typeof b.timeframe === 'string' ? b.timeframe : ''
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    throw new Error(`timeframe must be one of: ${VALID_TIMEFRAMES.join(', ')}`)
  }

  const strategyId = b.strategyId as StrategyId
  const meta = STRATEGIES.find((s) => s.id === strategyId)
  if (!meta) throw new Error(`Unknown strategyId: ${String(b.strategyId)}`)

  const rawParams = (typeof b.params === 'object' && b.params) || {}
  const params: Record<string, number> = {}
  for (const def of meta.params) {
    const v = (rawParams as Record<string, unknown>)[def.key]
    const num = typeof v === 'string' ? Number(v) : v
    params[def.key] = typeof num === 'number' && Number.isFinite(num) ? num : def.default
  }

  // Canonical asset shape: `dex:COIN` for HIP-3 (preserve dex lowercase, coin
  // upper); plain UPPERCASE ticker for main perps.
  const canonAsset = (raw: string): string => {
    const s = raw.trim()
    if (s.includes(':')) {
      const i = s.indexOf(':')
      return s.slice(0, i).toLowerCase() + ':' + s.slice(i + 1).toUpperCase()
    }
    return s.toUpperCase()
  }
  const asset = typeof b.asset === 'string' && b.asset.trim()
    ? canonAsset(b.asset)
    : canonAsset(symbol.replace(/USDT$/, ''))

  const riskRaw = typeof b.riskUsd === 'string' ? Number(b.riskUsd) : b.riskUsd
  const riskUsd =
    typeof riskRaw === 'number' && Number.isFinite(riskRaw) && riskRaw > 0 ? riskRaw : undefined

  const invRaw = typeof b.investment === 'string' ? Number(b.investment) : b.investment
  const investment =
    typeof invRaw === 'number' && Number.isFinite(invRaw) && invRaw > 0 ? invRaw : undefined

  const levRaw = typeof b.leverage === 'string' ? Number(b.leverage) : b.leverage
  const leverage =
    typeof levRaw === 'number' && Number.isFinite(levRaw) && levRaw >= 1 ? levRaw : undefined

  const sizeRaw = typeof b.size === 'string' ? Number(b.size) : b.size
  const sizeOk = typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) && sizeRaw > 0
  const size = sizeOk ? sizeRaw : 0

  if (!riskUsd && !investment && !sizeOk) {
    throw new Error('Provide a risk per trade (riskUsd), a budget (investment), or a fixed size')
  }

  const slipRaw = typeof b.slippagePct === 'string' ? Number(b.slippagePct) : b.slippagePct
  const slippagePct = typeof slipRaw === 'number' && Number.isFinite(slipRaw) && slipRaw > 0
    ? slipRaw : 2

  const cdRaw = typeof b.cooldownSec === 'string' ? Number(b.cooldownSec) : b.cooldownSec
  const cooldownSec = typeof cdRaw === 'number' && Number.isFinite(cdRaw) && cdRaw >= 0
    ? cdRaw : 60

  const tradeSide =
    b.tradeSide === 'buy' || b.tradeSide === 'sell' ? b.tradeSide : 'both'

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

  const mtfEnabled = b.mtfEnabled === true
  const mtfTimeframeRaw = typeof b.mtfTimeframe === 'string' ? b.mtfTimeframe : ''
  const mtfTimeframe =
    mtfEnabled && VALID_TIMEFRAMES.includes(mtfTimeframeRaw) ? mtfTimeframeRaw : undefined

  const dlRaw = typeof b.dailyLossLimitPct === 'string' ? Number(b.dailyLossLimitPct) : b.dailyLossLimitPct
  const dailyLossLimitPct =
    typeof dlRaw === 'number' && dlRaw > 0 && dlRaw <= 100 ? dlRaw : undefined

  const mdRaw = typeof b.maxDivergencePct === 'string' ? Number(b.maxDivergencePct) : b.maxDivergencePct
  const maxDivergencePct =
    typeof mdRaw === 'number' && mdRaw > 0 && mdRaw <= 10 ? mdRaw : undefined

  const tpRaw = typeof b.tpPct === 'string' ? Number(b.tpPct) : b.tpPct
  const tpPct = typeof tpRaw === 'number' && tpRaw > 0 ? tpRaw : undefined
  const slRaw = typeof b.slPct === 'string' ? Number(b.slPct) : b.slPct
  const slPct = typeof slRaw === 'number' && slRaw > 0 ? slRaw : undefined

  return {
    symbol, timeframe, strategyId, params, asset,
    ...(riskUsd !== undefined ? { riskUsd } : {}),
    investment, leverage, size, slippagePct, cooldownSec, tradeSide,
    ...(tpPct !== undefined ? { tpPct } : {}),
    ...(slPct !== undefined ? { slPct } : {}),
    ...(ensembleMode ? { ensembleMode, ensembleStrategyIds, ensembleThreshold } : {}),
    ...(mtfEnabled && mtfTimeframe ? { mtfEnabled, mtfTimeframe } : {}),
    ...(dailyLossLimitPct !== undefined ? { dailyLossLimitPct } : {}),
    ...(maxDivergencePct !== undefined ? { maxDivergencePct } : {}),
  }
}

interface PersistedSignalBot {
  id: string
  name: string
  config: SignalBotConfig
  running: boolean
  // True when the bot was auto-stopped because the user switched to mainnet
  // while this bot was running. On the next switch back to testnet, the server
  // will auto-resume bots with this flag set and clear it. Independent of
  // `running` so the bot list UI can show "Paused" instead of plain "Stopped".
  pausedForNetworkSwitch?: boolean
}

class SignalBot {
  readonly id: string
  readonly userId: string | undefined
  name: string
  private config: SignalBotConfig
  // In multi-user mode: the user's decrypted HL credentials. Null = single-tenant.
  private creds: EnvConfig | null
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
  // Track consecutive "Not filled" rejections (e.g. insufficient margin) so we
  // can auto-pause the bot before it spams HL and burns the hourly rate limit.
  private consecutiveNotFilled = 0
  private autoPausedReason: string | null = null
  private evaluating = false
  private computedSize: number | null = null
  private lastVotes: SignalBotStatus['lastVotes'] = null
  private mtfTrend: Signal = null
  private dailyDate = ''
  private dailyStartEquity: number | null = null
  private dailyPaused = false
  private dailyPnlPct: number | null = null
  // Set when the server auto-stopped this bot because the user switched to
  // mainnet while it was running. Cleared on auto-resume (switch back to
  // testnet) or when the user manually starts it.
  private pausedForNetworkSwitch = false
  private trades: TradeRecord[] = []
  // True once the first poll has recorded the current bar — only bars that
  // close after that are genuine signals we should act on.
  private primed = false
  // Signal funnel counters — reset on start()
  private signalsSeen = 0
  private signalsExecuted = 0
  private blockedByMtf = 0
  private blockedByCooldown = 0
  private blockedByDailyPause = 0
  private blockedByEnsemble = 0
  private blockedBySlippage = 0

  constructor(
    id: string,
    name: string,
    config: SignalBotConfig,
    userId?: string,
    creds: EnvConfig | null = null,
  ) {
    this.id = id
    this.userId = userId
    this.name = name
    this.config = config
    this.creds = creds
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
      pausedForNetworkSwitch: this.pausedForNetworkSwitch,
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
      pausedForNetworkSwitch: this.pausedForNetworkSwitch,
      autoPausedReason: this.autoPausedReason,
      signalsSeen: this.signalsSeen,
      signalsExecuted: this.signalsExecuted,
      blockedByMtf: this.blockedByMtf,
      blockedByCooldown: this.blockedByCooldown,
      blockedByDailyPause: this.blockedByDailyPause,
      blockedByEnsemble: this.blockedByEnsemble,
      blockedBySlippage: this.blockedBySlippage,
      lastTradeAt: this.lastTradeAt,
    }
  }

  getTrades(): TradeRecord[] {
    return [...this.trades]
  }

  setConfig(cfg: SignalBotConfig): void {
    if (this.running) throw new Error('Stop the bot before changing its config')
    this.config = cfg
    this.persist()
  }

  rename(name: string): void {
    this.name = name.trim() || this.name
    this.persist()
  }

  // Update the user's HL credentials (called when they save new keys).
  updateCreds(creds: EnvConfig | null): void {
    this.creds = creds
  }

  // Forget today's equity baseline. Called when the user switches HL network
  // — the old baseline was taken on a different account, so re-snapshot at
  // the next poll instead of computing daily PnL against the wrong reference.
  resetDailyBaseline(): void {
    this.dailyDate = ''
    this.dailyStartEquity = null
    this.dailyPaused = false
    this.dailyPnlPct = null
  }

  start(): void {
    if (this.running) return
    // Starting clears the network-switch pause marker — whether the start was
    // an automatic resume on testnet switch, or the user explicitly clicked
    // Start while the bot was still paused.
    this.pausedForNetworkSwitch = false
    this.autoPausedReason = null
    this.consecutiveNotFilled = 0
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
    this.signalsSeen = 0
    this.signalsExecuted = 0
    this.blockedByMtf = 0
    this.blockedByCooldown = 0
    this.blockedByDailyPause = 0
    this.blockedByEnsemble = 0
    this.blockedBySlippage = 0
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

      // Risk mode: positionUsd = riskUsd / (slPct/100); size = positionUsd / currentPrice.
      // Budget mode (legacy): size = (investment × leverage) / currentPrice.
      // Both computed once per session at startup so price drift doesn't silently alter size.
      if (this.computedSize === null) {
        const livePrice = candles[candles.length - 1].close
        if (cfg.riskUsd && cfg.slPct && cfg.slPct > 0) {
          const positionUsd = cfg.riskUsd / (cfg.slPct / 100)
          this.computedSize = positionUsd / livePrice
          this.log.info(
            `Risk mode: $${cfg.riskUsd} risk / ${cfg.slPct}% SL` +
              ` = $${positionUsd.toFixed(2)} position` +
              ` / ${livePrice} = ${this.computedSize.toFixed(6)} ${cfg.asset} per trade`,
          )
        } else if (cfg.investment && cfg.leverage) {
          this.computedSize = (cfg.investment * cfg.leverage) / livePrice
          this.log.info(
            `Budget mode: $${cfg.investment} × ${cfg.leverage}x` +
              ` = $${(cfg.investment * cfg.leverage).toFixed(2)} notional` +
              ` / ${livePrice} = ${this.computedSize.toFixed(6)} ${cfg.asset} per trade`,
          )
        }
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

      if (!sig) {
        // Ensemble had votes but didn't reach consensus → count as an
        // ensemble block so the funnel can show why nothing was traded.
        if (cfg.ensembleMode && this.lastVotes && (this.lastVotes.buy + this.lastVotes.sell) > 0) {
          this.blockedByEnsemble++
        }
        return
      }
      this.signalsSeen++

      // ── MTF filter ─────────────────────────────────────────────────────────
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
              this.blockedByMtf++
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
          this.dailyDate = today
          this.dailyPaused = false
          this.dailyPnlPct = null
          try {
            const acct = await getAccountState(undefined, this.creds)
            this.dailyStartEquity = acct.accountValue
            this.log.info(`Daily reset: start equity $${this.dailyStartEquity.toFixed(2)}`)
          } catch {
            this.dailyStartEquity = null
          }
        }
        if (this.dailyStartEquity !== null) {
          try {
            const acct = await getAccountState(undefined, this.creds)
            const lossPct = ((this.dailyStartEquity - acct.accountValue) / this.dailyStartEquity) * 100
            this.dailyPnlPct = -lossPct
            if (lossPct >= cfg.dailyLossLimitPct) {
              if (!this.dailyPaused) {
                this.dailyPaused = true
                this.log.warn(
                  `Daily loss limit hit: −${lossPct.toFixed(1)}%` +
                    ` (limit: ${cfg.dailyLossLimitPct}%) — no new entries until tomorrow UTC`,
                )
              }
              this.blockedByDailyPause++
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

      // ── Slippage gate ───────────────────────────────────────────────────
      // Bot evaluates on Binance candles but trades on Hyperliquid. During
      // fast moves these prices can diverge enough that the HL fill would
      // be at a meaningfully worse price than the bar close that fired the
      // signal. Reject the trade when the gap exceeds the configured max.
      if (cfg.maxDivergencePct && cfg.maxDivergencePct > 0) {
        const signalPx = closedBar.close
        try {
          const hlInfo = await getAssetInfo(cfg.asset, this.creds)
          const hlMid = hlInfo.midPx
          if (signalPx > 0 && Number.isFinite(hlMid) && hlMid > 0) {
            const divPct = Math.abs((hlMid - signalPx) / signalPx) * 100
            if (divPct > cfg.maxDivergencePct) {
              this.blockedBySlippage++
              this.log.warn(
                `${sig.toUpperCase()} blocked by slippage gate: HL mid ${hlMid.toFixed(4)}` +
                  ` vs signal ${signalPx.toFixed(4)} = ${divPct.toFixed(2)}% drift` +
                  ` (max ${cfg.maxDivergencePct}%)`,
              )
              return
            }
          }
        } catch (e) {
          this.log.warn(`Slippage gate check failed: ${(e as Error).message} — proceeding without check`)
        }
      }

      // ── Position-aware execution ─────────────────────────────────────────
      // Fetch live position so we know what to close before opening.
      const state = await getAccountState(cfg.asset, this.creds)
      const pos = state.position   // { side: 'long'|'short', size: number } | null
      const tradeSize = this.computedSize !== null ? this.computedSize : cfg.size

      // Decide what to do: willOpen = place a new entry; willClose = reduce-only
      // close of the existing opposite position first.
      let willOpen = false
      let willClose = false
      let closeSize = 0
      let closeSide: 'buy' | 'sell' = 'buy'
      let openSide: 'buy' | 'sell' = sig

      if (cfg.tradeSide === 'both') {
        // Long & Short: always enter in signal direction; close the opposite first.
        willOpen = true
        if (sig === 'buy') {
          openSide = 'buy'
          if (pos && pos.side === 'short') { willClose = true; closeSide = 'buy'; closeSize = pos.size }
        } else {
          openSide = 'sell'
          if (pos && pos.side === 'long') { willClose = true; closeSide = 'sell'; closeSize = pos.size }
        }
      } else if (cfg.tradeSide === 'buy') {
        // Long only: BUY → open long (skip if already long); SELL → close long, no short.
        if (sig === 'buy') {
          if (pos && pos.side === 'long') { this.log.info(`Already LONG ${cfg.asset} — BUY skipped`); return }
          willOpen = true; openSide = 'buy'
        } else {
          if (pos && pos.side === 'long') { willClose = true; closeSide = 'sell'; closeSize = pos.size }
          else { this.log.info(`No long position to close — SELL skipped`); return }
        }
      } else {
        // Short only: SELL → open short (skip if already short); BUY → close short, no long.
        if (sig === 'sell') {
          if (pos && pos.side === 'short') { this.log.info(`Already SHORT ${cfg.asset} — SELL skipped`); return }
          willOpen = true; openSide = 'sell'
        } else {
          if (pos && pos.side === 'short') { willClose = true; closeSide = 'buy'; closeSize = pos.size }
          else { this.log.info(`No short position to close — BUY skipped`); return }
        }
      }

      // Cooldown only guards opening a new position, not protective closes.
      if (willOpen) {
        const cooldownMs = cfg.cooldownSec * 1000
        const sinceLast = Date.now() - this.lastTradeAt
        if (cooldownMs > 0 && sinceLast < cooldownMs) {
          this.blockedByCooldown++
          this.log.warn(
            `${sig.toUpperCase()} signal skipped — cooldown ` +
              `(${Math.ceil((cooldownMs - sinceLast) / 1000)}s left)`,
          )
          return
        }
      }

      this.signalsExecuted++
      this.log.info(`${sig.toUpperCase()} signal on ${cfg.symbol} ${cfg.timeframe} close — executing`)
      try {
        // SAFEGUARD: snapshot old open-order OIDs BEFORE doing anything else.
        // We used to call cancelAssetOrders() here, but if the new entry then
        // failed (e.g. insufficient margin) the original position was left
        // naked. New flow: keep old SL/TP alive through the trade, then
        // cancel only those OLD OIDs after we confirm the new entry filled.
        const staleOids = await snapshotAssetOrderOids(cfg.asset, this.creds)

        // Close opposite position (reduce-only) before opening the new one.
        if (willClose && closeSize > 0) {
          this.log.info(`Closing ${closeSide === 'buy' ? 'SHORT' : 'LONG'} ${closeSize} ${cfg.asset} (reduce-only)`)
          const closeRes = await placeOrder({
            asset: cfg.asset, side: closeSide, size: closeSize,
            orderType: 'market', reduceOnly: true, maxSlippagePct: cfg.slippagePct,
          }, this.creds)
          this.trades.push({ time: Date.now(), side: closeSide, asset: cfg.asset, size: closeRes.filledSize, price: closeRes.avgPx, filled: closeRes.filled })
          if (this.trades.length > 100) this.trades = this.trades.slice(-100)
          this.log.fill(closeRes.message)
        }

        if (!willOpen) {
          // Position closed but no re-entry — stale brackets can go now.
          if (staleOids.length > 0) {
            try {
              const cancelled = await cancelOrdersByOid(cfg.asset, staleOids, this.creds)
              if (cancelled > 0) this.log.info(`Cleared ${cancelled} stale order(s) for ${cfg.asset}`)
            } catch (e) {
              this.log.warn(`Stale-order cleanup failed: ${(e as Error).message}`)
            }
          }
          return
        }

        // Open the new position with SL (and optional TP) bracket.
        this.lastTradeAt = Date.now()
        const result = await placeOrder({
          asset: cfg.asset,
          side: openSide,
          size: tradeSize,
          orderType: 'market',
          maxSlippagePct: cfg.slippagePct,
          tpPct: cfg.tpPct,
          slPct: cfg.slPct,
        }, this.creds)
        if (result.filled) {
          this.tradesExecuted++
          // Success — clear the not-filled streak + any auto-pause state.
          this.consecutiveNotFilled = 0
          this.autoPausedReason = null
          // Cast widens the field's narrowed type (TS sometimes pins it to
          // `null` after the lastError = null in start()).
          const errStr = this.lastError as string | null
          if (errStr && errStr.startsWith('Not filled')) this.lastError = null

          // Entry + brackets are in place — now safe to drop the OLD stops.
          // Cancelling by saved OID guarantees we don't touch the brand-new
          // SL/TP we just placed for this position.
          if (staleOids.length > 0) {
            try {
              const cancelled = await cancelOrdersByOid(cfg.asset, staleOids, this.creds)
              if (cancelled > 0) this.log.info(`Cleared ${cancelled} stale order(s) for ${cfg.asset}`)
            } catch (e) {
              this.log.warn(`Stale-order cleanup failed: ${(e as Error).message}`)
            }
          }
        } else {
          // Order didn't fill (HL rejection — most commonly insufficient margin).
          // Surface the reason on the bot status so the UI pill turns red.
          this.lastError = result.message ?? 'Order not filled'
          this.consecutiveNotFilled++
          // Old SL/TP intentionally kept in place — any pre-existing position
          // is still protected by its original stop.
          if (staleOids.length > 0) {
            this.log.warn(`Entry not filled — keeping ${staleOids.length} existing stop order(s) in place`)
          }
          // Auto-pause after 3 consecutive rejections — protects HL rate limit
          // and avoids piling up audit-log entries from a broken config.
          if (this.consecutiveNotFilled >= 3) {
            this.autoPausedReason = `Auto-paused after ${this.consecutiveNotFilled} consecutive failed orders: ${result.message ?? 'unknown'}`
            this.log.warn(this.autoPausedReason)
            this.running = false
          }
        }
        if (result.filled && (result.tpPlaced || result.slPlaced)) {
          this.log.info(`Bracket orders: ${result.tpPlaced ? 'TP✓' : 'TP✗'} ${result.slPlaced ? 'SL✓' : 'SL✗'}`)
        }
        const positionUsd = result.avgPx ? result.filledSize * result.avgPx : undefined
        this.trades.push({
          time: Date.now(),
          side: openSide,
          asset: cfg.asset,
          size: result.filledSize,
          price: result.avgPx,
          filled: result.filled,
          ...(cfg.riskUsd !== undefined ? { riskUsd: cfg.riskUsd } : {}),
          ...(cfg.slPct !== undefined ? { slPct: cfg.slPct } : {}),
          ...(positionUsd !== undefined ? { positionUsd } : {}),
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
      pausedForNetworkSwitch: this.pausedForNetworkSwitch || undefined,
    }
    try {
      const dir = signalDirForUser(this.userId)
      ensureBotDir(dir)
      writeFileSync(join(dir, this.id + '.json'), JSON.stringify(state, null, 2))
    } catch (e) {
      this.log.err(`Could not persist signal-bot state: ${(e as Error).message}`)
    }
  }

  // Stop the bot and tag it so it can be auto-resumed when the user switches
  // back to the previous network. Returns true if the bot was actually running
  // (and is therefore now paused); false if it was already stopped.
  pauseForNetworkSwitch(): boolean {
    if (!this.running) return false
    this.pausedForNetworkSwitch = true
    this.stop()
    this.log.warn('Paused — switched to mainnet. Will auto-resume on switch back to testnet.')
    return true
  }

  // Clear the marker without starting the bot (used when the user manually
  // takes control while the bot is still paused).
  clearPauseFlag(): void {
    if (this.pausedForNetworkSwitch) {
      this.pausedForNetworkSwitch = false
      this.persist()
    }
  }

  isPausedForNetworkSwitch(): boolean {
    return this.pausedForNetworkSwitch
  }
}

// ─────────────────────────── Manager ───────────────────────────

// Registry of all loaded bots. Key format: "<userId>:<botId>" in multi-user
// mode; ":<botId>" in single-tenant mode. UUID bot IDs ensure no collisions
// across users when MULTI_USER is true.
const bots = new Map<string, SignalBot>()
// Track which userId's bots have been loaded from disk.
const loadedForUser = new Set<string>()

const SINGLE_TENANT_KEY = ''

function registryKey(userId: string | undefined, botId: string): string {
  return `${userId ?? SINGLE_TENANT_KEY}:${botId}`
}

function ensureBotDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function slugify(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bot'
  )
}

function uniqueId(base: string, userId: string | undefined): string {
  const dir = signalDirForUser(userId)
  let id = base
  let n = 2
  while (
    bots.has(registryKey(userId, id)) ||
    existsSync(join(dir, id + '.json'))
  ) {
    id = `${base}-${n}`
    n++
  }
  return id
}

// Load bots from disk for a specific userId (or single-tenant if undefined).
// Idempotent — only runs once per userId.
function loadBotsForUser(userId: string | undefined, credsProvider?: () => EnvConfig | null): void {
  const key = userId ?? SINGLE_TENANT_KEY
  if (loadedForUser.has(key)) return
  loadedForUser.add(key)

  const dir = signalDirForUser(userId)
  ensureBotDir(dir)

  // Single-tenant: migrate the legacy single-bot JSON file if present.
  if (!userId && existsSync(LEGACY_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(LEGACY_PATH, 'utf8'))
      const cfg = parseSignalConfig(raw.config)
      const id = uniqueId(slugify(`${cfg.strategyId}-${cfg.symbol}`), undefined)
      const persisted: PersistedSignalBot = {
        id,
        name: `${cfg.strategyId.toUpperCase()} ${cfg.symbol}`,
        config: cfg,
        running: Boolean(raw.running),
      }
      writeFileSync(join(dir, id + '.json'), JSON.stringify(persisted, null, 2))
      unlinkSync(LEGACY_PATH)
    } catch {
      /* ignore an unreadable legacy file */
    }
  }

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as PersistedSignalBot
      if (!raw.id) continue
      const rk = registryKey(userId, raw.id)
      if (bots.has(rk)) continue
      const creds = credsProvider ? credsProvider() : null
      const bot = new SignalBot(raw.id, raw.name || raw.id, parseSignalConfig(raw.config), userId, creds)
      if (raw.pausedForNetworkSwitch) {
        // Hydrate the flag so the UI shows "Paused" instead of "Stopped".
        // Field is private; set via the helper that flips it without starting.
        ;(bot as unknown as { pausedForNetworkSwitch: boolean }).pausedForNetworkSwitch = true
      }
      bots.set(rk, bot)
    } catch {
      /* skip a corrupt bot file */
    }
  }
}

export function listSignalBots(userId?: string): SignalBotSummary[] {
  loadBotsForUser(userId)
  const prefix = `${userId ?? SINGLE_TENANT_KEY}:`
  return [...bots.entries()]
    .filter(([k]) => k.startsWith(prefix))
    .map(([, b]) => b.summary())
}

export function getSignalBot(id: string, userId?: string): SignalBot {
  loadBotsForUser(userId)
  const b = bots.get(registryKey(userId, id))
  if (!b) throw new Error(`Signal bot not found: ${id}`)
  return b
}

export function createSignalBot(
  name: string,
  config: SignalBotConfig,
  userId?: string,
  creds: EnvConfig | null = null,
): SignalBot {
  loadBotsForUser(userId)
  const label = name.trim() || `${config.strategyId.toUpperCase()} ${config.symbol}`
  // In multi-user mode, use UUID to guarantee cross-user uniqueness.
  const id = MULTI_USER && userId ? randomUUID() : uniqueId(slugify(label), userId)
  const bot = new SignalBot(id, label, config, userId, creds)
  bots.set(registryKey(userId, id), bot)
  bot.persist()
  return bot
}

export function listSignalBotTrades(id: string, userId?: string): TradeRecord[] {
  return getSignalBot(id, userId).getTrades()
}

export function deleteSignalBot(id: string, userId?: string): void {
  const bot = getSignalBot(id, userId)
  bot.stop()
  bots.delete(registryKey(userId, id))
  clearLogBuffer('signal-' + id)
  try {
    unlinkSync(join(signalDirForUser(userId), id + '.json'))
  } catch {
    /* already gone */
  }
}

// Called on server boot — resumes every bot that was running when the process
// last exited. In multi-user mode, pass a credsProvider so each bot gets its
// owner's decrypted keys.
export function maybeAutostartSignalBots(
  userId?: string,
  credsProvider?: () => EnvConfig | null,
): void {
  loadBotsForUser(userId, credsProvider)
  const dir = signalDirForUser(userId)
  if (!existsSync(dir)) return
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as PersistedSignalBot
      const bot = bots.get(registryKey(userId, raw.id))
      if (bot && raw.running && !bot.isRunning()) {
        createLogger('signal-' + raw.id).info('Resuming from saved running state')
        bot.start()
      }
    } catch {
      /* ignore */
    }
  }
}
