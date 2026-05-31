import { describe, it, expect } from 'vitest'
import type { Candle } from '@/types'
import type { SMCResult, StructureBreak } from './types'
import { compareSmcEntries } from './strategyTest'

function resultWith(structures: StructureBreak[]): SMCResult {
  return {
    structures, internalStructures: [], trendBias: [], trailing: null,
    orderBlocks: [], equalLevels: [], fairValueGaps: [], zones: null, mtfLevels: [],
  }
}

describe('compareSmcEntries (entry × exit combos via runBacktest)', () => {
  it('returns 6 entries × 3 exits = 18 combos with sane numbers', () => {
    const out = compareSmcEntries([], resultWith([]), 1.5)
    expect(out.length).toBe(18)
    for (const r of out) {
      expect(r.name).toContain(' · ')
      expect(['Flip', '2R', 'MFE']).toContain(r.exit)
      expect(r.trades).toBe(0)
      expect(r.winRate).toBeGreaterThanOrEqual(0)
      expect(r.winRate).toBeLessThanOrEqual(100)
    }
    // The three retrace entries are present and flagged test-only.
    expect(out.some(r => r.entry === 'Retest OB')).toBe(true)
    expect(out.some(r => r.entry === 'Retest FVG')).toBe(true)
    expect(out.filter(r => r.entry.startsWith('Retest')).every(r => !r.deployable)).toBe(true)
  })

  it('a long held through a rising series closes for a profit (Flip exit)', () => {
    const c: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      time: 1000 + i * 60, open: 100 + i, high: 100 + i + 0.5, low: 100 + i - 0.3, close: 100 + i, volume: 1,
    }))
    const r = resultWith([
      { kind: 'CHoCH', bias: 'bullish', level: 101, fromTime: c[1].time, atTime: c[2].time },
      { kind: 'CHoCH', bias: 'bearish', level: 117, fromTime: c[16].time, atTime: c[18].time },
    ])
    const out = compareSmcEntries(c, r, 1.5)
    const flip = out.find(x => x.entry === 'CHoCH' && x.exit === 'Flip')!
    expect(flip.trades).toBeGreaterThanOrEqual(1)
    expect(flip.returnPct).toBeGreaterThan(0)
  })
})
