// Parity guard for smcRetestSignals — the bot copy MUST produce the exact same
// signals as the web copy (src/lib/strategies.ts), or the deployed bot trades
// something different from what the Backtester/Market-Structure page shows.
//
// This mirrors the web test in src/lib/smc/strategyTest.test.ts ("matches the
// canonical bot/web parity fixture"). The bot package has no test runner, so
// this is a standalone tsx assertion: run `npm run test:parity` in bot/.

import { smcRetestSignals } from './strategies.js'

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
