import type { Candle, Trade } from '@/types'
import type { RegimeLabel } from './markov'
import { STATES } from './markov'

export interface RegimeBucketStats {
  label: RegimeLabel
  /** State index — 0 Bear, 1 Sideways, 2 Bull. */
  state: number
  count: number
  wins: number
  losses: number
  winRate: number          // %
  avgPnlPct: number        // mean per-trade pnlPct
  totalPnlPct: number      // sum of pnlPct across trades in this regime
  bestTradePct: number
  worstTradePct: number
  profitFactor: number
}

export interface RegimeBreakdown {
  buckets: RegimeBucketStats[]    // [Bear, Sideways, Bull] in fixed order
  untaggedCount: number           // trades that fell before the regime window filled
  total: number
}

// Binary search candles by time. Candles array is sorted ascending by time.
function findCandleIndex(candles: Candle[], time: number): number {
  let lo = 0
  let hi = candles.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const t = candles[mid].time
    if (t === time) return mid
    if (t < time) lo = mid + 1
    else hi = mid - 1
  }
  // No exact match — return the candle the trade fell into (last one with time ≤ entryTime).
  return Math.max(0, hi)
}

function emptyBucket(state: number): RegimeBucketStats {
  return {
    label: STATES[state],
    state,
    count: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    avgPnlPct: 0,
    totalPnlPct: 0,
    bestTradePct: 0,
    worstTradePct: 0,
    profitFactor: 0,
  }
}

// Classify each trade by the regime label of the candle it opened in,
// then aggregate per-regime stats.
export function tradesByRegime(
  trades: Trade[],
  candles: Candle[],
  regimeLabels: number[],
): RegimeBreakdown {
  const buckets = [emptyBucket(0), emptyBucket(1), emptyBucket(2)]
  const grossWin = [0, 0, 0]
  const grossLoss = [0, 0, 0]
  let untagged = 0

  for (const t of trades) {
    const idx = findCandleIndex(candles, t.entryTime)
    const label = regimeLabels[idx]
    if (label < 0 || label > 2) {
      untagged++
      continue
    }
    const b = buckets[label]
    b.count++
    b.totalPnlPct += t.pnlPct
    if (t.pnl >= 0) {
      b.wins++
      grossWin[label] += Math.abs(t.pnlPct)
    } else {
      b.losses++
      grossLoss[label] += Math.abs(t.pnlPct)
    }
    if (t.pnlPct > b.bestTradePct) b.bestTradePct = t.pnlPct
    if (t.pnlPct < b.worstTradePct) b.worstTradePct = t.pnlPct
  }

  for (let s = 0; s < 3; s++) {
    const b = buckets[s]
    if (b.count > 0) {
      b.winRate = (b.wins / b.count) * 100
      b.avgPnlPct = b.totalPnlPct / b.count
      b.profitFactor = grossLoss[s] > 0 ? grossWin[s] / grossLoss[s] : grossWin[s] > 0 ? Infinity : 0
    }
  }

  return {
    buckets,
    untaggedCount: untagged,
    total: trades.length,
  }
}
