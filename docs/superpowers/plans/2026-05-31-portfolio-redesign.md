# Portfolio Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Apply the superpowers:ui-ux-pro-max skill when restyling/building UI (Tasks 5-8).**

**Goal:** Rebuild the Portfolio page into a genuine progress tracker — true account-value trend (from Hyperliquid), prominent max drawdown, a rich bot leaderboard, and Power BI–style cross-filtering — with a full visual overhaul.

**Architecture:** Two honest data layers. (1) **Account layer** = Hyperliquid `info.portfolio()` account-value history → hero + trend chart (one new cached endpoint). (2) **Realized layer** = closed round-trips, already loaded client-side as `trips`, recomputed in the browser via a new pure module so cross-filtering by bot is instant (no server round-trip). The HL account line is account-wide; selecting a bot swaps the trend to that bot's realized-PnL curve.

**Tech Stack:** Node + TypeScript (bot/Express), `@nktkas/hyperliquid` InfoClient, React + Vite + Tailwind, Lightweight Charts v5. No test framework in repo — verification is `tsc` type-check, `npm run build`, tiny `tsx` assertion scripts for pure logic, and manual browser checks for UI.

**Note vs spec:** The spec §5 proposed extending `summarizePortfolio` with a per-bot daily series. Refined here: since `trips` are already fully loaded client-side, the entire realized layer (per-bot series, drawdown, daily, calendar, by-asset) is derived **client-side** in `src/lib/portfolio.ts`. The only backend change is the new equity endpoint. This is DRY and gives instant cross-filtering.

---

## File structure

- **Create** `bot/scripts/inspect-portfolio.ts` — one-off de-risk script (read-only HL call). Throwaway.
- **Modify** `bot/src/trade.ts` — add `getPortfolio(creds)` wrapper.
- **Modify** `bot/src/journal.ts` — add `EquitySeriesResponse` type + pure `mapEquitySeries()`.
- **Create** `bot/scripts/check-mapEquitySeries.ts` — assertion script for the pure mapper.
- **Modify** `bot/src/server.ts` — add `GET /api/portfolio/equity` endpoint.
- **Create** `src/lib/portfolio.ts` — pure client-side realized-layer derivation from `trips`.
- **Create** `scripts/check-portfolio.ts` — assertion script for `src/lib/portfolio.ts`.
- **Modify** `src/pages/PortfolioPage.tsx` — full rebuild around the three layers + cross-filter state. Sub-components stay inline (matches existing `StatCard`/`PnlCalendar`/`RollupTable` pattern).
- **Modify** `progress.md` — update Portfolio section.

---

## Task 1: HL portfolio wrapper + live de-risk

**Files:**
- Modify: `bot/src/trade.ts` (add export near `getClients`, ~line 47)
- Create: `bot/scripts/inspect-portfolio.ts`

- [ ] **Step 1: Add `getPortfolio` to `bot/src/trade.ts`**

Add directly after `evictClientCache` (after line 52):

```ts
// Fetch the user's Hyperliquid portfolio (account-value + pnl history grouped
// by day/week/month/allTime). Read-only; powers the Portfolio trend chart.
export async function getPortfolio(creds?: EnvConfig | null) {
  const { info, user } = getClients(creds)
  return info.portfolio({ user })
}
```

- [ ] **Step 2: Type-check the bot**

Run: `cd bot && npm run build`
Expected: PASS (no type errors).

- [ ] **Step 3: Write the de-risk inspection script**

Create `bot/scripts/inspect-portfolio.ts`:

