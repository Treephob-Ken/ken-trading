// Market Recommendation — looks at the universe-wide regime breakdown from
// a finished scan and recommends which kind of strategy fits "right now".
//
// Logic in plain words:
//   1. Group rows by (symbol, timeframe) so we don't count each pair once per
//      strategy. The regime label is identical across all strategies for the
//      same pair, so duplicate counting would skew the breakdown.
//   2. Tally Bull / Sideways / Bear shares of the unique pairs.
//   3. Map the dominant regime → preferred strategy family:
//        Bull-dominant      → trend-followers (MACD, EMA, Supertrend, ...)
//        Sideways-dominant  → mean-reverters (RSI, Bollinger, Stochastic, ...)
//        Bear-dominant      → trend-followers on the short side
//        Mixed              → confluence-only (lean on HTF agreement)
//   4. Cherry-pick the top 3 rows from the recommended family by quality score.
//
// This is a *reading layer* — nothing here re-runs backtests. It only
// summarises a scan that's already done.

import type { StrategyId } from '@/types'
import type { IndicatorScanRow } from './indicatorScan'
import type { RegimeLabel } from '@/lib/markov'

export type RecommendedType = 'trend' | 'mean-reversion' | 'mixed' | 'defensive'

export interface MarketRecommendation {
  btcRegime: RegimeLabel | null
  btcConviction: number
  btcTimeframe: string | null
  universe: {
    bull: number
    sideways: number
    bear: number
    unknown: number
    total: number
  }
  recommendedType: RecommendedType
  recommendedStrategyIds: StrategyId[]
  reason: string
  topPicks: IndicatorScanRow[]
}

// Functional buckets — Bollinger is officially "Volatility" but behaves
// as a mean-reverter (buy lower band, sell upper band).
const TREND_STRATEGIES: StrategyId[] = [
  'macd', 'ema', 'sma', 'supertrend', 'psar',
  'donchian', 'elliott', 'traderxo', 'adx', 'ichimoku',
]
const MEAN_REVERSION_STRATEGIES: StrategyId[] = [
  'rsi', 'stochastic', 'stochrsi', 'cci', 'williamsr', 'bollinger',
]

// Preferred TF for BTC's regime read (lower index = first try).
const BTC_TF_PREFERENCE = ['4h', '1h', '1d', '30m', '15m', '1w']

