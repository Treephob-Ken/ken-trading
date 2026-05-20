// Observable Markov regime model.
//
// Port of the markov-hedge-fund-method skill (Roan / @RohOnChain) to the
// browser. Labels every candle as Bull / Bear / Sideways from a rolling
// return, builds the 3×3 transition matrix by MLE counting, and exposes
// the stationary distribution and n-step forecast. All client-side from
// the candles we already have.

import type { Candle, StrategyId } from '@/types'

export const STATES = ['Bear', 'Sideways', 'Bull'] as const
export type RegimeLabel = typeof STATES[number]

export interface RegimeAnalysis {
  /** Current candle's state index, or -1 if not enough history yet. */
  currentState: number
  currentLabel: RegimeLabel | null
  /** 3×3 transition matrix. rows = from, cols = to. */
  transitionMatrix: number[][]
  /** Long-run probability of each state. */
  stationary: number[]
  /** Probability of the NEXT candle being in each state, given current. */
  nextStateProbs: number[]
  /** Probability of being in each state 5 steps from now. */
  fiveStepForecast: number[]
  /** P[current][current] — chance the regime holds for one more candle. */
  persistence: number
  /** P[current][Bull] − P[current][Bear]. +1 = certain up, −1 = certain down. */
  conviction: number
  /** Time series of regime labels, aligned with the input candles. */
  labels: number[]
  /** Per-state counts in the lookback window. */
  counts: number[]
  /** How many candles were used to fit the matrix. */
  fitSize: number
  /** Lookback window used for labelling (in candles). */
  window: number
  /** Threshold used for labelling (rolling-return %). */
  threshold: number
}

// Label each candle as Bear (0) / Sideways (1) / Bull (2) from rolling return.
// Returns -1 for candles before the lookback window has filled.
export function labelRegimes(
  candles: Candle[],
  window: number,
  threshold: number,
): number[] {
  const out: number[] = []
  for (let i = 0; i < candles.length; i++) {
    if (i < window) {
      out.push(-1)
      continue
    }
    const prev = candles[i - window].close
    if (!(prev > 0)) {
      out.push(-1)
      continue
    }
    const ret = (candles[i].close - prev) / prev
    if (ret > threshold) out.push(2)
    else if (ret < -threshold) out.push(0)
    else out.push(1)
  }
  return out
}

// MLE transition matrix from a sequence of state indices.
export function buildTransitionMatrix(labels: number[]): number[][] {
  const P: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let i = 0; i < labels.length - 1; i++) {
    const a = labels[i]
    const b = labels[i + 1]
    if (a < 0 || b < 0) continue
    P[a][b] += 1
  }
  // Row-normalize. Empty rows are left as zero (no observations yet).
  for (let i = 0; i < 3; i++) {
    const sum = P[i][0] + P[i][1] + P[i][2]
    if (sum > 0) for (let j = 0; j < 3; j++) P[i][j] /= sum
  }
  return P
}

// Stationary distribution via power iteration on a uniform start vector.
// Equivalent to the left eigenvector of P at eigenvalue 1, normalized.
export function stationaryDistribution(P: number[][]): number[] {
  let v = [1 / 3, 1 / 3, 1 / 3]
  for (let iter = 0; iter < 1000; iter++) {
    const next = [0, 0, 0]
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) next[j] += v[i] * P[i][j]
    }
    let diff = 0
    for (let i = 0; i < 3; i++) diff = Math.max(diff, Math.abs(next[i] - v[i]))
    v = next
    if (diff < 1e-12) break
  }
  const sum = v[0] + v[1] + v[2] || 1
  return v.map((x) => x / sum)
}

// Chapman-Kolmogorov: n-step transition matrix = P^n.
export function nStepForecast(P: number[][], n: number): number[][] {
  if (n <= 0) return identity3()
  let result = P.map((r) => [...r])
  for (let i = 1; i < n; i++) result = multiply3(result, P)
  return result
}

function identity3(): number[][] {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
}

function multiply3(A: number[][], B: number[][]): number[][] {
  const C: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) C[i][j] += A[i][k] * B[k][j]
    }
  }
  return C
}

