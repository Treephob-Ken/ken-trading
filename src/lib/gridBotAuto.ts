/**
 * Grid Bot Auto — ported from Pine Script by mvs1231/xxattaxx.
 *
 * Core idea: a "lazy" moving average acts as the grid anchor.  The anchor
 * point (AP) steps toward the LMA one grid-interval at a time, keeping
 * the grid stable while still tracking a slow drift in price.
 */

import type { Candle } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GridBotAutoParams {
  smoothingLen: number      // MA period (default 7)
  laziness: number          // % band before LMA updates (default 4)
  elasticity: number        // AP speed toward LMA in 0.01%-of-price steps/bar (default 50)
  gridIntervalPct: number   // grid spacing as % of AP (default 2)
  gridCount: number         // levels on each side of AP (default 2 → 5 lines total)
  cooldown: number          // bars between signals on same side (default 2)
  direction: 'neutral' | 'long' | 'short'
}

export const DEFAULT_AUTO_PARAMS: GridBotAutoParams = {
  smoothingLen: 7,
  laziness: 4,
  elasticity: 50,
  gridIntervalPct: 2,
  gridCount: 2,
  cooldown: 2,
  direction: 'neutral',
}

export interface AutoSignal {
  bar: number
  time: number
  type: 'buy' | 'sell'
  price: number
}

export interface GridBotAutoResult {
  /** Anchor point per bar. NaN for bars where LMA is not yet available. */
  anchorPoints: number[]
  /** Lazy MA per bar. */
  lmaValues: number[]
  /** Grid line prices per bar (sorted ascending). */
  gridLinesByBar: number[][]
  /** All detected signals. */
  signals: AutoSignal[]
  /** Last bar's anchor point. */
  currentAP: number
  /** Last bar's grid lines (sorted ascending). */
  currentLines: number[]
  /** Last bar's LMA. */
  currentLMA: number
}

// ── Math helpers ──────────────────────────────────────────────────────────────

/** Linear regression endpoint — equivalent to ta.linreg(src, length, 0) in Pine. */
function linregEnd(values: number[], i: number, period: number): number {
  if (i < period - 1) return NaN
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let j = 0; j < period; j++) {
    const x = j
    const y = values[i - (period - 1 - j)]
    sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x
  }
  const n = period
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return sumY / n
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return intercept + slope * (period - 1)
}

/**
 * "Lazy" filter: only updates when value moves more than `lazinessF` (fraction)
 * away from the previous output.  Keeps the anchor stable during small wiggles.
 *
 * Mirrors the Pine lz() function with sign(x) = 1 for positive prices.
 */
function lazyFilter(values: number[], lazinessF: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN)
  for (let i = 0; i < values.length; i++) {
    const x = values[i]
    if (isNaN(x)) continue
    if (i === 0 || isNaN(out[i - 1])) {
      out[i] = x
      continue
    }
    const prev = out[i - 1]
    // Allow ±lazinessF of the previous LMA value
    if (x > prev + lazinessF * prev || x < prev - lazinessF * prev) {
      out[i] = x
    } else {
      out[i] = prev
    }
  }
  return out
}

// ── Core computation ──────────────────────────────────────────────────────────

export function computeGridBotAuto(
  candles: Candle[],
  params: GridBotAutoParams,
): GridBotAutoResult {
  const n = candles.length
  const closes = candles.map((c) => c.close)

  // 1. Compute linear-regression MA then apply lazy filter
  const maValues = closes.map((_, i) => linregEnd(closes, i, params.smoothingLen))
  const lazF = params.laziness / 100
  const lmaValues = lazyFilter(maValues, lazF)

  // 2. Compute anchor points — steps toward LMA by ≤1 GI per bar
  const anchorPoints: number[] = new Array(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    const lma = lmaValues[i]
    if (isNaN(lma)) continue

    // Initialise on first valid bar
    if (i === 0 || isNaN(anchorPoints[i - 1])) {
      anchorPoints[i] = closes[i]
      continue
    }

    // Reset AP when LMA jumps (lazy filter triggered)
    if (lma !== lmaValues[i - 1]) {
      anchorPoints[i] = closes[i]
      continue
    }

    const prevAP = anchorPoints[i - 1]
    const gi = prevAP * params.gridIntervalPct / 100
    const nextUP = prevAP + gi
    const nextDN = prevAP - gi

    // Move AP toward LMA — 1 basis-point of price × elasticity per bar
    const step = prevAP * 0.0001 * params.elasticity
    let ap = prevAP + step * Math.sign(lma - prevAP)

    // Clamp: AP can only snap to the adjacent grid boundary
    if (ap >= nextUP) ap = nextUP
    if (ap <= nextDN) ap = nextDN

    anchorPoints[i] = ap
  }

  // 3. Build grid lines for every bar
  const gridLinesByBar: number[][] = new Array(n).fill(null).map(() => [])
  for (let i = 0; i < n; i++) {
    const ap = anchorPoints[i]
    if (isNaN(ap)) continue
    const gi = ap * params.gridIntervalPct / 100
    const lines: number[] = []
    for (let k = -params.gridCount; k <= params.gridCount; k++) {
      lines.push(ap + k * gi)
    }
    gridLinesByBar[i] = lines.sort((a, b) => a - b)
  }

  // 4. Detect signals: price crosses a grid line within bar (wick ± close direction)
  const signals: AutoSignal[] = []
  let lastBuyBar = -999
  let lastSellBar = -999

  for (let i = 1; i < n; i++) {
    const lines = gridLinesByBar[i]
    if (lines.length === 0) continue

    const c = candles[i]
    let buyHit = false
    let sellHit = false

    for (const line of lines) {
      const touched = c.high > line && c.low < line
      if (!touched) continue
      if (c.close >= line) buyHit = true
      if (c.close <= line) sellHit = true
    }

    // Conflicting cross — both sides touched, ignore
    if (buyHit && sellHit) continue

    if (buyHit && params.direction !== 'short' && i - lastBuyBar > params.cooldown) {
      lastBuyBar = i
      signals.push({ bar: i, time: candles[i].time, type: 'buy', price: c.close })
    } else if (sellHit && params.direction !== 'long' && i - lastSellBar > params.cooldown) {
      lastSellBar = i
      signals.push({ bar: i, time: candles[i].time, type: 'sell', price: c.close })
    }
  }

  const lastI = n - 1
  const currentAP = anchorPoints[lastI] ?? NaN
  const currentLMA = lmaValues[lastI] ?? NaN
  const currentLines = gridLinesByBar[lastI] ?? []

  return { anchorPoints, lmaValues, gridLinesByBar, signals, currentAP, currentLines, currentLMA }
}
