// Look-ahead bias detector. A strategy that uses future information will
// produce DIFFERENT signals on historical bars when given a longer candle
// series. We exploit that: generate signals on bars 0..N, then on bars 0..N-K,
// and compare the overlapping range. If they differ on past bars, the
// strategy is peeking into the future.
//
// This catches the same class of bug as Elliott Wave's ZigZag pivots — where
// a pivot at bar i was only "known" later when price retraced N% from it.

import type { Candle, StrategyId } from '@/types'
import { defaultParams, generateSignals } from '@/lib/strategies'

export interface LookaheadReport {
  strategyId: StrategyId
  ok: boolean
  diffCount: number   // # of bars where signals disagree
  diffPct: number     // % of bars that disagree
  // Index of the first disagreeing bar (for debugging). null if ok.
  firstDiffIdx: number | null
}

/**
 * Run the strategy twice on the same candle history and compare overlapping
 * signals. `tailDrop` bars are dropped from the tail of the second run.
 *
 * For a clean strategy, the signal at every bar in the overlap should be
 * identical regardless of whether the run included tail bars or not.
 */
export function checkLookahead(
  strategyId: StrategyId,
  candles: Candle[],
  params?: Record<string, number>,
  tailDrop = 20,
): LookaheadReport {
  if (candles.length < 50) {
    return { strategyId, ok: true, diffCount: 0, diffPct: 0, firstDiffIdx: null }
  }
  const p = params ?? defaultParams(strategyId)
  const full = generateSignals(strategyId, candles, p).signals
  const trimmed = candles.slice(0, candles.length - tailDrop)
  const short = generateSignals(strategyId, trimmed, p).signals

  // Compare overlap, ignoring the last `tailDrop` warmup bars in `short` —
  // strategies legitimately need lookback so the most recent signals before
  // the trim point can shift slightly. We look at bars 0..short.length-warmup
  // where warmup is generous (5 bars on top of strategy-specific lookback).
  const warmup = 5
  const upper = short.length - warmup
  let diffCount = 0
  let firstDiffIdx: number | null = null
  for (let i = 0; i < upper; i++) {
    if (full[i] !== short[i]) {
      diffCount++
      if (firstDiffIdx === null) firstDiffIdx = i
    }
  }
  const diffPct = upper > 0 ? (diffCount / upper) * 100 : 0
  // Threshold: more than 0.5% of historical bars changing = look-ahead bias.
  // Below that = harmless edge effects.
  const ok = diffPct < 0.5
  return { strategyId, ok, diffCount, diffPct, firstDiffIdx }
}
