// Smart Money Concepts engine — swing structure + trailing extremes (Phase 1).
//
// Logic ported from the LuxAlgo "Smart Money Concepts" Pine v5 indicator.
// © LuxAlgo — licensed CC BY-NC-SA 4.0. Non-commercial use only.
//
// Faithful port of the LuxAlgo `leg()` swing state machine and the swing
// BOS/CHoCH detection (close crossing the most recent swing pivot). Trailing
// extremes mirror updateTrailingExtremes()/drawHighLowSwings().

import type { Candle } from '@/types'
import type { SMCResult, SMCSettings, StructureBreak, TrailingExtremes } from './types'

const DEFAULTS: SMCSettings = { swingLength: 50, orderBlockCount: 5, equalLength: 3, equalThreshold: 0.1 }

export function computeSMC(candles: Candle[], settings: Partial<SMCSettings> = {}): SMCResult {
  const cfg: SMCSettings = { ...DEFAULTS, ...settings }
  const size = Math.max(2, Math.floor(cfg.swingLength))
  const n = candles.length
  const structures: StructureBreak[] = []

  if (n < size + 2) return { structures: [], trailing: null, orderBlocks: [], equalLevels: [] }

  const high = candles.map(c => c.high)
  const low = candles.map(c => c.low)
  const close = candles.map(c => c.close)
  const time = candles.map(c => c.time)

  // leg: 0 = bearish leg, 1 = bullish leg (matches LuxAlgo BEARISH_LEG / BULLISH_LEG).
  let leg = 0
  let swingHigh: { level: number; time: number; crossed: boolean } | null = null
  let swingLow: { level: number; time: number; crossed: boolean } | null = null
  // bias: 0 unknown, 1 bullish, -1 bearish (LuxAlgo swingTrend.bias).
  let bias: 0 | 1 | -1 = 0

  // Trailing extremes — reset on each new pivot, extended every bar.
  let top = high[0]
  let topTime = time[0]
  let bottom = low[0]
  let bottomTime = time[0]

  for (let i = size; i < n; i++) {
    const ref = i - size
    let maxR = -Infinity
    let minR = Infinity
    for (let k = ref + 1; k <= i; k++) {
      if (high[k] > maxR) maxR = high[k]
      if (low[k] < minR) minR = low[k]
    }
    const newLegHigh = high[ref] > maxR
    const newLegLow = low[ref] < minR

    const prevLeg = leg
    if (newLegHigh) leg = 0
    else if (newLegLow) leg = 1
    const startOfNewLeg = leg !== prevLeg

    if (startOfNewLeg) {
      if (leg === 1) {
        // New bullish leg → swing low confirmed at ref.
        swingLow = { level: low[ref], time: time[ref], crossed: false }
        bottom = low[ref]
        bottomTime = time[ref]
      } else {
        // New bearish leg → swing high confirmed at ref.
        swingHigh = { level: high[ref], time: time[ref], crossed: false }
        top = high[ref]
        topTime = time[ref]
      }
    }

    // Extend trailing extremes each bar.
    if (high[i] > top) { top = high[i]; topTime = time[i] }
    if (low[i] < bottom) { bottom = low[i]; bottomTime = time[i] }

    // Bullish break: close crosses above the last swing high.
    if (swingHigh && !swingHigh.crossed && close[i] > swingHigh.level) {
      const kind: StructureBreak['kind'] = bias === -1 ? 'CHoCH' : 'BOS'
      structures.push({ kind, bias: 'bullish', level: swingHigh.level, fromTime: swingHigh.time, atTime: time[i] })
      swingHigh.crossed = true
      bias = 1
    }

    // Bearish break: close crosses below the last swing low.
    if (swingLow && !swingLow.crossed && close[i] < swingLow.level) {
      const kind: StructureBreak['kind'] = bias === 1 ? 'CHoCH' : 'BOS'
      structures.push({ kind, bias: 'bearish', level: swingLow.level, fromTime: swingLow.time, atTime: time[i] })
      swingLow.crossed = true
      bias = -1
    }
  }

  const trailing: TrailingExtremes = {
    top,
    topTime,
    topLabel: bias === -1 ? 'Strong High' : 'Weak High',
    bottom,
    bottomTime,
    bottomLabel: bias === 1 ? 'Strong Low' : 'Weak Low',
  }

  return { structures, trailing, orderBlocks: [], equalLevels: [] }
}
