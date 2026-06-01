// Bot-side evaluator for CustomStrategySpec. Mirrors src/lib/builder/
// evaluate.ts; must stay in lock-step so the bot trades exactly what the
// builder UI's backtest showed.

import {
  adx,
  atr,
  bollinger,
  ema,
  macd,
  rsi,
  sma,
  smcStructure,
  stochastic,
} from './indicators.js'
import type { Candle, Signal } from './strategies.js'
import type {
  CompareOp,
  ConditionBlock,
  ConditionGroup,
  CustomStrategySpec,
  SeriesRef,
  SignalEventRef,
  StateOp,
} from './builder-types.js'

function seriesKey(ref: SeriesRef): string {
  const ps = Object.entries(ref.params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return `${ref.id}|${ps}`
}

function eventKey(ref: SignalEventRef): string {
  const ps = Object.entries(ref.params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return `${ref.kind}|${ps}`
}

function computeSeries(ref: SeriesRef, candles: Candle[]): number[] {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)

  switch (ref.id) {
    case 'price': return closes
    case 'volume': return candles.map((c) => c.volume)
    case 'volume_ma': return sma(candles.map((c) => c.volume), Math.max(2, Math.floor(ref.params.length ?? 20)))
    case 'atr': return atr(highs, lows, closes, Math.max(2, Math.floor(ref.params.length ?? 14)))
    case 'rsi':   return rsi(closes, Math.max(2, Math.floor(ref.params.length ?? 14)))
    case 'ema':   return ema(closes, Math.max(2, Math.floor(ref.params.length ?? 20)))
    case 'sma':   return sma(closes, Math.max(2, Math.floor(ref.params.length ?? 20)))
    case 'macd_line':
    case 'macd_signal':
    case 'macd_hist': {
      const m = macd(closes,
        Math.max(2, Math.floor(ref.params.fast ?? 12)),
        Math.max(2, Math.floor(ref.params.slow ?? 26)),
        Math.max(2, Math.floor(ref.params.signal ?? 9)))
      if (ref.id === 'macd_line') return m.macd
      if (ref.id === 'macd_signal') return m.signal
      return m.hist
    }
    case 'bb_upper':
    case 'bb_mid':
    case 'bb_lower': {
      const b = bollinger(closes,
        Math.max(2, Math.floor(ref.params.length ?? 20)),
        ref.params.mult ?? 2)
      if (ref.id === 'bb_upper') return b.upper
      if (ref.id === 'bb_lower') return b.lower
      return b.mid
    }
    case 'adx':
    case 'plus_di':
    case 'minus_di': {
      const a = adx(highs, lows, closes, Math.max(2, Math.floor(ref.params.length ?? 14)))
      if (ref.id === 'plus_di') return a.plusDI
      if (ref.id === 'minus_di') return a.minusDI
      return a.adx
    }
    case 'stoch_k':
    case 'stoch_d': {
      const s = stochastic(highs, lows, closes,
        Math.max(2, Math.floor(ref.params.kLen ?? 14)),
        Math.max(1, Math.floor(ref.params.kSmooth ?? 3)),
        Math.max(2, Math.floor(ref.params.dLen ?? 3)))
      return ref.id === 'stoch_k' ? s.k : s.d
    }
  }
}

function computeEvent(ref: SignalEventRef, candles: Candle[]): boolean[] {
  const n = candles.length
  const out = new Array<boolean>(n).fill(false)
  switch (ref.kind) {
    case 'smc_bullish_choch':
    case 'smc_bearish_choch':
    case 'smc_bullish_bos':
    case 'smc_bearish_bos': {
      const swingLength = Math.max(2, Math.floor(ref.params.swingLength ?? 50))
      const highs = candles.map((c) => c.high)
      const lows = candles.map((c) => c.low)
      const closes = candles.map((c) => c.close)
      const both = smcStructure(highs, lows, closes, swingLength, 'both')
      const chochOnly = smcStructure(highs, lows, closes, swingLength, 'choch')
      for (let i = 0; i < n; i++) {
        const isChoch = chochOnly[i] !== null
        const bothFired = both[i]
        switch (ref.kind) {
          case 'smc_bullish_choch': out[i] = isChoch && chochOnly[i] === 'buy'; break
          case 'smc_bearish_choch': out[i] = isChoch && chochOnly[i] === 'sell'; break
          case 'smc_bullish_bos':   out[i] = bothFired === 'buy' && !isChoch; break
          case 'smc_bearish_bos':   out[i] = bothFired === 'sell' && !isChoch; break
        }
      }
      break
    }
  }
  return out
}

interface Cache {
  series: Map<string, number[]>
  events: Map<string, boolean[]>
}

function buildCache(spec: CustomStrategySpec, candles: Candle[]): Cache {
  const series = new Map<string, number[]>()
  const events = new Map<string, boolean[]>()
  const visit = (group: ConditionGroup | undefined) => {
    if (!group) return
    for (const b of group.conditions) {
      switch (b.kind) {
        case 'compare':
          if (!series.has(seriesKey(b.series))) series.set(seriesKey(b.series), computeSeries(b.series, candles))
          break
        case 'cross':
        case 'state':
          if (!series.has(seriesKey(b.a))) series.set(seriesKey(b.a), computeSeries(b.a, candles))
          if (!series.has(seriesKey(b.b))) series.set(seriesKey(b.b), computeSeries(b.b, candles))
          break
        case 'event':
          if (!events.has(eventKey(b.event))) events.set(eventKey(b.event), computeEvent(b.event, candles))
          break
      }
    }
  }
  visit(spec.entryLong); visit(spec.exitLong)
  visit(spec.entryShort); visit(spec.exitShort)
  return { series, events }
}

function cmp(a: number, op: CompareOp, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  switch (op) {
    case '>':  return a > b
    case '<':  return a < b
    case '>=': return a >= b
    case '<=': return a <= b
    case '==': return a === b
  }
}

function stateCmp(a: number, op: StateOp, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return op === 'above' ? a > b : a < b
}

function evalBlock(b: ConditionBlock, i: number, cache: Cache): boolean {
  switch (b.kind) {
    case 'compare': {
      const s = cache.series.get(seriesKey(b.series))!
      return cmp(s[i], b.op, b.value)
    }
    case 'state': {
      const sa = cache.series.get(seriesKey(b.a))!
      const sb = cache.series.get(seriesKey(b.b))!
      return stateCmp(sa[i], b.op, sb[i])
    }
    case 'cross': {
      if (i < 1) return false
      const sa = cache.series.get(seriesKey(b.a))!
      const sb = cache.series.get(seriesKey(b.b))!
      const a0 = sa[i - 1], a1 = sa[i]
      const b0 = sb[i - 1], b1 = sb[i]
      if ([a0, a1, b0, b1].some(Number.isNaN)) return false
      return b.op === 'crossUp' ? a0 <= b0 && a1 > b1 : a0 >= b0 && a1 < b1
    }
    case 'event': {
      const e = cache.events.get(eventKey(b.event))!
      return e[i]
    }
  }
}

function evalGroup(group: ConditionGroup | undefined, i: number, cache: Cache): boolean {
  if (!group || group.conditions.length === 0) return false
  if (group.combinator === 'ALL') {
    for (const b of group.conditions) if (!evalBlock(b, i, cache)) return false
    return true
  }
  for (const b of group.conditions) if (evalBlock(b, i, cache)) return true
  return false
}

export function evaluateCustomStrategy(spec: CustomStrategySpec, candles: Candle[]): Signal[] {
  const n = candles.length
  const signals: Signal[] = new Array(n).fill(null)
  if (n === 0) return signals
  const cache = buildCache(spec, candles)
  let pos: 'flat' | 'long' | 'short' = 'flat'
  for (let i = 0; i < n; i++) {
    if (pos === 'flat') {
      if (evalGroup(spec.entryLong, i, cache)) { signals[i] = 'buy'; pos = 'long' }
      else if (evalGroup(spec.entryShort, i, cache)) { signals[i] = 'sell'; pos = 'short' }
    } else if (pos === 'long') {
      if (evalGroup(spec.exitLong, i, cache)) { signals[i] = 'sell'; pos = 'flat' }
    } else {
      if (evalGroup(spec.exitShort, i, cache)) { signals[i] = 'buy'; pos = 'flat' }
    }
  }
  return signals
}
