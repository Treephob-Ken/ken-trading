// Smart Money Concepts — shared types.
//
// Logic ported from the LuxAlgo "Smart Money Concepts" Pine v5 indicator.
// © LuxAlgo — licensed CC BY-NC-SA 4.0 (Attribution-NonCommercial-ShareAlike).
// Non-commercial use only; derivatives must keep this license + attribution.

// Phase 1 settings subset. Later phases extend this (order blocks, EQH/EQL, etc.).
export interface SMCSettings {
  // Bars used to confirm a swing pivot (LuxAlgo "swingsLengthInput", default 50).
  swingLength: number
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

export interface SMCResult {
  structures: StructureBreak[]
  // null when there isn't enough data to establish extremes.
  trailing: TrailingExtremes | null
}
