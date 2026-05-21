import type { Candle, StrategyId } from '@/types'
import { generateSignals, defaultParams } from './strategies'
import { runBacktest } from './backtest'

export interface CorrelationResult {
  matrix: number[][]
  ids: StrategyId[]
  bestUncorrelated: StrategyId[]
  sharpes: Record<StrategyId, number>
  drawdowns: Record<StrategyId, number>
}

export function computeCorrelationMatrix(
  candles: Candle[],
  strategyIds: StrategyId[],
  backtestOpts: {
    initialCapital: number
    feeRate: number
    direction: 'long' | 'short' | 'both'
    stopLossPct?: number
    takeProfitPrice?: number
    positionMode?: 'fixed' | 'compounding' | 'volatility'
    targetRiskPct?: number
    atrMultiplier?: number
  }
): CorrelationResult {
  const returnsMap = new Map<StrategyId, number[]>()
  const sharpes = {} as Record<StrategyId, number>
  const drawdowns = {} as Record<StrategyId, number>

  // Get all unique days in chronological order
  const uniqueDays = Array.from(
    new Set(
      candles.map((c) => new Date(c.time * 1000).toISOString().slice(0, 10))
    )
  ).sort()

  for (const id of strategyIds) {
    const params = defaultParams(id)
    const out = generateSignals(id, candles, params)
    const res = runBacktest(
      candles,
      out.signals,
      backtestOpts.initialCapital,
      backtestOpts.feeRate,
      backtestOpts.direction,
      backtestOpts.stopLossPct ?? 0,
      0, // no TP for correlation comparison to focus on strategy return profiles
      backtestOpts.positionMode ?? 'fixed',
      backtestOpts.targetRiskPct ?? 2,
      backtestOpts.atrMultiplier ?? 1.5
    )

    sharpes[id] = res.metrics.sharpeRatio
    drawdowns[id] = res.metrics.maxDrawdownPct

    // Map date string -> equity value
    const dateToEquity = new Map<string, number>()
    for (const pt of res.equity) {
      const dateStr = new Date(pt.time * 1000).toISOString().slice(0, 10)
      dateToEquity.set(dateStr, pt.value)
    }

    // Generate daily equity series
    let lastVal = backtestOpts.initialCapital
    const dailyEquity: number[] = []
    for (const day of uniqueDays) {
      if (dateToEquity.has(day)) {
        lastVal = dateToEquity.get(day)!
      }
      dailyEquity.push(lastVal)
    }

    // Generate daily returns: (E_t - E_{t-1}) / E_{t-1}
    const dailyReturns: number[] = []
    for (let i = 1; i < dailyEquity.length; i++) {
      const prev = dailyEquity[i - 1]
      dailyReturns.push(prev > 0 ? (dailyEquity[i] - prev) / prev : 0)
    }
    returnsMap.set(id, dailyReturns)
  }

  // Calculate Pearson correlation matrix
  const matrix: number[][] = []
  const n = strategyIds.length

  for (let i = 0; i < n; i++) {
    matrix.push(new Array(n).fill(1))
  }

  const pearson = (x: number[], y: number[]): number => {
    if (x.length !== y.length || x.length === 0) return 0
    const mX = x.reduce((s, val) => s + val, 0) / x.length
    const mY = y.reduce((s, val) => s + val, 0) / y.length

    let num = 0
    let denX = 0
    let denY = 0

    for (let i = 0; i < x.length; i++) {
      const diffX = x[i] - mX
      const diffY = y[i] - mY
      num += diffX * diffY
      denX += diffX * diffX
      denY += diffY * diffY
    }

    const den = Math.sqrt(denX * denY)
    return den > 0 ? num / den : 0
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const returnsI = returnsMap.get(strategyIds[i]) || []
      const returnsJ = returnsMap.get(strategyIds[j]) || []
      const corr = pearson(returnsI, returnsJ)
      matrix[i][j] = corr
      matrix[j][i] = corr
    }
  }

  // Greedy selection for best diversified portfolio:
  // 1. Sort strategies by Sharpe Ratio (descending)
  // 2. Pick the best one
  // 3. For subsequent strategies, add if correlation with ALL selected strategies is < 0.5
  const sortedIds = [...strategyIds].sort((a, b) => (sharpes[b] || 0) - (sharpes[a] || 0))
  const bestUncorrelated: StrategyId[] = []

  if (sortedIds.length > 0) {
    bestUncorrelated.push(sortedIds[0])
    for (let i = 1; i < sortedIds.length; i++) {
      const candidate = sortedIds[i]
      let ok = true
      for (const selected of bestUncorrelated) {
        const idxCandidate = strategyIds.indexOf(candidate)
        const idxSelected = strategyIds.indexOf(selected)
        const corr = matrix[idxCandidate][idxSelected]
        if (corr >= 0.5) {
          ok = false
          break
        }
      }
      if (ok) {
        bestUncorrelated.push(candidate)
      }
    }
  }

  return {
    matrix,
    ids: strategyIds,
    bestUncorrelated,
    sharpes,
    drawdowns,
  }
}
