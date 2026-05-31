// Smart Money Concepts engine — swing structure + trailing extremes (Phase 1).
//
// Logic ported from the LuxAlgo "Smart Money Concepts" Pine v5 indicator.
// © LuxAlgo — licensed CC BY-NC-SA 4.0. Non-commercial use only.
//
// Faithful port of the LuxAlgo `leg()` swing state machine and the swing
// BOS/CHoCH detection (close crossing the most recent swing pivot). Trailing
// extremes mirror updateTrailingExtremes()/drawHighLowSwings().

import type { Candle } from '@/types'
import { atr } from '../indicators'
import type { OrderBlock, SMCResult, SMCSettings, StructureBreak, TrailingExtremes } from './types'

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

  // Volatility-parsed extremes for order blocks (LuxAlgo): on high-volatility
  // bars the high/low are swapped so the OB hugs the candle body, not the wick.
  const vol = atr(high, low, close, 200)
  const parsedHigh: number[] = new Array(n)
  const parsedLow: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const highVol = high[i] - low[i] >= 2 * vol[i] // NaN vol → false → no swap
    parsedHigh[i] = highVol ? low[i] : high[i]
    parsedLow[i] = highVol ? high[i] : low[i]
  }

  interface ActiveOB { bias: 'bullish' | 'bearish'; top: number; bottom: number; fromTime: number; fromIndex: number }
  const activeOBs: ActiveOB[] = []

  // leg: 0 = bearish leg, 1 = bullish leg (matches LuxAlgo BEARISH_LEG / BULLISH_LEG).
  let leg = 0
  let swingHigh: { level: number; time: number; index: number; crossed: boolean } | null = null
  let swingLow: { level: number; time: number; index: number; crossed: boolean } | null = null
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
        swingLow = { level: low[ref], time: time[ref], index: ref, crossed: false }
        bottom = low[ref]
        bottomTime = time[ref]
      } else {
        // New bearish leg → swing high confirmed at ref.
        swingHigh = { level: high[ref], time: time[ref], index: ref, crossed: false }
        top = high[ref]
        topTime = time[ref]
      }
    }

    // Extend trailing extremes each bar.
    if (high[i] > top) { top = high[i]; topTime = time[i] }
    if (low[i] < bottom) { bottom = low[i]; bottomTime = time[i] }

    // Mitigation: drop any order block this bar's price has traded through.
    // (Runs before new OBs are created, so a fresh OB can't self-mitigate.)
    for (let j = activeOBs.length - 1; j >= 0; j--) {
      const ob = activeOBs[j]
      if (ob.bias === 'bullish' ? low[i] < ob.bottom : high[i] > ob.top) activeOBs.splice(j, 1)
    }

    // Bullish break: close crosses above the last swing high.
    if (swingHigh && !swingHigh.crossed && close[i] > swingHigh.level) {
      const kind: StructureBreak['kind'] = bias === -1 ? 'CHoCH' : 'BOS'
      structures.push({ kind, bias: 'bullish', level: swingHigh.level, fromTime: swingHigh.time, atTime: time[i] })
      // OB = the lowest (parsed) candle between the pivot and the break.
      let idx = swingHigh.index
      for (let k = swingHigh.index; k < i; k++) if (parsedLow[k] < parsedLow[idx]) idx = k
      activeOBs.push({ bias: 'bullish', top: parsedHigh[idx], bottom: parsedLow[idx], fromTime: time[idx], fromIndex: idx })
      swingHigh.crossed = true
      bias = 1
    }

    // Bearish break: close crosses below the last swing low.
    if (swingLow && !swingLow.crossed && close[i] < swingLow.level) {
      const kind: StructureBreak['kind'] = bias === 1 ? 'CHoCH' : 'BOS'
      structures.push({ kind, bias: 'bearish', level: swingLow.level, fromTime: swingLow.time, atTime: time[i] })
      // OB = the highest (parsed) candle between the pivot and the break.
      let idx = swingLow.index
      for (let k = swingLow.index; k < i; k++) if (parsedHigh[k] > parsedHigh[idx]) idx = k
      activeOBs.push({ bias: 'bearish', top: parsedHigh[idx], bottom: parsedLow[idx], fromTime: time[idx], fromIndex: idx })
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

  const orderBlocks: OrderBlock[] = activeOBs
    .slice(-cfg.orderBlockCount)
    .reverse()
    .map(({ bias, top, bottom, fromTime }) => ({ bias, top, bottom, fromTime }))

  return { structures, trailing, orderBlocks, equalLevels: [] }
}
