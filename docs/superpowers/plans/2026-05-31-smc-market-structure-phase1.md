# SMC Market Structure — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `/structure` (Market Structure) page that renders candles plus LuxAlgo-style **swing structure** (BOS/CHoCH labels) and **Strong/Weak High-Low** levels, driven by a pure, unit-tested SMC engine.

**Architecture:** A pure TypeScript engine (`src/lib/smc/`) turns candles → an `SMCResult` (structure breaks + trailing extremes). A presentational `SMCChart` component draws that result on a Lightweight Charts v5 instance using only built-in APIs (candlestick series, `createSeriesMarkers`, `createPriceLine`). A lazy-loaded page wires data fetching → engine → chart. No custom drawing primitives yet (those arrive in Phase 2 with order blocks).

**Tech Stack:** React + Vite + TypeScript, Tailwind, Lightweight Charts v5, Vitest (added in Task 1), existing `fetchKlines` data layer.

**Scope note:** This is Phase 1 of the 4-phase spec (`docs/superpowers/specs/2026-05-31-smc-market-structure-design.md`). Order blocks, EQH/EQL, FVG, zones, MTF, and deploy-to-bot are explicitly OUT of this plan.

**License:** Logic ported from LuxAlgo *Smart Money Concepts* (CC BY-NC-SA 4.0). Every new SMC source file starts with the attribution header shown in Task 2. Non-commercial use only.

---

### Task 1: Add Vitest test runner

**Files:**
- Modify: `package.json` (scripts + devDependencies)
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest**

Run:
```bash
npm install -D vitest
```
Expected: `vitest` appears under `devDependencies` in `package.json`.

