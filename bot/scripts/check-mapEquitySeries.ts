import assert from 'node:assert'
import { mapEquitySeries } from '../src/journal.js'

// Rises 100 -> 120, dips to 90, recovers to 110. Peak 120, trough 90 => DD 30 (25%).
const av: [number, string][] = [
  [1, '100'], [2, '120'], [3, '90'], [4, '110'],
]
const pnl: [number, string][] = [[1, '0'], [2, '20'], [3, '-10'], [4, '10']]
const r = mapEquitySeries('week', av, pnl)

assert.strictEqual(r.startValue, 100)
assert.strictEqual(r.currentValue, 110)
assert.strictEqual(r.returnPct, 10)
assert.strictEqual(r.maxDrawdown, 30)
assert.strictEqual(r.maxDrawdownPct, 25)
assert.strictEqual(r.points.length, 4)

// Empty history must not throw and yields zeros.
const empty = mapEquitySeries('day', [], [])
assert.strictEqual(empty.startValue, 0)
assert.strictEqual(empty.returnPct, 0)
assert.strictEqual(empty.maxDrawdown, 0)

// Leading $0 (pre-funding) entries are trimmed so baseline is the first funded
// value. [0, 0, 1000, 1100] => start 1000, current 1100, return 10%, 2 points.
const funded = mapEquitySeries('all',
  [[1, '0'], [2, '0'], [3, '1000'], [4, '1100']],
  [[1, '0'], [2, '0'], [3, '0'], [4, '100']])
assert.strictEqual(funded.startValue, 1000)
assert.strictEqual(funded.currentValue, 1100)
assert.strictEqual(funded.returnPct, 10)
assert.strictEqual(funded.points.length, 2)

console.log('mapEquitySeries OK')
