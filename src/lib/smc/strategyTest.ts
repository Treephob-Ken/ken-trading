// Compare SMC entry rules on historical candles with a fixed 2R simulation.
// Answers "which entry would actually have made money in this window?"
//
// Only LOOKAHEAD-SAFE (causal) entries are tested here: structure breaks are
// detected using past data only, and the discount/premium filter uses a rolling
// past-bars range. OB-tap / FVG-tap entries need causal tap events and are a
// deliberate follow-up (the end-state OB/FVG lists carry survivorship bias).

import type { Candle } from '@/types'
import type { SMCResult, StructureBreak } from './types'

export interface EntryResult {
  name: string
  trades: number
  winRate: number      // 0..1 (resolved trades only)
  expectancyR: number  // average R per trade (win = +2R, loss = -1R)
  profitFactor: number // grossWin / grossLoss
}

interface Signal { index: number; dir: 'long' | 'short' }

const LOOKBACK = 50 // bars used for the causal discount/premium range

export function compareSmcEntries(candles: Candle[], result: SMCResult, slPct = 1.5): EntryResult[] {
  const n = candles.length
  const idxByTime = new Map<number, number>()
  for (let i = 0; i < n; i++) idxByTime.set(candles[i].time, i)

  const toSignal = (s: StructureBreak): Signal | null => {
    const i = idxByTime.get(s.atTime)
    return i === undefined ? null : { index: i, dir: s.bias === 'bullish' ? 'long' : 'short' }
  }
  const isSignal = (s: Signal | null): s is Signal => s !== null

  // Causal discount/premium: is the entry in the lower (long) / upper (short)
  // half of the last LOOKBACK bars' range?
  const inFavorableZone = (sig: Signal): boolean => {
    const start = Math.max(0, sig.index - LOOKBACK)
    let hi = -Infinity
    let lo = Infinity
    for (let k = start; k <= sig.index; k++) {
      if (candles[k].high > hi) hi = candles[k].high
      if (candles[k].low < lo) lo = candles[k].low
    }
    const mid = (hi + lo) / 2
    const price = candles[sig.index].close
    return sig.dir === 'long' ? price <= mid : price >= mid
  }

  const choch = result.structures.filter(s => s.kind === 'CHoCH').map(toSignal).filter(isSignal)
  const all = result.structures.map(toSignal).filter(isSignal)
  const chochZone = choch.filter(inFavorableZone)

  return [
    simulate('CHoCH', choch, candles, slPct),
    simulate('BOS + CHoCH', all, candles, slPct),
    simulate('CHoCH in discount/premium', chochZone, candles, slPct),
  ]
}

function simulate(name: string, signals: Signal[], candles: Candle[], slPct: number): EntryResult {
  let wins = 0
  let losses = 0
  for (const sig of signals) {
    const entry = candles[sig.index].close
    const slDist = entry * (slPct / 100)
    const sl = sig.dir === 'long' ? entry - slDist : entry + slDist
    const tp = sig.dir === 'long' ? entry + 2 * slDist : entry - 2 * slDist
    for (let k = sig.index + 1; k < candles.length; k++) {
      const c = candles[k]
      // SL checked first: if a bar spans both, count the loss (conservative).
      if (sig.dir === 'long') {
        if (c.low <= sl) { losses++; break }
        if (c.high >= tp) { wins++; break }
      } else {
        if (c.high >= sl) { losses++; break }
        if (c.low <= tp) { wins++; break }
      }
    }
  }
  const trades = wins + losses
  const winRate = trades ? wins / trades : 0
  const expectancyR = trades ? winRate * 2 - (1 - winRate) : 0
  const profitFactor = losses ? (wins * 2) / losses : wins ? Infinity : 0
  return { name, trades, winRate, expectancyR, profitFactor }
}
