import type { Candle, StrategyId } from '@/types'
import { generateSignals, strategyMeta } from './strategies'
import { runBacktest } from './backtest'

export interface StabilityPoint {
  /** Wiggle applied to all params (-20, -10, 0, +10, +20). */
  percent: number
  /** Sharpe ratio of the backtest with wiggled params. */
  sharpe: number
  /** Total return % — useful for color-coding when Sharpe is undefined. */
  totalReturnPct: number
  /** Number of trades the wiggled strategy produced. */
  numTrades: number
}

export interface StabilityResult {
  points: StabilityPoint[]
  /** 0–100: how flat the Sharpe is across wiggles. 100 = perfectly stable. */
  stabilityScore: number
}

/**
 * Cheap version of walk-forward focused only on parameter stability.
 * Runs 5 backtests (params wiggled by -20/-10/0/+10/+20%) on the full
 * candle set — no fold loop, no per-fold optimization. Roughly 5× the
 * cost of the main backtest, fast enough to run synchronously in a
 * useMemo. Use this when you only want the stability strip; use
 * walkForward() when you need IS/OOS Sharpe + overfit score.
 */
export function stabilityCheck(
  candles: Candle[],
  strategyId: StrategyId,
  params: Record<string, number>,
  initialCapital = 10000,
  feeRate = 0.001,
  direction: 'long' | 'short' | 'both' = 'long',
  positionMode: 'fixed' | 'compounding' | 'volatility' = 'fixed',
): StabilityResult | null {
  if (candles.length < 50) return null
  const meta = strategyMeta(strategyId)
  const wiggles = [-20, -10, 0, 10, 20]
  const points: StabilityPoint[] = wiggles.map((pct) => {
    const wiggled: Record<string, number> = {}
    for (const def of meta.params) {
      const baseVal = params[def.key] ?? def.default
      const wVal = baseVal * (1 + pct / 100)
      const stepped = Math.round(wVal / def.step) * def.step
      wiggled[def.key] = Math.max(def.min, Math.min(def.max, Number(stepped.toFixed(4))))
    }
    const out = generateSignals(strategyId, candles, wiggled)
    const res = runBacktest(candles, out.signals, initialCapital, feeRate, direction, 0, 0, positionMode)
    return {
      percent: pct,
      sharpe: Number.isNaN(res.metrics.sharpeRatio) ? 0 : res.metrics.sharpeRatio,
      totalReturnPct: res.metrics.totalReturnPct,
      numTrades: res.metrics.numTrades,
    }
  })

  // Stability score: 100 - the percentage spread of Sharpe values, clamped 0-100.
  // Flat = high score, spiky = low score.
  const sharpes = points.map((p) => p.sharpe)
  const max = Math.max(...sharpes)
  const min = Math.min(...sharpes)
  const center = points.find((p) => p.percent === 0)?.sharpe ?? 0
  const reference = Math.max(Math.abs(center), 0.5) // avoid divide-by-zero for low-Sharpe strategies
  const spread = max - min
  const stabilityScore = Math.max(0, Math.min(100, 100 - (spread / reference) * 50))

  return { points, stabilityScore }
}

export interface WalkForwardFold {
  foldIndex: number
  trainParams: Record<string, number>
  trainSharpe: number
  testSharpe: number
  trainRange: string
  testRange: string
}

export interface WalkForwardResult {
  folds: WalkForwardFold[]
  inSampleSharpe: number
  outOfSampleSharpe: number
  overfitScore: number // 0-100, how much worse OOS vs IS
  paramStability: { percent: number; sharpe: number }[]
}

/**
 * Generates combinations of parameter wiggles.
 * If we have P parameters, each wiggled at -10%, 0%, +10%, we get 3^P combinations.
 * To keep it performant, we cap the combinations or wiggle the main parameters.
 */
function getParamCombinations(
  strategyId: StrategyId,
  baseParams: Record<string, number>,
): Record<string, number>[] {
  const meta = strategyMeta(strategyId)
  const paramDefs = meta.params

  const wiggles = [-0.1, 0, 0.1] // -10%, 0, +10%

  // Build list of wiggled values for each parameter
  const paramValuesList: { key: string; values: number[] }[] = []
  for (const def of paramDefs) {
    const baseVal = baseParams[def.key] ?? def.default
    const values = wiggles.map(w => {
      const val = baseVal * (1 + w)
      // Clamped to min/max and rounded to nearest step
      const stepped = Math.round(val / def.step) * def.step
      return Math.max(def.min, Math.min(def.max, Number(stepped.toFixed(4))))
    })
    // Filter duplicates
    const uniqueValues = Array.from(new Set(values))
    paramValuesList.push({ key: def.key, values: uniqueValues })
  }

  // Cartesian product
  let results: Record<string, number>[] = [{}]
  for (const { key, values } of paramValuesList) {
    const nextResults: Record<string, number>[] = []
    for (const res of results) {
      for (const val of values) {
        nextResults.push({ ...res, [key]: val })
      }
    }
    results = nextResults
  }

  // Cap at 27 combinations to ensure fast client-side execution
  return results.slice(0, 27)
}

/**
 * Runs walk-forward optimization on the given candles.
 */