export function analyzeRegime(
  candles: Candle[],
  window = 20,
  threshold = 0.02,
): RegimeAnalysis {
  const labels = labelRegimes(candles, window, threshold)
  const P = buildTransitionMatrix(labels)
  const stationary = stationaryDistribution(P)
  // Last valid label as the "current" state.
  let currentState = -1
  for (let i = labels.length - 1; i >= 0; i--) {
    if (labels[i] >= 0) {
      currentState = labels[i]
      break
    }
  }
  const counts = [0, 0, 0]
  let fitSize = 0
  for (const l of labels) {
    if (l < 0) continue
    counts[l]++
    fitSize++
  }
  const nextStateProbs =
    currentState >= 0 ? [...P[currentState]] : [...stationary]
  const fiveStep = nStepForecast(P, 5)
  const fiveStepForecast =
    currentState >= 0 ? [...fiveStep[currentState]] : [...stationary]
  const persistence = currentState >= 0 ? P[currentState][currentState] : NaN
  const conviction =
    currentState >= 0 ? P[currentState][2] - P[currentState][0] : NaN

  return {
    currentState,
    currentLabel: currentState >= 0 ? STATES[currentState] : null,
    transitionMatrix: P,
    stationary,
    nextStateProbs,
    fiveStepForecast,
    persistence,
    conviction,
    labels,
    counts,
    fitSize,
    window,
    threshold,
  }
}

// ---------------------------------------------------------------------------
// Strategy recommendations keyed to the current regime.
//
// Markov tells you WHICH playbook to use; it doesn't tell you the exact
// entry. Trend-following indicators (MACD, EMA, Supertrend) earn the most
// when persistence is high in Bull/Bear states. Mean-reversion indicators
// (Bollinger, RSI, Stochastic) earn the most when Sideways persists.
// ---------------------------------------------------------------------------

export interface StrategyRecommendation {
  id: StrategyId
  reason: string
  priority: 'primary' | 'secondary'
}

export function recommendStrategies(
  regime: RegimeLabel | null,
): StrategyRecommendation[] {
  if (regime === 'Bull') {
    return [
      { id: 'macd',       reason: 'Catches momentum in the up-trend.',           priority: 'primary' },
      { id: 'ema',        reason: 'Fast/slow EMA cross — classic trend filter.', priority: 'primary' },
      { id: 'supertrend', reason: 'Stays long while the trend holds.',           priority: 'primary' },
      { id: 'psar',       reason: 'Trails the trend until reversal.',            priority: 'secondary' },
      { id: 'donchian',   reason: 'Breakout into new highs.',                    priority: 'secondary' },
    ]
  }
  if (regime === 'Bear') {
    return [
      { id: 'macd',       reason: 'Sells the rallies in a down-trend.',          priority: 'primary' },
      { id: 'supertrend', reason: 'Stays short while the trend holds.',          priority: 'primary' },
      { id: 'ema',        reason: 'Bearish cross signals.',                      priority: 'primary' },
      { id: 'psar',       reason: 'Trails the down-trend.',                      priority: 'secondary' },
    ]
  }
  if (regime === 'Sideways') {
    return [
      { id: 'bollinger',  reason: 'Buy the lower band, sell the upper.',         priority: 'primary' },
      { id: 'rsi',        reason: 'Fade extremes in a ranging market.',          priority: 'primary' },
      { id: 'stochastic', reason: 'Catches oscillations between levels.',        priority: 'primary' },
      { id: 'cci',        reason: 'Cyclical reversion around the mean.',         priority: 'secondary' },
      { id: 'williamsr',  reason: 'Overbought/oversold inside the range.',       priority: 'secondary' },
    ]
  }
  return []
}

// Returns whether grid trading is well-suited for the current regime.
// Sideways = ideal; trending markets eat the inventory until SL hits.
export function isGoodForGrid(regime: RegimeLabel | null): {
  suitable: boolean
  reason: string
} {
  if (regime === 'Sideways')
    return { suitable: true, reason: 'Sideways regime — ideal for grids.' }
  if (regime === 'Bull')
    return {
      suitable: false,
      reason: 'Bull regime — grids accumulate shorts and bleed against the trend. Wait for the regime to flip, or use a long-only grid.',
    }
  if (regime === 'Bear')
    return {
      suitable: false,
      reason: 'Bear regime — grids accumulate longs and bleed against the trend. Wait for the regime to flip, or use a short-only grid.',
    }
  return { suitable: false, reason: 'Not enough history to detect a regime yet.' }
}
