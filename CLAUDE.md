# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent apps share this repo:

- **Web app** (root `src/`, `index.html`, `vite.config.ts`) — React + Vite + Tailwind + Lightweight Charts. Deployed to Vercel as `garlic-trading.vercel.app`. Two routed pages: a client-side strategy backtester and a grid optimizer. A third page (`src/pages/SignalTraderPage.tsx`) exists but is **not yet wired into `App.tsx`** — it's a React UI that talks to the bot's REST API.
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
# In one terminal — start the bot server
cd bot && npm start

# In another terminal — start (or keep running) the tunnel
cloudflared tunnel run <tunnel-name>
```

The tunnel forwards HTTPS at `bot.garlic-trading.net` → `http://localhost:3001`. Add `bot.garlic-trading.net` to `ALLOWED_ORIGINS` in `bot/.env` so the CORS policy allows the hosted dashboard. For extra security, put Cloudflare Access in front of the tunnel — then leave `BOT_API_TOKEN` unset and let Access handle authentication. Without Access, set `BOT_API_TOKEN` and enter it in the Signal Trader UI's "API Token" field.

The bot reads `bot/.env` for keys and settings:
- `HL_AGENT_PRIVATE_KEY`, `HL_USER_ADDRESS`, `HL_NETWORK` — required (see `bot/README.md`)
- `ALLOWED_ORIGINS` — comma-separated origins the CORS policy allows beyond localhost
- `BOT_API_TOKEN` — if set, every `/api/*` request must carry `Authorization: Bearer <token>`
- `MAX_TRADE_NOTIONAL_USD`, `ALLOWED_ASSETS`, `MAX_TRADES_PER_HOUR` — server-side safety caps (see `limits.ts`)

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
- **Persistence** — each bot's config and `running` state is written to `bot/signal-bots/<id>.json`. On server restart, `maybeAutostartSignalBots()` resumes every bot that was running when the process exited.

### HTTP server (`server.ts`)

Express server on port 3001. Serves the native-HTML dashboard at `GET /`. API surface:

| Route | Purpose |
|---|---|
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

CORS: only localhost by default. For remote access, set `ALLOWED_ORIGINS`. With `BOT_API_TOKEN` set, requests must carry `Authorization: Bearer <token>` (SSE stream accepts `?token=` query param instead).

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

## Conventions

- **No comments that restate the code.** Comments explain *why* (e.g. the `pos()` TS-narrowing workaround, the priming logic), never *what*.
- **TypeScript strict + noUnusedLocals/Parameters** is on in both apps. Unused vars will fail the build.
- The grid math is duplicated between `src/lib/grid.ts` (web) and `bot/src/config.ts → buildLines` (bot). This is intentional — the bot stays a separate package without a workspace setup.
- The strategy signal logic is duplicated between `src/lib/strategies.ts` (web) and `bot/src/strategy/strategies.ts` (bot). They **must stay in sync** — the bot trades what the backtester shows.
- **Log every fix and change to `progress.md`** at the repo root. After completing any non-trivial task (bug fix, feature, refactor), append an entry with the date, what was broken/missing, what was changed, and any gotchas. This file is the running history of decisions and is required reading before touching unfamiliar code.