```ts
import { loadEnv } from '../src/config.js'
import { getPortfolio } from '../src/trade.js'

async function main() {
  const env = loadEnv()
  const resp = await getPortfolio(env)
  for (const [period, data] of resp) {
    const av = data.accountValueHistory
    const first = av[0]
    const last = av[av.length - 1]
    console.log(
      `${period.padEnd(12)} points=${String(av.length).padStart(4)}  ` +
      `first=${first ? new Date(first[0]).toISOString() + ' $' + first[1] : '—'}  ` +
      `last=${last ? new Date(last[0]).toISOString() + ' $' + last[1] : '—'}  ` +
      `vlm=${data.vlm}`,
    )
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Run it against the live account (read-only)**

Run: `cd bot && npx tsx scripts/inspect-portfolio.ts`
Expected: one line per period (`day week month allTime perpDay perpWeek perpMonth perpAllTime`) printing point counts + first/last timestamps + value.
**Decisions to confirm from output:** (a) `day/week/month/allTime` have enough points to plot (>1); (b) combined values (`day` etc.) are the right "account worth" series vs perp-only — use combined. If a period has 0–1 points, note it; the UI will show "not enough history yet" for that toggle.

- [ ] **Step 5: Commit (script kept for future debugging)**

```bash
git add bot/src/trade.ts bot/scripts/inspect-portfolio.ts
git commit -m "feat: add HL portfolio wrapper + inspection script"
```

---

## Task 2: Pure equity-series mapper + drawdown

**Files:**
- Modify: `bot/src/journal.ts` (add type + function near the portfolio section, after line ~501)
- Create: `bot/scripts/check-mapEquitySeries.ts`

- [ ] **Step 1: Add the type + pure mapper to `bot/src/journal.ts`**

Append after the `PortfolioSummary` interface (after line 501):

```ts
export type EquityPeriod = 'day' | 'week' | 'month' | 'all'

export interface EquitySeriesResponse {
  period: EquityPeriod
  points: { t: number; value: number }[]      // account value over time (ms, $)
  pnlPoints: { t: number; value: number }[]    // pnl over time (ms, $)
  startValue: number
  currentValue: number
  returnPct: number                            // (current - start) / start * 100
  maxDrawdown: number                          // peak-to-trough on account value ($)
  maxDrawdownPct: number                       // relative to the peak at the trough
}

// Map one Hyperliquid portfolio period's raw [ts, "value"] arrays into a chart-
// ready series with return % and a true account-value max drawdown.
export function mapEquitySeries(
  period: EquityPeriod,
  accountValueHistory: [number, string][],
  pnlHistory: [number, string][],
): EquitySeriesResponse {
  const points = accountValueHistory.map(([t, v]) => ({ t, value: Number(v) }))
  const pnlPoints = pnlHistory.map(([t, v]) => ({ t, value: Number(v) }))
  const startValue = points.length ? points[0].value : 0
  const currentValue = points.length ? points[points.length - 1].value : 0
  const returnPct = startValue > 0 ? ((currentValue - startValue) / startValue) * 100 : 0

  let peak = points.length ? points[0].value : 0
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  for (const p of points) {
    if (p.value > peak) peak = p.value
    const drop = peak - p.value
    if (drop > maxDrawdown) {
      maxDrawdown = drop
      maxDrawdownPct = peak > 0 ? (drop / peak) * 100 : 0
    }
  }
  return { period, points, pnlPoints, startValue, currentValue, returnPct, maxDrawdown, maxDrawdownPct }
}
```

- [ ] **Step 2: Write the assertion script**

Create `bot/scripts/check-mapEquitySeries.ts`:

```ts
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

console.log('mapEquitySeries OK')
```

- [ ] **Step 3: Run it (expect FAIL first if function missing, else PASS)**

Run: `cd bot && npx tsx scripts/check-mapEquitySeries.ts`
Expected: prints `mapEquitySeries OK`. If it throws an assertion, fix `mapEquitySeries` until it passes.

- [ ] **Step 4: Type-check**

Run: `cd bot && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bot/src/journal.ts bot/scripts/check-mapEquitySeries.ts
git commit -m "feat: add mapEquitySeries with account-value max drawdown"
```

---

## Task 3: `GET /api/portfolio/equity` endpoint

**Files:**
- Modify: `bot/src/server.ts` (add handler right after `/api/portfolio/trips`, ~line 1467; add imports)

- [ ] **Step 1: Ensure imports**

In `bot/src/server.ts`, add `getPortfolio` to the existing `from './trade.js'` import block (ends line 34) and add `mapEquitySeries`, plus the type `EquityPeriod`, to the existing `from './journal.js'` import block (ends line 83).

- [ ] **Step 2: Add the endpoint**

Insert after the `/api/portfolio/trips` handler (after line 1467). Reuses the existing `portfolioCache` + `PORTFOLIO_CACHE_MS`:

```ts
// Account-value trend for the Portfolio hero chart. Sources Hyperliquid's
// portfolio endpoint (true account value incl. unrealized/funding/transfers),
// which only offers day/week/month/allTime granularity — so this endpoint's
// `period` is independent of the page's detail-range buttons.
const EQUITY_PERIOD_MAP: Record<string, { hl: string; period: EquityPeriod }> = {
  day:   { hl: 'day',     period: 'day' },
  week:  { hl: 'week',    period: 'week' },
  month: { hl: 'month',   period: 'month' },
  all:   { hl: 'allTime', period: 'all' },
}

