# Progress

## What we've built

### Phase 1 — Backtester + Grid Optimizer (web app)
Initial React + Vite + Tailwind app deployed at **garlic-trading.vercel.app**.

- **Backtester page**: fetch Binance candles, run 12 strategies client-side, show signals on chart with equity curve
- **Grid page**: sweep grid counts over a lookback window, pick best PnL, show grid lines on price chart with stats table
- 12 strategies across Trend / Oscillator / Volatility categories (MACD, EMA crossover, Bollinger, RSI, Supertrend, PSAR, Stochastic, CCI, Williams %R, Donchian, CCI, Elliott Wave)

---

### Phase 2 — Hyperliquid Grid Bot (bot/)
Live grid trading bot on Hyperliquid perps (testnet + mainnet).

- Signs orders with an API agent wallet via `@nktkas/hyperliquid` + `viem`
- Places a full grid of limit orders on startup, then reacts to fills: buy fill → sell one line up; sell fill → buy one line down (perpetual cycle)
- Correct price/size rounding for Hyperliquid's 5 sig-fig + szDecimals constraints
- `bot/grid.config.json` → paste JSON exported from the Grid page to configure the bot

---

### Phase 3 — Multi-bot + Budget Sizing + SL/TP (current)

#### Bot (bot/)

**Multi-bot architecture**
- Per-bot configs stored in `bot/configs/<id>.json` (auto-migrates legacy `grid.config.json` on first boot)
- REST API: `GET/POST /api/bots`, `GET/PUT /api/bots/:id/config`, `DELETE /api/bots/:id`, `POST /api/bots/:id/start|stop`
- Multiple bots run concurrently on different assets/configs in the same process

**Budget-based position sizing**
- Set `investment` (USDC) + `leverage` instead of a raw `orderSize`
- Formula: `orderSize = (investment × leverage × 0.5) / (gridCount × upper)`
- Sizes automatically derived at bot start; no manual calculation needed

**Exchange-side SL/TP triggers**
- On start, bot places two reduce-only stop orders on Hyperliquid:
  - **SL**: sell stop below `stopLossPrice` — fires when price drops through
  - **TP**: buy stop above `takeProfitPrice` — fires when price breaks up
- **Key fix**: both use `tpsl: 'sl'` in the SDK; direction is implied by `side` (not by the `tpsl` field). Using `tpsl: 'tp'` + buy caused Hyperliquid to fire immediately because it interprets that as "take profit for a short = price drops below trigger"
- Live stats expose: SL/TP distance %, liquidation price, `slUnreachable` flag (SL is below liquidation level)

**Dashboard rewrite (`bot/dashboard/index.html`)**
- Bot list sidebar with colored status dots (green pulse = running)
- Per-bot config editor: all fields including budget, leverage, SL price, TP price, trigger price
- Safety panel: SL / TP / Liquidation tiles with distance indicators and ON EXCHANGE / BOT-ONLY badges
- Log pane: 3-column layout (timestamp | level dot | message), filter buttons (All / Fills / Issues / Info), jump-to-bottom button, scrollable within viewport
- SSE stream: live logs pushed to dashboard without polling

**Per-bot scoped logger**
- `createLogger(botId)` returns a logger that tags every line with the bot ID
- `getLogBuffer(botId)` for history; `onLog(fn)` for SSE listeners

---

#### Web app (src/)

**Markov regime detection (`src/lib/markov.ts`)**
- 3 states: Bull / Bear / Sideways — classified by rolling N-bar return vs ±threshold
- MLE transition matrix from observed state sequences
- Stationary distribution via power iteration (long-run regime mix)
- Conviction score: `P(Bull) − P(Bear)` from next-step forecast
- `recommendStrategies(regime)` maps regime → ranked list of best strategies
- `isGoodForGrid(regime)` signals whether current market suits grid trading

**RegimePanel component (`src/components/RegimePanel.tsx`)**
- Colored header band matching regime (green / red / amber)
- Conviction bar: diverging ±100% bar
- Next-candle probability bar: stacked Bull/Sideways/Bear segments
- Long-run stationary mix bar
- Transition matrix table with current-state row highlighted
- Strategy recommendation buttons — click to apply directly to backtester

**BacktesterPage improvements**
- `MAX_BARS` raised from 6 000 → 20 000 (more history)
- Amber warning banner when data is capped at the limit
- RegimePanel shown below chart (≥30 candles)
- Strategy apply from RegimePanel wired to backtester strategy selector

**GridPage improvements**
- Regime suitability banner above chart (green = grid-friendly, amber = mismatch + reason)
- Export JSON always includes `stopLossPrice` and `takeProfitPrice` (no toggle needed)
- Budget + leverage inputs in the deploy card
- Optional trigger price for conditional order entry