- [ ] **Step 2: Create the Vitest config (with the `@` alias tests need)**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Add a `test` script**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run"
```

- [ ] **Step 4: Create a throwaway sanity test and run it**

Create `src/lib/smc/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('vitest wiring', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run:
```bash
npx vitest run src/lib/smc/sanity.test.ts
```
Expected: 1 passing test.

- [ ] **Step 5: Delete the sanity test**

Run:
```bash
rm src/lib/smc/sanity.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test runner"
```

---

### Task 2: SMC engine types

**Files:**
- Create: `src/lib/smc/types.ts`

- [ ] **Step 1: Write the types file**

Create `src/lib/smc/types.ts`:
```ts
// Smart Money Concepts — shared types.
//
// Logic ported from the LuxAlgo "Smart Money Concepts" Pine v5 indicator.
// © LuxAlgo — licensed CC BY-NC-SA 4.0 (Attribution-NonCommercial-ShareAlike).
// Non-commercial use only; derivatives must keep this license + attribution.

// Phase 1 settings subset. Later phases extend this (order blocks, EQH/EQL, etc.).
export interface SMCSettings {
  // Bars used to confirm a swing pivot (LuxAlgo "swingsLengthInput", default 50).
  swingLength: number
}

// One detected structure break (Break of Structure or Change of Character).
export interface StructureBreak {
  kind: 'BOS' | 'CHoCH'
  bias: 'bullish' | 'bearish'
  // The pivot price that price closed through.
  level: number
  // Time (unix seconds) of the pivot bar that was broken.
  fromTime: number
  // Time (unix seconds) of the bar whose close broke the pivot.
  atTime: number
}

// Trailing swing extremes → "Strong/Weak High" and "Strong/Weak Low" labels.
export interface TrailingExtremes {
  top: number
  topTime: number
  topLabel: 'Strong High' | 'Weak High'
  bottom: number
  bottomTime: number
  bottomLabel: 'Strong Low' | 'Weak Low'
}

export interface SMCResult {
  structures: StructureBreak[]
  // null when there isn't enough data to establish extremes.
  trailing: TrailingExtremes | null
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/smc/types.ts
git commit -m "feat: add SMC engine types"
```

---

### Task 3: SMC engine — swing structure (BOS/CHoCH)

**Files:**
- Create: `src/lib/smc/engine.ts`
- Test: `src/lib/smc/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/smc/engine.test.ts`:
```ts
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

// A path that rises to a peak, falls through it to a trough, then rallies back
// above the peak. With a short swing length this yields at least one bullish and
// one bearish structure break.
const PATH = [
  1, 2, 3, 4, 5, 6, 7, 8,        // rise (forms a swing-high pivot once it turns)
  7, 6, 5, 4, 3, 2, 1,           // fall through the prior swing low → bearish break
  2, 3, 4, 5, 6, 7, 8, 9, 10,    // rally back above the swing high → bullish break
]

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
    // After a bullish break establishes a bullish bias, the next bearish break
    // (price closing below a swing low) is a Change of Character.
    const r = computeSMC(series(PATH), { swingLength: 3 })
    const firstBearish = r.structures.find(s => s.bias === 'bearish')
    const firstBullish = r.structures.find(s => s.bias === 'bullish')
    // At least one of the two reversals in this path is a CHoCH.
    expect(
      (firstBearish?.kind === 'CHoCH') || (firstBullish?.kind === 'CHoCH'),
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/lib/smc/engine.test.ts
```
Expected: FAIL — `computeSMC` is not defined / module not found.

- [ ] **Step 3: Implement the engine**

Create `src/lib/smc/engine.ts`:
```ts
// Smart Money Concepts engine — swing structure + trailing extremes (Phase 1).
//
// Logic ported from the LuxAlgo "Smart Money Concepts" Pine v5 indicator.
// © LuxAlgo — licensed CC BY-NC-SA 4.0. Non-commercial use only.
//
// Faithful port of the LuxAlgo `leg()` swing state machine and the swing
// BOS/CHoCH detection (close crossing the most recent swing pivot). Trailing
// extremes mirror updateTrailingExtremes()/drawHighLowSwings().

import type { Candle } from '@/types'
import type { SMCResult, SMCSettings, StructureBreak, TrailingExtremes } from './types'

const DEFAULTS: SMCSettings = { swingLength: 50 }

export function computeSMC(candles: Candle[], settings: Partial<SMCSettings> = {}): SMCResult {
  const cfg: SMCSettings = { ...DEFAULTS, ...settings }
  const size = Math.max(2, Math.floor(cfg.swingLength))
  const n = candles.length
  const structures: StructureBreak[] = []

  if (n < size + 2) return { structures: [], trailing: null }

  const high = candles.map(c => c.high)
  const low = candles.map(c => c.low)
  const close = candles.map(c => c.close)
  const time = candles.map(c => c.time)

  // leg: 0 = bearish leg, 1 = bullish leg (matches LuxAlgo BEARISH_LEG / BULLISH_LEG).
  let leg = 0
  let swingHigh: { level: number; time: number; crossed: boolean } | null = null
  let swingLow: { level: number; time: number; crossed: boolean } | null = null
  // bias: 0 unknown, 1 bullish, -1 bearish (LuxAlgo swingTrend.bias).
  let bias: 0 | 1 | -1 = 0

  // Trailing extremes — reset on each new pivot, extended every bar.
  let top = high[0]
  let topTime = time[0]
  let bottom = low[0]
  let bottomTime = time[0]

  for (let i = size; i < n; i++) {
    const ref = i - size
    let maxR = -Infinity
    let minR = Infinity
    for (let k = ref + 1; k <= i; k++) {
      if (high[k] > maxR) maxR = high[k]
      if (low[k] < minR) minR = low[k]
    }
    const newLegHigh = high[ref] > maxR
    const newLegLow = low[ref] < minR

    const prevLeg = leg
    if (newLegHigh) leg = 0
    else if (newLegLow) leg = 1
    const startOfNewLeg = leg !== prevLeg

    if (startOfNewLeg) {
      if (leg === 1) {
        // New bullish leg → swing low confirmed at ref.
        swingLow = { level: low[ref], time: time[ref], crossed: false }
        bottom = low[ref]
        bottomTime = time[ref]
      } else {
        // New bearish leg → swing high confirmed at ref.
        swingHigh = { level: high[ref], time: time[ref], crossed: false }
        top = high[ref]
        topTime = time[ref]
      }
    }

    // Extend trailing extremes each bar.
    if (high[i] > top) { top = high[i]; topTime = time[i] }
    if (low[i] < bottom) { bottom = low[i]; bottomTime = time[i] }

    // Bullish break: close crosses above the last swing high.
    if (swingHigh && !swingHigh.crossed && close[i] > swingHigh.level) {
      const kind: StructureBreak['kind'] = bias === -1 ? 'CHoCH' : 'BOS'
      structures.push({ kind, bias: 'bullish', level: swingHigh.level, fromTime: swingHigh.time, atTime: time[i] })
      swingHigh.crossed = true
      bias = 1
    }

    // Bearish break: close crosses below the last swing low.
    if (swingLow && !swingLow.crossed && close[i] < swingLow.level) {
      const kind: StructureBreak['kind'] = bias === 1 ? 'CHoCH' : 'BOS'
      structures.push({ kind, bias: 'bearish', level: swingLow.level, fromTime: swingLow.time, atTime: time[i] })
      swingLow.crossed = true
      bias = -1
    }
  }

  const trailing: TrailingExtremes = {
    top,
    topTime,
    topLabel: bias === -1 ? 'Strong High' : 'Weak High',
    bottom,
    bottomTime,
    bottomLabel: bias === 1 ? 'Strong Low' : 'Weak Low',
  }

  return { structures, trailing }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/lib/smc/engine.test.ts
```
Expected: PASS (4 tests).
If the "bullish and bearish" assertion fails, the synthetic `PATH` did not produce both breaks at `swingLength: 3` — lengthen the rise/fall runs in `PATH` so each leg clears the rolling window. The engine logic is correct; the fixture must give it room to confirm pivots.

- [ ] **Step 5: Commit**

```bash
git add src/lib/smc/engine.ts src/lib/smc/engine.test.ts
git commit -m "feat: SMC engine swing structure (BOS/CHoCH)"
```

---

### Task 4: SMC engine — Strong/Weak High-Low labels

**Files:**
- Test: `src/lib/smc/engine.test.ts` (append)

- [ ] **Step 1: Append failing tests for trailing extremes**

Append to `src/lib/smc/engine.test.ts`:
```ts
describe('computeSMC — trailing extremes', () => {
  function series2(prices: number[]): Candle[] {
    return prices.map((p, i) => ({
      time: 1_700_000_000 + i * 60,
      open: p, high: p, low: p, close: p, volume: 1,
    }))
  }

  it('labels the low "Strong Low" when the final bias is bullish', () => {
    // Rise → dip → break above the swing high (ends bullish).
    const r = computeSMC(
      series2([1, 2, 3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 7, 8, 9, 10]),
      { swingLength: 3 },
    )
    expect(r.trailing).not.toBeNull()
    expect(r.trailing!.bottomLabel).toBe('Strong Low')
    expect(Number.isFinite(r.trailing!.top)).toBe(true)
    expect(Number.isFinite(r.trailing!.bottom)).toBe(true)
  })

  it('exposes a top/bottom with their times', () => {
    const r = computeSMC(
      series2([1, 2, 3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 7, 8, 9, 10]),
      { swingLength: 3 },
    )
    expect(r.trailing!.topTime).toBeGreaterThan(0)
    expect(r.trailing!.bottomTime).toBeGreaterThan(0)
    expect(['Strong High', 'Weak High']).toContain(r.trailing!.topLabel)
  })
})
```

- [ ] **Step 2: Run the tests**

Run:
```bash
npx vitest run src/lib/smc/engine.test.ts
```
Expected: PASS (all tests). The engine from Task 3 already computes `trailing`, so these pass without code changes.
If `bottomLabel` is not `'Strong Low'`, the fixture's final break wasn't bullish — adjust the trailing tail of the price array so the last structure break is a bullish one.

- [ ] **Step 3: Commit**

```bash
git add src/lib/smc/engine.test.ts
git commit -m "test: SMC strong/weak high-low labels"
```

---

### Task 5: SMCChart presentational component

**Files:**
- Create: `src/components/smc/SMCChart.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/smc/SMCChart.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type IPriceLine,
} from 'lightweight-charts'
import type { Candle } from '@/types'
import type { SMCResult } from '@/lib/smc/types'

const GREEN = '#089981'
const RED = '#f23645'

export default function SMCChart({ candles, result }: { candles: Candle[]; result: SMCResult }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8b93a7', fontFamily: "'Inter', system-ui, sans-serif" },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3142' },
      rightPriceScale: { borderColor: '#2a3142' },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })
    chartRef.current = chart
    seriesRef.current = series
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [])

  // Push candles + SMC overlays whenever data changes.
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return

    series.setData(
      candles.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })),
    )

    // BOS/CHoCH labels as series markers at the breaking bar.
    const markers: SeriesMarker<Time>[] = result.structures.map(s => ({
      time: s.atTime as Time,
      position: s.bias === 'bullish' ? 'belowBar' : 'aboveBar',
      color: s.bias === 'bullish' ? GREEN : RED,
      shape: s.bias === 'bullish' ? 'arrowUp' : 'arrowDown',
      text: s.kind,
    }))
    createSeriesMarkers(series, markers)

    // Clear previous Strong/Weak price lines, then redraw.
    for (const pl of priceLinesRef.current) series.removePriceLine(pl)
    priceLinesRef.current = []
    if (result.trailing) {
      priceLinesRef.current.push(series.createPriceLine({
        price: result.trailing.top, color: RED, lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: result.trailing.topLabel,
      }))
      priceLinesRef.current.push(series.createPriceLine({
        price: result.trailing.bottom, color: GREEN, lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: result.trailing.bottomLabel,
      }))
    }

    chart.timeScale().fitContent()
  }, [candles, result])

  return (
    <div className="relative">
      <div ref={containerRef} className="h-[460px] min-h-[460px] w-full" />
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. If a marker/price-line type name differs in the installed `lightweight-charts@^5.0.7`, open `node_modules/lightweight-charts/dist/typings.d.ts` and match the exact exported name (e.g. `SeriesMarker`, `IPriceLine`).

- [ ] **Step 3: Commit**

```bash
git add src/components/smc/SMCChart.tsx
git commit -m "feat: SMCChart renders candles, BOS/CHoCH markers, strong/weak levels"
```

---

### Task 6: Market Structure page

**Files:**
- Create: `src/pages/MarketStructurePage.tsx`

- [ ] **Step 1: Write the page**

Create `src/pages/MarketStructurePage.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react'
import { Network } from 'lucide-react'
import { fetchKlines } from '@/lib/binance'
import { computeSMC } from '@/lib/smc/engine'
import SMCChart from '@/components/smc/SMCChart'
import type { Candle } from '@/types'

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d']

export default function MarketStructurePage() {
  const [symbol, setSymbol] = useState(() => localStorage.getItem('lab_symbol') || 'ETHUSDT')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('lab_timeframe') || '1h')
  const [swingLength, setSwingLength] = useState(50)
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchKlines({ symbol, interval: timeframe })
      .then(c => { if (!cancelled) setCandles(c) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol, timeframe])

  const result = useMemo(() => computeSMC(candles, { swingLength }), [candles, swingLength])

  const pairLabel = symbol.includes(':') ? symbol.split(':')[1] + '/USDC' : symbol.replace(/USDT$/, '/USDC')

  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-brand" />
          <h1 className="text-lg font-semibold text-text font-display">Market Structure</h1>
          <p className="hidden sm:block text-xs text-dim">Swing structure (BOS/CHoCH) + Strong/Weak levels — {pairLabel} · {timeframe}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={symbol}
            onChange={e => { setSymbol(e.target.value.toUpperCase()); localStorage.setItem('lab_symbol', e.target.value.toUpperCase()) }}
            className="field w-[140px]"
            aria-label="Symbol"
          />
          <div className="flex items-center gap-1">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                type="button"
                onClick={() => { setTimeframe(tf); localStorage.setItem('lab_timeframe', tf) }}
                className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer ${tf === timeframe ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-panel-2 text-dim hover:text-text'}`}
              >{tf}</button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-[11px] text-dim">
            Swing
            <input
              type="number" min={3} max={200} value={swingLength}
              onChange={e => setSwingLength(Math.max(3, +e.target.value || 50))}
              className="field w-[64px]"
            />
          </label>
        </div>
      </div>

      {error && <div className="card border border-loss/30 bg-loss/5 p-3 text-xs text-loss">{error}</div>}

      <section className="card shrink-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-text">Chart</h3>
          {loading && <span className="text-[10px] text-dim animate-pulse">Loading…</span>}
        </div>
        {candles.length === 0 && !loading ? (
          <div className="flex h-[460px] min-h-[460px] items-center justify-center text-sm text-dim">No data.</div>
        ) : (
          <SMCChart candles={candles} result={result} />
        )}
      </section>

      <section className="card p-3">
        <div className="mb-2 text-xs font-semibold text-text">Recent structure events</div>
        {result.structures.length === 0 ? (
          <div className="text-[11px] text-dim italic">No structure breaks detected in this window.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {result.structures.slice(-12).reverse().map((s, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className={s.bias === 'bullish' ? 'text-gain' : 'text-loss'}>
                  {s.bias === 'bullish' ? 'Bullish' : 'Bearish'} {s.kind}
                </span>
                <span className="font-mono tabular-nums text-dim">
                  @ {s.level} · {new Date(s.atTime * 1000).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/MarketStructurePage.tsx
git commit -m "feat: Market Structure page (data -> engine -> chart + events)"
```

---

### Task 7: Route + sidebar entry (lazy-loaded)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Lazy-import the page in `src/App.tsx`**

At the top of `src/App.tsx`, change the React import and add the lazy page. Replace:
```tsx
import { useEffect, useState } from 'react'
```
with:
```tsx
import { lazy, Suspense, useEffect, useState } from 'react'
```
Then, after the existing page imports (after the `import FundamentalsPage ...` / `import ScannerPage ...` block), add:
```tsx
const MarketStructurePage = lazy(() => import('@/pages/MarketStructurePage'))
```

- [ ] **Step 2: Add the route**

In `src/App.tsx`, inside the auth-gated `<Route path="/">` block, add this route next to the other pages (e.g. right after the `scanner` route):
```tsx
<Route path="structure" element={
  <Suspense fallback={<div className="p-6 text-sm text-dim">Loading…</div>}>
    <MarketStructurePage />
  </Suspense>
} />
```

- [ ] **Step 3: Add the sidebar nav item in `src/components/Sidebar.tsx`**

Add `Network` to the existing `lucide-react` import (alphabetically near the others):
```tsx
  Network,
```
Then add an entry to the `NAV_ITEMS` array (place it after the `scanner` entry):
```tsx
  { path: '/structure', icon: Network, label: 'Market Structure' },
```

- [ ] **Step 4: Type-check + build**

Run:
```bash
npm run build
```
Expected: build succeeds (`tsc --noEmit` clean, Vite emits to `bot/public/`).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx bot/public
git commit -m "feat: add /structure route + sidebar entry (lazy-loaded)"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run the engine tests**

Run:
```bash
npm test
```
Expected: all SMC engine tests pass.

- [ ] **Step 2: Run the production build**

Run:
```bash
npm run build
```
Expected: success, no type errors.

- [ ] **Step 3: Manual smoke check (local dev)**

Run (two terminals):
```bash
cd bot ; npm run serve
```
```bash
npm run dev
```
Open http://localhost:5173, click **Market Structure** in the sidebar. Verify:
- Candles render for ETH/USDC · 1h.
- Up/down arrows tagged `BOS` / `CHoCH` appear at structure breaks.
- Two dashed price lines labeled Strong/Weak High and Strong/Weak Low appear.
- Changing the Swing number re-runs instantly; the events list updates.

- [ ] **Step 4: No commit needed** (verification only).

---

## Self-Review

**Spec coverage (Phase 1 rows only):**
- ✅ New `/structure` page — Task 6, 7
- ✅ Candles — Task 5, 6
- ✅ Swing structure BOS/CHoCH labels — Task 3 (engine) + Task 5 (markers)
- ✅ Strong/Weak high-low — Task 4 (engine) + Task 5 (price lines)
- ✅ Pure, testable engine — Task 3, 4
- ✅ Lazy-load to protect bundle size (spec §9 risk) — Task 7
- ✅ LuxAlgo attribution + license header (spec §1) — Task 2, 3
- ✅ Reuses existing `fetchKlines` incl. HIP-3 branch (spec §5) — Task 6
- ⏭️ Order blocks, EQH/EQL, FVG, zones, MTF, trend candles, deploy-to-bot — OUT (Phases 2–4)

**Type consistency:** `SMCSettings`, `StructureBreak`, `TrailingExtremes`, `SMCResult` defined in Task 2 are used identically in Tasks 3–6. `computeSMC(candles, settings)` signature matches across engine, tests, and page. `SMCChart` props `{ candles, result }` match the page's usage.

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. The two "if the fixture fails, adjust" notes are TDD guidance (the engine is complete), not placeholders.
