// Smart Money Concepts — shared types.
//
// Logic ported from the LuxAlgo "Smart Money Concepts" Pine v5 indicator.
// © LuxAlgo — licensed CC BY-NC-SA 4.0 (Attribution-NonCommercial-ShareAlike).
// Non-commercial use only; derivatives must keep this license + attribution.

export interface SMCSettings {
  // Bars used to confirm a swing pivot (LuxAlgo "swingsLengthInput", default 50).
  swingLength: number
  // Most-recent un-mitigated order blocks to keep (LuxAlgo default 5).
  orderBlockCount: number
  // Bars used to confirm an equal-high/low pivot (LuxAlgo default 3).
  equalLength: number
  // Equal-high/low sensitivity as a fraction of ATR(200) (LuxAlgo default 0.1).
  equalThreshold: number
}

// One detected structure break (Break of Structure or Change of Character).
export interface StructureBreak {
  kind: 'BOS' | 'CHoCH'
  bias: 'bullish' | 'bearish'
  // The pivot price that price closed through.
  level: number
  // Time (unix seconds) of the pivot bar that was broken.
  fromTime: number
  // Time (unix seconds) of the bar whose close broke the pivot.
  atTime: number
}

// Trailing swing extremes → "Strong/Weak High" and "Strong/Weak Low" labels.
export interface TrailingExtremes {
  top: number
  topTime: number
  topLabel: 'Strong High' | 'Weak High'
  bottom: number
  bottomTime: number
  bottomLabel: 'Strong Low' | 'Weak Low'
}

// A supply/demand order block — the candle that originated a structure break.
export interface OrderBlock {
  bias: 'bullish' | 'bearish'
  top: number
  bottom: number
  fromTime: number // unix seconds of the OB candle (box left edge)
}

// An equal-high (EQH) or equal-low (EQL): two same-side pivots at ~the same price.
export interface EqualLevel {
  kind: 'EQH' | 'EQL'
  level: number
  fromTime: number // prior equal pivot time
  toTime: number   // confirming equal pivot time
}

// A fair value gap (imbalance) — a 3-candle price gap that often gets refilled.
export interface FairValueGap {
  bias: 'bullish' | 'bearish'
  top: number
  bottom: number
  fromTime: number // unix seconds of the gap (middle) candle
}

// Premium / equilibrium / discount split of the current swing range.
// Above equilibrium = premium (expensive, prefer selling); below = discount.
export interface Zones {
  top: number
  equilibrium: number
  bottom: number
}

// Previous-period high/low from a higher timeframe (PDH/PDL, PWH/PWL, PMH/PML).
export interface MTFLevel {
  tf: 'D' | 'W' | 'M'
  high: number
  low: number
}

export interface SMCResult {
  structures: StructureBreak[]
  // null when there isn't enough data to establish extremes.
  trailing: TrailingExtremes | null
  // Most-recent un-mitigated order blocks (newest first), capped to orderBlockCount.
  orderBlocks: OrderBlock[]
  equalLevels: EqualLevel[]
  // Active (un-filled) fair value gaps, newest first.
  fairValueGaps: FairValueGap[]
  // Premium/discount split of the current swing range (null if no swing yet).
  zones: Zones | null
  // Previous-period high/low levels available from the loaded candles.
  mtfLevels: MTFLevel[]
}
