# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two independent apps share this repo:

- **Web app** (root `src/`, `index.html`, `vite.config.ts`) — React + Vite + Tailwind + Lightweight Charts. Deployed to Vercel as `garlic-trading.vercel.app`. Two pages: a client-side strategy backtester and a grid optimizer.
- **Bot** (`bot/`) — Node + TypeScript live grid trading bot for Hyperliquid (testnet + mainnet). Uses the `@nktkas/hyperliquid` SDK with a `viem` agent wallet.

The web app's optimizer produces a grid spec (range, count, mode, spacing) that you can paste into `bot/grid.config.json` to run live.

## Commands

### Web app (run from repo root)

```bash
npm install
npm run dev               # Vite dev server (default http://localhost:5173)
npm run build             # tsc --noEmit && vite build  (must pass before deploy)
npx vercel --prod --yes   # deploy to production (project: garlic-trading)
```

### Bot (run from `bot/`)

```bash
cd bot
npm install
npm start                 # runs tsx src/index.ts — the live bot
npm run build             # tsc --noEmit (type-check only, no JS emitted)
```

The bot reads `bot/.env` for keys (`HL_AGENT_PRIVATE_KEY`, `HL_USER_ADDRESS`, `HL_NETWORK`) and `bot/grid.config.json` for the grid spec. See `bot/README.md` for the testnet account setup walkthrough.

## Web app architecture

**Data flow (Backtester page):** `App.tsx` owns `symbol/timeframe/symbols` (lifted so both pages share the selection). `BacktesterPage` fetches candles from Binance, subscribes to a live kline WebSocket when the date range includes today, and runs the backtest in a `useMemo` so any control change re-runs instantly.

**Data flow (Grid page):** `GridPage` fetches the most recent ~1000 candles, slices the last `lookback` bars as the optimization window, and calls `optimizeGrid()`. The result drives `GridChart` (price lines for grid levels) and `GridStats` (the metrics table).

**Key modules in `src/lib/`:**

- `binance.ts` — public Binance data endpoints (REST + WS). No API key. `fetchKlines` paginates forward in 1000-bar chunks for long date ranges (capped at `MAX_BARS = 6000`).
- `indicators.ts` — math primitives (EMA, RMA, ATR, Bollinger, Supertrend, PSAR, Stochastic, CCI, Williams %R, Donchian). All NaN-tolerant — early bars where the indicator can't yet be computed return NaN, downstream code treats NaN as "no signal."
- `strategies.ts` — wraps indicators into 12 named strategies grouped by category (Trend / Oscillator / Volatility). Each strategy returns `{ signals, mainLines, subPane? }` so the same shape feeds the backtester and the chart overlays.
- `backtest.ts` — long/short/both backtest with an equity-fraction model. Shorts are simulated as `afterFee * (2 - price/entryPrice)` clamped to 0 (liquidation). Note the `pos()` function pattern at the top of `runBacktest` — it's there to defeat TypeScript's over-narrowing of a `let position` mutated only inside closures.
- `grid.ts` — `optimizeGrid(window, params)` sweeps grid counts from `minGrids` to `maxGrids` and picks the one with the highest **total** PnL (realized + unrealized). The simulator walks each candle as `[prevClose, open, low, high, close]` (or the reverse for down bars) to catch intrabar crossings. Each cell holds at most one unit: it buys when price crosses its lower line going down, sells when price crosses its upper line going up. `analyzeMarket` computes a Kaufman efficiency ratio + ATR% as the grid-suitability score.

**Charting:** `ChartPanel` and `GridChart` both use Lightweight Charts v5. Grid lines are drawn via `series.createPriceLine()` — labels are hidden when count > 16 to avoid clutter. The backtester's equity chart in `Results.tsx` rebases both strategy and buy-and-hold to **cumulative % return starting at 0** so they share one scale.

**Path alias:** `@/*` → `src/*` (configured in both `tsconfig.json` and `vite.config.ts`).

## Bot architecture

The bot is a single long-running process. `index.ts` wires it up; the actual loop lives in `grid-bot.ts`:

1. **Init** — fetch asset metadata (index, szDecimals, current price), cancel any existing orders on the asset.
2. **Subscribe before placing** — `userFills` WS subscription is opened first so the bot can't miss a fast fill that happens immediately after placement.
3. **Place initial grid** — for every grid line, buy if below current price, sell if above. One order per line.
4. **React to fills** — on each fill, place an opposite order one line away (buy fill → sell one line up; sell fill → buy one line down).
5. **P&L** — taken directly from Hyperliquid's `closedPnl` field on each fill. This means fees, funding, and partial-fill quirks are all accounted for the same way the web UI shows them — do **not** reimplement FIFO matching locally.

**Price/size rounding** (`hyperliquid.ts`) — Hyperliquid perps cap prices at 5 significant figures AND `(6 - szDecimals)` decimal places. `roundPrice()` enforces both. Sizes use `roundSize()` to clamp to `szDecimals`. Skipping these → silent order rejections.

**Order status union** — `exchange.order(...)` returns statuses that can be the string literals `"waitingForFill"` / `"waitingForTrigger"`, or `{ resting }`, or `{ filled }`. The SDK already filters out error statuses (it throws). When narrowing, the first check must be `typeof status === 'string'` before any `'resting' in status` lookup.

**Security model** — the bot signs with an **API agent wallet** (a separate private key generated in Hyperliquid UI). The agent can place/cancel orders but cannot withdraw. Never use a real funded wallet's key here; only an agent key.

## Conventions

- **No comments that restate the code.** Existing code already follows this — comments explain *why* (e.g. the `pos()` function's TS-narrowing workaround), never *what*.
- **TypeScript strict + noUnusedLocals/Parameters** is on in both apps. Unused vars will fail the build.
- The grid math is duplicated between `src/lib/grid.ts` (web) and `bot/src/config.ts → buildLines` (bot). This is intentional — the bot stays a separate package and we don't want to add a workspace setup just to share one function.