app.get('/api/portfolio/equity', requireAuth, async (req: Request, res: Response) => {
  try {
    const creds = MULTI_USER ? userCreds(req) : loadEnv()
    if (!creds) { res.status(400).json({ error: 'Hyperliquid credentials are not set. Add them in Settings.' }); return }
    const key = typeof req.query.period === 'string' ? req.query.period : 'all'
    const sel = EQUITY_PERIOD_MAP[key] ?? EQUITY_PERIOD_MAP.all
    const uid = userId(req) ?? 'single'
    const cacheKey = `equity|${uid}|${sel.period}`
    const hit = portfolioCache.get(cacheKey)
    if (hit && Date.now() - hit.at < PORTFOLIO_CACHE_MS) { res.json(hit.data); return }

    const resp = await getPortfolio(creds)
    const found = resp.find(([p]) => p === sel.hl)
    const data = found
      ? mapEquitySeries(sel.period, found[1].accountValueHistory, found[1].pnlHistory)
      : mapEquitySeries(sel.period, [], [])
    portfolioCache.set(cacheKey, { at: Date.now(), data })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})
```

- [ ] **Step 3: Type-check**

Run: `cd bot && npm run build`
Expected: PASS.

- [ ] **Step 4: Smoke-test the route live**

Start the server: `cd bot && npm run serve` (separate terminal). Then in single-tenant dev:
Run: `curl "http://localhost:3001/api/portfolio/equity?period=all"`
Expected: JSON with `period`, `points[]`, `startValue`, `currentValue`, `returnPct`, `maxDrawdown`, `maxDrawdownPct`. (In multi-user mode add `-H "Authorization: Bearer <token>"`.)

- [ ] **Step 5: Commit**

```bash
git add bot/src/server.ts
git commit -m "feat: add /api/portfolio/equity endpoint for account-value trend"
```

---

## Task 4: Client-side realized-layer derivation (`src/lib/portfolio.ts`)

**Files:**
- Create: `src/lib/portfolio.ts`
- Create: `scripts/check-portfolio.ts`

This module recomputes the realized layer from already-loaded `trips`, filterable by bot — the engine behind instant cross-filtering.

- [ ] **Step 1: Create `src/lib/portfolio.ts`**

```ts
// Client-side derivation of the "realized" portfolio layer from round-trips.
// Powers instant Power BI–style cross-filtering: filtering by bot recomputes
// everything in-browser with no server round-trip. All figures are realized
// (closed-trade) PnL — distinct from the account-value trend (HL endpoint).

import type { RoundTrip, FillSource, DailyBucket } from './journal'

export function botKey(s: FillSource): string {
  return s.kind === 'manual' ? 'manual' : `${s.kind}:${s.botId}`
}

export interface BotPerf {
  key: string
  source: FillSource
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number
  maxDrawdown: number          // on the bot's cumulative realized PnL
  equity: { t: number; value: number }[]   // cumulative realized PnL (for sparkline)
}

export interface RealizedView {
  netPnl: number
  trades: number
  winRate: number
  maxDrawdown: number
  maxDrawdownPct: number
  equity: { t: number; value: number }[]   // cumulative realized PnL over time
  daily: DailyBucket[]
  byAsset: { asset: string; pnl: number; trades: number; winRate: number }[]
  best: { pnl: number; asset: string } | null
  worst: { pnl: number; asset: string } | null
}

function dayKeyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// Cumulative realized-PnL series + its peak-to-trough drawdown, ordered by exit time.
function cumulative(trips: RoundTrip[]): {
  equity: { t: number; value: number }[]
  maxDrawdown: number
  maxDrawdownPct: number
} {
  const sorted = [...trips].sort((a, b) => a.exitTime - b.exitTime)
  let running = 0
  const equity = sorted.map((t) => {
    running += t.closedPnl
    return { t: t.exitTime, value: running }
  })
  let peak = 0
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  for (const p of equity) {
    if (p.value > peak) peak = p.value
    const drop = peak - p.value
    if (drop > maxDrawdown) {
      maxDrawdown = drop
      maxDrawdownPct = peak > 0 ? (drop / peak) * 100 : 0
    }
  }
  return { equity, maxDrawdown, maxDrawdownPct }
}

// Build a ranked per-bot performance list (best realized PnL first).
export function botPerformance(trips: RoundTrip[]): BotPerf[] {
  const groups = new Map<string, RoundTrip[]>()
  for (const t of trips) {
    const k = botKey(t.source)
    const arr = groups.get(k) ?? []
    arr.push(t)
    groups.set(k, arr)
  }
  const out: BotPerf[] = []
  for (const [key, arr] of groups) {
    const pnl = arr.reduce((s, t) => s + t.closedPnl, 0)
    const wins = arr.filter((t) => t.closedPnl > 0).length
    const losses = arr.filter((t) => t.closedPnl < 0).length
    const { equity, maxDrawdown } = cumulative(arr)
    out.push({
      key,
      source: arr[0].source,
      pnl,
      trades: arr.length,
      wins,
      losses,
      winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
      maxDrawdown,
      equity,
    })
  }
  return out.sort((a, b) => b.pnl - a.pnl)
}

// Compute the full realized view for the current selection. Pass a botKey to
// filter to one bot (the cross-filter), or null/undefined for "All bots".
export function realizedView(trips: RoundTrip[], selectedBot?: string | null): RealizedView {
  const rows = selectedBot ? trips.filter((t) => botKey(t.source) === selectedBot) : trips
  const netPnl = rows.reduce((s, t) => s + t.closedPnl, 0)
  const wins = rows.filter((t) => t.closedPnl > 0).length
  const losses = rows.filter((t) => t.closedPnl < 0).length
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0

  const dayMap = new Map<string, DailyBucket>()
  for (const t of rows) {
    const k = dayKeyUTC(t.exitTime)
    const b = dayMap.get(k) ?? { date: k, pnl: 0, trades: 0 }
    b.pnl += t.closedPnl
    b.trades += 1
    dayMap.set(k, b)
  }
  const daily = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  const assetMap = new Map<string, { asset: string; pnl: number; trades: number; wins: number; losses: number }>()
  for (const t of rows) {
    const e = assetMap.get(t.asset) ?? { asset: t.asset, pnl: 0, trades: 0, wins: 0, losses: 0 }
    e.pnl += t.closedPnl
    e.trades += 1
    if (t.closedPnl > 0) e.wins += 1
    else if (t.closedPnl < 0) e.losses += 1
    assetMap.set(t.asset, e)
  }
  const byAsset = [...assetMap.values()]
    .map((a) => ({ asset: a.asset, pnl: a.pnl, trades: a.trades, winRate: a.wins + a.losses > 0 ? (a.wins / (a.wins + a.losses)) * 100 : 0 }))
    .sort((a, b) => b.pnl - a.pnl)

  let best: RealizedView['best'] = null
  let worst: RealizedView['worst'] = null
  for (const t of rows) {
    if (!best || t.closedPnl > best.pnl) best = { pnl: t.closedPnl, asset: t.asset }
    if (!worst || t.closedPnl < worst.pnl) worst = { pnl: t.closedPnl, asset: t.asset }
  }
  if (best && best.pnl <= 0) best = null
  if (worst && worst.pnl >= 0) worst = null

  const { equity, maxDrawdown, maxDrawdownPct } = cumulative(rows)
  return { netPnl, trades: rows.length, winRate, maxDrawdown, maxDrawdownPct, equity, daily, byAsset, best, worst }
}
```

- [ ] **Step 2: Write the assertion script**

Create `scripts/check-portfolio.ts`:

```ts
import assert from 'node:assert'
import { botPerformance, realizedView, botKey } from '../src/lib/portfolio'
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

console.log('portfolio derivation OK')
```

- [ ] **Step 3: Run it**

Run: `npx tsx scripts/check-portfolio.ts`
Expected: prints `portfolio derivation OK`. Fix `src/lib/portfolio.ts` until it passes.

- [ ] **Step 4: Type-check the web app**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio.ts scripts/check-portfolio.ts
git commit -m "feat: client-side realized portfolio derivation for cross-filtering"
```

---

## Task 5: Rebuild PortfolioPage — account-health hero + trend chart

**Files:**
- Modify: `src/pages/PortfolioPage.tsx`

> Apply ui-ux-pro-max for visual polish. Use existing theme tokens only: `text`, `dim`, `brand`, `gain`, `loss`, `panel`, `panel-2`, `border`, `card`, `font-display`, `font-mono`.

- [ ] **Step 1: Add equity-trend state + fetch**

In `PortfolioPage`, add a `period` state with its own toggle (independent of `range`), and a fetch to the new endpoint. Add type import from journal and the new lib:

```ts
import type { EquitySeriesResponse, EquityPeriod } from '@/lib/journal'   // (EquityPeriod/EquitySeriesResponse exported from bot journal — mirror the types in src/lib/journal.ts, see Step 2)
import { botPerformance, realizedView, botKey } from '@/lib/portfolio'

const EQUITY_PERIODS: { id: EquityPeriod; label: string }[] = [
  { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' }, { id: 'all', label: 'All' },
]
```

State + fetch inside the component:

```ts
const [period, setPeriod] = useState<EquityPeriod>(
  () => (localStorage.getItem('portfolio_eq_period') as EquityPeriod) || 'all',
)
const [equity, setEquity] = useState<EquitySeriesResponse | null>(null)
const [selectedBot, setSelectedBot] = useState<string | null>(null)
useEffect(() => { localStorage.setItem('portfolio_eq_period', period) }, [period])
useEffect(() => {
  apiFetch(`/api/portfolio/equity?period=${period}`)
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(`equity ${r.status}`)))
    .then((d) => setEquity(d as EquitySeriesResponse))
    .catch(() => setEquity(null))
}, [period])
```

- [ ] **Step 2: Mirror the equity types into `src/lib/journal.ts`**

The web app's `src/lib/journal.ts` mirrors the bot types. Add at the end of the file (so the import in Step 1 resolves):

```ts
export type EquityPeriod = 'day' | 'week' | 'month' | 'all'
export interface EquitySeriesResponse {
  period: EquityPeriod
  points: { t: number; value: number }[]
  pnlPoints: { t: number; value: number }[]
  startValue: number
  currentValue: number
  returnPct: number
  maxDrawdown: number
  maxDrawdownPct: number
}
```

- [ ] **Step 3: Derive the active realized view + per-bot perf**

```ts
const perf = useMemo(() => botPerformance(trips), [trips])
const view = useMemo(() => realizedView(trips, selectedBot), [trips, selectedBot])
const selectedPerf = useMemo(
  () => (selectedBot ? perf.find((p) => p.key === selectedBot) ?? null : null),
  [perf, selectedBot],
)
// Hero shows account value when no bot selected; realized when a bot is selected.
const heroIsAccount = !selectedBot
```

- [ ] **Step 4: Build the hero band JSX (replaces the snapshot card grid)**

Replace the four-snapshot grid block (current lines ~218-244) with a hero band. When `heroIsAccount`, show account value/return/account max-DD from `equity`; when a bot is selected, show that bot's realized figures from `selectedPerf`/`view`:

```tsx
<section className="card p-4">
  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-text">
        {heroIsAccount ? 'Account value · All bots' : `Realized equity · ${sourceLabel(selectedPerf!.source)}`}
      </span>
      {!heroIsAccount && (
        <button onClick={() => setSelectedBot(null)}
          className="rounded-full border border-border bg-panel-2 px-2 py-0.5 text-[10px] text-dim hover:text-text">
          × Clear filter
        </button>
      )}
    </div>
    {heroIsAccount && (
      <div className="flex items-center gap-1">
        {EQUITY_PERIODS.map((p) => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className={`rounded-md border px-2 py-1 text-[11px] ${p.id === period
              ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-panel-2 text-dim hover:text-text'}`}>
            {p.label}
          </button>
        ))}
      </div>
    )}
  </div>

  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {heroIsAccount ? (
      <>
        <StatCard title="Account value" value={equity ? money(equity.currentValue) : '—'}
          sub={equity ? `${equity.period} return` : ' '} tone="neutral" />
        <StatCard title="Return" value={equity ? pct(equity.returnPct, true) : '—'}
          tone={equity ? toneForPnl(equity.returnPct) : 'neutral'} />
        <StatCard title="Max drawdown" value={equity ? `−${money(equity.maxDrawdown)}` : '—'}
          sub={equity && equity.maxDrawdownPct > 0 ? `−${equity.maxDrawdownPct.toFixed(1)}%` : ' '} tone="loss" />
        <StatCard title="Realized win rate" value={pct(view.winRate)}
          sub={`${view.trades} trades`} tone="neutral" />
      </>
    ) : (
      <>
        <StatCard title="Realized PnL" value={money(view.netPnl, true)} tone={toneForPnl(view.netPnl)} />
        <StatCard title="Win rate" value={pct(view.winRate)} sub={`${view.trades} trades`} tone="neutral" />
        <StatCard title="Max drawdown" value={`−${money(view.maxDrawdown)}`}
          sub={view.maxDrawdownPct > 0 ? `−${view.maxDrawdownPct.toFixed(1)}%` : ' '} tone="loss" />
        <StatCard title="Best / Worst" value={view.best ? money(view.best.pnl, true) : '—'}
          sub={view.worst ? `worst ${money(view.worst.pnl, true)}` : ' '} tone="neutral" />
      </>
    )}
  </div>

  <div ref={eqContainerRef} className="mt-3 w-full" style={{ height: 240 }} />