**ChartPanel drawing tools (`src/components/ChartPanel.tsx`)**
- Toolbar with "Horizontal line" tool (active), "Trend line" + "Fib" placeholders, "Clear (N)" button
- Click chart in line mode → places a persistent `createPriceLine` at that price
- Lines persist across candle reloads (stored in `hLines` state outside chart lifecycle)
- Stable chart lifecycle: 4 separate `useEffect`s avoid full rebuilds on every input change

**NumberInput component (`src/components/NumberInput.tsx`)**
- Smooth typing: local string buffer while focused, only clamps/syncs on blur
- Prevents snap-to-min when user clears field mid-edit
- Arrow-key stepping, `inputMode="decimal"` for mobile
- Used in Controls (capital, fee, SL%, TP%, strategy params) and GridControls (all numeric fields)

---

---

### Phase 4 — Live Auto-Trading & Indicator Triggering (current)
Connecting React web app's live indicator signals (BUY/SELL) to the local trading bot for instant trade execution.

#### Bot (bot/)
- **Direct Trade Execution Endpoint**: Added `POST /api/trade` to place market-like orders 5% past mid-price using the Immediate-or-Cancel (`Ioc`) time-in-force for instant execution.
- **Custom CORS Support**: Permitted frontend calls from `localhost:5173` without extra npm dependency installs.

#### Web App (src/)
- **LiveSignalController component**: Built a premium sidebar execution card with connectivity polling, manual buy/sell order placement, and live logs.
- **Auto-Trade Toggle Switch**: Listens to Binance websocket events on candle close, extracts stable strategy signals from the backtester, and auto-routes orders to the bot.
- **Go Live Toggle Button**: Added a dedicated toggle button inside `Controls.tsx` that instantly clears the End Date to activate websocket mode, displaying a green pulsing dot.
- **Mock Signal Simulator**: Interactive triggers ("Simulate BUY" / "Simulate SELL") to verify the auto-trade `useEffect` hook and safety checks without waiting for candle close events.

#### System Shortcuts & Batch Scripts
- **Bot Launcher**: `start_bot.bat` + `Hyperliquid Bot.lnk` desktop shortcut (opens bot panel and starts server).
- **Web App Launcher**: `start_website.bat` + `Crypto Strategy Lab.lnk` desktop shortcut (opens `http://localhost:5173` and starts Vite dev server).

---

### Phase 5 — Signal Trader: autonomous indicator bot + dedicated page

Re-architected the Phase 4 live-trading feature. The strategy now runs **inside the
bot** (autonomous, server-side) instead of in the browser, and it has its own page
instead of being bolted onto the Backtester sidebar. The browser is now purely a
view/control layer — closing and reopening the tab re-fetches all state from the bot.

#### Bot (bot/) — the signal engine

- **Strategy port (`bot/src/strategy/`)** — `indicators.ts` and `strategies.ts` ported
  from the web app so the bot evaluates all 13 strategies identically to the backtester;
  `market-data.ts` fetches Binance candles (REST).
- **`bot/src/signal-bot.ts`** — the `SignalBot` engine. Every 30s it fetches candles,
  evaluates the configured strategy on the **last closed bar**, and fires a market order
  on a fresh BUY/SELL signal (respecting a cooldown and a buy/sell/both direction filter).
  Config + running state persist to `signal-bot.json`; the bot **auto-resumes** if it was
  running when the process last exited.
- **`bot/src/trade.ts`** — hardened trade module: input validation, slippage cap
  (IOC limit at most N% past mid, default 2%, max 10%), reused clients, `getAccountState`.
- **API** — `GET /api/strategies` (strategy catalog), `GET /api/account` (network +
  balance + position), and `/api/signal/{status,config,start,stop,logs}`.
- **Security** — CORS tightened from wildcard `*` to localhost-only origins, so a public
  website can never reach the trade API.

#### Web app (src/)

- **New "Signal Trader" page (`src/pages/SignalTraderPage.tsx`)** — the 3rd tab.
  Configure symbol / timeframe / strategy + params / size / slippage / cooldown /
  direction; Save, Start, Stop; live status (last signal, trades executed, errors);
  account + position panel; manual one-click Buy/Sell; activity log. All state is read
  back from the bot, so reopening the tab always shows the latest.
- **`src/lib/env.ts`** — `IS_LOCAL` environment gate. On Vercel the page shows a
  "local only" explanation (no bot trigger); on localhost it has full control.
- **ChartPanel** — removed the non-working drawing tools; added a **Hide Buy/Sell**
  marker toggle and a **Latest Price** jump button.
- **Backtester sidebar** — fixed a scroll glitch (sticky sidebar now scrolls internally);
  removed the old `LiveSignalController` and mock-signal simulator (superseded).

---

### Phase 6 — Remote Access, VPS Hosting, & Security Hardening (current)

