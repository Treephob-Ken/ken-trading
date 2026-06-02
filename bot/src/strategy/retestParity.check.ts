// Parity guard for smcRetestSignals — the bot copy MUST produce the exact same
// signals as the web copy (src/lib/strategies.ts), or the deployed bot trades
// something different from what the Backtester/Market-Structure page shows.
//
// This mirrors the web test in src/lib/smc/strategyTest.test.ts ("matches the
// canonical bot/web parity fixture"). The bot package has no test runner, so
// this is a standalone tsx assertion: run `npm run test:parity` in bot/.

import { smcRetestSignals, smcSweepSignals } from './strategies.js'

function triangle(): number[] {
  const pts: number[] = []
  const ramp = (from: number, to: number, step: number) => {
    for (let v = from; step > 0 ? v <= to : v >= to; v += step) pts.push(v)
  }
  ramp(0, 20, 2); ramp(18, 0, -2); ramp(2, 26, 2); ramp(24, -6, -2); ramp(-4, 32, 2); ramp(30, -12, -2)
  return pts
}

const closes = triangle()
const highs = closes.map((p) => p + 0.2)
const lows = closes.map((p) => p - 0.2)
const sig = smcRetestSignals(highs, lows, closes, 3, 'both', 'ob')
const buys = sig.map((s, i) => (s === 'buy' ? i : -1)).filter((i) => i >= 0)
const sells = sig.map((s, i) => (s === 'sell' ? i : -1)).filter((i) => i >= 0)

const ok =
  sig.length === 91 &&
  JSON.stringify(buys) === JSON.stringify([46, 87]) &&
  JSON.stringify(sells) === JSON.stringify([65])

if (!ok) {
  console.error('PARITY FAIL — bot smcRetestSignals diverged from the web copy.')
  console.error(`  length=${sig.length} (want 91)`)
  console.error(`  buys=${JSON.stringify(buys)} (want [46,87])`)
  console.error(`  sells=${JSON.stringify(sells)} (want [65])`)
  process.exit(1)
}

console.log('PARITY OK — bot smcRetestSignals matches the web canonical fixture.')

// ── smcSweepSignals parity — mirrors src/lib/smc/strategyTest.test.ts ──────────
function sweepFixture(): { highs: number[]; lows: number[]; closes: number[] } {
  const c: number[] = []
  const push = (from: number, to: number, step: number) => {
    for (let v = from; step > 0 ? v <= to : v >= to; v += step) c.push(v)
  }
  push(0, 10, 1); push(9, 1, -1); push(2, 10, 1); push(9, 1, -1)
  push(2, 8, 1); push(7, 0, -1); push(1, 8, 1); push(7, 0, -1); push(1, 6, 1)
  const h = c.map((v) => v + 0.1)
  const l = c.map((v) => v - 0.1)
  c.push(9.5); h.push(10.6); l.push(9.4)
  c.push(8); h.push(8.1); l.push(7.9)
  c.push(0.5); h.push(0.6); l.push(-0.6)
  c.push(2); h.push(2.1); l.push(1.9)
  return { highs: h, lows: l, closes: c }
}

const sf = sweepFixture()
const ssig = smcSweepSignals(sf.highs, sf.lows, sf.closes, 3, 0.1, 100)
const sbuys = ssig.map((s, i) => (s === 'buy' ? i : -1)).filter((i) => i >= 0)
const ssells = ssig.map((s, i) => (s === 'sell' ? i : -1)).filter((i) => i >= 0)
const sweepOk =
  ssig.length === 79 &&
  JSON.stringify(ssells) === JSON.stringify([75]) &&
  JSON.stringify(sbuys) === JSON.stringify([77])

if (!sweepOk) {
  console.error('PARITY FAIL — bot smcSweepSignals diverged from the web copy.')
  console.error(`  length=${ssig.length} (want 79)`)
  console.error(`  sells=${JSON.stringify(ssells)} (want [75])`)
  console.error(`  buys=${JSON.stringify(sbuys)} (want [77])`)
  process.exit(1)
}

console.log('PARITY OK — bot smcSweepSignals matches the web canonical fixture.')
