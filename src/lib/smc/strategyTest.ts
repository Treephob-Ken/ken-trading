// Compare SMC entry rules × exit modes using the SAME backtest engine as the
// Backtester (runBacktest), so every number matches the Backtester AND what the
// deployed bot can actually do. Every exit here is expressible as a take-profit
// %, so all are testable consistently and deployable:
//
//   Flip = exit/flip on the opposite structure signal (tp off)
//   2R   = fixed take-profit at 2× the stop distance
//   MFE  = data-driven target: P75 of the strategy's historical favourable
//          excursion — i.e. "where price usually runs to (the liquidity) before
//          reversing". 0 if too few signals → behaves like Flip.
//
// Only LOOKAHEAD-SAFE (causal) entries are tested.

import type { Candle, Signal } from '@/types'
import type { SMCResult, StructureBreak } from './types'
import { runBacktest } from '@/lib/backtest'

export interface EntryResult {
  name: string         // "BOS + CHoCH · 2R"
  entry: string        // "CHoCH" | "BOS + CHoCH" | "CHoCH in zone"
  exit: string         // "Flip" | "2R" | "MFE"
  deployable: boolean  // the bot can run this exit
  trades: number
  winRate: number      // percent (0-100)
  returnPct: number    // total return % over the window, AFTER fees
  profitFactor: number
  maxDdPct: number
}

const LOOKBACK = 50
const FEE_RATE = 0.001
const CAPITAL = 10_000
const RR = 2

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

  const entries: { name: string; idxs: Idx[] }[] = [
    { name: 'CHoCH', idxs: result.structures.filter(s => s.kind === 'CHoCH').map(toIdx).filter(ok) },
    { name: 'BOS + CHoCH', idxs: result.structures.map(toIdx).filter(ok) },
  ]
  const chochZone = entries[0].idxs.filter(inFavorableZone)
  entries.push({ name: 'CHoCH in zone', idxs: chochZone })

  const out: EntryResult[] = []
  for (const e of entries) {
    const signals = buildSignals(n, e.idxs)
    const mfeTp = mfeTpPct(candles, signals)
    out.push(simulate(e.name, 'Flip', true, signals, candles, slPct, 0))
    out.push(simulate(e.name, '2R', true, signals, candles, slPct, RR * slPct))
    out.push(simulate(e.name, 'MFE', true, signals, candles, slPct, mfeTp))
  }
  return out
}

function buildSignals(n: number, idxs: Idx[]): Signal[] {
  const signals: Signal[] = new Array(n).fill(null)
  for (const { index, dir } of idxs) signals[index] = dir === 'long' ? 'buy' : 'sell'
  return signals
}

function simulate(entry: string, exit: string, deployable: boolean, signals: Signal[], candles: Candle[], slPct: number, tpPct: number): EntryResult {
  const res = runBacktest(candles, signals, CAPITAL, FEE_RATE, 'both', slPct, tpPct, 'fixed', 2, 1.5)
  const m = res.metrics
  return {
    name: `${entry} · ${exit}`,
    entry, exit, deployable,
    trades: m.numTrades,
    winRate: m.winRate,
    returnPct: m.totalReturnPct,
    profitFactor: m.profitFactor,
    maxDdPct: m.maxDrawdownPct,
  }
}

// P75 of favourable excursion % across the signal's trades (until the opposite
// signal). This is the data-driven "liquidity" target. 0 if < 5 signals.
function mfeTpPct(candles: Candle[], signals: Signal[]): number {
  const mfes: number[] = []
  for (let i = 0; i < signals.length - 1; i++) {
    const sig = signals[i]
    if (sig !== 'buy' && sig !== 'sell') continue
    const entry = candles[i].close
    if (!(entry > 0)) continue
    let exitIdx = signals.length - 1
    for (let j = i + 1; j < signals.length; j++) {
      if (signals[j] && signals[j] !== sig) { exitIdx = j; break }
    }
    if (sig === 'buy') {
      let mx = entry
      for (let k = i + 1; k <= exitIdx; k++) if (candles[k].high > mx) mx = candles[k].high
      const m = ((mx - entry) / entry) * 100
      if (m > 0) mfes.push(m)
    } else {
      let mn = entry
      for (let k = i + 1; k <= exitIdx; k++) if (candles[k].low < mn) mn = candles[k].low
      const m = ((entry - mn) / entry) * 100
      if (m > 0) mfes.push(m)
    }
  }
  if (mfes.length < 5) return 0
  mfes.sort((a, b) => a - b)
  const idx = (mfes.length - 1) * 0.75
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const p75 = lo === hi ? mfes[lo] : mfes[lo] + (mfes[hi] - mfes[lo]) * (idx - lo)
  return Math.round(p75 * 100) / 100
}