Connecting and securing the local bot for 24/7 VPS hosting and remote control from a hosted/published dashboard.

#### Bot (bot/)

- **Strict CORS & SameSite Cookie Credentials**:
  - Restricts origins to `localhost` by default, but allows arbitrary domains/origins via the `ALLOWED_ORIGINS` environment variable.
  - Reflects `Access-Control-Allow-Credentials: true` to support Zero Trust (e.g. Cloudflare Access) authentication cookies.
- **API Token Shared-Secret Protection**:
  - Added optional `BOT_API_TOKEN` environment variable security gate.
  - Requests to `/api/*` are blocked unless authenticated with `Authorization: Bearer <token>` or a `?token=` query parameter (allowing EventSource SSE streams).
- **Server-Side Safety Caps (`bot/src/limits.ts`)**:
  - Enforced strict trade execution limits server-side to limit financial exposure:
    - `MAX_TRADE_NOTIONAL_USD`: Caps the maximum allowed USD value of a single order.
    - `ALLOWED_ASSETS`: Configures a whitelist of tradeable perp assets.
    - `MAX_TRADES_PER_HOUR`: Limits the hourly trade frequency using a rolling 60-minute window.
- **NDJSON Trade Audit Log**:
  - Appends detailed records of every trade execution (both fills and failures) with timestamps, sizes, fill prices, and notional USD amounts to a persistent `bot/trade-audit.log`.
- **Live Asset Endpoint**:
  - Added `GET /api/assets` to query the active, non-delisted perp markets directly from Hyperliquid.

#### Web App & Dashboard (src/)

- **Dynamic Currency Picker**:
  - Replaced the free-text `Binance Symbol` field with a dropdown populated from the bot's dynamic asset list, ensuring only tradeable Hyperliquid assets are chosen.
- **Persistent Connection Credentials**:
  - Added `Bot URL` and `API Token` inputs stored locally in the browser (`localStorage`) so users can securely direct the dashboard to their VPS tunnel without exposing credentials.
  - Replaced the hard-coded localhost logic so the hosted dashboard (Vercel) can interact with remote bots.
- **Dropdown Readability & Styling Polish**:
  - Fixed native dropdown text rendering black-on-black or black-on-dark in Chrome/OS defaults by explicitly styling `<select>`, `<option>`, and `<optgroup>` with dark theme colors.
  - Added `color-scheme: dark` to the dashboard `:root` style.
  - Polished the dashboard buttons and panels with violet glow effects, shadow depth, and scale-down active click transitions.

#### Multiple concurrent signal traders + UX overhaul

- **Multi-bot signal manager (`bot/src/signal-bot.ts`)**:
  - Refactored the single signal bot into a multi-bot manager mirroring the grid-bot pattern — each `SignalBot` has its own id, config, scoped logger (`signal-<id>`), and persisted state file in `bot/signal-bots/`.
  - Legacy `signal-bot.json` is auto-migrated on first boot; every bot that was running resumes on restart.
  - New API: `/api/signal/bots` CRUD plus per-bot `start` / `stop` / `logs`.
- **Dashboard Signal Trader rebuilt** with a bot-list sidebar — add / select / delete bots, each with independent config, status, account, and activity log.
- **Searchable comboboxes** (vanilla JS, no library) for the strategy and 169-market currency pickers — type to filter, arrows + Enter to select. Replaces the native `<select>` (also fixes the black-text and long-scroll issues).
- **No-save Start flow** — the separate "Save Config" step is gone; config auto-saves, and **Start** applies the form after a confirmation popup. Manual Buy/Sell confirm first too. The form locks while a bot runs; the redundant Hyperliquid Asset field was removed (the currency picker is the single source).

---

### Phase 7 — Signal Trader position sizing + Vercel simplification (current)

#### Bot (`bot/src/trade.ts`, `bot/src/server.ts`)

- **`placeOrder()`** — unified market + limit order function with optional TP/SL.
  Market orders use IOC at mid ± slippage%. Limit orders use GTC at specified price.
  After a market fill, TP and SL reduce-only stops are placed automatically using
  the same `isMarket:true` + `tpsl:'tp'/'sl'` pattern as the grid bot.
- **`POST /api/order`** — new endpoint wrapping `placeOrder`; accepts `{ asset, side, size, orderType, limitPrice?, reduceOnly?, tpPrice?, slPrice?, maxSlippagePct? }`.

#### Dashboard (`bot/dashboard/index.html`)

- **Dedicated Trade tab removed** — the separate Trade page (with full order form,
  TP/SL sync, %, account panel, trade log) was removed at user request.
- **Manual Trade panel restored** to Signal Trader sidebar — simple asset + size +
  slippage inputs with Buy/Sell buttons calling `POST /api/trade` (market IOC).

