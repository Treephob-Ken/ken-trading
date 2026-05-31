import assert from 'node:assert'
import { botPerformance, realizedView, botKey, dedupeByTime } from '../src/lib/portfolio'
import type { RoundTrip } from '../src/lib/journal'

const mk = (over: Partial<RoundTrip>): RoundTrip => ({
  id: Math.random().toString(36), asset: 'BTC', side: 'long',
  entryTime: 0, exitTime: 1, entryPx: 1, exitPx: 1, size: 1, fees: 0,
  closedPnl: 0, pnlPct: 0, holdMs: 0, fillCount: 1,
  source: { kind: 'signal', botId: 'a' } as RoundTrip['source'], ...over,
})

const trips: RoundTrip[] = [
  mk({ exitTime: 1, closedPnl: 100, source: { kind: 'signal', botId: 'a' } as RoundTrip['source'] }),
  mk({ exitTime: 2, closedPnl: -40, source: { kind: 'signal', botId: 'a' } as RoundTrip['source'] }),
  mk({ exitTime: 3, closedPnl: 50, asset: 'ETH', source: { kind: 'grid', botId: 'b' } as RoundTrip['source'] }),
]

const all = realizedView(trips, null)
assert.strictEqual(all.netPnl, 110)
assert.strictEqual(all.trades, 3)
// Cumulative all: 100, 60, 110 -> peak 100, trough 60 => DD 40
assert.strictEqual(all.maxDrawdown, 40)

const perf = botPerformance(trips)
assert.strictEqual(perf[0].pnl, 60)          // bot a: 100 - 40
assert.strictEqual(perf[0].maxDrawdown, 40)
assert.strictEqual(perf[1].pnl, 50)          // bot b

const onlyB = realizedView(trips, botKey({ kind: 'grid', botId: 'b' } as RoundTrip['source']))
assert.strictEqual(onlyB.netPnl, 50)
assert.strictEqual(onlyB.trades, 1)
assert.strictEqual(onlyB.byAsset[0].asset, 'ETH')

// dedupeByTime: two trips closing in the same second must collapse to one
// ascending point (keeping the latest cumulative value) so Lightweight Charts
// setData never sees a duplicate/non-ascending timestamp.
const sameSecond = dedupeByTime([
  { t: 1000, value: 10 },   // 1s
  { t: 1500, value: 25 },   // also 1s (floors to 1)
  { t: 2000, value: 30 },   // 2s
])
assert.strictEqual(sameSecond.length, 2)
assert.deepStrictEqual(sameSecond.map((p) => p.time), [1, 2])
assert.strictEqual(sameSecond[0].value, 25)   // latest value kept for the 1s bucket
// Timestamps strictly ascending and unique.
for (let i = 1; i < sameSecond.length; i++) assert.ok(sameSecond[i].time > sameSecond[i - 1].time)

console.log('portfolio derivation OK')
