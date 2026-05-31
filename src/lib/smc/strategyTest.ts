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
  quality: number      // 0-100 composite (PF + sample + win-rate + drawdown)
}

// Tent: peaks on [lowPeak, highPeak], ramps to 0 at lowZero / highZero.
function tent(x: number, lowZero: number, lowPeak: number, highPeak: number, highZero: number): number {
  if (x <= lowZero || x >= highZero) return 0
  if (x >= lowPeak && x <= highPeak) return 1
  if (x < lowPeak) return (x - lowZero) / (lowPeak - lowZero)
  return (highZero - x) / (highZero - highPeak)
}

// Quality score (0-100) — ranks combos by ROBUST edge, not raw return.
// Return% is barely weighted because an unclosed position inflates it; the real
// signal is profit factor + enough closed trades + a non-lottery win rate + low
// drawdown. A PF-0 / 0%-win "mirage" row scores ~0.
export function smcQuality(r: { trades: number; winRate: number; returnPct: number; profitFactor: number; maxDdPct: number }): number {
  if (r.trades <= 0) return 0
  const pf = Math.max(0, Math.min(1, (r.profitFactor - 1) / 1.5)) * 35         // PF 1→0, 2.5+→35
  const tc = tent(r.trades, 4, 20, 120, 400) * 25                              // sweet spot 20-120
  const wr = Math.max(0, Math.min(1, (r.winRate - 15) / 35)) * 20              // 15%→0, 50%+→20
  const dd = (1 - Math.max(0, Math.min(1, r.maxDdPct / 80))) * 15              // 0%→15, 80%+→0
  const ret = r.returnPct > 0 ? Math.min(5, (r.returnPct * 0.5 / 30) * 5) : 0  // tiny, haircut
  return Math.round(Math.max(0, Math.min(100, pf + tc + wr + dd + ret)))
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

  const entries: { name: string; idxs: Idx[]; deployable: boolean }[] = [
    { name: 'CHoCH', idxs: result.structures.filter(s => s.kind === 'CHoCH').map(toIdx).filter(ok), deployable: true },
    { name: 'BOS + CHoCH', idxs: result.structures.map(toIdx).filter(ok), deployable: true },
  ]
  entries.push({ name: 'CHoCH in zone', idxs: entries[0].idxs.filter(inFavorableZone), deployable: true })
  // Retrace/retest entries: after a break, wait for the pull-back into a target
  // zone, then enter there (better price than chasing the break). Test-only for
  // now — the bot still enters on the break itself.
  entries.push({ name: 'Retest level', idxs: retraceEntries(candles, result.structures, idxByTime, 'level'), deployable: false })
  entries.push({ name: 'Retest OB', idxs: retraceEntries(candles, result.structures, idxByTime, 'ob'), deployable: false })
  entries.push({ name: 'Retest FVG', idxs: retraceEntries(candles, result.structures, idxByTime, 'fvg'), deployable: false })

  const out: EntryResult[] = []
  for (const e of entries) {
    const signals = buildSignals(n, e.idxs)
    const mfeTp = mfeTpPct(candles, signals)
    out.push(simulate(e.name, 'Flip', e.deployable, signals, candles, slPct, 0))
    out.push(simulate(e.name, '2R', e.deployable, signals, candles, slPct, RR * slPct))
    out.push(simulate(e.name, 'MFE', e.deployable, signals, candles, slPct, mfeTp))
  }
  return out
}

const RETEST_WINDOW = 40 // bars to wait for the pull-back after a break

// For each structure break, find the first bar (within RETEST_WINDOW) where
// price pulls back into the chosen target zone — that's the retrace entry.
// Causal: the zone is derived only from bars up to the break; the entry is a
// later bar. No survivorship bias (zones come from the break's own range).
function retraceEntries(
  candles: Candle[],
  breaks: StructureBreak[],
  idxByTime: Map<number, number>,
  kind: 'level' | 'ob' | 'fvg',
): Idx[] {
  const out: Idx[] = []
  for (const b of breaks) {
    const breakIdx = idxByTime.get(b.atTime)
    const pivotIdx = idxByTime.get(b.fromTime)
    if (breakIdx === undefined || pivotIdx === undefined || pivotIdx > breakIdx) continue
    const long = b.bias === 'bullish'

    let zoneTop: number
    let zoneBottom: number
    if (kind === 'level') {
      zoneTop = b.level
      zoneBottom = b.level
    } else if (kind === 'ob') {
      // Order block = the extreme candle in the pivot→break range.
      let ix = pivotIdx
      for (let k = pivotIdx; k <= breakIdx; k++) {
        if (long ? candles[k].low < candles[ix].low : candles[k].high > candles[ix].high) ix = k
      }
      zoneTop = candles[ix].high
      zoneBottom = candles[ix].low
    } else {
      const fvg = findFvgInRange(candles, pivotIdx, breakIdx, long)
      if (!fvg) continue
      zoneTop = fvg.top
      zoneBottom = fvg.bottom
    }

    const end = Math.min(breakIdx + RETEST_WINDOW, candles.length - 1)
    for (let k = breakIdx + 1; k <= end; k++) {
      const touched = long ? candles[k].low <= zoneTop : candles[k].high >= zoneBottom
      if (touched) { out.push({ index: k, dir: long ? 'long' : 'short' }); break }
    }
  }
  return out
}

// Last fair-value gap in [a, b] matching the direction (3-candle imbalance).
function findFvgInRange(candles: Candle[], a: number, b: number, long: boolean): { top: number; bottom: number } | null {
  let found: { top: number; bottom: number } | null = null
  for (let i = Math.max(a + 2, 2); i <= b; i++) {
    if (long && candles[i].low > candles[i - 2].high) found = { top: candles[i].low, bottom: candles[i - 2].high }
    else if (!long && candles[i].high < candles[i - 2].low) found = { top: candles[i - 2].low, bottom: candles[i].high }
  }
  return found
}

function buildSignals(n: number, idxs: Idx[]): Signal[] {
  const signals: Signal[] = new Array(n).fill(null)
  for (const { index, dir } of idxs) signals[index] = dir === 'long' ? 'buy' : 'sell'
  return signals
}

function simulate(entry: string, exit: string, deployable: boolean, signals: Signal[], candles: Candle[], slPct: number, tpPct: number): EntryResult {
  const res = runBacktest(candles, signals, CAPITAL, FEE_RATE, 'both', slPct, tpPct, 'fixed', 2, 1.5)
  const m = res.metrics
  const base = {
    name: `${entry} · ${exit}`,
    entry, exit, deployable,
    trades: m.numTrades,
    winRate: m.winRate,
    returnPct: m.totalReturnPct,
    profitFactor: m.profitFactor,
    maxDdPct: m.maxDrawdownPct,
  }
  return { ...base, quality: smcQuality(base) }
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