#### Bot (`bot/src/signal-bot.ts`)

- **Budget mode**: `SignalBotConfig` now accepts optional `investment` (USDC) and `leverage` alongside the existing `size`. When both are provided, `size` is set to `0` (sentinel) and the effective trade size is computed on the first tick as `(investment × leverage) / currentPrice`. The size is frozen for the session so price drift doesn't silently change position size mid-run.
- Computed size is logged on start (e.g. `Budget mode: $500 × 3x = $1,500 notional / 42000 = 0.035714 ETH per trade`) and exposed in `SignalBotStatus.computedSize` for the UI.
- `parseSignalConfig` validates: either `investment + leverage` or a positive `size` must be present (not both required — override size is still optional).

#### Dashboard (`bot/dashboard/index.html`)

- **Trade Settings panel** split into "Position Sizing" and "Execution" sub-sections, mirroring the Grid Bot config panel.
- New inputs: **Budget (USDC)** and **Leverage**. The Order Size field becomes an optional override ("auto from budget" placeholder).
- **Live sizing preview box**: fetches the current Binance price once per selected currency; shows estimated order size, notional, and required margin. Falls back to formula-only when price is unavailable.
- While the bot is running, the preview box is replaced by the actual computed size (e.g. `Effective size 0.035714 ETH per trade (computed at start)`).
- Start confirmation dialog shows the sizing method (`$500 budget @ 3x leverage (size computed at start)` vs `fixed size 0.01 ETH`).
- Manual Buy/Sell buttons use `computedSize` from status when no override size is set.
- Strategy banner subtitle shows the effective size/trade when running.

#### Guides & Documentation

- **`bot/REMOTE_ACCESS.md`**:
  - Full instructions for tunneling the bot to the web: Setup A (Cloudflare Tunnel + Zero Trust Access for passwordless email login) and Setup B (plain tunnel + API token authorization).
  - Guides on choosing a 24/7 host (Oracle Cloud Free Tier vs. cheap VPS) and managing the process via `pm2`.
- **`bot/DEPLOY_VPS.md`**:
  - Step-by-step walkthrough to deploy the bot on a fresh Ubuntu VPS (Hetzner), install Node, clone the repository, configure Zero Trust, configure `.env` safety limits, and configure `pm2` autostart.

#### Vercel web app (src/)

- **Signal Trader tab removed** — Vercel can't host the bot, so the Signal Trader page served no purpose there. Tabs now: Strategy Backtester · Grid Optimizer.
- **`SummaryPanel` component** (`src/components/SummaryPanel.tsx`) — plain-English verdict panel shown below the backtest `Results`:
  - Strategy performance row: return %, number of trades, win rate, vs buy-and-hold
  - Regime row: current Bull/Bear/Sideways label + conviction %, grid trading suitability (✓ Good / ⚠ Risky)
  - One combined recommendation sentence (strategy verdict + direction hint + grid note)
- **Advanced Analysis collapsible** — `MultiTFPanel`, `RegimePanel`, `EnsemblePanel`, `CorrelationPanel`, and `WalkForwardPanel` are now wrapped in a collapsible "Advanced Analysis Tools" toggle, collapsed by default. Preference persisted in `localStorage`. `SummaryPanel` is always visible so users get a quick read without digging into the quant tools.

---

## Current state

| Area | Status |
|---|---|
| Web app (Vercel) | ✅ deployed — garlic-trading.vercel.app |
| Bot (local) | ✅ running — `cd bot && npm start` |
| GitHub | ✅ pushed to master & new branch `trigger-bot` created |
| SL/TP on Hyperliquid | ✅ verified — correct trigger conditions confirmed in order history |
| Multi-bot (grid) | ✅ working — manage via dashboard at `http://localhost:3001` |
| Signal Trader | ✅ multi-bot + budget sizing — budget × leverage → size computed at live price on start |
| Trade page | ➖ removed — manual IOC trade restored as simple Buy/Sell in Signal Trader sidebar |
| Trade API security | ✅ verified — CORS locked; API token gate; server safety caps; audit log |
| Remote access | ✅ live — Cloudflare Tunnel + Access at `bot.garlic-trading.net` (running from local PC) |
| 24/7 VPS hosting | ⏳ next — deploy to Hetzner (see `futureplan.md` / `bot/DEPLOY_VPS.md`) |

---

## Known limitations / next ideas

- Grid lines not visible on bot dashboard chart (GridChart not re-rendering after config load)
- No position sizing for "both" direction grids (current formula assumes long-only)
- Grid bot has no auto-restart on crash (the Signal Trader does — resumes from saved state)
- Signal Trader polls candles every 30s rather than streaming on candle close
- No webhook / alert when SL or TP triggers
- Signal Trader budget mode freezes size at start; no periodic recalculation as price drifts

