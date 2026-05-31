import { describe, it, expect } from 'vitest'
import type { Candle } from '@/types'
import type { SMCResult, StructureBreak } from './types'
import { compareSmcEntries, smcQuality } from './strategyTest'
import { smcRetestSignals } from '@/lib/strategies'

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
      expect(r.quality).toBe(0) // no trades → quality 0
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

  it('quality sinks a PF-0 open-position mirage and rewards a solid combo', () => {
    const mirage = smcQuality({ trades: 8, winRate: 0, returnPct: 119, profitFactor: 0, maxDdPct: 50 })
    const solid = smcQuality({ trades: 40, winRate: 50, returnPct: 20, profitFactor: 1.8, maxDdPct: 20 })
    expect(mirage).toBeLessThan(20)
    expect(solid).toBeGreaterThan(mirage)
    expect(solid).toBeGreaterThanOrEqual(50)
  })
})

describe('smcRetestSignals', () => {
  // Increasing-amplitude oscillation → breaks both ways → retests happen.
  function triangle(): number[] {
    const pts: number[] = []
    const ramp = (from: number, to: number, step: number) => {
      for (let v = from; step > 0 ? v <= to : v >= to; v += step) pts.push(v)
    }
    ramp(0, 20, 2); ramp(18, 0, -2); ramp(2, 26, 2); ramp(24, -6, -2); ramp(-4, 32, 2); ramp(30, -12, -2)
    return pts
  }

  it('runs, returns length n, valid + deterministic signals', () => {
    const closes = triangle()
    const highs = closes.map(p => p + 0.2)
    const lows = closes.map(p => p - 0.2)
    const sig = smcRetestSignals(highs, lows, closes, 3, 'both', 'level')
    expect(sig.length).toBe(closes.length)
    for (const s of sig) expect([null, 'buy', 'sell']).toContain(s)
    expect(sig.some(s => s !== null)).toBe(true)
    // Deterministic — same input → identical output (the bot copy must match).
    expect(smcRetestSignals(highs, lows, closes, 3, 'both', 'level')).toEqual(sig)
  })

  it('returns all-null when there is not enough data', () => {
    const sig = smcRetestSignals([1, 2, 3], [1, 2, 3], [1, 2, 3], 50, 'both', 'level')
    expect(sig).toEqual([null, null, null])
  })
})
