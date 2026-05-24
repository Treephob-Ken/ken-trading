# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Live deployment

| Component | URL | Host |
|---|---|---|
| Web app (backtester + grid optimizer) | https://garlic-trading.vercel.app | Vercel |
| Bot server + dashboard | https://bot.garlic-trading.net | DigitalOcean SGP1 (68.183.184.170) |

### High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                             │
└────────────┬───────────────────────────────┬────────────────┘
             │                               │
    garlic-trading.vercel.app       bot.garlic-trading.net
    (React web app)                 (Cloudflare Tunnel)
             │                               │
        Vercel CDN               Cloudflare Edge → cloudflared
                                             │
                                    VPS: localhost:3001
                                    Express server (pm2)
                                    ┌────────────────────┐
                                    │  Multi-user mode   │
                                    │  SQLite users.db   │
                                    │  Per-user bot data │
                                    │  JWT auth (7d)     │
                                    └────────────────────┘
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

# Restart bot (e.g. after code update)
cd ~/ken-trading && git pull && cd bot && npm install
pm2 restart trading-bot

# Restart tunnel
pm2 restart cloudflare-tunnel

# SSH in
ssh root@68.183.184.170
```

### Updating the VPS after a code change

```bash
# Local: push changes
git add . && git commit -m "..." && git push origin master

# On VPS:
cd ~/ken-trading && git pull
cd bot && npm install   # only if package.json changed
pm2 restart trading-bot
```

## Repository layout

Two independent apps share this repo:

- **Web app** (root `src/`, `index.html`, `vite.config.ts`) — React + Vite + Tailwind + Lightweight Charts. Deployed to Vercel as `garlic-trading.vercel.app`. Three pages in a left icon-rail nav: Strategy Backtester, Grid Optimizer, and Signal Trader (`src/pages/SignalTraderPage.tsx`). Signal Trader is wired in `App.tsx` but is only functional when a bot URL is reachable — on Vercel with no bot it shows a connection-error state.
- **Bot** (`bot/`) — Node + TypeScript live trading bot for Hyperliquid (testnet + mainnet). Runs two bot types: a grid bot (`grid-bot.ts`) and one or more signal bots (`signal-bot.ts`). Both are managed through an Express HTTP server (`server.ts`) on port 3001 that also serves the native-HTML dashboard at `bot/dashboard/index.html`.

The web app's optimizer produces a grid spec (range, count, mode, spacing) that you can paste into `bot/grid.config.json` to run live.

## Commands

### Web app (run from repo root)

```bash
npm install
npm run dev               # Vite dev server (default http://localhost:5173)
npm run build             # tsc --noEmit && vite build  (must pass before deploy)
npx vercel --prod --yes   # deploy to production (project: garlic-trading)
```

Set `VITE_BOT_URL=https://bot.garlic-trading.net` in Vercel env vars so the hosted Signal Trader page points at the remote bot.

### Bot (run from `bot/`)

```bash
cd bot
npm install
npm run serve             # runs tsx src/server.ts — HTTP server + dashboard on port 3001 (use this)
npm start                 # runs tsx src/index.ts — legacy standalone single grid-bot (no dashboard, no API)
npm run build             # tsc --noEmit (type-check only, no JS emitted)
```

The bot server runs locally but is exposed to the internet (and to the hosted web app at `garlic-trading.vercel.app`) via a **Cloudflare Tunnel** at `https://bot.garlic-trading.net`. To start the bot remotely accessible:

```bash
# In one terminal — start the bot server (use serve, not start)
cd bot && npm run serve

# In another terminal — start (or keep running) the tunnel
cloudflared tunnel run <tunnel-name>
```

The tunnel forwards HTTPS at `bot.garlic-trading.net` → `http://localhost:3001`. Add `bot.garlic-trading.net` to `ALLOWED_ORIGINS` in `bot/.env` so the CORS policy allows the hosted dashboard. For extra security, put Cloudflare Access in front of the tunnel — then leave `BOT_API_TOKEN` unset and let Access handle authentication. Without Access, set `BOT_API_TOKEN` and enter it in the Signal Trader UI's "API Token" field.

