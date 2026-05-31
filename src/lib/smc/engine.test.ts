import { describe, it, expect } from 'vitest'
import type { Candle } from '@/types'
import { computeSMC } from './engine'

// Helper: build flat OHLC candles from a list of prices (high=low=close=open).
function series(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    time: 1_700_000_000 + i * 60, // 1-minute bars
    open: p, high: p, low: p, close: p, volume: 1,
  }))
}

// Increasing-amplitude triangle wave: each swing overshoots the previous one,
// so price repeatedly closes through prior swing pivots in BOTH directions —
// guaranteeing bullish and bearish breaks plus at least one trend reversal (CHoCH).
function triangle(): number[] {
  const pts: number[] = []
  const ramp = (from: number, to: number, step: number) => {
    for (let v = from; step > 0 ? v <= to : v >= to; v += step) pts.push(v)
  }
  ramp(0, 20, 2)     // up
  ramp(18, 0, -2)    // down → trough at 0
  ramp(2, 26, 2)     // up → breaks the prior swing high (20)
  ramp(24, -6, -2)   // down → breaks the prior swing low (0)
  ramp(-4, 32, 2)    // up → breaks again
  ramp(30, -12, -2)  // down → breaks again
  return pts
}

const PATH = triangle()

describe('computeSMC — swing structure', () => {
  it('returns no structures when there is not enough data', () => {
    const r = computeSMC(series([1, 2, 3]), { swingLength: 50 })
    expect(r.structures).toEqual([])
    expect(r.trailing).toBeNull()
  })

  it('detects at least one bullish and one bearish structure break', () => {
    const r = computeSMC(series(PATH), { swingLength: 3 })
    expect(r.structures.length).toBeGreaterThan(0)
    expect(r.structures.some(s => s.bias === 'bullish')).toBe(true)
    expect(r.structures.some(s => s.bias === 'bearish')).toBe(true)
  })

  it('every structure has consistent fields', () => {
    const r = computeSMC(series(PATH), { swingLength: 3 })
    for (const s of r.structures) {
      expect(['BOS', 'CHoCH']).toContain(s.kind)
      expect(['bullish', 'bearish']).toContain(s.bias)
      expect(Number.isFinite(s.level)).toBe(true)
      expect(s.atTime).toBeGreaterThan(s.fromTime)
    }
  })

  it('a trend reversal is tagged CHoCH', () => {
    // Once a bias is established, a break in the opposite direction is a
    // Change of Character. The oscillating path produces several.
    const r = computeSMC(series(PATH), { swingLength: 3 })
    expect(r.structures.some(s => s.kind === 'CHoCH')).toBe(true)
  })
})
