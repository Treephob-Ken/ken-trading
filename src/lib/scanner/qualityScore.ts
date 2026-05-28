// Quality Score (0–100) for an Indicator scanner row.
//
// Replaces "sort by raw return %" with a composite signal that combines
// risk-adjusted return, beats-buy-and-hold, trade-count quality, real-money
// realism, multi-TF agreement, and a funding penalty.
//
// Inputs are already populated by runBacktest() + scanner enrichment — this
// function does no fetching and no analysis, it just weights what's there.

import type { IndicatorScanRow } from './indicatorScan'

export interface QualityBreakdown {
  total: number             // final score, clamped [0,100]
  calmar: number            // points from calmar ratio
  sharpe: number            // points from sharpe
  beatsBH: number           // points from beating buy & hold
  tradeCount: number        // points from trade-count quality
  realistic: number         // points from realistic-return guess
  confluence: number        // points from HTF confluence
  fundingPenalty: number    // negative points from crowded funding
  forcedZero: boolean       // true if look-ahead detected -> score = 0
}

// Tent function: peaks at [lowPeak, highPeak], ramps to 0 at lowZero / highZero.
function tent(x: number, lowZero: number, lowPeak: number, highPeak: number, highZero: number): number {
  if (x <= lowZero || x >= highZero) return 0
  if (x >= lowPeak && x <= highPeak) return 1
  if (x < lowPeak) return (x - lowZero) / (lowPeak - lowZero)
  return (highZero - x) / (highZero - highPeak)
}

export function qualityScore(row: IndicatorScanRow): QualityBreakdown {
  // Look-ahead = kill switch. Backtest numbers can't be trusted at all.
  if (row.looksAhead) {
    return {
      total: 0, calmar: 0, sharpe: 0, beatsBH: 0, tradeCount: 0,
      realistic: 0, confluence: 0, fundingPenalty: 0, forcedZero: true,
    }
  }

  // Calmar — return per unit drawdown. Normalised so calmar=3 -> 25pts.
  const calmarRaw = row.calmar ?? 0
  const calmar = Math.max(0, Math.min(3, calmarRaw)) / 3 * 25

  // Sharpe — capped at 3.0 because higher is usually fitted/look-ahead.
  const sharpeRaw = row.sharpeRatio ?? 0
  const sharpe = Math.max(0, Math.min(3, sharpeRaw)) / 3 * 15

  // Beats buy & hold — must earn its complexity.
  const beatsBH = row.totalReturnPct > row.buyHoldReturnPct ? 15 : 0

  // Trade count — sweet spot 15..80. <5 lucky one-off; >150 overtrading.
  const tradeCount = tent(row.numTrades, 4, 15, 80, 200) * 10

  // Realistic guess (50% haircut): +3% -> 5pts, +20% -> 15pts. Below +3 -> 0.
  const realisticPct = row.totalReturnPct > 0 ? row.totalReturnPct * 0.5 : 0
  let realistic = 0
  if (realisticPct >= 3) {
    realistic = Math.min(15, 5 + ((realisticPct - 3) / (20 - 3)) * 10)
  }

  // HTF confluence — bonus for agreement; neutral counts a little.
  let confluence = 0
  if (row.confluence === 'aligned') confluence = 10
  else if (row.confluence === 'neutral') confluence = 5

  // Funding penalty — crowded perps bleed money the backtest never paid.
  let fundingPenalty = 0
  const apr = row.fundingApr
  if (typeof apr === 'number' && Number.isFinite(apr)) {
    if (apr > 50) fundingPenalty = -15
    else if (apr < -50) fundingPenalty = -10
  }

  const raw = calmar + sharpe + beatsBH + tradeCount + realistic + confluence + fundingPenalty
  const total = Math.max(0, Math.min(100, raw))

  return {
    total, calmar, sharpe, beatsBH, tradeCount, realistic, confluence, fundingPenalty, forcedZero: false,
  }
}
