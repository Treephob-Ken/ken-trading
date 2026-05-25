# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Live deployment

Single live surface — the React SPA and the bot dashboard/API are now served by **one** Express server on the VPS. Vercel is decommissioned.

| Component | URL | Host |
|---|---|---|
| Everything (web app + bot API + dashboard) | https://bot.garlic-trading.net | DigitalOcean SGP1 (68.183.184.170) |

The React SPA is built locally with `npm run build` → outputs to `bot/public/` (committed to git). On the VPS, `express.static(bot/public)` serves it. No separate frontend deploy — `git push` + `./deploy.sh` ships both.

### High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                 bot.garlic-trading.net
                 (Cloudflare Tunnel)
                          │
                Cloudflare Edge → cloudflared
                          │
                 VPS: localhost:3001
                 Express server (pm2)
                 ┌────────────────────────────┐
                 │  GET /             → React SPA from bot/public/
                 │  GET /api/*        → REST API (JWT-gated)
                 │  GET /auth/*       → register / login / me
                 │  GET /settings/*   → per-user HL creds
                 │
                 │  Multi-user mode (MULTI_USER=true)
                 │  SQLite users.db
                 │  Per-user bot data
                 │  JWT auth (7d)
                 └────────────────────────────┘
                          │
                 Hyperliquid API (testnet/mainnet)
                 Binance REST (market data)
```

### User registration flow

1. User visits **https://bot.garlic-trading.net**
2. Dashboard detects multi-user mode by calling `GET /auth/me` — gets `401` → shows login overlay
3. User clicks **Register** tab → enters email + password
4. `POST /auth/register` creates account in SQLite (`bot/data/users.db`), returns JWT
5. JWT stored in `localStorage`; all subsequent API calls send `Authorization: Bearer <token>`
6. User goes to **Settings** → enters their Hyperliquid agent key + wallet address
7. `PUT /settings/credentials` AES-256-GCM encrypts the key and saves to DB
8. User can now create signal bots and grid bots — all isolated to their account

### What happens behind the scenes (multi-user)

- **Auth:** `bot/src/auth.ts` — `requireAuth` middleware validates JWT on every `/api/*` request. No-op in single-tenant mode.
- **Storage:** `bot/src/users.ts` — SQLite via `better-sqlite3`. Each user row stores encrypted HL agent key (`hl_key_enc`), wallet address (`hl_user`), network (`hl_network`).
- **Encryption:** AES-256-GCM using `KEY_ENCRYPTION_SECRET` from `.env`. Key is unrecoverable if the secret is lost.
- **Bot isolation:** Signal bot configs in `bot/data/<userId>/signal-bots/`, grid configs in `bot/data/<userId>/configs/`. Bots run with each user's own decrypted credentials.
- **Admin:** First registered user always gets admin. Admin can see all users, stop any user's bots (`DELETE /admin/users/:id`, `POST /admin/users/:id/kill-bots`).
- **Migration:** On first admin registration, existing single-tenant configs are copied to `bot/data/<adminId>/` (idempotent, marker file `bot/data/.migrated`).

### VPS management commands

```bash
# Check status
pm2 status

# View bot logs
pm2 logs trading-bot --lines 50

# Restart tunnel
pm2 restart cloudflare-tunnel

# SSH in
ssh root@68.183.184.170
```

### Updating the VPS after a code change

Use the idempotent `deploy.sh` script — it survives any local junk in the VPS working tree (rebuilt `package-lock.json`, accidental npm builds, stale staged files) and only runs `npm install` when `bot/node_modules` is genuinely out of sync with `bot/package-lock.json`.

```bash
# Local — build the SPA into bot/public/ if web files changed, then push
npm run build                         # only if anything under src/ changed
git add . && git commit -m "..." && git push origin master

# On VPS — one command does everything (pull, conditional install, restart)
cd ~/ken-trading && ./deploy.sh
```

`deploy.sh` does: `git fetch` → `git reset --hard origin/master` → diff `bot/node_modules/.package-lock.json` vs `bot/package-lock.json` → conditional `npm install --no-audit --no-fund` → `pm2 restart trading-bot`. Safe — only touches tracked files; `.env`, `bot/data/`, `bot/configs/`, `bot/signal-bots/`, `bot/trade-audit.log` are all preserved (gitignored or untracked).

## Repository layout

One unified app, two source trees:

- **Web app** (root `src/`, `index.html`, `vite.config.ts`) — React + Vite + Tailwind + Lightweight Charts. `npm run build` outputs to `bot/public/` (committed to git) so the Express server can serve it directly. Pages in `src/pages/`:
  - `LoginPage.tsx` — register / login (multi-user mode only)
  - `BacktesterPage.tsx` — Strategy Backtester (Monte Carlo, regime breakdown, MTF, deploy-to-bot). Reads `location.state.presetStrategy` from Scanner to auto-apply a strategy on arrival.
  - `GridPage.tsx` — Grid Optimizer (parameter sweep + deploy-to-bot)
  - `ScannerPage.tsx` — Currency Scanner: two tabs (Indicator + Grid) that batch-rank ~30 HL-tradeable coins. Reuses `runBacktest` / `optimizeGrid` engines client-side. Each row gets a colored verdict badge + plain-English reason from `src/lib/scanner/verdict.ts`. Results persist across page navigation via `sessionStorage`; filters persist via `localStorage`. Row → click → opens Backtester (with strategy preset) or Grid Optimizer (with symbol preset).
  - `GridBotsPage.tsx` — Live grid bot management
  - `SignalBotsPage.tsx` — Live signal bot management (per-bot chart, logs, trades)
  - `TradePage.tsx` — Manual trade + open positions + click-to-select position detail w/ chart + SL/TP/liq lines
  - `LogsPage.tsx` — Live SSE log tail across all bots
  - `SettingsPage.tsx` — HL agent key + wallet + network
  - `FundamentalsPage.tsx` — Market fundamentals
- **Bot** (`bot/`) — Node + TypeScript live trading bot for Hyperliquid (testnet + mainnet). Runs two bot types: a grid bot (`grid-bot.ts`) and one or more signal bots (`signal-bot.ts`). The Express HTTP server (`server.ts`) on port 3001 does double duty — serves the React SPA from `bot/public/` AND exposes the REST API. The legacy native-HTML dashboard at `bot/dashboard/index.html` is no longer the primary UI.

The web app's optimizer produces a grid spec (range, count, mode, spacing) that you can deploy directly via the **Deploy to bot** button (no JSON copy-paste).

## Commands

### Web app (run from repo root)

> **Node.js requirement:** The bot requires **Node.js 22+** on the VPS. Node 20 lacks native `WebSocket` which `@nktkas/hyperliquid`'s `WebSocketTransport` requires. After any Node.js upgrade, run `npm rebuild` in `bot/` to recompile `better-sqlite3`.

```bash
npm install
npm run dev               # Vite dev server (http://localhost:5173) — proxies /api + /auth to localhost:3001
npm run build             # tsc --noEmit && vite build → outputs to bot/public/ (commit + push to deploy)
```

The Vite dev server proxies `/api` and `/auth` to `http://localhost:3001`, so run `cd bot && npm run serve` in another terminal during development. There is **no separate frontend deploy** — `npm run build` writes to `bot/public/` which is git-tracked, so `git push` + `./deploy.sh` on the VPS ships the SPA along with the bot.

### Bot (run from `bot/`)

```bash
cd bot
npm install
npm run serve             # runs tsx src/server.ts — HTTP server + dashboard on port 3001 (use this)
npm start                 # runs tsx src/index.ts — legacy standalone single grid-bot (no dashboard, no API)
npm run build             # tsc --noEmit (type-check only, no JS emitted)
```

The bot server runs locally but is exposed to the internet via a **Cloudflare Tunnel** at `https://bot.garlic-trading.net`. To start the bot remotely accessible:

```bash
# In one terminal — start the bot server (use serve, not start)
cd bot && npm run serve

# In another terminal — start (or keep running) the tunnel
cloudflared tunnel run <tunnel-name>
```

The tunnel forwards HTTPS at `bot.garlic-trading.net` → `http://localhost:3001`. Since the React SPA is now served from the same Express server, CORS is mostly irrelevant for production — `ALLOWED_ORIGINS` only matters for cross-origin local dev (`http://localhost:5173`). On the VPS, multi-user mode (`MULTI_USER=true`) is the auth gate — JWT from `requireAuth` middleware. Set `ALLOWED_EMAILS` to restrict registration to specific emails.

The bot reads `bot/.env` for keys and settings:
- `HL_AGENT_PRIVATE_KEY`, `HL_USER_ADDRESS`, `HL_NETWORK` — required in single-tenant mode (see `bot/README.md`)
- `HOST` — bind address (default `127.0.0.1` for localhost-only behind tunnel)
- `ALLOWED_ORIGINS` — comma-separated origins the CORS policy allows beyond localhost (rarely needed now that SPA is same-origin)
- `BOT_API_TOKEN` — if set, every `/api/*` request must carry `Authorization: Bearer <token>` (single-tenant only; ignored when `MULTI_USER=true`)
- `MAX_TRADE_NOTIONAL_USD`, `ALLOWED_ASSETS`, `MAX_TRADES_PER_HOUR` — server-side safety caps (see `limits.ts`)
- `MULTI_USER=true` — opt-in multi-user mode; adds login, per-user HL creds, data isolation (see Phase B below)
- `OWNER_EMAIL` — if set, the first user who registers with this email gets admin privileges
- `ALLOWED_EMAILS` — comma-separated whitelist of emails permitted to register (e.g. `ken2540@gmail.com`). If unset, anyone can register.
- `KEY_ENCRYPTION_SECRET` — 64 hex chars (32 bytes); used to AES-256-GCM encrypt each user's HL agent key at rest. **Unrecoverable if lost.**
- `JWT_SECRET` — 32+ char random string; signs JWT session tokens (7-day expiry)

## Web app architecture

**Data flow (Backtester page):** `App.tsx` owns `symbol/timeframe/symbols` (lifted so both pages share the selection). `BacktesterPage` fetches candles from Binance, subscribes to a live kline WebSocket when the date range includes today, and runs the backtest in a `useMemo` so any control change re-runs instantly.

**Data flow (Grid page):** `GridPage` fetches the most recent ~1000 candles, slices the last `lookback` bars as the optimization window, and calls `optimizeGrid()`. The result drives `GridChart` (price lines for grid levels) and `GridStats` (the metrics table).

**Key modules in `src/lib/`:**

- `binance.ts` — public Binance data endpoints (REST + WS). No API key. `fetchKlines` paginates forward in 1000-bar chunks for long date ranges (capped at `MAX_BARS = 6000`).
- `indicators.ts` — math primitives (EMA, RMA, ATR, Bollinger, Supertrend, PSAR, Stochastic, CCI, Williams %R, Donchian). All NaN-tolerant — early bars return NaN; downstream code treats NaN as "no signal."
- `strategies.ts` — wraps indicators into 14 named strategies. Each returns `{ signals, mainLines, subPane? }` so the same shape feeds the backtester and chart overlays. Exports `generateSignals`, `defaultParams`, and `strategyMeta`.
- `backtest.ts` — long/short/both backtest with an equity-fraction model. Shorts are simulated as `afterFee * (2 - price/entryPrice)` clamped to 0 (liquidation). Note the `pos()` function pattern — it defeats TypeScript's over-narrowing of a `let position` mutated inside closures.
- `grid.ts` — `optimizeGrid(window, params)` sweeps grid counts and picks the highest **total** PnL (realized + unrealized). The simulator walks each candle as `[prevClose, open, low, high, close]` to catch intrabar crossings.
- `markov.ts` — Observable Markov regime model: labels every candle Bull/Sideways/Bear from a rolling return, builds a 3×3 MLE transition matrix, and exposes stationary distribution, n-step forecast, persistence, and conviction. Used by `RegimePanel` and `multiTF.ts`.
- `ensemble.ts` — runs multiple strategies, tracks their running stance (long/short/flat), and combines via vote-consensus or weighted mode. Regime weights from `markov.ts` can boost/reduce trend vs oscillator strategies by market state.
- `walkforward.ts` — walk-forward validation: sweeps ±10% parameter combinations (cartesian product), runs IS/OOS fold pairs, and reports `overfitScore` (how much worse OOS is vs IS).
- `multiTF.ts` — fetches the next higher timeframe per `TF_HIERARCHY` (e.g. `1h → 4h`), runs regime analysis on both, and returns confluence/conflict assessment.
- `gridBotAuto.ts` — ported Pine Script "lazy MA" grid strategy. An anchor point (AP) steps slowly toward the LMA; buy/sell signals fire when price crosses grid lines on either side.
- `env.ts` — bot connection settings stored in localStorage (`lab_bot_url`, `lab_bot_token`). Reads `VITE_BOT_URL` at build time for the hosted-deploy default.
- `format.ts` — shared price/number formatting utilities (`fmtPrice`, etc.).
- `glossary.ts` — term definitions shown in UI tooltips.
- `scanner/` — used by `ScannerPage`. `universe.ts` intersects HL `/api/assets` with Binance 24h `quoteVolume` and returns the top N tradeable coins (default 30). `indicatorScan.ts` and `gridScan.ts` run batched backtests with an inline concurrency-limited pool (default 6 in-flight Binance fetches). `verdict.ts` translates a row's raw metrics into a grade (`great|good|ok|caution|skip`) + plain-English reason that the UI surfaces as the colored "Pick" badge and Best-Pick hero card.

**`src/types.ts`** is the shared type hub: `Candle`, `Signal`, `StrategyId`, `Direction`, `Trade`, `Metrics`, `BacktestResult`. Both web app modules and strategy types align to this file.

**Charting:** `ChartPanel` and `GridChart` both use Lightweight Charts v5. Grid lines use `series.createPriceLine()` — labels hidden when count > 16. The equity chart in `Results.tsx` rebases both strategy and buy-and-hold to **cumulative % return starting at 0**.

**Path alias:** `@/*` → `src/*` (configured in both `tsconfig.json` and `vite.config.ts`).

## Bot architecture

The bot has two entry points:
- **`server.ts`** (`npm run serve`) — the current entry. Express HTTP server on port 3001 + native HTML dashboard; manages multiple grid bots and signal bots. This is what `start_bot.bat` runs.
- **`index.ts`** (`npm start`) — legacy single-bot runner; reads `bot/grid.config.json` and starts one `GridBot` directly with no API or dashboard. Only useful for quick standalone testing without the dashboard.

The grid bot loop lives in `grid-bot.ts`.

### Grid bot loop (`grid-bot.ts`)

1. **Init** — fetch asset metadata, cancel existing orders.
2. **Subscribe before placing** — `userFills` WS opened first so fast fills aren't missed.
3. **Place initial grid** — buy below price, sell above. One order per line.
4. **React to fills** — buy fill → sell one line up; sell fill → buy one line down.
5. **P&L** — taken from Hyperliquid's `closedPnl` field directly; do **not** reimplement FIFO matching.

### Signal bot subsystem (`signal-bot.ts`)

Multiple `SignalBot` instances run concurrently. Each polls Binance every 30 s, evaluates its strategy on the most-recent **closed** bar (index `candles.length - 2`), and fires a market order on a fresh signal. Key behaviors:

- **Priming** — the first tick records the current closed bar; signals only fire on bars that close *after* priming, preventing stale signals on startup.
- **Ensemble mode** — runs N strategies and requires ≥ threshold votes for a signal. Vote breakdown stored in `lastVotes`.
- **MTF filter** — fetches the higher timeframe and verifies the last HTF signal agrees before entering. Skips the trade if they conflict.
- **Daily loss circuit-breaker** — snapshots equity at UTC midnight; pauses new entries for the rest of the day once the drawdown exceeds `dailyLossLimitPct`.
- **Budget mode** — when `investment + leverage` are set instead of `size`, computes `size = (investment × leverage) / currentPrice` once per session at startup.
- **Bracket orders** — after each fill, places TP and SL stop-limit orders from the actual fill price. Stale bracket orders from the previous trade are cancelled before the next entry.
- **Persistence** — in single-tenant mode, state files live in `bot/signal-bots/<id>.json`. In multi-user mode, per-user state lives in `bot/data/<userId>/signal-bots/<id>.json`. On server restart, `maybeAutostartSignalBots()` resumes every bot that was running when the process exited.
- **Multi-user** — `SignalBot` accepts `userId` and `creds` (decrypted `EnvConfig`). All `placeOrder`/`getAccountState` calls pass the user's creds; bot IDs are UUIDs to prevent cross-user registry collisions.

### HTTP server (`server.ts`)

Express server on port 3001. Serves the React SPA at `GET /` from `bot/public/` (the built Vite output). API surface:

| Route | Purpose |
|---|---|
| `POST /auth/register` | Create account (multi-user mode only; gated by `ALLOWED_EMAILS` if set) |
| `POST /auth/login` | Sign in, get JWT |
| `GET /auth/me` | Returns 404 (single-tenant), 401 (not logged in), or current user |
| `GET /settings/credentials` | Read user's saved HL address + network |
| `PUT /settings/credentials` | Save/update HL agent key + address — validates format + live HL approval before saving |
| `GET /admin/users` | List all users (admin only) |
| `DELETE /admin/users/:id` | Remove user (admin only) |
| `POST /admin/users/:id/kill-bots` | Stop all bots for a user (admin only) |
| `GET /api/bots` | List grid bots |
| `POST/PUT/DELETE /api/bots/:id` | CRUD grid bot configs |
| `POST /api/bots/:id/start\|stop` | Lifecycle |
| `GET /api/signal/bots` | List signal bots |
| `POST /api/signal/bots` | Create signal bot |
| `GET/PUT/DELETE /api/signal/bots/:id` | CRUD |
| `POST /api/signal/bots/:id/start\|stop` | Lifecycle |
| `GET /api/signal/bots/:id/logs\|trades` | Per-bot data |
| `GET /api/strategies` | Strategy catalog (used by Backtester + Signal Bots UI) |
| `GET /api/account` | Account state + open positions (now includes liquidationPx, leverage, marginUsed, positionValue, markPx) |
| `GET /api/positions/:asset/brackets` | Read pending SL/TP orders for a specific asset |
| `GET /api/positions/sources` | Map open positions to their owning bot (signal/grid/manual) for the Trade page source-chips |
| `POST /api/order` | Market or limit order with optional TP/SL |
| `POST /api/close` | Cancel TP/SL stops then close position |
| `GET /api/logs/stream` | SSE stream of all bot log lines |

**Security stack (production):**
- `helmet()` with strict CSP allowing only Hyperliquid + Binance origins for `connect-src`
- `express-rate-limit` on all `/auth/*` routes
- `app.set('trust proxy', 1)` so rate-limit sees the real client IP behind Cloudflare
- Bind to `127.0.0.1` by default (set `HOST=0.0.0.0` to expose directly — not needed behind the tunnel)
- Multi-user mode: JWT from `requireAuth` middleware gates all `/api/*` and `/settings/*` routes
- Single-tenant mode: `BOT_API_TOKEN` gates `/api/*` (`Authorization: Bearer <token>`; SSE accepts `?token=` query param)

### `trade.ts` and `limits.ts`

`trade.ts` is a shared order execution layer. Both the grid bot and signal bots use it. Exposes `placeOrder` (market or limit, with optional `tpPct`/`slPct`/`tpPrice`/`slPrice` bracket orders), `closePosition` (reduce-only market), `cancelAssetOrders`, and `getAccountState`.

`limits.ts` enforces hard safety caps before any order is placed: `MAX_TRADE_NOTIONAL_USD`, `ALLOWED_ASSETS` allow-list, and `MAX_TRADES_PER_HOUR` rolling rate limit. Every executed order is appended as NDJSON to `bot/trade-audit.log`.

### `bot/src/strategy/`

`indicators.ts` and `strategies.ts` here mirror the web app's `src/lib/` equivalents. The signal logic must stay **identical** to the web app so the bot trades exactly what the backtester shows. `market-data.ts` polls Binance REST (no WS) for the most recent N candles.

### Price/size rounding (`hyperliquid.ts`)

Hyperliquid perps cap prices at 5 significant figures AND `(6 - szDecimals)` decimal places. `roundPrice()` enforces both. `roundSize()` clamps to `szDecimals`. Skipping these → silent order rejections.

### Order status narrowing

`exchange.order(...)` can return `"waitingForFill"` / `"waitingForTrigger"` (strings), `{ resting }`, or `{ filled }`. First check must be `typeof status === 'string'` before any `'resting' in status` lookup.

### Security model

Bot signs with an **API agent wallet** — a separate key generated in Hyperliquid UI. Agent can place/cancel orders but cannot withdraw. Never use a real funded wallet's key.

### Phase B — Multi-user mode (`MULTI_USER=true`)

Opt-in feature. When absent (default), the server behaves exactly as before (single-tenant).

**New files:**
- `bot/src/users.ts` — SQLite DB at `bot/data/users.db`. Schema: `id, email, password_hash, is_admin, created_at, hl_key_enc, hl_user, hl_network`. Functions: `createUser`, `findUserByEmail`, `findUserById`, `verifyPassword`, `listUsers`, `deleteUser`, `userCount`, `saveHLCredentials`, `loadUserCreds`. Encryption helpers: `encryptSecret` / `decryptSecret` (AES-256-GCM). Validation: `validateAgentKeyFormat` (0x + 64 hex), `validateHLUserFormat` (0x + 40 hex), `verifyAgentOnHL` (hits HL `extraAgents` endpoint to confirm the agent key is approved on the user's account before saving).
- `bot/src/auth.ts` — `MULTI_USER` flag, `JwtPayload` interface, `signToken`, `verifyToken`, `requireAuth`, `requireAdmin` middleware (both are no-ops when `!MULTI_USER`). Augments `Express.Request` with `req.user?: JwtPayload`.
- `bot/src/migrate.ts` — `runMigrationIfNeeded(ownerId)` copies `bot/configs/*.json` and `bot/signal-bots/*.json` to `bot/data/<ownerId>/`. Idempotent (marker file `bot/data/.migrated`).

**Key behaviour:**
- First registered user always gets admin. `OWNER_EMAIL` also grants admin to any user with that email.
- `ALLOWED_EMAILS` (comma-separated) — if set, only listed emails can register. Returns 403 otherwise. Currently locked to `ken2540@gmail.com`.
- Migration runs inside `/auth/register` when `isFirstUser && isAdmin` (not at boot, because the DB is empty at first run).
- `PUT /settings/credentials` validates the agent key format, derives the agent address via viem, calls `verifyAgentOnHL()` to confirm it's an approved agent on the user's HL account, saves the encrypted key, then immediately calls `bot.updateCreds(newCreds)` on every running signal bot for that user. Bad pastes fail in <1s with a clear error.
- `saveHLCredentials(userId, agentKey, hlUser, network)` — if `agentKey` is blank, only `hl_user` and `hl_network` are updated; existing encrypted key is preserved.
- Per-user data directories: `bot/data/<userId>/configs/` and `bot/data/<userId>/signal-bots/`.
- Audit log per user: `bot/data/<userId>/trade-audit.log` (wired in `limits.ts`; note callers in `trade.ts` don't yet pass `userId` so entries currently go to the global log).

## Conventions

- **No comments that restate the code.** Comments explain *why* (e.g. the `pos()` TS-narrowing workaround, the priming logic), never *what*.
- **TypeScript strict + noUnusedLocals/Parameters** is on in both apps. Unused vars will fail the build.
- The grid math is duplicated between `src/lib/grid.ts` (web) and `bot/src/config.ts → buildLines` (bot). This is intentional — the bot stays a separate package without a workspace setup.
- The strategy signal logic is duplicated between `src/lib/strategies.ts` (web) and `bot/src/strategy/strategies.ts` (bot). They **must stay in sync** — the bot trades what the backtester shows.
- **`progress.md` at the repo root is a current-state snapshot, not a changelog.** Max ~200 lines. When something changes, **edit the relevant section in place** so it reflects how the project is *now*. Do not append dated entries for every fix — git history is the changelog. Sections to keep: what the project is, current architecture, what's working, what's pending, how to run, gotchas. Trim stale content aggressively. Read it at the start of every session.
- **Always end every work session with a ready-to-paste deploy block.** After any task that changes files the live site depends on (web app OR bot), print the exact commands the user must run so they can copy-paste without thinking:

```
# ── Local ────────────────────────────────────────────────
npm run build                  # only if anything under src/ changed (writes to bot/public/)
git add . && git commit -m "<describe change>" && git push origin master

# ── On VPS ───────────────────────────────────────────────
# SSH → root@68.183.184.170
cd ~/ken-trading && ./deploy.sh
```

`./deploy.sh` handles pull (via `git reset --hard`), conditional `npm install`, and `pm2 restart trading-bot`. Skip `npm run build` if no `src/` files changed. There is no separate Vercel deploy — the SPA ships in the same git push as the bot.
