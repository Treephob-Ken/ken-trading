import assert from 'node:assert'
import { mapEquitySeries } from '../src/journal.js'

// Account value 100->120->90->110 (avg 105). Trading pnl 0->20->-10->10.
// periodPnl = last - first = 10 - 0 = 10. returnPct = 10/105*100 ≈ 9.52%.
// pnl peak 20, trough -10 => trading drawdown 30; 30/105*100 ≈ 28.57%.
const av: [number, string][] = [
  [1, '100'], [2, '120'], [3, '90'], [4, '110'],
]
const pnl: [number, string][] = [[1, '0'], [2, '20'], [3, '-10'], [4, '10']]
const r = mapEquitySeries('week', av, pnl)

assert.strictEqual(r.startValue, 100)
assert.strictEqual(r.currentValue, 110)
assert.strictEqual(r.avgCapital, 105)
assert.strictEqual(r.periodPnl, 10)
assert.ok(Math.abs(r.returnPct - (10 / 105) * 100) < 1e-9)
assert.strictEqual(r.maxDrawdown, 30)
assert.ok(Math.abs(r.maxDrawdownPct - (30 / 105) * 100) < 1e-9)
assert.strictEqual(r.points.length, 4)

// The bug case: tiny $5 baseline funded up to $157 by DEPOSITS, with only $20
// of actual trading profit. Old formula said +3047%; new formula must report a
// sane figure based on trading pnl ($20) over avg capital — not deposit growth.
const bug = mapEquitySeries('all',
  [[1, '5'], [2, '80'], [3, '157']],          // account value (mostly deposits)
  [[1, '0'], [2, '12'], [3, '20']])           // real trading pnl
assert.strictEqual(bug.periodPnl, 20)
assert.ok(bug.returnPct < 100, `return should be sane, got ${bug.returnPct}`)
assert.ok(Math.abs(bug.returnPct - (20 / ((5 + 80 + 157) / 3)) * 100) < 1e-9)

// Empty history must not throw and yields zeros.
const empty = mapEquitySeries('day', [], [])
assert.strictEqual(empty.startValue, 0)
assert.strictEqual(empty.returnPct, 0)
assert.strictEqual(empty.periodPnl, 0)
assert.strictEqual(empty.maxDrawdown, 0)

// Leading $0 (pre-funding) account-value entries are trimmed from the chart.
const funded = mapEquitySeries('all',
  [[1, '0'], [2, '0'], [3, '1000'], [4, '1100']],
  [[1, '0'], [2, '0'], [3, '0'], [4, '100']])
assert.strictEqual(funded.startValue, 1000)
assert.strictEqual(funded.currentValue, 1100)
assert.strictEqual(funded.points.length, 2)
assert.strictEqual(funded.periodPnl, 100)

console.log('mapEquitySeries OK')
