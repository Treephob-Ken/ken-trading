import { describe, it, expect } from 'vitest'
import type { Candle } from '@/types'
import type { SMCResult, StructureBreak } from './types'
import { compareSmcEntries } from './strategyTest'

// Minimal result carrying only the structures the comparison reads.
function resultWith(structures: StructureBreak[]): SMCResult {
  return {
    structures, internalStructures: [], trendBias: [], trailing: null,
    orderBlocks: [], equalLevels: [], fairValueGaps: [], zones: null, mtfLevels: [],
  }
}

describe('compareSmcEntries (runBacktest-based)', () => {
  it('always returns the three entry rules with sane numbers', () => {
    const out = compareSmcEntries([], resultWith([]), 1.5)
    expect(out.map(r => r.name)).toEqual(['CHoCH', 'BOS + CHoCH', 'CHoCH in discount/premium'])
    for (const r of out) {
      expect(r.trades).toBe(0)
      expect(r.winRate).toBeGreaterThanOrEqual(0)
      expect(r.winRate).toBeLessThanOrEqual(100)
    }
  })

  it('a long held through a rising series closes for a profit (after fees)', () => {
    // 20 steadily rising candles; lows never dip enough to hit a 1.5% stop.
    const c: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      time: 1000 + i * 60, open: 100 + i, high: 100 + i + 0.5, low: 100 + i - 0.3, close: 100 + i, volume: 1,
    }))
    // Bullish CHoCH opens the long at bar 2; a later bearish CHoCH closes it
    // near the top → one closed, winning round trip.
    const r = resultWith([
      { kind: 'CHoCH', bias: 'bullish', level: 101, fromTime: c[1].time, atTime: c[2].time },
      { kind: 'CHoCH', bias: 'bearish', level: 117, fromTime: c[16].time, atTime: c[18].time },
    ])
    const out = compareSmcEntries(c, r, 1.5)
    const choch = out.find(x => x.name === 'CHoCH')!
    expect(choch.trades).toBeGreaterThanOrEqual(1)
    expect(choch.returnPct).toBeGreaterThan(0)
    expect(choch.winRate).toBeGreaterThan(0)
  })
})
