// Indicator Scanner — runs every strategy × symbol × timeframe over the
// last 90 days and returns each combo's backtest metrics, sorted by total
// return %. Reuses the exact same backtest engine the Backtester page uses,
// so a row's reported number matches what the user will see when they click
// through to /backtest with the same preset.

import type { Candle, Direction, StrategyId } from '@/types'
import type { SymbolInfo } from '@/lib/binance'
import { fetchKlines } from '@/lib/binance'
import { defaultParams, generateSignals, STRATEGIES } from '@/lib/strategies'
import { runBacktest } from '@/lib/backtest'
import { checkLookahead } from '@/lib/scanner/lookaheadCheck'

export interface IndicatorScanOptions {
  timeframes: string[]            // e.g. ['1h', '4h']
  lookbackDays: number            // e.g. 90
  direction: Direction            // 'long' | 'short' | 'both'
  initialCapital?: number         // default 10_000
  feePct?: number                 // default 0.1 (0.1%)
  concurrency?: number            // parallel kline fetches; default 6
  strategies?: StrategyId[]       // default = all 14
}

export interface IndicatorScanRow {
  symbol: string         // e.g. 'BTCUSDT'
  base: string           // e.g. 'BTC'
  timeframe: string
  strategyId: StrategyId
  strategyName: string
  totalReturnPct: number
  numTrades: number
  winRate: number
  maxDrawdownPct: number
  sharpeRatio: number
  buyHoldReturnPct: number
  // True if the look-ahead detector flagged this strategy. When true, the
  // backtest numbers above are unreliable — the strategy peeked into the
  // future. Surfaced with a ⚠ badge in the scanner UI.
  looksAhead?: boolean
  // The lookback window (in days) used for this row's backtest. Used by the
  // verdict to warn when the test was too short to be reliable.
  lookbackDays?: number
}

export interface ScanProgress {
  done: number
  total: number
  current?: string       // human-readable current combo, e.g. "BTC 1h MACD"
}

const MS_PER_DAY = 86_400_000

// Tiny promise-pool — caps in-flight fetches without an extra dep.
async function pool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const runners: Promise<void>[] = []
  for (let k = 0; k < Math.max(1, concurrency); k++) {
    runners.push(
      (async () => {
        while (true) {
          const i = next++
          if (i >= items.length) return
          out[i] = await worker(items[i], i)
        }
      })(),
    )
  }
  await Promise.all(runners)
  return out
}

export async function runIndicatorScan(
  universe: SymbolInfo[],
  options: IndicatorScanOptions,
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<IndicatorScanRow[]> {
  const {
    timeframes,
    lookbackDays,
    direction,
    initialCapital = 10_000,
    feePct = 0.1,
    concurrency = 6,
    strategies = STRATEGIES.map((s) => s.id),
  } = options

  const startTime = Date.now() - lookbackDays * MS_PER_DAY
  const fetchJobs: { sym: SymbolInfo; tf: string }[] = []
  for (const sym of universe) {
    for (const tf of timeframes) fetchJobs.push({ sym, tf })
  }

  // Fetch all (symbol, timeframe) candle sets in chunks. Failed fetches yield
  // an empty array so one bad symbol can't sink the whole scan.
  const candleSets = await pool(fetchJobs, concurrency, async (job) => {
    if (signal?.aborted) return { job, candles: [] as Candle[] }
    try {
      const candles = await fetchKlines({
        symbol: job.sym.symbol,
        interval: job.tf,
        startTime,
      })
      return { job, candles }
    } catch {
      return { job, candles: [] as Candle[] }
    }
  })

  const total = fetchJobs.length * strategies.length
  let done = 0
  const rows: IndicatorScanRow[] = []
  // Look-ahead check is run ONCE per strategy on the first usable candle set
  // we see, then cached. A strategy that peeks behaves the same way on any
  // history, so no need to re-check per symbol/timeframe.
  const lookaheadCache = new Map<StrategyId, boolean>()

  for (const { job, candles } of candleSets) {
    if (signal?.aborted) break
    if (candles.length < 35) {
      // not enough bars for any strategy to compute — skip but advance progress
      done += strategies.length
      onProgress?.({ done, total })
      continue
    }
    for (const id of strategies) {
      if (signal?.aborted) break
      try {
        const out = generateSignals(id, candles, defaultParams(id))
        const result = runBacktest(
          candles,
          out.signals,
          initialCapital,
          feePct / 100,
          direction,
          0, // no SL — match the user's default backtest
          0, // no TP — opposite signal closes
          'fixed',
          2,
          1.5,
        )
        const m = result.metrics
        if (!lookaheadCache.has(id)) {
          try {
            const rep = checkLookahead(id, candles)
            lookaheadCache.set(id, !rep.ok)
          } catch {
            lookaheadCache.set(id, false)
          }
        }
        rows.push({
          symbol: job.sym.symbol,
          base: job.sym.base,
          timeframe: job.tf,
          strategyId: id,
          strategyName: STRATEGIES.find((s) => s.id === id)?.name ?? id,
          totalReturnPct: m.totalReturnPct,
          numTrades: m.numTrades,
          winRate: m.winRate,
          maxDrawdownPct: m.maxDrawdownPct,
          sharpeRatio: m.sharpeRatio,
          buyHoldReturnPct: m.buyHoldReturnPct,
          looksAhead: lookaheadCache.get(id) === true,
          lookbackDays,
        })
      } catch {
        // one bad combo doesn't kill the scan
      }
      done++
      if (done % 10 === 0 || done === total) {
        onProgress?.({
          done,
          total,
          current: `${job.sym.base} ${job.tf} ${id}`,
        })
      }
    }
  }

  return rows
}
