# Full-Site Consolidation Plan
**Branch:** `full-site`  
**Goal:** Merge `garlic-trading.vercel.app` (analytics) and `bot.garlic-trading.net` (bot dashboard) into a single site at `bot.garlic-trading.net`.

---

## Decisions (locked)

| Question | Answer |
|---|---|
| Tech approach | React (Vite) SPA served as static files by Express |
| Auth gating | **Entire site requires login** |
| Vercel fate | Decommission after launch |
| Symbol scope | HL-tradeable assets only across all pages |
| LocalStorage user prefs | Accept shared-device leak (it's a personal tool) |
| LW Charts version | All new React bot pages use v5 API (React app already on v5) |

---

## Pre-Flight API Contract Verification (DONE)

These were verified before Phase 1 begins — do not re-derive from assumptions.

| Endpoint | Return shape | Notes |
|---|---|---|
| `GET /api/assets` | `string[]` | Short names: `['BTC', 'ETH', 'SOL', ...]` — NO "USDT" suffix |
| `POST /api/bots` | `GridConfig` (saved) | Body cast directly to `GridConfig`; required: `asset`, `lower`, `upper`, `gridCount`, `mode`, plus one of `orderSize` OR `investment`+`leverage` |
| `GET /api/signal/bots/:id/chart-data` | Confirmed exists | `server.ts:609` |
| `GET /api/assets` auth | Requires JWT | `requireAuth` middleware — will 401 if no token |

**GridConfig field names (from `bot/src/config.ts`):**
```ts
asset: string            // 'ETH', not 'ETHUSDT'
lower: number
upper: number
gridCount: number
mode: 'arithmetic' | 'geometric'
orderSize?: number       // direct per-grid size (wins over investment)
investment?: number      // USDC budget → derives orderSize via deriveOrderSize()
leverage?: number        // default 1
stopLossPrice?: number   // absolute price, must be < lower
takeProfitPrice?: number // absolute price, must be > upper
name?: string            // display label
```

---

## Architecture

```
bot.garlic-trading.net  (Cloudflare Tunnel → VPS:3001)
│
Express server (bot/src/server.ts)
├── /auth/*      →  Auth API (login, register, me, credentials)
├── /api/*       →  Bot API (bots, signal bots, trade, account, etc.)
└── /*           →  React SPA (static files from bot/public/)
                     React Router handles /login, /backtest, /grid, /signal, /bots, /trade, /logs
                     Express SPA fallback: GET * → index.html (except /api, /auth)
```

**Build pipeline:**
- `vite.config.ts`: set `build.outDir = '../bot/public'` (relative to repo root)
- Express: `app.use(express.static(path.join(__dirname, '../public')))` (before API routes)
- SPA fallback: catch-all GET → `bot/public/index.html` (only if not `/api/*` or `/auth/*`)
- `bot/public/` → add to `.gitignore`
- Dev: Vite proxy `/api` and `/auth` to `localhost:3001`

**Auth (shared JWT key):**
- Vanilla dashboard uses `localStorage.getItem('auth_jwt')` — React must use the **same key**
- React `AuthContext` reads JWT from `localStorage('auth_jwt')`, calls `GET /auth/me` to validate
- React `api()` helper attaches `Authorization: Bearer <jwt>` header on all `/api/*` and `/auth/*` calls
- `GET /auth/me` returns:
  - **404** → single-tenant mode (no auth required; treat as "logged in")
  - **401** → multi-user mode, not logged in → redirect to `/login`
  - **200** → multi-user mode, valid session
- On 401 response from any API call → clear token, redirect to `/login`

> **Current VPS runs `MULTI_USER=true`. AuthContext MUST handle all three cases above correctly.**

---

## Navigation Structure

Six items in the left icon rail (60px, same design as current React sidebar):

| # | Icon | Route | Label | Description |
|---|---|---|---|---|
| 1 | LineChart | `/backtest` | Strategy Backtester | Backtest 14 strategies on historical data |
| 2 | LayoutGrid | `/grid` | Grid Optimizer | Optimize grid ranges → deploy directly |
| 3 | Radio | `/signal` | Signal Bots | Multi-bot autonomous trading |
| 4 | Bot/Grid | `/bots` | Grid Bots | Manual grid bot management |
| 5 | ArrowUpDown | `/trade` | Trade | Manual orders + account overview |
| 6 | Activity | `/logs` | Logs | Trade journal + activity stream |

Running-bot indicator dots on Signal Bots and Grid Bots nav items (same pulse dot pattern as vanilla dashboard).

Default route: `/` → redirect to `/backtest` (if authed) or `/login`.

---

## Page-by-Page Design

### `/login` — New React page

**What it is:** Replaces vanilla HTML login overlay.

**Layout:** Centered card, full-screen dark background with grid pattern.
- Two tabs: **Sign In** | **Register**
- Fields: Email, Password (+ Confirm Password on Register)
- Submit → `POST /auth/login` or `/auth/register`
- On success → store JWT to `localStorage('auth_jwt')`, redirect to `/backtest`

**Removed:** Vanilla HTML login overlay in `bot/dashboard/index.html` (becomes unused once React SPA is the shell).

---

### `/backtest` — Strategy Backtester

**What changes:**
1. **Symbol picker** → replace `fetchSymbols()` (Binance) with `GET /api/assets` (HL assets). New hook `useHLAssets()` returns `{ symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT' }[]` (same shape as current — candle fetching still uses Binance kline API with `${base}USDT`).
2. **"Deploy as Signal Bot" button** in the Results section:
   - Stores config in `sessionStorage('pending_signal_bot_config')` as a JSON blob
   - Navigates to `/signal`
   - Signal Bots page checks `sessionStorage` on mount → opens new-bot form pre-filled
   - Clears `sessionStorage` after reading
3. **Remove:** `IS_LOCAL` env gate, `VITE_BOT_URL` references, `env.ts` bot URL logic
4. **Remove:** Bot URL / API Token connection panel (no longer needed)

**Unchanged:** All analytics (Markov regime, walk-forward, ensemble, multi-TF, correlation). Full 14 strategies. Chart + equity curve. SummaryPanel. Advanced Analysis collapsible.

---

### `/grid` — Grid Optimizer

**What changes:**
1. **Symbol picker** → HL assets (same `useHLAssets()` hook, shared with Backtester)
2. **Deploy section redesign** — replaces current Export buttons:
   - **Remove:** "Export Config JSON" button
   - **Remove:** "Export Grid Lines JSON" button _(optional: keep as hidden "Advanced export" collapsible for power users)_
   - **Add:** `▶ Deploy as Grid Bot` primary button:
     - Calls `POST /api/bots` with payload below
     - On success: shows toast "Grid bot 'ETH-GRID-8' created"
     - Then navigates to `/bots?select=<newBotId>`

**Deploy payload mapping (field names match GridConfig exactly):**
```
Grid Optimizer config → POST /api/bots body
──────────────────────────────────────────────────────────
name           ← botName || generateAutoName()   // e.g. 'ETH-GRID-8'
asset          ← base                            // 'ETH' (NOT 'ETHUSDT')
lower          ← activeLines[0]
upper          ← activeLines[last]
gridCount      ← activeLines.length - 1
mode           ← 'arithmetic' | 'geometric'
investment     ← riskUsd field value             // Risk per Trade $ budget
leverage       ← 1 (default; user can override)
stopLossPrice  ← lower * (1 - slPct / 100)      // MUST be < lower
takeProfitPrice← upper * (1 + slPct / 100)      // MUST be > upper
```

> **Note:** `riskUsd` and `slPct` are UI field names in the Grid page form; they map to `investment` and computed absolute prices. `riskUsd`/`slPct` do NOT exist on `GridConfig` — never send them raw.

**Unchanged:** Static optimizer, auto-grid mode, regime suitability banner, grid chart, stats panel.

> **Note:** Risk per Trade ($) and SL% UI fields already exist in GridPage.tsx (added session 3). Phase 2 work is wiring the Deploy button, not adding those fields.

---

### `/signal` — Signal Bots

**What it is:** Full port of vanilla dashboard Signal Trader page to React.  
**Base:** Expand existing `src/pages/SignalTraderPage.tsx` (already exists but simplified).

**Layout:** Same split-pane as current vanilla — left sidebar + right main area.

**Left sidebar:**
- Bot list (name, running status dot, click to select)
- "+ New Bot" button
- Start / Stop controls
- Bot config form:
  - Asset (HL combo picker)
  - Strategy (combo picker — fetched from `GET /api/strategies`)
  - Timeframe select
  - Strategy params (dynamic based on strategy)
  - Risk per Trade ($) + SL%
  - Direction (Long & Short / Long only / Short only)
  - Cooldown, Slippage
  - Auto-naming (`ETH-MACD-1H`)
  - Save Config button

**Right main area:**
- Status banner (last signal, trades executed, daily P&L)
- LW Charts v5 candlestick chart with buy/sell markers (from `/api/signal/bots/:id/chart-data`)
- Compact stats row (LastSignal / Trades / DailyPnL)
- Activity log (SSE stream filtered to this bot)

**Pre-fill from Backtester:** reads `sessionStorage('pending_signal_bot_config')` on mount → opens new bot form pre-filled, then clears the key.

**Removed from current SignalTraderPage.tsx:**
- `botUrl`, `botToken` state and inputs
- `IS_LOCAL` / connection status check
- `lab_bot_url` / `lab_bot_token` localStorage keys

**API calls:** All relative paths — `/api/signal/bots/*`, `/api/strategies`, `/api/assets`.

---

### `/bots` — Grid Bots

**What it is:** Full port of vanilla dashboard Grid Bot page to React.  
**New file:** `src/pages/GridBotsPage.tsx`

**Layout:** Same left sidebar + right main area pattern.

**Left sidebar:**
- Bot list with status dots
- "+ New Bot" button
- Start / Stop controls
- Bot config form:
  - Display Name, Asset (HL combo)
  - Lower / Upper price range
  - Grid Count, Mode (arithmetic/geometric)
  - Timeframe (chart only)
  - Risk per Trade ($) + SL%
  - Auto-naming (`ETH-GRID-8`)

**Right main area:**
- Compact stats card (Price / Realized PnL / Total PnL / State)
- Safety card (SL / TP / Liquidation distances)
- LW Charts v5 candlestick chart with grid price lines + SL/TP lines

**Deep-link from Grid Optimizer:** `/bots?select=<id>` → page loads and auto-selects that bot.

**Removed:**
- JSON file drag-and-drop import (replaced by Grid Optimizer → Deploy flow)

---

### `/trade` — Manual Trade & Account

**What it is:** Port of vanilla dashboard Trade page to React.  
**New file:** `src/pages/TradePage.tsx`

**Layout:** Two-column — left = account + position info, right = sticky order form.

**Left column:**
- Account overview (equity, withdrawable, margin used)
- Open Position card (unrealised P&L, side/asset/size/entry, Close Position button)
- Recent fills table

**Right column:**
- Asset picker (HL combo)
- Order size, Slippage %
- Quick-size buttons (25% / 50% / 75% / Max)
- Buy / Sell buttons → `POST /api/order`
- Live price refresh every 5s from `/api/asset-info`

**Auto-refresh:** Account + position polls every 5s while page is active.

---

### `/logs` — Trade & Activity Logs

**What it is:** Port of vanilla dashboard Trade & Log page to React.  
**New file:** `src/pages/LogsPage.tsx`

**Top strip:**
- Account overview
- Quick Close widget (asset + slippage → `POST /api/close`)

**Log viewer:**
- SSE stream from `GET /api/logs/stream?token=<jwt>` (token in query param since SSE can't use headers)
- Filter buttons: All / Fills / Issues / Info
- Per-bot filter buttons (auto-generated from log prefixes)
- Jump-to-bottom, Clear, running count
- Level colour coding (gain=Fills, loss=Issues, dim=Info)

---

## Integrations & Cross-Cutting Concerns

### useHLAssets hook
```ts
// src/lib/hlAssets.ts
let _cache: SymbolInfo[] | null = null

export async function fetchHLAssets(): Promise<SymbolInfo[]> {
  if (_cache) return _cache
  // /api/assets requires auth — call only after login
  const assets: string[] = await fetch('/api/assets', {
    headers: { Authorization: `Bearer ${localStorage.getItem('auth_jwt')}` }
  }).then(r => r.json())
  _cache = assets.map(a => ({ symbol: `${a}USDT`, base: a, quote: 'USDT' }))
  return _cache
}
```
Both Backtester and Grid Optimizer call this instead of Binance `fetchSymbols()`.  
Candle fetching (Binance REST) still uses `ETHUSDT` format — no change to `binance.ts`.

### AuthContext
```ts
// src/contexts/AuthContext.tsx
const JWT_KEY = 'auth_jwt'  // ← same key as vanilla dashboard

export function AuthProvider({ children }) {
  const [user, setUser] = useState<User | null | 'loading'>('loading')
  useEffect(() => {
    const jwt = localStorage.getItem(JWT_KEY)
    if (!jwt) { setUser(null); return }
    fetch('/auth/me', { headers: { Authorization: `Bearer ${jwt}` } })
      .then(r => {
        // 404 = single-tenant mode, no auth required
        if (r.status === 404) return { id: 'local', email: 'local' }
        if (!r.ok) return null  // 401 = not logged in
        return r.json()
      })
      .then(setUser)
  }, [])
  if (user === 'loading') return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>
}
```

### React Router setup (App.tsx refactor)
Current `App.tsx` uses page-state, no router. Needs:
- Install `react-router-dom`
- Wrap app in `<BrowserRouter>`
- Replace `useState<Page>` with `<Routes>` + `<Route>` components
- `AuthProvider` wraps all routes except `/login`
- Default `/` → redirect to `/backtest`

### Vite proxy (dev)
```ts
// vite.config.ts addition
server: {
  proxy: {
    '/api': 'http://localhost:3001',
    '/auth': 'http://localhost:3001',
  }
}
```

### Express static serving (server.ts addition)
```ts
import { join, dirname } from 'node:path'
const PUBLIC_DIR = join(__dirname, '..', 'public')

// Before any routes:
app.use(express.static(PUBLIC_DIR))

// After all /api and /auth routes, SPA fallback:
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return
  res.sendFile(join(PUBLIC_DIR, 'index.html'))
})
```

### LW Charts v5 for bot pages
The React app already uses `"lightweight-charts": "^5.0.7"`. All new bot management pages use v5 API:
- `chart.addSeries(CandlestickSeries)` not `chart.addCandlestickSeries()`
- Markers via `series.setData()` with `customValues` instead of `series.setMarkers()`

(The vanilla dashboard is pinned to v4.2.0 via CDN and stays unchanged until it's removed.)

---

## What Gets Removed / Replaced

| Item | Reason |
|---|---|
| `exportConfig()` in GridPage | Replaced by "Deploy as Grid Bot" → `POST /api/bots` |
| `exportLines()` in GridPage | Replaced by same flow |
| `lab_bot_url` / `lab_bot_token` localStorage keys | Same origin; no remote config needed |
| `getBotUrl()`, `setBotUrl()`, `getBotToken()` in env.ts | Replaced by same-origin relative calls |
| `IS_LOCAL` / `VITE_BOT_URL` build variable | No longer needed |
| `DEFAULT_BOT_URL` in env.ts | No longer needed |
| Bot URL / API Token inputs in SignalTraderPage | Removed |
| Vanilla HTML `bot/dashboard/index.html` served at `/` | Replaced by React SPA |
| Vercel `garlic-trading.vercel.app` | Decommissioned after launch |
| `ALLOWED_ORIGINS=https://garlic-trading.vercel.app` in VPS .env | **Keep until Vercel is actually decommissioned** — remove only in Phase 6 |
| JSON file import (drag-and-drop) on Grid Bots page | Replaced by Grid Optimizer → Deploy flow |

**What stays (vanilla dashboard):**
- The vanilla `bot/dashboard/index.html` is kept as a backup served at `/legacy` — not linked in nav, but useful during transition. Removed after full parity confirmed.

---

## Phased Delivery

Each phase is a deployable checkpoint. You can pause after any phase.

### Phase 1 — Foundation (1–2 days)
**What ships:**
- Express serves React SPA as static files from `bot/public/`
- React Router added to App.tsx
- AuthContext reads `auth_jwt` JWT from localStorage, gates all pages (handles 404/401/200)
- Login page (`/login`) in React
- Backtester and Grid pages accessible at `/backtest` and `/grid` (auth-gated)
- Vite proxy to bot API for local dev
- `/legacy` serves old vanilla dashboard (fallback)
- VPS deploy procedure updated: `npm run build` in root (outputs to `bot/public/`), then `pm2 restart trading-bot`

**Smoke tests:**
- [ ] `bot.garlic-trading.net` shows React login page (not vanilla dashboard)
- [ ] Login with existing credentials works; redirects to `/backtest`
- [ ] `/backtest` and `/grid` load with full analytics functionality
- [ ] `/legacy` still shows old vanilla dashboard
- [ ] Direct URL `/backtest` works on page reload (SPA fallback functioning)
- [ ] `/api/bots` returns JSON (API routes not swallowed by SPA fallback)

---

### Phase 2 — Analytics integration (0.5–1 day)
**What ships:**
- Symbol picker uses HL assets (`/api/assets`) on both Backtester and Grid Optimizer
- Grid Optimizer: "Deploy as Grid Bot" button → `POST /api/bots` → navigate to `/bots` (placeholder page until Phase 4)
- Backtester: "Deploy as Signal Bot" button → stores config in `sessionStorage('pending_signal_bot_config')` → navigate to `/signal` (placeholder until Phase 3)
- Remove: Export JSON buttons on Grid Optimizer
- Remove: `lab_bot_url` / `lab_bot_token` / env.ts bot URL logic

**Smoke tests:**
- [ ] Backtester symbol picker shows HL assets (BTC, ETH, SOL, ...) not all Binance pairs
- [ ] Grid Optimizer symbol picker shows HL assets
- [ ] Backtester still fetches candles and runs backtest after symbol change
- [ ] "Deploy as Grid Bot" button calls `POST /api/bots` and gets 200 response
- [ ] Navigation to `/bots` after deploy (placeholder page loads)

---

### Phase 3 — Signal Bots page (1.5–2 days)
**What ships:**
- `/signal` → full `SignalBotPage.tsx` (port of vanilla Signal Trader + expansion of existing `SignalTraderPage.tsx`)
- LW Charts v5 signal chart with buy/sell markers
- "Deploy as Signal Bot" from Backtester pre-fills form via `sessionStorage`
- SSE log stream for this bot

**Smoke tests:**
- [ ] `/signal` lists existing signal bots
- [ ] Create new signal bot; bot appears in list
- [ ] Start/stop bot; running dot appears/disappears
- [ ] Chart loads with candles + buy/sell markers
- [ ] SSE log stream shows new log lines as they arrive
- [ ] Backtester "Deploy" pre-fills signal form correctly

---

### Phase 4 — Grid Bots page (1.5–2 days)
**What ships:**
- `/bots` → `GridBotsPage.tsx` (port of vanilla Grid Bot page)
- LW Charts v5 chart with grid lines + SL/TP
- "Deploy as Grid Bot" from Grid Optimizer navigates here and auto-selects new bot

**Smoke tests:**
- [ ] `/bots` lists existing grid bots
- [ ] Create new bot; appears in list
- [ ] Start/stop bot; state updates
- [ ] Chart loads with candles + grid price lines + SL/TP lines
- [ ] Grid Optimizer "Deploy" creates bot and auto-selects it on `/bots`

---

### Phase 5 — Trade & Logs pages (1–1.5 days)
**What ships:**
- `/trade` → `TradePage.tsx` (manual orders + account overview)
- `/logs` → `LogsPage.tsx` (SSE log viewer + trade journal)

**Smoke tests:**
- [ ] `/trade` shows account equity, open position
- [ ] Close position button works
- [ ] Buy/Sell order form submits and gets fill response
- [ ] `/logs` shows SSE log stream in real time
- [ ] Log filter buttons (All/Fills/Issues/Info) work

---

### Phase 6 — Decommission (0.5 days)
- Remove `/legacy` route
- Update VPS `.env`: remove `ALLOWED_ORIGINS=garlic-trading.vercel.app` (only after Vercel project deleted)
- Delete Vercel project
- Update `CLAUDE.md` architecture section
- Final smoke test: all 6 routes work end-to-end

**Total: ~8–10 development days** (not including review/testing)

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LW Charts v5 API differences | All new bot pages start with v5 API from scratch — no migration from v4 |
| SSE in React (EventSource can't use fetch headers) | Read JWT from `localStorage('auth_jwt')` and pass as `?token=<jwt>` query param — already supported by server |
| Strategy duplication (`src/lib/` vs `bot/src/strategy/`) | Out of scope for this consolidation; document as known gap |
| Live users on bot while migrating | Phase 1 provides React shell while vanilla still works at `/legacy`; no disruption |
| React Router SPA fallback breaking `/api/*` calls | Express catch-all must explicitly exclude `/api` and `/auth` prefixes — order matters |
| Symbol name format mismatch | `useHLAssets()` converts `'ETH'` → `{ base: 'ETH', symbol: 'ETHUSDT' }`; GridConfig `asset` field always receives short form `'ETH'` |
| AuthContext 404 vs 401 ambiguity | Explicitly handle: 404=single-tenant (authed), 401=multi-user not logged in, 200=authed |
| `POST /api/bots` body schema mismatch | Pre-flight verified: send `investment` not `riskUsd`; `stopLossPrice`/`takeProfitPrice` as absolute prices (not percentages) |
| Removing ALLOWED_ORIGINS prematurely | Keep in `.env` until Vercel project is actually deleted (Phase 6) |

---

## File Change Summary

**New files:**
- `src/contexts/AuthContext.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/GridBotsPage.tsx`
- `src/pages/TradePage.tsx`
- `src/pages/LogsPage.tsx`
- `src/lib/hlAssets.ts`

**Modified files:**
- `vite.config.ts` — add `build.outDir: '../bot/public'`, dev proxy
- `src/App.tsx` — add React Router, AuthProvider, 6-route structure
- `src/components/Sidebar.tsx` — add 4 new nav items, running-bot dots
- `src/pages/GridPage.tsx` — replace export buttons with Deploy button, use HL symbols
- `src/pages/BacktesterPage.tsx` — add Deploy as Signal Bot, use HL symbols
- `src/pages/SignalTraderPage.tsx` — expand to full multi-bot UI, remove BOT_URL/token
- `src/lib/env.ts` — remove bot URL / token logic
- `bot/src/server.ts` — add static file serving, SPA fallback route

**Removed files:**
- `src/lib/env.ts` (if fully emptied; or kept and trimmed to just what's still used)

**Unchanged:**
- All bot logic (`bot/src/*.ts`) — no changes to trading engine
- `bot/dashboard/index.html` — kept at `/legacy` route during transition
- All analytics lib files (`src/lib/*.ts`) — no changes to strategy/backtest/grid logic