</section>
```

- [ ] **Step 5: Point the equity chart at the active series**

Update the equity-chart `useEffect` (current lines ~113-139): it should plot `equity.points` (ms→sec) when `heroIsAccount`, else `view.equity`. Replace the effect body's data + deps:

```ts
useEffect(() => {
  const el = eqContainerRef.current
  if (!el) return
  const data = heroIsAccount
    ? (equity?.points ?? []).map((p) => ({ time: Math.floor(p.t / 1000) as UTCTimestamp, value: p.value }))
    : view.equity.map((p) => ({ time: Math.floor(p.t / 1000) as UTCTimestamp, value: p.value }))
  if (eqChartRef.current) { eqChartRef.current.remove(); eqChartRef.current = null }
  if (data.length === 0) return
  const chart = createChart(el, {
    width: el.clientWidth, height: 240,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
    grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
    rightPriceScale: { borderColor: '#334155' },
    timeScale: { borderColor: '#334155', timeVisible: false, secondsVisible: false },
    crosshair: { mode: 0 },
  })
  const up = data.length < 2 || data[data.length - 1].value >= data[0].value
  const series = chart.addSeries(AreaSeries, {
    lineColor: up ? '#22c55e' : '#ef4444',
    topColor: up ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
    bottomColor: 'rgba(0,0,0,0)', lineWidth: 2,
  })
  series.setData(data)
  chart.timeScale().fitContent()
  eqChartRef.current = chart
  const onResize = () => chart.applyOptions({ width: el.clientWidth })
  window.addEventListener('resize', onResize)
  return () => { window.removeEventListener('resize', onResize); chart.remove(); eqChartRef.current = null }
}, [equity, view, heroIsAccount])
```

- [ ] **Step 6: Type-check + build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Manual check**

Run dev (`npm run dev` + `cd bot && npm run serve`), open Portfolio. Expected: hero shows account value, % return, max drawdown, win rate; Day/Week/Month/All toggle swaps the trend line; chart renders.

- [ ] **Step 8: Commit**

```bash
git add src/pages/PortfolioPage.tsx src/lib/journal.ts
git commit -m "feat(portfolio): account-health hero + true equity trend chart"
```

---

## Task 6: Bot leaderboard cards (the cross-filter control)

**Files:**
- Modify: `src/pages/PortfolioPage.tsx`

- [ ] **Step 1: Add an inline `BotCard` component**

Add near the other inline components (e.g. after `StatCard`):

```tsx
function Sparkline({ data, color }: { data: { t: number; value: number }[]; color: string }) {
  if (data.length < 2) return <div className="h-8 w-full" />
  const xs = data.map((d) => d.t)
  const ys = data.map((d) => d.value)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const w = 100, h = 28
  const nx = (x: number) => (maxX === minX ? 0 : ((x - minX) / (maxX - minX)) * w)
  const ny = (y: number) => (maxY === minY ? h / 2 : h - ((y - minY) / (maxY - minY)) * h)
  const d = data.map((p, i) => `${i ? 'L' : 'M'}${nx(p.t).toFixed(1)},${ny(p.value).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

function BotCard({ perf, selected, onSelect }: {
  perf: import('@/lib/portfolio').BotPerf
  selected: boolean
  onSelect: () => void
}) {
  const pos = perf.pnl >= 0
  return (
    <button type="button" onClick={onSelect}
      className={`card p-3 text-left transition ${selected
        ? 'border-brand ring-1 ring-brand/40' : 'border-border hover:border-dim'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-text" title={sourceLabel(perf.source)}>
          {sourceLabel(perf.source)}
        </span>
        <span className={`font-mono text-sm font-bold ${pos ? 'text-gain' : 'text-loss'}`}>
          {money(perf.pnl, true)}
        </span>
      </div>
      <div className="mt-1"><Sparkline data={perf.equity} color={pos ? '#22c55e' : '#ef4444'} /></div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-dim font-mono">
        <span>win {pct(perf.winRate)}</span>
        <span>{perf.trades} trades</span>
        <span className="text-loss">MDD −{money(perf.maxDrawdown)}</span>
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Render the leaderboard grid** (place between the hero and the detail sections)

```tsx
<section>
  <div className="mb-2 flex items-center justify-between">
    <span className="text-xs font-semibold text-text">Bot performance</span>
    {selectedBot && (
      <button onClick={() => setSelectedBot(null)}
        className="text-[10px] text-dim hover:text-text">Show all</button>
    )}
  </div>
  {perf.length === 0 ? (
    <div className="card p-3 text-[11px] text-dim italic">No closed trades yet.</div>
  ) : (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {perf.map((p) => (
        <BotCard key={p.key} perf={p} selected={selectedBot === p.key}
          onSelect={() => setSelectedBot((cur) => (cur === p.key ? null : p.key))} />
      ))}
    </div>
  )}
</section>
```

- [ ] **Step 3: Build + manual check**

Run: `npm run build` (expect PASS). In the browser: leaderboard shows one card per bot with sparkline + MDD; clicking a card highlights it and clicking again clears.

- [ ] **Step 4: Commit**

```bash
git add src/pages/PortfolioPage.tsx
git commit -m "feat(portfolio): rich bot leaderboard with sparkline + drawdown"
```

---

## Task 7: Cross-filter the detail sections

**Files:**
- Modify: `src/pages/PortfolioPage.tsx`

- [ ] **Step 1: Drive daily PnL bars from `view.daily`**

Update the daily-bars `useEffect` (current ~144-168) to use `view.daily` instead of `summary.dailySeries`, and add `view` to deps. Data mapping stays the same (`dateToTs(d.date)`, green/red by sign).

- [ ] **Step 2: Drive the PnL calendar from `view.daily`**

Change the calendar render to `{view.daily.length > 0 && <PnlCalendar series={view.daily} />}` (was `summary.dailySeries`).

- [ ] **Step 3: Drive By-Asset from `view.byAsset`**

Replace the By-Asset `RollupTable` rows with `view.byAsset.slice(0, 8)`. (Drop the separate By-Bot table — the leaderboard replaces it.) `RollupTable`'s `CommonRollupRow` needs only `pnl/trades/winRate`; adjust its generic bound to not require `wins/losses` (they're unused in the cell render), or map `view.byAsset` rows to include `wins: 0, losses: 0`. Choose the mapping approach to avoid touching the generic:

```tsx
<RollupTable
  title={selectedBot ? 'By Asset (this bot)' : 'By Asset (top 8)'}
  rows={view.byAsset.slice(0, 8).map((a) => ({ ...a, wins: 0, losses: 0 }))}
  rowKey={(r) => r.asset} name={(r) => r.asset}
  empty="No closed trades in this selection." />
```

- [ ] **Step 4: Filter the Closed-trades list**

The closed-trades table currently maps `trips`. Make it respect the filter:

```ts
const visibleTrips = useMemo(
  () => (selectedBot ? trips.filter((t) => botKey(t.source) === selectedBot) : trips),
  [trips, selectedBot],
)
```

Replace `trips.slice(0, 50)` with `visibleTrips.slice(0, 50)` and the `{trips.length}` counters with `{visibleTrips.length}`.

- [ ] **Step 5: Remove now-dead code (build will fail on `noUnusedLocals` otherwise)**

After Tasks 5-7 the following are no longer referenced and MUST be deleted from `PortfolioPage.tsx`: the `snap24h/snap7d/snap30d/snapAll` state + their setters, `fetchSnapshots()` and its `useEffect`, the `topAssets`/`topBots` `useMemo`s, and the old By-Bot `RollupTable`. Keep `summary`/`fetchAll` only if still used; if nothing reads `summary` anymore, remove it and its `useEffect` too (the realized layer now comes from `trips` via `view`). The `trips` fetch and `range` buttons stay.

- [ ] **Step 6: Build + manual check (the key interaction)**

Run: `npm run build` (PASS — no unused-local errors). In browser: select a bot → daily bars, calendar, by-asset, closed-trades, hero, and trend chart all switch to that bot **instantly with no spinner**; "Clear filter" / clicking the card again restores All.

- [ ] **Step 7: Commit**

```bash
git add src/pages/PortfolioPage.tsx
git commit -m "feat(portfolio): Power BI-style cross-filter on bot selection"
```

---

## Task 8: Visual overhaul pass (ui-ux-pro-max)

**Files:**
- Modify: `src/pages/PortfolioPage.tsx`

> Invoke superpowers:ui-ux-pro-max ("review/improve" this page) and apply its guidance within existing theme tokens. No data/logic changes in this task — styling only.

- [ ] **Step 1: Apply spacing/typography/card hierarchy**

Refine section spacing, card padding, headers, and number emphasis per ui-ux-pro-max. Make the hero account value the largest element; keep mono fonts for all figures; ensure consistent section gaps (`gap-4`/`gap-5`).

- [ ] **Step 2: Responsive + state polish**

Verify the layout at narrow widths (stat grid → 1 col, leaderboard → 1-2 cols). Add subtle hover/selected states already started in `BotCard`. Ensure dimmed (non-selected) cards remain readable.

- [ ] **Step 3: Loading & empty states**

Confirm: loading shows the existing spinner on Refresh; empty data shows the italic "No closed trades" copy; equity chart with <2 points shows a small "Not enough history for this period yet" note instead of a blank box.

- [ ] **Step 4: Build + full manual sweep**

Run: `npm run build` (PASS). Sweep every section in the browser at desktop + narrow width.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PortfolioPage.tsx
git commit -m "style(portfolio): visual overhaul pass (ui-ux-pro-max)"
```

---

## Task 9: Build SPA, update progress, deploy block

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Production build (writes SPA into `bot/public/`)**

Run: `npm run build`
Expected: PASS; `bot/public/` updated.

- [ ] **Step 2: Update `progress.md` Portfolio section**

Edit the relevant section in place to describe: two-layer model (HL account-value trend vs realized round-trips), new `/api/portfolio/equity` endpoint, `src/lib/portfolio.ts` derivation, bot leaderboard, cross-filtering. Keep it a current-state snapshot (no dated changelog entry).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(portfolio): redesigned page — account trend, bot leaderboard, cross-filter"
```

- [ ] **Step 4: Present the deploy block to Ken (do NOT push/deploy without his go-ahead)**

```
# ── Local ────────────────────────────────────────────────
git push origin master

# ── On VPS ───────────────────────────────────────────────
# SSH → root@68.183.184.170
cd ~/ken-trading && ./deploy.sh
```

---

## Self-Review

**Spec coverage:**
- Two honest layers → Tasks 3 (account) + 4 (realized), labelled in Task 5 hero. ✓
- Account-health hero w/ prominent max drawdown → Task 5. ✓
- Day/Week/Month/All trend toggle (HL granularity) → Tasks 3 + 5. ✓
- Rich bot leaderboard (sparkline, win rate, drawdown) → Task 6. ✓
- Power BI cross-filtering, instant/client-side → Tasks 4 + 7. ✓
- Honest caveat (account line can't split per bot → swaps to realized) → Task 5 Steps 3-5. ✓
- Preserve existing wiring (calendar, range buttons, snapshots, formatters) → kept; range buttons now drive detail sections; **note:** the four 24h/7d/30d/all snapshot cards are replaced by the hero — intentional per "full overhaul". ✓
- Combined account value (not perp) → Task 3 `EQUITY_PERIOD_MAP`. ✓
- Visual overhaul via ui-ux-pro-max → Task 8. ✓
- Out-of-scope items (local snapshots, per-bot unrealized) not built. ✓

**Placeholder scan:** No TBD/TODO. Every code step has complete code; manual-check steps state exact expected behavior. ✓

**Type consistency:** `EquitySeriesResponse`/`EquityPeriod` defined in bot `journal.ts` (Task 2) and mirrored in web `src/lib/journal.ts` (Task 5 Step 2). `botKey`, `botPerformance`, `realizedView`, `BotPerf`, `RealizedView` defined in Task 4 and used consistently in Tasks 5-7. `getPortfolio` (Task 1) used in Task 3. `mapEquitySeries` (Task 2) used in Task 3. ✓

**Note on `range` vs `period`:** the existing `summary`/`snapshot` fetches and `range` buttons remain for now but, after Task 7, the detail sections read from `view` (client-derived). `range` still bounds which `trips` are fetched (`/api/portfolio/trips?range=`), so the range buttons continue to govern the detail window — consistent with the design.
