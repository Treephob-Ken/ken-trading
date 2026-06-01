import { describe, it, expect } from 'vitest'
import type { Candle } from '@/types'
import { evaluateCustomStrategy } from './evaluate'
import { runBacktest } from '@/lib/backtest'
import type { CustomStrategySpec } from './types'

// Build a candle with close `c`; high/low straddle it by `pad`.
function bar(time: number, c: number, pad = 2): Candle {
  return { time, open: c, high: c + pad, low: c - pad, close: c, volume: 1 }
}

// Price oscillates above/below 100. An "entry when price > 100" strategy with
// NO exit conditions (SL/TP only) must re-enter every time it dips and breaks
// back above — the old stateful evaluator got stuck "long" and took 1 trade.
function oscillatingSeries(): Candle[] {
  const closes = [99, 99, 102, 103, 99, 99, 102, 103, 99, 99, 102, 103, 99]
  return closes.map((c, i) => bar(1000 + i * 60, c, 2))
}

const longEntryOnly: CustomStrategySpec = {
  id: 't1', name: 'price>100, SL/TP only',
  direction: 'long',
  entryLong: { combinator: 'ALL', conditions: [{ kind: 'compare', id: 'a', series: { id: 'price', params: {} }, op: '>', value: 100 }] },
  exitLong: { combinator: 'ANY', conditions: [] }, // exits via SL/TP only
  stopMode: 'pct', tpPct: 1, slPct: 5,
}

describe('evaluateCustomStrategy — stateless re-entry', () => {
  it('emits a buy on every bar the entry condition holds (not just the first)', () => {
    const sig = evaluateCustomStrategy(longEntryOnly, oscillatingSeries())
    const buys = sig.filter((s) => s === 'buy').length
    expect(buys).toBeGreaterThan(1)
  })

  it('re-enters after a SL/TP exit → more than one trade (the bug fix)', () => {
    const candles = oscillatingSeries()
    const sig = evaluateCustomStrategy(longEntryOnly, candles)
    const r = runBacktest(candles, sig, 10_000, 0, 'long', longEntryOnly.slPct ?? 0, longEntryOnly.tpPct ?? 0)
    expect(r.trades.length).toBeGreaterThan(1)
  })

  it('long-only ignores short entries', () => {
    const sig = evaluateCustomStrategy(longEntryOnly, oscillatingSeries())
    expect(sig.every((s) => s === 'buy' || s === null)).toBe(true)
  })
})

describe('evaluateCustomStrategy — both directions', () => {
  const bothSpec: CustomStrategySpec = {
    id: 't2', name: 'flip', direction: 'both',
    entryLong: { combinator: 'ALL', conditions: [{ kind: 'compare', id: 'a', series: { id: 'price', params: {} }, op: '>', value: 100 }] },
    exitLong: { combinator: 'ANY', conditions: [] },
    entryShort: { combinator: 'ALL', conditions: [{ kind: 'compare', id: 'b', series: { id: 'price', params: {} }, op: '<', value: 100 }] },
  }

  it('emits buy above and sell below the threshold', () => {
    const candles = oscillatingSeries()
    const sig = evaluateCustomStrategy(bothSpec, candles)
    expect(sig.some((s) => s === 'buy')).toBe(true)
    expect(sig.some((s) => s === 'sell')).toBe(true)
  })
})
