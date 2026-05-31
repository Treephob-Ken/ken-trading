import { describe, it, expect } from 'vitest'
import type { Candle } from '@/types'
import type { SMCResult, StructureBreak } from './types'
import { compareSmcEntries } from './strategyTest'

function flat(price: number, t: number): Candle {
  return { time: t, open: price, high: price, low: price, close: price, volume: 1 }
}

// Minimal result carrying only the structures the comparison reads.
function resultWith(structures: StructureBreak[]): SMCResult {
  return {
    structures, internalStructures: [], trendBias: [], trailing: null,
    orderBlocks: [], equalLevels: [], fairValueGaps: [], zones: null, mtfLevels: [],
  }
}

describe('compareSmcEntries', () => {
  it('counts a winning CHoCH long when price reaches 2R before the stop', () => {
    const c: Candle[] = []
    for (let i = 0; i < 6; i++) c.push(flat(100, 1000 + i * 60))
    // Entry on bar 5 (close 100). SL=98.5, TP=103 at slPct 1.5.
    c.push({ time: 1000 + 6 * 60, open: 100, high: 104, low: 100, close: 103, volume: 1 })
    const r = resultWith([{ kind: 'CHoCH', bias: 'bullish', level: 100, fromTime: c[2].time, atTime: c[5].time }])
    const out = compareSmcEntries(c, r, 1.5)
    const choch = out.find(x => x.name === 'CHoCH')!
    expect(choch.trades).toBe(1)
    expect(choch.winRate).toBe(1)
    expect(choch.expectancyR).toBeCloseTo(2, 6)
  })

  it('counts a losing CHoCH long when the stop is hit first', () => {
    const c: Candle[] = []
    for (let i = 0; i < 6; i++) c.push(flat(100, 1000 + i * 60))
    c.push({ time: 1000 + 6 * 60, open: 100, high: 100.5, low: 98, close: 98.2, volume: 1 }) // low 98 < SL 98.5
    const r = resultWith([{ kind: 'CHoCH', bias: 'bullish', level: 100, fromTime: c[2].time, atTime: c[5].time }])
    const out = compareSmcEntries(c, r, 1.5)
    const choch = out.find(x => x.name === 'CHoCH')!
    expect(choch.trades).toBe(1)
    expect(choch.winRate).toBe(0)
    expect(choch.expectancyR).toBeCloseTo(-1, 6)
  })

  it('always returns the three entry rules with sane numbers', () => {
    const out = compareSmcEntries([], resultWith([]), 1.5)
    expect(out.map(r => r.name)).toEqual(['CHoCH', 'BOS + CHoCH', 'CHoCH in discount/premium'])
    for (const r of out) {
      expect(r.trades).toBe(0)
      expect(r.winRate).toBeGreaterThanOrEqual(0)
      expect(r.winRate).toBeLessThanOrEqual(1)
    }
  })
})