The bot reads `bot/.env` for keys and settings:
- `HL_AGENT_PRIVATE_KEY`, `HL_USER_ADDRESS`, `HL_NETWORK` — required in single-tenant mode (see `bot/README.md`)
- `ALLOWED_ORIGINS` — comma-separated origins the CORS policy allows beyond localhost
- `BOT_API_TOKEN` — if set, every `/api/*` request must carry `Authorization: Bearer <token>` (single-tenant only; ignored when `MULTI_USER=true`)
- `MAX_TRADE_NOTIONAL_USD`, `ALLOWED_ASSETS`, `MAX_TRADES_PER_HOUR` — server-side safety caps (see `limits.ts`)
- `MULTI_USER=true` — opt-in multi-user mode; adds login, per-user HL creds, data isolation (see Phase B below)
- `OWNER_EMAIL` — if set, the first user who registers with this email gets admin privileges
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

Express server on port 3001. Serves the native-HTML dashboard at `GET /`. API surface:

| Route | Purpose |
|---|---|
| `POST /auth/register` | Create account (multi-user mode only) |
| `POST /auth/login` | Sign in, get JWT |
| `GET /auth/me` | Returns 404 (single-tenant), 401 (not logged in), or current user |
| `GET /settings/credentials` | Read user's saved HL address + network |
| `PUT /settings/credentials` | Save/update HL agent key + address (multi-user only) |
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
| `GET /api/strategies` | Strategy catalog (used by Signal Trader UI) |
| `GET /api/account` | Account state + open position |
| `POST /api/order` | Market or limit order with optional TP/SL |
| `POST /api/close` | Cancel TP/SL stops then close position |
| `GET /api/logs/stream` | SSE stream of all bot log lines |

CORS: only localhost by default. For remote access, set `ALLOWED_ORIGINS`. In single-tenant mode, `BOT_API_TOKEN` gates all `/api/*` requests (`Authorization: Bearer <token>`; SSE accepts `?token=` query param). In multi-user mode, JWT from `requireAuth` middleware is used instead.

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
- `bot/src/users.ts` — SQLite DB at `bot/data/users.db`. Schema: `id, email, password_hash, is_admin, created_at, hl_key_enc, hl_user, hl_network`. Functions: `createUser`, `findUserByEmail`, `findUserById`, `verifyPassword`, `listUsers`, `deleteUser`, `userCount`, `saveHLCredentials`, `loadUserCreds`. Encryption helpers: `encryptSecret` / `decryptSecret` (AES-256-GCM).
- `bot/src/auth.ts` — `MULTI_USER` flag, `JwtPayload` interface, `signToken`, `verifyToken`, `requireAuth`, `requireAdmin` middleware (both are no-ops when `!MULTI_USER`). Augments `Express.Request` with `req.user?: JwtPayload`.
- `bot/src/migrate.ts` — `runMigrationIfNeeded(ownerId)` copies `bot/configs/*.json` and `bot/signal-bots/*.json` to `bot/data/<ownerId>/`. Idempotent (marker file `bot/data/.migrated`).

**Key behaviour:**
- First registered user always gets admin. `OWNER_EMAIL` also grants admin to any user with that email.
- Migration runs inside `/auth/register` when `isFirstUser && isAdmin` (not at boot, because the DB is empty at first run).
- `PUT /settings/credentials` saves the encrypted key and immediately calls `bot.updateCreds(newCreds)` on every running signal bot for that user.
- `saveHLCredentials(userId, agentKey, hlUser, network)` — if `agentKey` is blank, only `hl_user` and `hl_network` are updated; existing encrypted key is preserved.
- Per-user data directories: `bot/data/<userId>/configs/` and `bot/data/<userId>/signal-bots/`.
- Audit log per user: `bot/data/<userId>/trade-audit.log` (wired in `limits.ts`; note callers in `trade.ts` don't yet pass `userId` so entries currently go to the global log).

## Conventions

- **No comments that restate the code.** Comments explain *why* (e.g. the `pos()` TS-narrowing workaround, the priming logic), never *what*.
- **TypeScript strict + noUnusedLocals/Parameters** is on in both apps. Unused vars will fail the build.
- The grid math is duplicated between `src/lib/grid.ts` (web) and `bot/src/config.ts → buildLines` (bot). This is intentional — the bot stays a separate package without a workspace setup.
- The strategy signal logic is duplicated between `src/lib/strategies.ts` (web) and `bot/src/strategy/strategies.ts` (bot). They **must stay in sync** — the bot trades what the backtester shows.
- **Log every fix and change to `progress.md`** at the repo root. After completing any non-trivial task (bug fix, feature, refactor), append an entry with the date, what was broken/missing, what was changed, and any gotchas. This file is the running history of decisions and is required reading before touching unfamiliar code.