export function recommendForMarket(rows: IndicatorScanRow[]): MarketRecommendation {
  // ── Step 1: collapse rows to unique (symbol, timeframe) pairs ────────────
  // The regime label is the same for every strategy on a given pair, so
  // count each pair once.
  interface PairSnapshot {
    symbol: string
    base: string
    timeframe: string
    regime: RegimeLabel | null
    conviction: number
  }
  const pairMap = new Map<string, PairSnapshot>()
  for (const r of rows) {
    const k = `${r.symbol}|${r.timeframe}`
    if (pairMap.has(k)) continue
    pairMap.set(k, {
      symbol: r.symbol,
      base: r.base,
      timeframe: r.timeframe,
      regime: r.regimeLabel ?? null,
      conviction: r.regimeConviction ?? 0,
    })
  }
  const pairs = Array.from(pairMap.values())

  // ── Step 2: BTC regime read ──────────────────────────────────────────────
  // Pick BTC's row at the preferred TF (4h beats 1h beats daily, etc.) as a
  // "headline" indicator that's shown prominently in the UI.
  const btcPairs = pairs.filter((p) => p.base === 'BTC')
  let btcRegime: RegimeLabel | null = null
  let btcConviction = 0
  let btcTimeframe: string | null = null
  for (const tf of BTC_TF_PREFERENCE) {
    const found = btcPairs.find((p) => p.timeframe === tf)
    if (found && found.regime) {
      btcRegime = found.regime
      btcConviction = found.conviction
      btcTimeframe = found.timeframe
      break
    }
  }

  // ── Step 3: universe regime breakdown ────────────────────────────────────
  const universe = { bull: 0, sideways: 0, bear: 0, unknown: 0, total: pairs.length }
  for (const p of pairs) {
    if (p.regime === 'Bull') universe.bull += 1
    else if (p.regime === 'Sideways') universe.sideways += 1
    else if (p.regime === 'Bear') universe.bear += 1
    else universe.unknown += 1
  }

  // ── Step 4: pick the recommended type ────────────────────────────────────
  // Use the known (labelled) pairs as the denominator so a scan with lots
  // of empty pairs doesn't dilute the share.
  const known = Math.max(1, universe.bull + universe.sideways + universe.bear)
  const bullPct = (universe.bull / known) * 100
  const sidewaysPct = (universe.sideways / known) * 100
  const bearPct = (universe.bear / known) * 100

  let recommendedType: RecommendedType
  let reason: string
  let recommendedStrategyIds: StrategyId[]

  // Dominance threshold — 50% of labelled pairs leaning one way is enough
  // to commit. Below that we fall back to confluence-only.
  if (bullPct >= 50) {
    recommendedType = 'trend'
    reason = `${bullPct.toFixed(0)}% of coins are in an uptrend — trend-followers will catch the moves`
    recommendedStrategyIds = TREND_STRATEGIES
  } else if (bearPct >= 50) {
    recommendedType = 'defensive'
    reason = `${bearPct.toFixed(0)}% of coins are in a downtrend — only take shorts with trend confirmation, or stay flat`
    recommendedStrategyIds = TREND_STRATEGIES
  } else if (sidewaysPct >= 50) {
    recommendedType = 'mean-reversion'
    reason = `${sidewaysPct.toFixed(0)}% of coins are ranging — mean-reverters (RSI, Bollinger) fade extremes profitably`
    recommendedStrategyIds = MEAN_REVERSION_STRATEGIES
  } else {
    recommendedType = 'mixed'
    reason = `No regime dominates (${bullPct.toFixed(0)}% bull · ${sidewaysPct.toFixed(0)}% range · ${bearPct.toFixed(0)}% bear) — only trade picks where higher TF agrees`
    // In mixed conditions, prefer both buckets but rely on confluence filter
    recommendedStrategyIds = [...TREND_STRATEGIES, ...MEAN_REVERSION_STRATEGIES]
  }

  // ── Step 5: top 3 picks from the recommended family ──────────────────────
  // Filter to strategies that fit the regime, drop look-ahead-flagged rows,
  // require minimum trade count + positive return, then take the top scored.
  // In 'mixed' mode we additionally require HTF confluence to be aligned.
  const recSet = new Set<StrategyId>(recommendedStrategyIds)
  const candidates = rows.filter((r) => {
    if (r.looksAhead) return false
    if (!recSet.has(r.strategyId as StrategyId)) return false
    if ((r.numTrades ?? 0) < 5) return false
    if ((r.totalReturnPct ?? 0) <= 0) return false
    if (recommendedType === 'mixed' && r.confluence !== 'aligned') return false
    return true
  })
  candidates.sort((a, b) => {
    const av = (a.qualityScore ?? a.totalReturnPct ?? 0) as number
    const bv = (b.qualityScore ?? b.totalReturnPct ?? 0) as number
    return bv - av
  })
  // De-duplicate by base so the top 3 spans different coins (avoids three
  // rows of "BTC · 1h · X / BTC · 4h · X / BTC · 1d · X").
  const seenBases = new Set<string>()
  const topPicks: IndicatorScanRow[] = []
  for (const r of candidates) {
    if (seenBases.has(r.base)) continue
    seenBases.add(r.base)
    topPicks.push(r)
    if (topPicks.length >= 3) break
  }

  return {
    btcRegime,
    btcConviction,
    btcTimeframe,
    universe,
    recommendedType,
    recommendedStrategyIds,
    reason,
    topPicks,
  }
}
