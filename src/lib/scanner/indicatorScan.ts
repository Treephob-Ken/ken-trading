// Indicator Scanner — runs every strategy × symbol × timeframe over the
// last 90 days and returns each combo's backtest metrics, sorted by total
// return %. Reuses the exact same backtest engine the Backtester page uses,
// so a row's reported number matches what the user will see when they click
// through to /backtest with the same preset.

import type { Candle, Direction, StrategyId } from '@/types'
import type { SymbolInfo } from '@/lib/binance'
import { fetchFundingRate, fetchKlines } from '@/lib/binance'
import { defaultParams, generateSignals, STRATEGIES } from '@/lib/strategies'
import { runBacktest } from '@/lib/backtest'
import { checkLookahead } from '@/lib/scanner/lookaheadCheck'
import { analyzeRegime, type RegimeLabel } from '@/lib/markov'
import { TF_HIERARCHY } from '@/lib/multiTF'
import { qualityScore, type QualityBreakdown } from '@/lib/scanner/qualityScore'

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

  // ── Quality Score & enrichment fields ────────────────────────────────────
  // 0-100 composite of calmar, sharpe, beats-BH, trade count, realistic guess,
  // confluence, funding penalty. Look-ahead forces 0.
  qualityScore?: number
  qualityBreakdown?: QualityBreakdown
  // Calmar ratio (annualised return ÷ max drawdown %). Pulled from runBacktest.
  calmar?: number
  // Current regime + conviction for (symbol, timeframe). Shared across all
  // strategies on the same pair (regime doesn't depend on strategy).
  regimeLabel?: RegimeLabel | null
  regimeConviction?: number
  // Higher-TF confluence — comparing this row's TF regime vs the next-tier TF.
  // 'aligned' = same regime; 'conflicting' = opposite; 'neutral' = mixed; null = no HTF.
  confluence?: 'aligned' | 'conflicting' | 'neutral' | null
  higherTimeframe?: string | null
  // Annualised funding APR for the perp on Binance, e.g. 12.5 = +12.5% APR.
  // NaN if the symbol isn't on Binance futures or the fetch failed.
  fundingApr?: number
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

  // Enrichment pass — for each (sym, tf) compute regime, fetch funding, fetch
  // HTF candles + regime. Done ONCE per pair (not per strategy) since these
  // don't depend on the strategy. Parallelised through the same pool.
  interface Enrichment {
    regimeLabel: RegimeLabel | null
    regimeConviction: number
    confluence: 'aligned' | 'conflicting' | 'neutral' | null
    higherTimeframe: string | null
    fundingApr: number
  }
  const enrichKey = (sym: string, tf: string): string => `${sym}|${tf}`
  const enrichMap = new Map<string, Enrichment>()
  await pool(candleSets, concurrency, async ({ job, candles }) => {
    if (signal?.aborted) return null
    const key = enrichKey(job.sym.symbol, job.tf)
    if (candles.length < 30) {
      enrichMap.set(key, {
        regimeLabel: null, regimeConviction: 0,
        confluence: null, higherTimeframe: null, fundingApr: NaN,
      })
      return null
    }
    // Run the three sub-tasks in parallel — funding is a network fetch, HTF
    // is a network fetch + regime calc, current regime is local CPU.
    const htfName = TF_HIERARCHY[job.tf] ?? null
    const [funding, htfCandles] = await Promise.all([
      fetchFundingRate(job.sym.symbol).catch(() => NaN),
      htfName
        ? fetchKlines({ symbol: job.sym.symbol, interval: htfName, startTime })
            .catch(() => [] as Candle[])
        : Promise.resolve([] as Candle[]),
    ])
    const curr = analyzeRegime(candles)
    let confluence: 'aligned' | 'conflicting' | 'neutral' | null = null
    if (htfCandles.length >= 30) {
      const high = analyzeRegime(htfCandles)
      const c = curr.currentLabel
      const h = high.currentLabel
      if (c && h) {
        if (c === h) confluence = 'aligned'
        else if ((c === 'Bull' && h === 'Bear') || (c === 'Bear' && h === 'Bull')) confluence = 'conflicting'
        else confluence = 'neutral'
      }
    }
    enrichMap.set(key, {
      regimeLabel: curr.currentLabel,
      regimeConviction: Number.isFinite(curr.conviction) ? curr.conviction : 0,
      confluence,
      higherTimeframe: htfName,
      fundingApr: funding,
    })
    return null
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
    const enrich = enrichMap.get(enrichKey(job.sym.symbol, job.tf))
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
        const row: IndicatorScanRow = {
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
          calmar: m.calmarRatio,
          regimeLabel: enrich?.regimeLabel ?? null,
          regimeConviction: enrich?.regimeConviction ?? 0,
          confluence: enrich?.confluence ?? null,
          higherTimeframe: enrich?.higherTimeframe ?? null,
          fundingApr: enrich?.fundingApr,
        }
        const q = qualityScore(row)
        row.qualityScore = q.total
        row.qualityBreakdown = q
        rows.push(row)
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
