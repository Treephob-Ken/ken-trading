import type { Trade } from '@/types'

// Monte Carlo simulation: bootstrap historical trade returns with replacement
// to project a distribution of forward equity paths.
//
// This tests path-dependency — would the strategy have been profitable if the
// same set of trades had occurred in a different order? It does NOT predict
// future market behaviour. Pair with walk-forward validation for OOS confidence.

export interface MCOptions {
  /** How many independent paths to simulate. More = smoother percentiles, slower. */
  paths?: number
  /** How many trades into the future to project. */
  horizon?: number
  /** Fixed seed for deterministic output (useful for unit tests + caching). */
  seed?: number
  /** Drawdown threshold to count as "ruin". Default 0.5 (50% account loss). */
  ruinThreshold?: number
}

export interface MCStep {
  /** Trade index after the last historical trade (1 = first projected trade). */
  step: number
  /** Multiplier on equity at this step: 1.0 = unchanged, 1.5 = +50%, 0.7 = -30%. */
  p5: number
  p50: number
  p95: number
}

export interface MCResult {
  steps: MCStep[]
  /** Final-step equity multiplier percentiles. */
  finalP5: number
  finalP50: number
  finalP95: number
  /** Worst-case in-path drawdown across the horizon. */
  ddP50: number
  ddP95: number
  /** Probability that final equity > starting equity. */
  probProfit: number
  /** Probability that any path hits the ruin threshold. */
  probRuin: number
  /** Inputs used (for the UI to display "based on N trades, M paths, K horizon"). */
  inputTrades: number
  horizon: number
  paths: number
}

// Mulberry32 — fast, small-state PRNG. Deterministic when seeded.
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const rank = (sorted.length - 1) * p
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

export function simulateMonteCarlo(
  trades: Trade[],
  opts: MCOptions = {},
): MCResult | null {
  const paths = opts.paths ?? 1000
  const horizon = opts.horizon ?? 30
  const seed = opts.seed ?? 12345
  const ruinThreshold = opts.ruinThreshold ?? 0.5

  // Need at least a handful of trades for bootstrap to be meaningful.
  if (trades.length < 3) return null

  const pool = trades.map((t) => t.pnlPct / 100) // convert % → fraction
  const n = pool.length
  const rng = makeRng(seed)

  // Per-step buckets: equityByStep[step][pathIdx] = equity multiplier at that step
  const equityByStep: number[][] = Array.from({ length: horizon + 1 }, () => new Array(paths))
  const finalEquities: number[] = new Array(paths)
  const maxDDs: number[] = new Array(paths)
  let ruinCount = 0
  let profitCount = 0

  for (let p = 0; p < paths; p++) {
    let equity = 1
    let peak = 1
    let maxDD = 0
    equityByStep[0][p] = 1

    for (let s = 1; s <= horizon; s++) {
      const sampleIdx = Math.floor(rng() * n)
      const r = pool[sampleIdx]
      equity *= 1 + r
      // Equity can't go below 0 in reality (broker liquidates first); cap at tiny positive.
      if (equity < 0.001) equity = 0.001
      if (equity > peak) peak = equity
      const dd = (peak - equity) / peak
      if (dd > maxDD) maxDD = dd
      equityByStep[s][p] = equity
    }

    finalEquities[p] = equity
    maxDDs[p] = maxDD
    if (maxDD >= ruinThreshold) ruinCount++
    if (equity > 1) profitCount++
  }

  // Percentile bands per step
  const steps: MCStep[] = []
  for (let s = 0; s <= horizon; s++) {
    const sorted = equityByStep[s].slice().sort((a, b) => a - b)
    steps.push({
      step: s,
      p5: percentile(sorted, 0.05),
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
    })
  }

  const finalSorted = finalEquities.slice().sort((a, b) => a - b)
  const ddSorted = maxDDs.slice().sort((a, b) => a - b)

  return {
    steps,
    finalP5: percentile(finalSorted, 0.05),
    finalP50: percentile(finalSorted, 0.5),
    finalP95: percentile(finalSorted, 0.95),
    ddP50: percentile(ddSorted, 0.5),
    ddP95: percentile(ddSorted, 0.95),
    probProfit: profitCount / paths,
    probRuin: ruinCount / paths,
    inputTrades: n,
    horizon,
    paths,
  }
}

// Convert an MC equity multiplier into a % change for display.
export const mcPct = (multiplier: number): number => (multiplier - 1) * 100

// Estimate the avg seconds between trades from historical data — used to
// time-stamp the projection on the equity chart.
export function avgSecondsPerTrade(trades: Trade[]): number | null {
  if (trades.length < 2) return null
  const first = trades[0].exitTime
  const last = trades[trades.length - 1].exitTime
  if (last <= first) return null
  return (last - first) / (trades.length - 1)
}
