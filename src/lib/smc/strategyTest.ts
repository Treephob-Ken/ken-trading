// Compare SMC entry rules using the SAME backtest engine as the Backtester
// page (runBacktest) so the numbers match across the app AND match what the
// deployed signal bot actually does: SL% bracket + exit/flip on the opposite
// structure signal (no fixed TP), fees included.
//
// Only LOOKAHEAD-SAFE (causal) entries are tested: structure breaks are detected
// from past data, and the discount/premium filter uses a rolling past-bars range.
// OB-tap / FVG-tap entries are a deliberate follow-up.

import type { Candle, Signal } from '@/types'
import type { SMCResult, StructureBreak } from './types'
import { runBacktest } from '@/lib/backtest'

export interface EntryResult {
  name: string
  trades: number
  winRate: number      // percent (0-100), from runBacktest
  returnPct: number    // total return % over the window, AFTER fees
  profitFactor: number // gross profit / gross loss (Infinity if no losses)
  maxDdPct: number     // max drawdown %
}

const LOOKBACK = 50      // bars for the causal discount/premium range
const FEE_RATE = 0.001   // 0.1% taker — matches the Backtester default
const CAPITAL = 10_000

interface Idx { index: number; dir: 'long' | 'short' }

export function compareSmcEntries(candles: Candle[], result: SMCResult, slPct = 1.5): EntryResult[] {
  const n = candles.length
  const idxByTime = new Map<number, number>()
  for (let i = 0; i < n; i++) idxByTime.set(candles[i].time, i)

  const toIdx = (s: StructureBreak): Idx | null => {
    const i = idxByTime.get(s.atTime)
    return i === undefined ? null : { index: i, dir: s.bias === 'bullish' ? 'long' : 'short' }
  }
  const ok = (x: Idx | null): x is Idx => x !== null

  // Causal discount/premium: is the entry in the lower (long) / upper (short)
  // half of the last LOOKBACK bars' range?
  const inFavorableZone = (sig: Idx): boolean => {
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

  const choch = result.structures.filter(s => s.kind === 'CHoCH').map(toIdx).filter(ok)
  const all = result.structures.map(toIdx).filter(ok)
  const chochZone = choch.filter(inFavorableZone)

  return [
    runRule('CHoCH', choch, candles, slPct),
    runRule('BOS + CHoCH', all, candles, slPct),
    runRule('CHoCH in discount/premium', chochZone, candles, slPct),
  ]
}

function runRule(name: string, idxs: Idx[], candles: Candle[], slPct: number): EntryResult {
  const signals: Signal[] = new Array(candles.length).fill(null)
  // A bullish break = buy (open/maintain long), bearish = sell. With direction
  // 'both', runBacktest flips on the opposite signal — exactly the bot's exit.
  for (const { index, dir } of idxs) signals[index] = dir === 'long' ? 'buy' : 'sell'
  const res = runBacktest(candles, signals, CAPITAL, FEE_RATE, 'both', slPct, 0, 'fixed', 2, 1.5)
  const m = res.metrics
  return {
    name,
    trades: m.numTrades,
    winRate: m.winRate,
    returnPct: m.totalReturnPct,
    profitFactor: m.profitFactor,
    maxDdPct: m.maxDrawdownPct,
  }
}