export function walkForward(
  candles: Candle[],
  strategyId: StrategyId,
  params: Record<string, number>,
  numFolds = 5,
  initialCapital = 10000,
  feeRate = 0.001,
  direction: 'long' | 'short' | 'both' = 'both',
  positionMode: 'fixed' | 'compounding' | 'volatility' = 'fixed',
): WalkForwardResult {
  const n = candles.length
  const folds: WalkForwardFold[] = []

  if (n < 50) {
    return {
      folds: [],
      inSampleSharpe: 0,
      outOfSampleSharpe: 0,
      overfitScore: 0,
      paramStability: [],
    }
  }

  // Generate parameter combinations to sweep
  const paramCombos = getParamCombinations(strategyId, params)

  // Segment size
  const segmentSize = Math.floor(n / numFolds)

  // We run walk-forward folding.
  // For fold f (from 0 to numFolds-2):
  // - Train (In-sample) = candles from start up to (f + 1) * segmentSize
  // - Test (Out-of-sample) = candles from (f + 1) * segmentSize to (f + 2) * segmentSize
  for (let f = 0; f < numFolds - 1; f++) {
    const trainEndIdx = (f + 1) * segmentSize
    const testEndIdx = Math.min(n, (f + 2) * segmentSize)

    const trainCandles = candles.slice(0, trainEndIdx)
    const testCandles = candles.slice(trainEndIdx, testEndIdx)

    if (trainCandles.length < 10 || testCandles.length < 10) continue

    // Sweep parameters on training set to find best Sharpe
    let bestParams = { ...params }
    let bestTrainSharpe = -Infinity

    for (const combo of paramCombos) {
      const out = generateSignals(strategyId, trainCandles, combo)
      const res = runBacktest(
        trainCandles,
        out.signals,
        initialCapital,
        feeRate,
        direction,
        0, // no SL for optimization
        0, // no TP for optimization
        positionMode,
      )
      const sharpe = res.metrics.sharpeRatio
      if (!Number.isNaN(sharpe) && sharpe > bestTrainSharpe) {
        bestTrainSharpe = sharpe
        bestParams = combo
      }
    }

    if (bestTrainSharpe === -Infinity) {
      bestTrainSharpe = 0
    }

    // Run test set with best train parameters
    const testOut = generateSignals(strategyId, testCandles, bestParams)
    const testRes = runBacktest(
      testCandles,
      testOut.signals,
      initialCapital,
      feeRate,
      direction,
      0,
      0,
      positionMode,
    )
    const testSharpe = Number.isNaN(testRes.metrics.sharpeRatio) ? 0 : testRes.metrics.sharpeRatio

    // Format dates for display
    const formatDate = (t: number) => new Date(t * 1000).toISOString().slice(5, 10)
    const trainRange = `${formatDate(trainCandles[0].time)} to ${formatDate(trainCandles[trainCandles.length - 1].time)}`
    const testRange = `${formatDate(testCandles[0].time)} to ${formatDate(testCandles[testCandles.length - 1].time)}`

    folds.push({
      foldIndex: f + 1,
      trainParams: bestParams,
      trainSharpe: bestTrainSharpe,
      testSharpe,
      trainRange,
      testRange,
    })
  }

  // Calculate average train & test Sharpe
  const validFolds = folds.filter(f => !Number.isNaN(f.trainSharpe) && !Number.isNaN(f.testSharpe))
  const inSampleSharpe = validFolds.length
    ? validFolds.reduce((sum, f) => sum + f.trainSharpe, 0) / validFolds.length
    : 0
  const outOfSampleSharpe = validFolds.length
    ? validFolds.reduce((sum, f) => sum + f.testSharpe, 0) / validFolds.length
    : 0

  // Overfit Score: 0-100%
  // measures percentage degradation from In-Sample to Out-of-Sample
  let overfitScore = 0
  if (inSampleSharpe > 0) {
    overfitScore = Math.max(0, (1 - outOfSampleSharpe / inSampleSharpe) * 100)
  } else if (inSampleSharpe <= 0 && outOfSampleSharpe < inSampleSharpe) {
    overfitScore = 100 // OOS is worse when IS was already negative
  }

  // Parameter stability: run base parameters wiggled by ±20%, ±10%, 0% on ENTIRE dataset
  const stabilityPercents = [-20, -10, 0, 10, 20]
  const paramStability = stabilityPercents.map(pct => {
    // Wiggle all parameters by pct%
    const wiggled: Record<string, number> = {}
    const meta = strategyMeta(strategyId)
    for (const def of meta.params) {
      const baseVal = params[def.key] ?? def.default
      const wVal = baseVal * (1 + pct / 100)
      const stepped = Math.round(wVal / def.step) * def.step
      wiggled[def.key] = Math.max(def.min, Math.min(def.max, Number(stepped.toFixed(4))))
    }

    const out = generateSignals(strategyId, candles, wiggled)
    const res = runBacktest(
      candles,
      out.signals,
      initialCapital,
      feeRate,
      direction,
      0,
      0,
      positionMode,
    )
    return {
      percent: pct,
      sharpe: Number.isNaN(res.metrics.sharpeRatio) ? 0 : res.metrics.sharpeRatio,
    }
  })

  return {
    folds,
    inSampleSharpe,
    outOfSampleSharpe,
    overfitScore,
    paramStability,
  }
}
