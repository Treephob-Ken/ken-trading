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
| Bot (local) | ✅ running — `cd bot && npm run serve` |
| GitHub | ✅ pushed to master & working on branch `trigger-bot` |
| SL/TP on Hyperliquid | ✅ verified — correct trigger conditions confirmed in order history |
| Multi-bot (grid) | ✅ working — manage via dashboard at `http://localhost:3001` |
| Signal Trader | ✅ multi-bot + budget sizing — budget × leverage → size computed at live price on start |
| Trade page | ✅ Manual Trade tab in dashboard (4th tab) with Account/Position/Order/Fills |
| Trade API security | ✅ CORS locked; API token gate; server safety caps; audit log |
| Remote access | ✅ live — Cloudflare Tunnel + Access at `bot.garlic-trading.net` (running from local PC) |
| Multi-user (Phase B) | ✅ built — enable with `MULTI_USER=true` in `bot/.env`; see `bot/.env.example` |
| 24/7 VPS hosting | ⏳ pending — still on local PC; deploy to Hetzner when ready (see `futureplan.md` / `bot/DEPLOY_VPS.md`) |

---

## Known limitations / next ideas

- Grid lines not visible on bot dashboard chart (GridChart not re-rendering after config load)
- No position sizing for "both" direction grids (current formula assumes long-only)
- Grid bot has no auto-restart on crash (the Signal Trader does — resumes from saved state)
- Signal Trader polls candles every 30s rather than streaming on candle close
- No webhook / alert when SL or TP triggers
- Signal Trader budget mode freezes size at start; no periodic recalculation as price drifts

---

### 2026-05-23 — Repo cleanup + CLAUDE.md overhaul

**What changed:**
- Deleted 4 redundant trading-guide markdown files (`trading_guide.md`, `trading_guide_simple.md`, `trading_instructions.md`, `TRADING_GUIDE_EASY.md`) — all superseded by `HOW_TO_TRADE.md`.
- Added `graphify-out/` to `.gitignore` (generated skill output, already untracked).
- Rewrote `CLAUDE.md` to cover all additions since Phase 3: signal-bot subsystem, HTTP server API table, trade.ts / limits.ts, Cloudflare Tunnel setup (`bot.garlic-trading.net`), new web-app lib modules (markov, ensemble, walkforward, multiTF, gridBotAuto, env, format, types.ts), and the `progress.md` logging convention.
- `src/pages/SignalTraderPage.tsx` exists but is intentionally not wired to `App.tsx` (removed from Vercel in Phase 7 because Vercel can't reach the local bot). Left in repo — `trigger-bot` branch suggests it may be restored.

**Gotchas:**
- `HOW_TO_TRADE.md` is now the single user-facing guide — do not create additional trading guide files.
- Log every change here in `progress.md`; CLAUDE.md is for architecture, not changelog.
- **CLAUDE.md corrected**: `npm start` runs `index.ts` (legacy standalone single-bot, no dashboard). The server is `npm run serve` → `server.ts`. `start_bot.bat` correctly uses `npm run serve`. Do NOT confuse the two entry points.


---

### 2026-05-23 — Dashboard redesign + bug fixes (UI/UX Pro Max)

**What changed (bot/dashboard/index.html):**
- **Removed Grid Chart entirely** — user request; `fetchCandles`, `initChart`, `destroyChart`, `buildLines`, `updateGridLines` all deleted, along with the chart HTML card and `.chart-card`/`.chart-header`/`.chart-meta` CSS.
- **Fixed corrupted `.log-empty` CSS** — a misplaced comment had broken the `padding:` rule and embedded a broken `ensemble-list` block inside it. Fixed to `padding: var(--s5); text-align: center;`.
- **Fixed duplicate `.ensemble-list` block** — the corrupted block was removed; the clean block at line ~500 remains.
- **Fixed duplicate `.ensemble-row:hover`** — appeared twice in the real ensemble-list block; removed duplicate.
- **Added `.jump-btn` CSS** — the "↓ Latest" button was referenced in HTML for both Grid and Signal log boxes but had no CSS, making it invisible. Now has position:absolute, brand color, slide-in transition.
- **Removed `lightweight-charts` script tag** — no longer needed after chart removal.
- **Replaced emoji icons with SVGs** — ⚡ header icon, 🤖 empty state, 🗑 delete buttons all now use inline SVG per UI/UX Pro Max rule (no emoji as structural icons).
- **Added Trade Log tab** — third tab with a global SSE log viewer (`/api/logs/stream`). Includes per-bot filter buttons (auto-generated as new bot IDs appear), level filters (All/Fills/Issues/Info), clear, and jump-to-bottom.
- **Stat card accent borders** — colored left-border accents (gain=green, loss=red, warn=amber, neutral=brand) to distinguish card meaning at a glance.
- **Tabular nums** — `font-variant-numeric: tabular-nums` on `.stat` and `.stat-value` for stable number columns.
- **Stats grid gap** — increased from `var(--s2)` to `var(--s3)` for better breathing room.
- **Branding** — header title updated to "Garlic Trading" with sub "Hyperliquid · Local Dashboard".
- **Binance API** — changed `api.binance.com` (geo-blocked) → `data-api.binance.vision` in ST price ticker fetch (remaining after chart removal).

**Installed UI/UX Pro Max skill** — cloned `github.com/nextlevelbuilder/ui-ux-pro-max-skill` into `~/.claude/skills/` (7 sub-skills: banner-design, brand, design, design-system, slides, ui-styling, ui-ux-pro-max). Repo removed after install.

**Gotchas:**
- The emoji-inside-CSS corruption came from a previous editor that injected a comment block mid-rule. Check for this pattern if other styles behave unexpectedly.
- `jump-btn` must be inside a `position:relative` container (`.log-wrap` already sets this).
- Trade Log tab routes logs through the existing `connectSSE()` call; no new SSE connection opened.

---

### 2026-05-23 — Manual Trade page + Trade Log portfolio overview

**Config pane fix**: The first `field-row` in Grid Bot config had inline `grid-template-columns:1fr` overriding the default `1fr 1fr`, making "Display Name" and "Asset" stack vertically. Changed to `grid-template-columns:2fr 1fr` so they're side-by-side (Name wider, Asset narrower).

**New Manual Trade tab (4th tab `page-trade`):**
- Full 2-column layout: left = Account overview + Open Position + Recent Fills; right = sticky Place Order panel
- Account card shows equity, withdrawable, margin used (computed as accountValue − withdrawable)
- Open Position card shows big unrealized P&L number, side/asset/size/entry grid, close-slippage input, "Close Position" button (calls `POST /api/close { asset, slippagePct }`)
- Place Order panel: asset input (Binance price auto-fetches via `data-api.binance.vision`), size, slippage, 25%/50%/75%/Max quick-size buttons (sized against withdrawable/price), order preview, Buy/Sell buttons, status line
- Recent Fills table built from session fills (client-side list)
- `initTradePage()` called by `switchTab('trade')`; polls account every 5 s while on tab
- Manual Trade card removed from Signal Trader sidebar; `stManualTrade()` replaced by `trManualTrade()`; stale `st-manual-panel` show/hide calls cleaned up

**Trade Log portfolio overview (top of `page-log`):**
- 3-column strip: Account (equity + withdrawable), Open Position (badge/asset/size/entry/UPnL), Quick Close (asset input + slippage + Close button)
- Position panel auto-fills asset from live position; "Quick Close" posts to `POST /api/close`
- `refreshLogAccount()` runs on tab switch + every 5 s while on log tab

**Gotchas:**
- `/api/close` body: `{ asset: string, slippagePct?: number }`. Returns `{ filled, message }` on no-position case.
- `trQuickSize()` reads withdrawable from the display text, so it requires the account to load first.
- The Trade page price fetch runs Binance, not Hyperliquid — there's no `/api/price` endpoint. A 400ms debounce prevents flooding on fast typing.

---

### 2026-05-23 — Manual Trade page data-loading fixes

**Root cause:** Bot server was never restarted after last session's code changes, so the new `/api/asset-info` endpoint didn't exist in the running process. Also several bugs in the dashboard JS.

**Bugs fixed (`bot/dashboard/index.html`):**

1. **`trAssetsLoaded = true` before `try` block** — If `/api/assets` failed on first visit (server cold/down), the flag was set before confirming success, so assets would never retry. Moved inside `try`, after `assets.length` is confirmed.

2. **Price never auto-refreshes** — Once an asset was selected, `trAssetChanged()` fetched the price once and never updated it. Added `trPriceTimer` (module-level interval var) that polls `/api/asset-info` every 5 s while an asset is selected. Cleared via `destroyTradeTimers()` (which already cleared `trAccountTimer`).

3. **Silent price failures** — When `/api/asset-info` returned an error or non-JSON (e.g. server not restarted), the catch silently set price to `—` with no user feedback. Replaced with `fetchAssetPrice()` helper that:
   - Shows "Server error — restart bot" (red) when response isn't parseable JSON
   - Shows "Not found" (amber) when the asset doesn't exist on Hyperliquid
   - Shows "No connection" (red) on network failure
   - Parses text first (not `.json()` directly) to safely handle HTML 404 responses

4. **`slippagePct` → `maxSlippagePct` field mismatch** — All 4 manual trade API calls (`/api/order` once, `/api/close` three times) were sending `slippagePct` but the server reads `maxSlippagePct`. Orders worked but always used the default 2% slippage, ignoring the UI input. Fixed in all 4 places. (Signal bot config still uses `slippagePct` — that's a different JSON field, correct as-is.)

**TypeScript build:** Passes clean (`npm run build` — no errors in `trade.ts` or `server.ts`).

**Action required:** Restart the bot server (`cd bot && npm run serve`) to activate the `/api/asset-info` endpoint.

**Gotchas:**
- `fetchAssetPrice()` reads `.text()` first then `JSON.parse()` to distinguish HTML-404 from JSON-404. Using `.json()` directly would throw on HTML responses (like Express's default 404 page before the route was registered), masking the real error.
- The price timer (`trPriceTimer`) must be cleared in `trAssetChanged()` at the top before starting a new one, otherwise selecting a second asset creates a second parallel timer for the old asset.

---

### Sidebar Redesign — 2026-05-23

#### Web app (garlic-trading.vercel.app)
**What changed:**
- Replaced the top header (brand + tab nav) with a left icon nav rail (`src/components/Sidebar.tsx`)
- Layout changed from `flex-col` to `h-screen flex overflow-hidden` in `App.tsx`
- Signal Trader page (`SignalTraderPage.tsx`) wired into `App.tsx` as a third nav item (Radio icon)
- Sticky aside top values updated: `top-[97px]` → `top-5`, `top-[52px]` → `top-5` (old values assumed header height, now irrelevant)
- Retained the 3px brand accent stripe at top of the content area

**Design:**
- 60px icon rail: CandlestickChart brand logo, 3 nav buttons (LineChart / LayoutGrid / Radio), hover tooltip labels
- Active state: `bg-brand/15 text-brand` + left accent bar
- Tooltip: absolute-positioned floating label slides in to the right on hover

#### Bot dashboard (garlic-trading.net)
**What changed:**
- Removed tab nav from `<header>` (slimmed to brand + connection status only)
- Added `<div class="app-main">` wrapper around icon rail + pages
- Added 60px `<nav class="icon-rail">` with SVG icons for Grid Bots / Signal Trader / Trade & Log
- `switchTab()` updated to also toggle `.active` on `.rail-btn` elements
- Running-dot pulse propagates to `rail-dot-grid` and `rail-dot-signal` (small indicator dots on the rail buttons)

**Gotchas:**
- The `tab-btn-*` elements still exist in the DOM (hidden by the header being slimmed) so existing `has-running` toggle code still works without breakage
- Rail tooltip arrows use `::before`/`::after` pseudo-elements — these need `position:relative` on `.rail-btn` (already set)
- Sticky positioning on page controls still works because the scroll container is the page's `.pane-right` / BacktesterPage's overflow-y-auto parent, not the viewport

---

### 2026-05-23 — Theme alignment + BentoGrid stat cards + GlowCard effect (bot dashboard)

**What changed (`bot/dashboard/index.html`):**

**Theme alignment:**
- `--bg` changed `#080810` → `#000000` (pure black to match Vercel web app)
- `--bg-raised` `#0c0c18` → `#060609`, `--surface` `#111122` → `#0a0a0f`, `--surface-2` `#181830` → `#101017`, `--surface-3` `#1e1e38` → `#16161f`
- Body background updated: removed heavy single-color purple radial; replaced with subtle `radial-gradient` corner accents (purple tl, blue tr) + a fine `40px×40px` grid of 1.2%-opacity lines — identical pattern to the Vercel web app's Tailwind `bg-grid` style

**GlowCard cursor-following spotlight:**
- `:root` gains `--gx`, `--gy`, `--gxp` custom properties updated on `pointermove`
- `.card` gets a `background-image: radial-gradient(300px at --gx --gy ...)` fill spotlight (`!important` to beat the existing background shorthand)
- `.card::before` / `.card::after` use a CSS mask trick (`mask-clip: padding-box, border-box; mask-composite: intersect`) to light up only the 1px border ring — no fill leaks inside the card
- `.stat` was intentionally kept separate from glow pseudo-elements to avoid `::before`/`::after` conflicts with bento-stat's dot-grid overlay

**Glow hue: blue → purple blend:**
- Changed hue formula from `calc(263 + xp*60)` (purple→pink) to `calc(213 + xp*50)` (blue→purple): cursor left = 213° (blue, matching Vercel's brand-blue), cursor right = 263° (violet, matching the bot's brand-purple)
- Removed `.stat` from glow rules entirely (`.card` only), which also removes pseudo-element conflicts

**BentoGrid stat tiles:**
- New `.bento-stat` class: `bg-raised` background, `border`, `r-md` rounded, flex-col layout, dot-grid `::before` overlay that fades in on hover, `position: relative; overflow: hidden` for the overlay clipping
- Accent variants: `.bento-stat.gain-accent / .loss-accent / .warn-accent / .neutral-accent` — same left-border treatment as old `.stat`
- Grid utilities: `.bento-grid .bento-grid-4 .bento-grid-3 .bento-grid-2`
- Inner classes `stat-label`, `stat-value`, `stat-sub` unchanged — JS color updates (`$('s-realized').className = 'stat-value gain'`) still work

**shadcn-style card composables:**
- Added `.card-header`, `.card-header-row`, `.card-heading`, `.card-desc`, `.card-content`, `.card-footer` CSS — replaces the `.card { padding } + .card-title { margin-bottom }` pattern with explicit header/content sections

**HTML updated:**
- Grid Bot Live Stats: `card-title` → `card-header`; `.stats-grid-4` of `.stat` → `.bento-grid.bento-grid-4` of `.bento-stat`
- Grid Bot Safety: same pattern, `.stats-grid-3` → `.bento-grid.bento-grid-3`
- Signal Trader Live Stats: same pattern, `.stats-grid-4` → `.bento-grid.bento-grid-4`
- Signal Trader Protection Status: same pattern, `.stats-grid-2` → `.bento-grid.bento-grid-2`
- Signal Trader Account: same pattern, `.stats-grid-3` → `.bento-grid.bento-grid-3`
- Trade & Log Account: same pattern, `.stats-grid-3` → `.bento-grid.bento-grid-3`
- All inner IDs preserved (no JS changes needed)

**Web app new files:**
- `src/lib/utils.ts` — `cn()` class merger utility
- `src/components/ui/card.tsx` — shadcn-style Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- `src/components/ui/bento-grid.tsx` — BentoGrid + BentoCell components with dot-grid overlay, gradient border shine, icon/status/tags/CTA

**Gotchas:**
- `.card` glow uses `!important` on `background-image` to beat the `background: var(--surface-2)` shorthand which sets `background-image: none`
- `background-attachment: fixed` makes the gradient viewport-relative — cursor position in `px` maps directly to the correct spot on every card simultaneously
- `mask-composite: intersect` treats areas outside a layer's clip as opaque=1, so `padding-box` (layer 1 transparent interior) × `border-box` (layer 2 full area) = border strip only visible
- Remove `.stat::before/::after` from glow: the `.bento-stat::before` dot-grid overlay uses `::before` for its own purpose — having glow pseudo-elements on `.stat` too would conflict if both classes were ever on the same element

---

### 2026-05-23 — Bot dashboard pane redesign + price charts (Stage 1+2)

**Motivation:** User requested: fewer cards on right panes, logs only on Trade Log page, chart on Grid Bot page like Vercel web app, chart + signals on Signal Trader page.

**What changed (`bot/dashboard/index.html`):**

**CSS additions:**
- `.chart-card { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }` — makes the chart card fill remaining height in the pane
- `.chart-el { flex: 1; min-height: 0; width: 100%; }` — the div LW Charts renders into; fills card
- Added `<script src="https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js">` in `<head>` — pinned to v4.2.0 (v5 removed `addCandlestickSeries` and `setMarkers`)

**Grid Bot right pane (done in previous session):**
- Replaced: 8-tile Live Stats card + 3-tile Safety card + Log panel
- With: single combined compact card (4-tile row: Price/Realized/Total/State + 3-tile row: SL/TP/Liq) + chart card
- `pane-right` got `overflow:hidden` so chart fills remaining flex space
- Removed IDs kept alive in hidden `display:none` div: `safety-warning`, `s-floating`, `s-position`, `s-orders`, `s-fills`, `s-fees`, `s-size`, `s-budget`, `log-count`, `log-box`, `jump-btn`

**Signal Trader right pane:**
- Replaced: Banner + Live Stats (4 tiles) + Protection Status (2 tiles) + Account (3 tiles + position card) + Trade Journal + Activity Log
- With: Banner (unchanged) + compact stats card (3+3 tiles: LastSignal/Trades/LastEval + MTFTrend/DailyPnL/LastError) + chart card
- `pane-right` got `overflow:hidden`
- Removed IDs kept alive in hidden div: `st-log-box`, `st-jump-btn`, `st-log-context`, `st-journal-body/empty/table/count`, `st-balance`, `st-withdrawable`, `st-position-none/card`, `st-pos-badge/asset/size/entry/upnl`, `st-started-at`, `st-network-badge`

**Chart JavaScript (Stage 2):**
- `activeCandles`, `candlestickSeries`, `gridChart` — grid chart state (names match existing `pollGridStats`/`updateSizingPreview` references)
- `signalChart`, `signalCandleSeries` — signal chart state
- `_gridPriceLines[]` — tracks price line handles for remove-before-redraw pattern
- `buildLines(lower, upper, count, mode)` — generates `{price}[]` for arithmetic/geometric grids; called by `updateSizingPreview()` and `clearGridStats()` already in JS
- `updateGridLines(lines, currentPrice, slPrice, tpPrice)` — removes old price lines, re-draws all: grid lines in blue (below price) / purple (above), SL in red, TP in green
- `_fetchCandles(symbol, interval, limit)` — Binance `data-api.binance.vision` REST, returns `{time,open,high,low,close}[]`
- `_makeLWChart(el)` — creates LW chart with dark theme (transparent bg, `#252538` grid/border, `#a0a0c0` text)
- `initGridChart(cfg)` — fetches 300×1h bars for `cfg.asset`, draws candles + grid lines + SL/TP, fits content, attaches ResizeObserver; hooked into `selectBot(id)` via `setTimeout(() => initGridChart(cfgRes), 0)` (defer 1 tick so layout paints first)
- `initSignalChart(cfg, trades)` — fetches 300 bars at `cfg.timeframe`, draws candles + buy/sell arrow markers from filled trades, fits content; hooked into `selectSignalBot(id)` (fetches trades from `/api/signal/bots/:id/trades` inline before defer)

**Gotchas:**
- LW Charts v5 breaks `addCandlestickSeries()` and `series.setMarkers()` — pinned to v4.2.0 on CDN
- `setTimeout(() => ..., 0)` defers chart init by one event loop tick so `el.clientWidth/clientHeight` are non-zero after the flex layout paints
- `candlestickSeries` variable name matches what `updateSizingPreview()` and `pollGridStats()` already check (`if (candlestickSeries && ...)`) — must stay as-is
- Signal activity log and trade journal still appended to hidden DOM elements (no errors, just invisible) — logs are fully visible on Trade Log page via SSE stream

---

## 2026-05-24 — Phase B: Multi-user support

### What was built
Full multi-user authentication and data isolation layer. Opt-in via `MULTI_USER=true` in `bot/.env`; single-tenant mode is completely unchanged when the flag is absent.

### Files added
- **`bot/src/users.ts`** — SQLite user DB (`bot/data/users.db`), bcrypt password hashing, AES-256-GCM encryption for HL agent private keys.
- **`bot/src/auth.ts`** — JWT sign/verify (7-day expiry), `requireAuth` + `requireAdmin` Express middleware (both no-ops in single-tenant mode).
- **`bot/src/migrate.ts`** — One-time migration: copies existing `bot/configs/` + `bot/signal-bots/` into `bot/data/<ownerId>/` on first multi-user boot.

### Files changed
- **`bot/src/trade.ts`** — Replaced singleton `HLClients` with per-user cache (`Map<string, HLClients>`). All exported functions accept optional `creds?: EnvConfig | null`; omitting falls back to env singleton.
- **`bot/src/config.ts`** — Added `configsDirForUser(userId?)`. All CRUD functions accept optional `userId`.
- **`bot/src/signal-bot.ts`** — `SignalBot` gains `userId` + `creds`. Data in `bot/data/<userId>/signal-bots/`. Multi-user bot IDs are UUIDs to prevent cross-user registry collisions.
- **`bot/src/limits.ts`** — `recordTrade(entry, userId?)` writes to per-user audit log.
- **`bot/src/server.ts`** — `/auth/register|login|me`, `requireAuth` on all `/api/*`, `/settings/credentials`, `/admin/users*`, per-user grid bot manager.
- **`bot/dashboard/index.html`** — Login overlay, HL credentials modal, header user chip, mode detection via `GET /auth/me`.
- **`bot/.env.example`** — Added `MULTI_USER`, `OWNER_EMAIL`, `KEY_ENCRYPTION_SECRET`, `JWT_SECRET`.

### Key design decisions
- **Feature flag** `MULTI_USER=true` — absent = full backward compat.
- **Admin bootstrap** — first registered user always gets admin; `OWNER_EMAIL` also grants admin.
- **Data migration** — idempotent (marker file `bot/data/.migrated`); existing bots claimed by first admin.
- **`KEY_ENCRYPTION_SECRET` is unrecoverable** — losing it bricks all stored HL keys. Must be backed up separately.

### Gotchas
- Signal bot IDs are UUIDs in multi-user mode to ensure cross-user uniqueness in the shared registry map.
- `GET /api/logs/stream` SSE can't use fetch headers — reads `?token=` query param in both modes.
- `UserRow` must be exported from `users.ts` for `server.ts` to access `row.is_admin` from `verifyPassword()`.

### Known gap
- **Per-user audit log not fully wired**: `limits.ts:recordTrade(entry, userId?)` writes to `bot/data/<userId>/trade-audit.log` when `userId` is provided, but `trade.ts` doesn't thread the user ID through to that call. All audit entries still land in the global `bot/trade-audit.log` for now.

---

## 2026-05-24 — Phase B blockers fixed

Four issues identified in advisor review and fixed:

**Fix 1 — Migration not triggered on first registration** (`bot/src/server.ts`)
- `runMigrationIfNeeded(user.id)` and `maybeAutostartSignalBots(...)` were only called at
  boot `if (owner)` — but in a fresh multi-user deploy the DB is empty at boot, so owner is
  undefined. Fixed: both calls now run inside `/auth/register` when `isFirstUser && isAdmin`.

**Fix 2 — Running signal bots kept stale creds after key update** (`bot/src/server.ts`)
- `PUT /settings/credentials` evicted the client cache but didn't notify running `SignalBot`
  instances, which kept their old `EnvConfig`. Fixed: after `saveHLCredentials`, we load fresh
  creds and call `bot.updateCreds(newCreds)` on every signal bot for that user.

**Fix 3 — Empty agentKey rejected by saveHLCredentials** (`bot/src/users.ts`)
- The dashboard credentials modal says "leave blank to keep current key" but the backend
  threw `'agentKey must be a 0x-prefixed…'` on an empty string. Fixed: if `agentKey === ''`,
  only `hl_user` and `hl_network` are updated; the existing `hl_key_enc` is preserved.

**Fix 4 — TypeScript build** — all 3 changes pass `npm run build` clean.

---

## 2026-05-24 — VPS Deployment (DigitalOcean Singapore)

### What was done
Deployed the bot server to a live VPS so it's accessible 24/7 without needing a local machine running.

**Server:** DigitalOcean Droplet — Singapore (SGP1), Ubuntu 24.04 LTS, 1 vCPU / 1GB RAM / $6/mo  
**Public IP:** 68.183.184.170  
**Live URL:** https://bot.garlic-trading.net (via Cloudflare Tunnel)

### Steps completed
1. Created DigitalOcean Droplet (Ubuntu 24.04, Singapore, $6/mo)
2. Installed Node.js 20 via NodeSource (`curl -fsSL https://deb.nodesource.com/setup_20.x | bash -`)
3. Installed `build-essential` (required for `better-sqlite3` native compilation)
4. Cloned repo from GitHub (`master` branch — merged from `trigger-bot` first)
5. `npm install` inside `bot/`
6. Created `.env` from `.env.example` with:
   - `MULTI_USER=true`
   - `OWNER_EMAIL=ken2540@gmail.com`
   - `KEY_ENCRYPTION_SECRET` + `JWT_SECRET` (generated with `openssl rand -hex 32`)
   - `ALLOWED_ORIGINS=https://garlic-trading.vercel.app`
7. Started bot with `pm2 start npm --name "trading-bot" -- run serve`
8. Set pm2 to auto-start on reboot: `pm2 save && pm2 startup`
9. Installed `cloudflared` and ran tunnel via token: `pm2 start "cloudflared tunnel run --token <TOKEN>" --name "cloudflare-tunnel"`
10. Registered first user (admin) via `curl http://localhost:3001/auth/register`

### Issues encountered & fixed
- **`better-sqlite3` build failed** — missing `make`. Fix: `apt install -y build-essential`
- **GitHub private repo** — token exposed in chat; GitHub auto-revoked it. Fix: made repo public
- **Cloudflare Access blocking API calls** — old Access policy was intercepting all requests and returning 302 redirects before they reached the bot. Fix: deleted the Access application in Zero Trust dashboard
- **Tunnel returning wrong response** — Cloudflare had cached the old 302 response. Resolved on its own after Access was removed
- **Tunnel credentials file missing** — used `cloudflared tunnel run --token <TOKEN>` instead of `cloudflared tunnel run <name>` to bypass needing the credentials JSON file

### Architecture running on VPS
```
Internet → Cloudflare Edge → Cloudflare Tunnel (cloudflared, pm2) → localhost:3001
                                                                         ↓
                                                               Express bot server (pm2)
                                                               Multi-user mode enabled
                                                               SQLite DB at bot/data/users.db
```

### pm2 processes
| Name | Command | Purpose |
|---|---|---|
| `trading-bot` | `npm run serve` | Express server + bot logic on port 3001 |
| `cloudflare-tunnel` | `cloudflared tunnel run --token <TOKEN>` | Cloudflare tunnel to expose port 3001 |

---

## 2026-05-24 — VPS post-deploy fixes

### Node.js WebSocket + better-sqlite3 rebuild

**Problem 1 — Account API hanging:** `GET /api/account` hung indefinitely. Root cause: Node.js 20 has no native `WebSocket` global; `@nktkas/hyperliquid`'s `WebSocketTransport` threw "No WebSocket implementation found" silently and the request never resolved.

**Fix:** Upgraded Node.js from 20 → 22 on the VPS (`curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs`). Node.js 22 ships native WebSocket.

**Problem 2 — Bot crash after Node upgrade:** `better-sqlite3` is a native addon compiled against Node's ABI version. After upgrading Node 20 → 22, the prebuilt binary was incompatible (`NODE_MODULE_VERSION 115` vs required `127`). Bot crashed on startup with `ERR_DLOPEN_FAILED`.

**Fix:** `npm rebuild` inside `bot/` recompiles the native addon against Node 22. Then `pm2 restart trading-bot`.

**Gotcha:** Always run `npm rebuild` after upgrading Node.js when the project uses native addons (`better-sqlite3`, `canvas`, etc.).

---

### 2026-05-24 — Risk-based position sizing for signal bots

**Problem:** Position sizing was "Budget (USDC) × Leverage" — meaningless without knowing SL distance. User wanted formula: Position size ($) = Risk per Trade ($) / SL%.

**What changed:**

**`bot/src/hyperliquid.ts`:**
- Added `maxLeverage: number` to `AssetMeta` interface and extracted `u.maxLeverage` from HL metadata.

**`bot/src/trade.ts`:**
- `getAssetInfo` now returns `maxLeverage` (forwarded from `AssetMeta`). The `/api/asset-info` endpoint exposes this to the dashboard.

**`bot/src/signal-bot.ts`:**
- Added `riskUsd?: number` to `SignalBotConfig` (risk per trade in USDC).
- Added `riskUsd?`, `slPct?`, `positionUsd?` to `TradeRecord` so the trade log shows risk context.
- `parseSignalConfig` now parses `riskUsd` and accepts it as a sizing mode (alongside legacy `investment`/`leverage` and fixed `size`).
- Tick logic: if `riskUsd` + `slPct` are set, computes `positionUsd = riskUsd / (slPct/100)` → `computedSize = positionUsd / livePrice`. Legacy budget mode (`investment × leverage / price`) still works.
- Trade record now stores `riskUsd`, `slPct`, `positionUsd` when risk mode is active.

**`bot/dashboard/index.html`:**
- Replaced "Budget (USDC)" + "Leverage" inputs with "Risk per Trade ($)" (`st-risk-usd`).
- Hidden `st-investment`/`st-leverage` fields kept for backward compat (old saved configs).
- Max leverage shown as info text next to risk field — auto-fetched via `/api/asset-info` when currency is picked.
- `updateSignalSizingPreview()` rewritten: shows `Position $X = $Y risk / Z% SL · Max lev: Nx`.
- `onCurrencyPicked` and `populateForm` both fetch max leverage and current price from `/api/asset-info` (not Binance), so preview is instant and uses HL mark price.
- `collectSignalConfig` uses `riskUsd` mode; validates that SL% is set when risk mode is chosen.
- Trade journal table now has columns: Time, Side, Size, Price, Position $, Risk $, SL%, ✓.
- New bot default: `{ riskUsd: 50, slPct: 2 }` (so Start works without any user input).
- `updateSLPreview` now uses `stCurrentPrice` (set by asset-info fetch) instead of scraping a DOM element.

**Gotcha:** Risk mode requires SL% to be set — `collectSignalConfig` enforces this and shows a clear error if the user tries to start without it.

---

## 2026-05-24 — Signal chart auto-refresh on currency/strategy/timeframe change

**Problem:** When a signal bot was selected and the user changed the asset (currency picker), strategy, or timeframe in the form, the chart stayed on the old symbol/indicator. The chart only re-initialized when `selectSignalBot()` was called (i.e. when selecting a different bot from the list).

**Root cause:** `onCurrencyPicked`, `onStrategyChanged`, and the timeframe change handler all triggered `scheduleSave()` but never called `initSignalChart()`.

**Fix (`bot/dashboard/index.html`):**

Added `stChartRefreshTimer` variable and a `scheduleChartRefresh()` function — a debounced wrapper (800 ms, longer than the 450 ms `scheduleSave` debounce) that re-invokes `initSignalChart` with a cfg built from the current form values:

```javascript
function scheduleChartRefresh() {
  if (!stSelectedId) return
  clearTimeout(stChartRefreshTimer)
  stChartRefreshTimer = setTimeout(async () => {
    const asset   = stCurrencyCombo?.getValue() || $('st-asset')?.value || 'ETH'
    const tf      = $('st-timeframe')?.value || '1h'
    const stratId = stSignalMode === 'ensemble' ? 'ensemble' : (stStrategyCombo?.getValue() || 'macd')
    const cfg = { asset: asset.toUpperCase(), symbol: asset.toUpperCase() + 'USDT', timeframe: tf, strategyId: stratId }
    await initSignalChart(cfg, _signalTrades, stSelectedId)
  }, 800)
}
```

Called from:
- `onCurrencyPicked` — after `scheduleSave()`
- `onStrategyChanged` — after `scheduleSave()`
- `wireAutoSave` timeframe `change` handler — alongside `maybeUpdateAutoName()`

**Timing rationale:** 800 ms delay ensures `scheduleSave`'s 450 ms has already fired, the server has saved the new config, and `/api/signal/bots/:id/chart-data` returns indicator data computed from the updated config.

---

## 2026-05-24 — Chart refresh revised (save-triggered, not timer-triggered)

**Problem with previous approach:** Timer-based chart refresh (800 ms after field change) had a race condition on VPS — if the network round-trip for `saveCurrentBot` was slow, the server still had the old config when `/api/signal/bots/:id/chart-data` was fetched.

**Fix:** Removed the independent timer. Added `refreshChartFromForm()` function called directly inside `saveCurrentBot()` after the PUT completes — server is guaranteed to have the new config at that point.

```javascript
function refreshChartFromForm() {
  if (!stSelectedId) return
  const asset   = stCurrencyCombo?.getValue() || $('st-asset')?.value || 'ETH'
  const tf      = $('st-timeframe')?.value || '1h'
  const stratId = stSignalMode === 'ensemble' ? 'ensemble' : (stStrategyCombo?.getValue() || 'macd')
  const cfg = { asset: asset.toUpperCase(), symbol: asset.toUpperCase() + 'USDT', timeframe: tf, strategyId: stratId }
  initSignalChart(cfg, _signalTrades, stSelectedId)
}
// Called at end of saveCurrentBot() after apiCall PUT resolves.
```

---

## 2026-05-24 — Grid page: asset combo picker + chart refresh

**Problem:** Grid page Asset field was a plain text input. Chart didn't update when asset was changed.

**Fix:**
- Replaced `<input id="f-asset" type="text">` with `.combo` div (same `createCombo` pattern as signal page)
- Hidden `<input id="f-asset" type="hidden">` kept so `getFormConfig()` unchanged
- `initGridPage()` called from `loadBots()` — idempotent, runs once
- `gbCurrencyCombo` onChange: sets `f-asset`, calls `updateSizingPreview()`, calls `initGridChart(getFormConfig())`
- `renderFormFromConfig()` syncs both hidden input and combo via `gbCurrencyCombo.setValue(asset)`
- `getFormConfig()` reads `gbCurrencyCombo?.getValue() || $('f-asset').value`

---

## 2026-05-24 — Grid page: position sizing card (consistent with signal page)

**What changed:**
- Removed visible Budget (USDC) + Leverage + Override Order Size inputs
- Added Risk per Trade ($) (`gb-risk-usd`) + Stop Loss % (`gb-sl-pct`) inputs
- Hidden `f-investment`, `f-leverage`, `f-size` auto-set by `updateSizingPreview()`
- Fetch `/api/asset-info` on asset pick AND on `renderFormFromConfig` → `gbCurrentPrice`, `gbMaxLeverage`
- `f-investment` = positionUsd / maxLev (USDC margin to deposit)
- `f-leverage` = maxLeverage from Hyperliquid
- SL% sets BOTH `f-sl` (below current price) AND `f-tp` (above) — grid is symmetric, both act as exits
- Card rows: Position $ | Order Qty per grid | Max Leverage | Margin at max lev | SL below / TP above
- `riskUsd` and `slPct` stored in config JSON for UI round-trip; not consumed by the grid bot engine
- Card row label: "SL below / TP above (auto-set)"

---

## 2026-05-24 — Grid page: auto-naming + timeframe selector

**Auto-naming:**
- `gbBotNameIsAuto` flag (same pattern as signal page's `stBotNameIsAuto`)
- `generateGridBotName()` → `{ASSET}-GRID-{COUNT}` e.g. `ETH-GRID-8`
- `maybeUpdateGridAutoName()` called from asset combo onChange and f-count oninput
- f-name gets `oninput="gbBotNameIsAuto=false"` to disable auto when user types
- `newBot()` sets `gbBotNameIsAuto = true`, blank name, gridCount=8
- `renderFormFromConfig` detects auto mode by comparing stored name to `generateGridBotName()`

**Timeframe selector:**
- `<select id="f-timeframe">` added beside Mode (options 1m–1d, default 1h)
- `initGridChart` now reads `cfg.timeframe || '1h'` instead of hardcoded `'1h'`
- `getFormConfig()` includes `timeframe` field; `renderFormFromConfig` restores it
- `onchange="initGridChart(getFormConfig())"` — instant chart reload on change

---

## 2026-05-24 — Signal bot: position-aware trade execution

**Problem:** Bot was not position-aware. In "both" mode, a SELL signal after a LONG only closed the long (net flat) — did not flip to short. "Long only" and "Short only" modes had the same issue.

**Fix (`bot/src/signal-bot.ts`):** Replaced simple `placeOrder` call with position-aware logic:

**Long & Short (both):**
- BUY signal → close existing SHORT (reduce-only) if any → open LONG + SL bracket
- SELL signal → close existing LONG (reduce-only) if any → open SHORT + SL bracket
- True flip, never flat between signals

**Long only:**
- BUY signal → open LONG + SL (skip if already long)
- SELL signal → close LONG (reduce-only), no short opened

**Short only:**
- SELL signal → open SHORT + SL (skip if already short)
- BUY signal → close SHORT (reduce-only), no long opened

**Key details:**
- `getAccountState()` called at start of each tick to read live position
- Cooldown only applies to opening new positions, not to protective closes
- Close trades are recorded to the trade journal (reduce-only closes)
- SL bracket (`slPct`) placed on every opening trade, never on closes
- TypeScript strict build passes (`npm run build` clean)

---

### 2026-05-24 — Full-site consolidation (Phases 1–5) on branch `full-site`

**Goal:** Merge `garlic-trading.vercel.app` (React analytics) and `bot.garlic-trading.net` (vanilla dashboard) into a single React SPA served by the Express bot server.

#### Phase 1 — Foundation (committed earlier)
- `vite.config.ts`: `build.outDir: 'bot/public'`, dev proxy `/api` + `/auth` → `localhost:3001`
- `bot/src/server.ts`: serves `bot/public/` as static files; SPA catch-all fallback (`*` → `index.html`, skipping `/api` + `/auth`); `/legacy` route serves old vanilla dashboard
- `src/contexts/AuthContext.tsx`: JWT at `localStorage('auth_jwt')` (same key as vanilla); `apiFetch()` helper attaches `Bearer` header, redirects to `/login` on 401; `AuthProvider` handles 404=single-tenant, 401=not logged in, 200=authed
- `src/pages/LoginPage.tsx`: Sign In / Register tabs, posts to `/auth/login` + `/auth/register`, stores token, navigates to `/backtest`
- `src/components/Sidebar.tsx`: rewrote with `useLocation`/`useNavigate`, 6 nav items, logout button
- `src/App.tsx`: React Router v7 with `BrowserRouter` + `AuthProvider` + `AppShell` + 6 routes

#### Phase 2 — Analytics integration (committed earlier)
- `src/lib/hlAssets.ts`: `useHLAssets()` hook fetches HL asset list from `/api/assets` (with JWT); module-level cache
- `BacktesterPage` + `GridPage`: symbol picker now uses HL assets via `useHLAssets()` instead of Binance `fetchSymbols()`
- `BacktesterPage`: added "Deploy as Signal Bot" button → stores `pending_signal_bot_config` in `sessionStorage` → navigates to `/signal`
- `GridPage`: replaced Export JSON buttons with "Deploy as Grid Bot" → `POST /api/bots` → navigate to `/bots?select=<id>`; removed `exportLines()` function

#### Phase 3 — Signal Bots page
- New `src/pages/SignalBotsPage.tsx` replaces `SignalTraderPage.tsx`
- Multi-bot sidebar (list + New Bot), config form (asset from HL, strategy/timeframe/params/size/direction/TP/SL), save/start/stop/delete
- `SignalChart` sub-component: LW Charts v5 candlestick + `createSeriesMarkers` for trade arrows
- `ManualTradeCard`: buy/sell buttons posting to `/api/order`
- Reads `sessionStorage('pending_signal_bot_config')` on mount for Backtester pre-fill
- Polls `/api/signal/bots/:id` every 5s

#### Phase 4 — Grid Bots page
- New `src/pages/GridBotsPage.tsx` ports vanilla grid bot tab
- Config: asset/lower/upper/gridCount/mode/timeframe, direct sizing (budget+leverage or order size), risk-mode auto-sizing (riskUsd + slPct → margin/leverage/SL-TP prices)
- `GridBotChart` sub-component: LW Charts v5 with grid price lines + SL/TP levels, `fetchKlines` for candle data
- Live stats panel (P&L/roundtrips/orders/fees), safety panel (SL/TP distances + liq price), activity log
- `?select=<id>` URL param deep-link from Grid Optimizer deploy
- Polls `/api/bots/:id/stats` every 5s

#### Phase 5 — Trade + Logs pages
- New `src/pages/TradePage.tsx`: account card (equity/withdrawable/margin), open positions list with close buttons, Place Order form (asset search, slippage, USDC amount, quick-size 25/50/75/Max, order preview), Position Calculator (risk$+SL%→qty/margin/SL prices), buy/sell via `/api/order`
- New `src/pages/LogsPage.tsx`: SSE via `EventSource('/api/logs/stream?token=<jwt>')`, level filters (All/Fills/Issues/Info), bot filters (auto-populated), auto-scroll with jump button, 2000-line ring buffer

#### Cleanup
- Deleted `src/pages/SignalTraderPage.tsx` (replaced by `SignalBotsPage.tsx`)
- Deleted `src/pages/ComingSoonPage.tsx` (all routes now live)
- Deleted `src/lib/env.ts` (bot URL/token logic no longer needed — same-origin)

**Gotchas:**
- `outDir: 'bot/public'` is relative to project root (where `vite.config.ts` lives), NOT `'../bot/public'` which would place files in `c:\Users\ken25\bot\public\`
- LW Charts v5: `chart.addSeries(CandlestickSeries)` not `chart.addCandlestickSeries()`; markers via `createSeriesMarkers()` plugin
- SSE EventSource can't send headers — JWT goes in `?token=<jwt>` query param
- `/api/assets` returns short names `['ETH', 'BTC', ...]` not `'ETHUSDT'` — `useHLAssets()` pads to full symbol for Binance candle fetching
- `POST /api/bots` body: `investment` not `riskUsd`; `stopLossPrice`/`takeProfitPrice` as absolute prices not percentages
- Build output CSS slightly smaller after `env.ts` removal (no unused `VITE_BOT_URL` reference)

**Next: Phase 6 (decommission)**
- Deploy `full-site` branch to VPS: `git pull && npm run build && pm2 restart trading-bot`
- Smoke-test all 6 routes at `bot.garlic-trading.net`
- `/legacy` stays until parity confirmed; then remove it
- After Vercel project deleted: remove `ALLOWED_ORIGINS=garlic-trading.vercel.app` from VPS `.env`
- Update `CLAUDE.md` architecture section

---

## 2026-05-24 — Signal Bots page: chart indicators, position sizing, remove ManualTradeCard

### What changed
- **`src/pages/SignalBotsPage.tsx`** — rewrote `SignalChart` to consume `mainLines` and `subPane` from
  the existing `/api/signal/bots/:id/chart-data` endpoint. Main pane now overlays strategy indicator
  lines (EMA, Bollinger, etc.); a synced sub-pane appears below for oscillators (RSI, MACD, Stoch)
  with dashed reference levels. Chart header shows active indicator IDs.
- **Position Sizing Calculator** — added to the bot config sidebar. Has its own Risk $ + Stop Loss %
  inputs (independent from `cfg.slPct`). Computes position notional, order qty, max leverage, margin,
  and SL prices. "Apply" button writes the computed qty into the Order size field.
- **ManualTradeCard removed** — moved user to TradePage which already has a full place-order panel
  (asset picker, quick-size buttons, position calculator, Buy/Sell). The bot-specific card was
  redundant and confusing.

### Gotchas
- Sub-pane uses a second LW Charts instance (not a native pane); timescale is synced via
  `subscribeVisibleLogicalRangeChange`. Both charts are created in a single `useEffect([entry])`
  that fires after `setEntry()` updates state — so `subRef.current` is in the DOM by then.
- `sizingSlPct` is local UI state (not saved to bot config). `cfg.slPct` (the bracket-order SL)
  remains separate.

---

## 2026-05-25 — Chart hover overlay reused on Signal Bots

### Motivation
The chart hover overlay (regime + OHLC + trade chip) was only on the Backtester
chart. The most valuable place to debug "why did my bot trade here?" is the live
Signal Bots chart — that's where real money is on the line. Extracted the
overlay once, applied it twice.

### What changed
- **New `src/components/ui/ChartHoverPanel.tsx`** — pure render component +
  `findCandleIndexByTime()` shared helper. Accepts:
  - `hover` (the `{ time, barIdx }` state owned by the parent)
  - `candles` for OHLC lookup
  - `regimeLabels` (optional, per-candle 0/1/2)
  - `tradeAtBar` (optional resolver that returns `{ label, pnlPct?, tone }`)
  - `position` ('top-left' | 'top-right') for placement choice
  Pointer-events-none, top-3/left-3, max-w-260, backdrop-blurred.
- **`src/components/ChartPanel.tsx`** — switched from the inline overlay to
  `<ChartHoverPanel>`. Trade resolver maps Backtester `Trade.entryTime` /
  `exitTime` to BUY/SELL/EXIT chips with pnl% on exits. Dropped the
  now-duplicate `REGIME_NAMES`/`REGIME_COLOR` constants and the inline hoverInfo
  IIFE. Net: cleaner ChartPanel, same UX.
- **`src/pages/SignalBotsPage.tsx`** — `SignalChart` sub-component now:
  - Computes `regimeLabels` from `analyzeRegime(candles).labels` in a useMemo
    (lazy, ≥30 candles required).
  - Adds `subscribeCrosshairMove` handler — pairs with `unsubscribeCrosshairMove`
    in the cleanup.
  - Wraps the chart div in a `relative` container and renders
    `<ChartHoverPanel>` with a `resolveTradeAtBar` that matches the live bot's
    `TradeRecord.time` (ms → seconds) to bar times.

### Gotchas
- Live `TradeRecord.time` is in milliseconds (from the bot's `Date.now()`
  recording); chart bar times are seconds (unix). Match with
  `Math.floor(tr.time / 1000) === c.time`. Don't forget the divide.
- The SignalChart uses TWO chart instances (main + oscillator sub-pane). Only
  the main chart's container gets the `relative` wrapper + overlay. The
  sub-pane keeps its own crosshair sync (already wired) but no hover panel —
  hover is anchored to the main pane only.
- Regime is recomputed on every candle refresh inside SignalChart. That's
  fine — `analyzeRegime` is cheap O(n) and the candles array updates rarely
  (asset/timeframe change). If the timer-based candle refresh becomes
  frequent, memoize harder or lift to a parent.
- Build: `npm run build` ✓ clean. Bundle 606 kB (+0.6 kB net — extracted
  component is now shared, plus the live Markov computation on SignalChart).

### Site state
| Page | Verdict UI | Live header | Stat tiles + tooltips | Chart hover overlay |
|---|---|---|---|---|
| Backtester | ✓ | – | ✓ | ✓ |
| Grid Optimizer | ✓ | – | ✓ | – |
| Signal Bots | – | ✓ | – | ✓ |
| Grid Bots | – | ✓ | – | – |
| Trade | – | – | ✓ | n/a |
| Logs | – | – | – | – |

---

## 2026-05-25 — Phase 4 follow-ups: Trade page StatTile makeover + chart hover panel

### What changed
- **Trade page (`src/pages/TradePage.tsx`)**
  - Account 3-tile grid swapped to `<StatTile>` with question titles:
    *"How much is the account worth?"* (Account Value) ·
    *"How much can I deploy right now?"* (Withdrawable) ·
    *"How much is tied up as collateral?"* (Margin Used).
    Withdrawable goes amber when < 20% of Account Value as a margin-stress hint.
  - **New asset-context strip** — only renders when an asset is selected. 4
    compact StatTiles mirroring the ConfidenceStrip pattern:
    *"What's the live mid price?"* (Hyperliquid mark) ·
    *"How much leverage is available?"* (max leverage ×) ·
    *"Is this real money?"* (network — green Mainnet / amber Testnet) ·
    *"What's my buying power here?"* (withdrawable × max leverage upper bound).
  - **Open Positions header** — added `<InfoTip>` next to the title, plus an
    inline *"total uPnL ±X.XX"* chip with its own InfoTip when positions exist.
    Tone tracks sign (gain/loss/neutral).
- **Backtester chart hover panel (`src/components/ChartPanel.tsx`)**
  - New `regimeLabels?: number[]` optional prop, threaded from BacktesterPage
    (`regime?.labels`).
  - `subscribeCrosshairMove` resolves the hovered bar via binary search and
    drives a new `hover` state.
  - Floating overlay panel (top-left of chart, `pointer-events: none`) shows:
    formatted bar timestamp · OHLC quad (colored) · regime chip (Bear/Sideways/Bull)
    · BUY (entry) / SELL (entry) / EXIT chip with pnl% when a trade marker
    sits on the hovered bar.
- **`src/lib/glossary.ts`** — added Account Value, Withdrawable, Margin Used,
  Mid Price, Max Leverage, Open Positions, Network. Removed the duplicate
  "Unrealized PnL" entry I'd added (the original at line 272 already exists).

### Gotchas
- LW Charts v5 — `chart.subscribeCrosshairMove(handler)` returns `void`, not an
  unsubscribe function. Pair with `chart.unsubscribeCrosshairMove(handler)` in
  the cleanup, and keep a reference to the handler. v4 returned the unsubscribe
  callback directly; v5 doesn't.
- Hover panel is positioned inside a `relative` wrapper that surrounds the
  chart `<div>`. Without that wrapper, the absolute positioning would escape to
  the page root. The wrapper is new — make sure it isn't accidentally removed
  when editing other chart effects.
- The TradePage hover-position calc uses live `assetInfo.midPx`. If the
  /api/asset-info endpoint is slow, the asset-context strip shows `—` until
  the first response lands — by design.
- Build: `npm run build` ✓ clean. Bundle 605 kB (+6 kB for the StatTile reuse,
  glossary entries, and the crosshair overlay logic).

---

## 2026-05-25 — Redesign Phase 4: Grid parity + Live bot header + Polish pass

Three parallel tracks landed in one pass. The Backtester verdict pattern now
extends to the Grid Optimizer and the two live bot pages, and the heavy
analytical cards no longer pay layout/paint cost while off-screen.

### 4A — Grid Optimizer parity
- **New `src/components/GridVerdictStrip.tsx`** — combined `<VerdictBadge>` +
  4-tile confidence strip tuned for grid bots:
  1. *Does the regime support grids?* — uses `isGoodForGrid(regime)`
  2. *How much would the best grid have earned?* — `best.totalReturnPct` / `totalPnl`
  3. *How often would it trade?* — roundtrips per day from window duration
  4. *Are fees covered per cell?* — spacing ÷ breakeven safety multiple
  Trade/Wait/Avoid verdict logic: TRADE when PnL > 0 + spacing ≥ 3× breakeven +
  regime supports grids + ≥5 roundtrips. AVOID when PnL ≤ 0 or spacing < 1×
  breakeven or (negative PnL in trending regime). WAIT otherwise.
- **`src/pages/GridPage.tsx`** — replaced the old "Regime banner" border-l-4
  card with `<GridVerdictStrip>` (only when static optimizer has a result).
  Auto-mode flow is unchanged.

### 4B — Live bot pages
- **New `src/components/LiveBotHeader.tsx`** — single shared header for any live
  bot pane. Pulsing colored status pill (RUNNING green / STOPPED dim / ERROR red),
  bot name, summary line, and inline chips: uptime, trades-this-session, last
  signal direction + relative time. Inline error strip rendered as a full-width
  strip across the bottom of the card when `lastError` is present.
- **`src/pages/SignalBotsPage.tsx`** — replaced the old "Status / control banner"
  block with `<LiveBotHeader>` + a sibling Start/Stop column. Removed the
  redundant *Last error* card (header now owns that). New-bot empty state gets
  a slim placeholder card. Unused `fmtTime` helper dropped.
- **`src/pages/GridBotsPage.tsx`** — same pattern. Grid bots have no
  `lastSignal` (they react to fills), so the header receives `tradesExecuted =
  stats.roundtrips` and uses the `stats.state` lifecycle to pick the colored
  state: live/init/waiting-trigger all map to `running`, `stopped` to `stopped`.

### 4C — Polish pass (perf + form UX)
- **`src/index.css`** — added two utility-class enhancements:
  - **`.defer-render`** — `content-visibility: auto` + `contain-intrinsic-size:
    1px 320px`. Skips layout and paint cost on any card that isn't near the
    viewport. The intrinsic size keeps scroll bars honest before render.
  - **`.field:user-valid / :user-invalid`** — input validation styling now flips
    *after* the user finishes editing (no flash mid-typing). Applies to every
    `<input>` already using the `.field` class, including `NumberInput`.
- **`src/components/RegimeBreakdownCard.tsx`** + **`ParamStabilityCard.tsx`** —
  root card gets the `defer-render` class. These are the heaviest stat cards
  on the Backtester page, so deferring them is the biggest win.

### Gotchas
- `:user-valid` / `:user-invalid` are Baseline 2023 — supported in all evergreen
  browsers. They only fire after blur/submit, so the styling won't flash while
  the user is still typing (which was the goal). NumberInput's local string
  buffer + blur-clamp behaviour pairs cleanly.
- `content-visibility: auto` will trigger a relayout when each card enters the
  viewport. The `contain-intrinsic-size: 320px` is a guess — undersized cards
  will jump up when their real height is measured. 320px matches the typical
  height of the two cards using it; if a deeper drilldown gets added, raise
  the value or compute it from the rendered height.
- LiveBotHeader's `state` derivation in SignalBotsPage: the redundant ternary
  `state.lastError ? (running ? 'error' : 'error') : ...` is intentional —
  visual: an errored stopped bot should look loud red (error), not greyed
  (stopped). If the user wants stopped-with-error to look stopped, simplify to
  `state.lastError ? 'error' : running ? 'running' : 'stopped'`.
- Build: `npm run build` ✓ clean. Bundle 599 kB (+6 kB for the new components
  and CSS utilities).

### Page status after Phase 4
| Page | Verdict pattern | Live header | defer-render | :user-valid |
|---|---|---|---|---|
| Backtester | ✓ Phase 1 | n/a | ✓ Phase 4C | ✓ Phase 4C |
| Grid Optimizer | ✓ Phase 4A | n/a | ✓ via Tailwind cards | ✓ Phase 4C |
| Signal Bots | n/a (live bot) | ✓ Phase 4B | n/a | ✓ Phase 4C |
| Grid Bots | n/a (live bot) | ✓ Phase 4B | n/a | ✓ Phase 4C |
| Trade | not yet | n/a | n/a | ✓ Phase 4C |
| Logs | n/a | n/a | n/a | n/a |

---

## 2026-05-24 — Redesign Phase 3: Regime breakdown + Kelly nudge + Parameter stability

Three quant additions landed in one pass — all on the Backtester page.

### 3a — Regime-conditional breakdown
- **New `src/lib/regimeStats.ts`** — `tradesByRegime(trades, candles, regimeLabels)`
  binary-searches each trade's entry time against the candle timeline, picks up the
  regime label at that bar, and aggregates per-regime stats: count, wins/losses,
  win rate, avg pnl %, total pnl %, best/worst, profit factor. Returns 3 buckets in
  fixed Bear/Sideways/Bull order plus an `untaggedCount` (trades that fell before
  the Markov window filled).
- **New `src/components/RegimeBreakdownCard.tsx`** — 3-row table (Bull on top, Bear
  on bottom) with colored dot + label + NOW badge for the live regime row. Auto-
  generates an "Insight:" line ("Edge concentrated in Bull — bleeds in Bear,
  consider trading only when regime = Bull"). Hidden entirely when no trades yet
  or no Markov result.

### 3b — Kelly fraction nudge
- **`src/pages/BacktesterPage.tsx`** — added a `kellyHint` `useMemo` deriving full
  Kelly + half Kelly from the latest backtest's win rate, avg win, avg loss.
  Pass-through to Controls. Null when `numTrades < 5` or avg win/loss are zero.
- **`src/components/Controls.tsx`** — new `kellyHint` optional prop. When in
  Risk-based sizing mode, renders an accent-tinted nudge box under the *Risk per
  Trade (%)* input: full Kelly + ½ Kelly numbers + one-click *Apply ½ Kelly* button
  that writes the half-Kelly value into `targetRiskPct`. Shows a *"Negative edge"*
  warning instead of the button when Kelly says don't bet.

### 3c — Parameter-stability heatmap
- **`src/lib/walkforward.ts`** — added `stabilityCheck()` and `StabilityResult` /
  `StabilityPoint` types. Cheap version of walk-forward (5 runs at -20/-10/0/+10/
  +20% param wiggles, full dataset, no fold loop). Returns Sharpe / total return %
  / numTrades per wiggle + a stability score (100 = perfectly flat Sharpe across
  the band, 0 = wild swings).
- **New `src/components/ParamStabilityCard.tsx`** — colored 5-tile strip. Each tile
  shows the wiggle %, Sharpe (big), return %, with bg color from a diverging
  green/amber/red palette mapped to the Sharpe value. The 0% tile is ringed in
  brand color with a "BASE" badge. Headline shows the stability score (0–100) +
  an auto-generated verdict line ("Robust — Sharpe stays in 0.82–1.10 band" / "
  Fragile — Sharpe collapses from 1.05 to -0.30").
- Wired into BacktesterPage below the regime breakdown.

### Page order on Backtester (right pane)
1. ConfidenceStrip
2. Chart
3. **Trade Summary** (verdict-first headline card)
4. **Regime Breakdown** ← new
5. **Parameter Stability** ← new
6. Results (detail grids, Risk Manager, equity + projection, Trade History collapsed)

### Gotchas
- `tradesByRegime` falls back to the nearest preceding candle when entryTime
  doesn't exactly match a bar — fine for closed-bar strategies, but for sub-bar
  entry times this could mis-tag by one bar at regime boundaries. Acceptable
  given the rolling regime window already smooths it.
- `stabilityCheck()` runs 5 backtests synchronously inside a `useMemo`. On a
  1,000-bar history with all 14 strategies this is ~25–50 ms — fine. If a
  particularly slow strategy lands later (e.g. complex Elliott), profile and
  move to a Worker.
- Kelly formula assumes win/loss returns are stationary. If the strategy's
  edge has drifted (use the regime breakdown to check), Kelly will over-bet.
  ½ Kelly is the practical compromise (Thorp / Aronson).
- Build: `npm run build` ✓ clean. Bundle 594 kB (+12 kB for the 3 features).

### Next (Phase 4 candidates)
- Apply the same `<StatTile>` + `<VerdictBadge>` + `<RegimeBreakdownCard>` pattern
  to the Grid Optimizer page (currently text-heavy, no verdict).
- Or jump to the Signal Bots / Grid Bots pages: collapse the config form when a
  bot is live, add a "Why this signal?" anchor-positioned popover at each chart
  marker.

---

## 2026-05-24 — Redesign Phase 2: Monte Carlo forward projection

### Motivation
Phase 1 landed the Trade/Wait/Avoid verdict + ConfidenceStrip with a placeholder
"forward equity band" tile. Phase 2 fills that placeholder with real Monte Carlo
output, then visualises the same band as a dashed fan extending past the historical
equity curve. Goal: answer *"if the next 30 trades land in a different random order,
where could my account be?"* — directly addresses the user's capital-preservation
brief.

### What changed
- **New `src/lib/montecarlo.ts`** — pure simulation library.
  - `simulateMonteCarlo(trades, opts)` bootstraps `pnlPct` with replacement,
    compounds 30 trades forward across 1,000 paths (defaults). Returns
    per-step p5/p50/p95 equity multipliers, final-equity percentiles, max-drawdown
    percentiles, P(profit at horizon), and P(ruin) where ruin = ≥50% drawdown.
  - Deterministic seeded RNG (Mulberry32) so the same trades + same seed = same
    output (cache-friendly, test-friendly).
  - `avgSecondsPerTrade(trades)` helper computes the avg gap between exit times,
    used to time-stamp the forward projection on the equity chart.
  - `mcPct(multiplier)` converts the equity multiplier to a signed % for display.
- **`src/components/ConfidenceStrip.tsx`** — placeholder MC tile replaced with
  real values: shows `+P5% → +P95%` as the headline range, median + ruin% in the
  sub-line. Tone: gain if pessimistic case still positive, loss if median loses,
  warn otherwise.
- **`src/components/Results.tsx`** — equity chart card retitled to
  *"Performance & Forward Projection"*, header now has a Monte Carlo InfoTip and
  3 new legend chips (MC median amber, MC p95 green, MC p5 red).
- **`EquityChart` rewrite** — accepts `trades` as a new prop, computes MC + avg
  trade interval in a `useMemo`, and adds 3 dashed LineSeries (p5, p50, p95)
  starting at the last historical equity point and projecting forward. p50 is the
  thickest of the three (most-likely outcome); p5/p95 form the cone edges.
- **`src/lib/glossary.ts`** — added Monte Carlo, Equity Band, Ruin Probability,
  Probability of Profit definitions for the new InfoTips.

### Key design decisions
- **Bootstrap with replacement** (not without): each path is a random re-shuffle
  of the historical trade-return distribution. Tests path-dependency; does *not*
  predict future market behaviour. Pair with walk-forward (already in repo) for
  out-of-sample confidence.
- **Equity floor at 0.001×** in the simulator — prevents math blowup if a long
  string of losers compounds toward zero. Real-world equivalent is broker
  liquidation; the floor stops paths from going negative without distorting the
  percentile bands.
- **Single 30-trade horizon for now** — keeps the UI legible. If users want
  longer projections later, expose `horizon` as a slider in Phase 5.
- **Projection time-stamps** use historical avg gap between exit times — gives a
  meaningful x-axis position without pretending we know future market timing.

### Gotchas
- The MC computation runs in two places (ConfidenceStrip and EquityChart). Both
  are `useMemo`-cached on `trades` identity, so the cost is ~5ms per recompute.
  If profile shows this hurting, lift it to BacktesterPage and pass down as a
  prop — for now duplication keeps each component independent.
- The chart projection extends past `chart.timeScale().fitContent()` because the
  projected points have timestamps after the last historical bar. LW Charts
  auto-fits to include them — desired behaviour.
- Build: `npm run build` passes clean. Bundle 582 kB (+4 kB for the MC lib +
  projection rendering).

### Next (Phase 3 candidates)
- Regime-conditional metrics (Sharpe / win-rate / DD broken out by Bull/Bear/Sideways
  from existing markov.ts labels).
- Kelly fraction + half-Kelly cap shown next to the Risk per trade input
  (foundation already in `RiskManager` — surface it as a primary input nudge).
- Parameter-stability heatmap built on top of existing `walkforward.ts`.

---

## 2026-05-24 — Phase 1 refinement: SummaryPanel promoted, Trade History collapsed, Sortino dropped

### What changed
- **`src/pages/BacktesterPage.tsx`** — swapped order: `<SummaryPanel>` now renders
  *before* `<Results>` instead of after. Verdict + StatTile grid are the first thing
  the user sees once a backtest completes; the detailed metric grids + equity chart +
  trade history come after.
- **`src/components/SummaryPanel.tsx`** — added highlight treatment so it reads as
  the headline card: `ring-1 ring-brand/30` + `shadow-[0_0_0_4px_hsl(var(--brand)/0.05)]`
  outer halo, a gradient brand stripe across the top (`from-brand via-accent to-brand`),
  and a glowing brand dot next to the new "Trade Summary" title (was "Strategy Report").
- **`src/components/Results.tsx`** — dropped the **Sortino Ratio** tile from the
  Advanced Quant Metrics row (too redundant with Sharpe; both measure return/volatility).
  Row went from `sm:grid-cols-5` to `sm:grid-cols-4`: Sharpe · Calmar · Expectancy ·
  Avg Hold Bars. Calmar stays because it's drawdown-adjusted (matches the capital-
  preservation persona); Expectancy stays because it's $/trade (concrete).
- **Trade History collapsed by default** — wrapped in a click-to-expand `<button>`
  header with `ChevronDown`/`ChevronRight` icon and `aria-expanded`. State lives in
  `historyOpen` (default `false`). Auto-opens when the user picks a trade from the
  chart (so the row is visible). Still positioned at the bottom of the Results card
  — no move needed.

### Gotchas
- The `selectedTrade` → auto-expand effect runs unconditionally on `selectedTrade`
  change; only when the value is truthy does it flip `historyOpen` to true. Clicking
  to deselect doesn't collapse the table (intentional — user may still be reading).
- `SummaryPanel` is now visually heavier than other cards by design. If we add a
  second "headline" card anywhere on the page, give that one the same treatment so
  the visual hierarchy stays consistent.
- Build: `npm run build` passes clean. Bundle 578 kB (was 577 kB — `+1 kB` from the
  Chevron icons + collapsible logic).

---

## 2026-05-24 — Redesign Phase 1: Verdict-first UI + Confidence Strip

### Motivation
Plan call (ui-ux-pro-max + modern-web-guidance): site needs a clear "Trade / Wait /
Avoid" verdict at the top, info tooltips on every stat (question-style titles), and
a shared "ConfidenceStrip" that gates the Deploy CTA. Foundation for upcoming
Monte Carlo and regime-conditional metric work.

### What changed
- **New `src/components/ui/VerdictBadge.tsx`** — Trade ✓ / Wait ⏸ / Avoid ✗ pill
  with reasons list. Exports `decideVerdict(result, regime)` pure function so the
  threshold logic is the single source of truth. Trade requires: >5% return, <25% DD,
  PF ≥ 1.5, Sharpe ≥ 0.5, beats Buy & Hold, ≥10 trades. Avoid triggers on
  <-5% return, PF < 0.9, or DD > 40%. Everything else = Wait.
- **New `src/components/ui/StatTile.tsx`** — shared stat card with question title,
  InfoTip ⓘ, tabular-nums value, optional colored bar, sub-line. Has `compact` prop
  for ConfidenceStrip use. Replaces the inline `MetricCard` previously living inside
  SummaryPanel.
- **New `src/components/ConfidenceStrip.tsx`** — 4-tile horizontal strip placed at
  the top of the Backtester right pane. Tiles:
  1. *Does the regime support this trade?* — derives alignment of regime + direction
  2. *What's the forward equity band?* — placeholder until Phase 2 Monte Carlo
  3. *How bad can it get?* — historical max drawdown
  4. *What's the edge per trade?* — μ ± σ of per-trade pnlPct with edge-vs-noise sub
- **`src/components/SummaryPanel.tsx`** rewritten — leads with `<VerdictBadge>`
  (clear Trade/Wait/Avoid call), then 5 StatTile cards (return / drawdown / win-rate /
  profit factor / Sharpe) and a regime tile. Removed the old prose verdict at the
  bottom — the badge + reasons list now does that job more directly.
- **`src/components/Results.tsx`** — every `<Metric>` now has a `tooltipTerm`
  (Strategy Return, Net P&L, Buy & Hold, Final Equity, Trades, Avg Win, Avg Loss,
  Best Trade, Worst Trade). No more bare stats.
- **`src/lib/glossary.ts`** — added 10 new entries (Strategy Return, Net P&L,
  Buy & Hold, Final Equity, Trades, Avg Win, Avg Loss, Best Trade, Worst Trade,
  Avg Holding Bars, Verdict).
- **`src/pages/BacktesterPage.tsx`** — wires ConfidenceStrip above the chart card,
  inside the right section.

### Gotchas
- `decideVerdict` is exported separately so the same Trade/Wait/Avoid logic can be
  reused in ConfidenceStrip if we later swap the "MC equity band" tile for a verdict
  echo. Don't duplicate the thresholds — import the function.
- `StatTile`'s `info` prop is a glossary key first, raw string second (same contract
  as `InfoTip term`). When in doubt add a glossary entry rather than passing a long
  inline string.
- Build: `npm run build` passes clean (TS noEmit + Vite). 577 kB bundle, no new
  warnings.

### Next (Phase 2)
Monte Carlo lib (`src/lib/montecarlo.ts`) — bootstrap trade returns to project a
30-trade forward equity band (p5/p50/p95), then wire it into the placeholder
ConfidenceStrip tile and overlay the band on the equity chart in Results.

---

## 2026-05-24 — Backtester left pane redesign + deploy bug fix

### What changed
- **`src/components/Controls.tsx`** — reorganized into three clear labeled sections:
  1. **Data** (asset, timeframe, date range with inline Reload icon — no standalone reload button)
  2. **Strategy** (badged "deploys to bot"): strategy, params, direction, SL%, TP%
  3. **Simulation** (badged "backtest only"): capital, fee, position sizing
- **`src/pages/BacktesterPage.tsx`** — deploy card now:
  - Shows a live summary of what will be deployed (asset, strategy, TF, direction, SL/TP)
  - Translates `positionMode` into Signal Bot sizing:
    - `fixed` → order size (qty) input, passed as `size`
    - `compounding` → same qty input with a "compounding not supported by bot" warning
    - `volatility` → computes `riskUsd = targetRiskPct% × capital`, shows preview panel, passes `riskUsd` + `sizingSlPct`
  - **Fixes bug**: `stopLossPct` and `takeProfitPct` were never included in the sessionStorage payload → bot always got `slPct: undefined / tpPct: undefined`
- **`src/pages/SignalBotsPage.tsx`** — pending-config reader now handles:
  - `size`, `slPct`, `tpPct` — applied directly to the new bot config
  - `riskUsd` + `sizingSlPct` — pre-fills the Risk Mode sizing calculator so volatility-mode deploy flows end-to-end without manual re-entry

### Gotchas
- `positionMode` and related state are still persisted in BacktesterPage so existing users don't lose their settings. The backtest itself still runs all three modes correctly.
- `deployPayload` is a `useMemo` that recomputes whenever any relevant value changes — no stale deploy data.

---

## 2026-05-25 — Fundamentals page (new)

### What changed
A new "Fundamentals" page at `bot.garlic-trading.net/fundamentals`, framed
as an institutional analyst would frame BTC: sentiment, valuation, regime,
positioning, and breadth — each presented as a question the card answers.

**Server (`bot/src/fundamentals.ts`, new file)**
- In-memory `cachedFetch` per endpoint (1h–6h TTLs) so we stay polite to the
  free public APIs and never hammer them on rapid UI refreshes.
- Six data sources, all FREE / no key required:
  - **Fear & Greed Index** — alternative.me `/fng/?limit=365`
  - **MVRV** — CoinMetrics community API `CapMVRVCur` metric (chose this over
    Bitcoin Magazine Pro to avoid the API-key dependency)
  - **BTC Dominance** — CoinGecko `/api/v3/global`
  - **Funding rates** — Binance `fapi/v1/fundingRate?symbol=BTCUSDT` (240 = 80d)
  - **Open interest** — Binance `futures/data/openInterestHist?period=4h` (180 = 30d)
  - **Wyckoff-style regime** — computed locally from Binance daily klines via
    a 4-state heuristic scorer (EMA50/200 stack + 30D return + Donchian
    position + Bollinger bandwidth quantile). Returns label + confidence %.
- **Verdict aggregator** — fans out all calls in parallel, scores each
  dimension into a bias in [-1, +1], blends with hand-tuned weights
  (valuation 30, regime 30, sentiment 20, leverage 15, breadth 5), maps the
  composite to one of 5 stances (Bullish / Cautiously Bullish / Neutral /
  Cautiously Bearish / Bearish) and writes a 2-3 sentence analyst paragraph.
- Router mounted at `/api/fundamentals/*` with `requireAuth` on every route,
  so multi-user mode keeps everyone gated.

**Frontend (`src/pages/FundamentalsPage.tsx`, new file)**
- Single React page using existing Tailwind tokens + Lightweight Charts v5.
- Top: Overall Verdict card (stance pill + analyst paragraph).
- Then: 5-chip summary row (Sentiment / Valuation / Regime / Leverage / Breadth)
  with tone-coded colors (gain / loss / warn / neutral).
- Then: 5 Q-cards, each titled as a question:
  1. *"Is the market greedy or fearful?"* — F&G gauge + 1Y history area chart
  2. *"Is BTC overvalued vs its own history?"* — MVRV line with mean band and
     1.0 / 3.7 reference zones
  3. *"Which Wyckoff phase are we in?"* — candles + EMA50/200 with phase label
  4. *"Is leverage flashing a warning?"* — funding rate + OI dual mini-chart
  5. *"Risk-on or risk-off across crypto?"* — BTC dominance bars
- Each card ends with a one-line interpretation rendered from the latest data
  (no static copy — the text changes with the readings).
- Wired in `src/App.tsx` and `src/components/Sidebar.tsx` (new Brain icon entry
  between Grid Bots and Trade).

### Decisions worth remembering
- Picked **CoinMetrics community API** for MVRV over Bitcoin Magazine Pro
  because it needs no API key and has been stable as a free tier for years.
- Wyckoff classification is **not** the full 11-event schematic; it's an
  honest 4-state regime ("Accumulation/Markup/Distribution/Markdown") with a
  confidence %. Trying to detect the full schematic algorithmically produces
  unreliable labels even on the same chart pros disagree on.
- All API caching is in-memory only (`Map<string, { ts, data }>`). Survives
  any number of dashboard refreshes but resets on pm2 restart — acceptable
  since cold-start fetches finish in <2s.
- No CSP changes needed: browser only talks to same-origin `/api/fundamentals/*`;
  Node has no CSP, so outbound calls to alternative.me / coinmetrics / coingecko
  / binance just work.

### Gotchas
- Binance `fapi` endpoints occasionally rate-block specific cloud IPs.
  If `/api/fundamentals/funding` or `/oi` returns 502 from the VPS, it's
  upstream — increase cache TTL or switch to a CDN-fronted Binance mirror.
- `bollinger()` from `bot/src/strategy/indicators.ts` returns `{ mid, upper, lower }`
  (not `middle`) — caught this on the first build.

---

## 2026-05-25 — Fundamentals page polish + 3 Tier-A cards

### What changed
**Polish pass** (applied via `/ui-ux-pro-max` + `/modern-web-guidance` skills):
- **Container queries** on each Q-card (`.fund-card` in `index.css`) — cards now reflow based on
  their own width, not the page viewport.
- **Lightweight Charts** `rightOffset: 0` + `fixLeftEdge/fixRightEdge: true` + `attachReflow()`
  helper that re-runs `fitContent()` on every resize. Fixes the "data clusters on the left,
  whitespace on the right" bug.
- **View Transitions API** wraps the refresh state swap — smooth cross-fade between old and new
  readings on supporting browsers; falls back to instant update otherwise.
- **`prefers-reduced-motion`** guard in `index.css` disables refresh spin + VT animations.
- **Accessibility**: `aria-live="polite"` on verdict card; `aria-label` summaries on every chart
  container; `role="progressbar"` with min/max/now on dominance bars; `role="alert"` on error
  banner; `aria-busy` skeleton; `focus-visible:ring` on refresh button.
- **Trend arrows** on chips — computed from the last value vs ~7-period-ago in history series we
  already fetch. Adds shape redundancy so colorblind users can read the chips.
- **Tabular numerals** (`.fund-num` → `font-variant-numeric: tabular-nums`) on every numeric
  readout.
- **Skeleton grid** matches the final card heights so there's zero CLS on first load.

**Three new Tier-A cards** (server `bot/src/fundamentals.ts` + frontend cards):

1. **Realized Volatility & ATR%** — *"How violent is the market right now?"*
   - Computes 7D/30D annualized realized volatility from daily log returns + 14D ATR%
   - Zone labels: Calm (<25%), Normal (25-50%), Elevated (50-80%), Extreme (>80%)
   - Interpretation tells the bot operator how to adjust grid spacing + SL distance
   - Source: Binance daily klines (free)

2. **Cycle Position (Mayer Multiple + Pi Cycle Top)** — *"Where in the macro cycle are we?"*
   - Log-scale price chart with 200DMA overlay, 111DMA × 2 and 350DMA (Pi Cycle indicator)
   - Mayer zones: Cheap (<0.8), Fair (0.8-1.8), Hot (1.8-2.4), Cycle Top (>2.4)
   - `piGapPct` = distance from 111DMAx2 to 350DMA crossover; negative = not in top zone
   - Source: Binance daily klines (1000 bars ≈ 2.7y, enough for 350DMA)

3. **Smart-Money Positioning (Top-Trader L/S + Coinbase Premium)** — *"Where is the smart money?"*
   - Binance top-trader long/short account ratio (`futures/data/topLongShortAccountRatio`, 4h, 30 days)
   - Coinbase Premium Gap = (Coinbase BTC-USD daily close − Binance BTCUSDT daily close) / Binance × 100
   - Source: Binance public + `api.exchange.coinbase.com/products/BTC-USD/candles` (both free)

### Decisions worth remembering
- Did NOT touch the verdict aggregator. The 5-input verdict scoring is balanced and tested;
  bolting on 3 more dimensions would require retuning weights. v2 verdict can incorporate them
  later if the standalone cards prove useful.
- Coinbase candle endpoint (`api.exchange.coinbase.com`) caps at 300 bars and no API key —
  10 months of premium history, plenty for the card.
- Pi Cycle Top is rendered as two dotted MA lines on the cycle chart rather than a separate
  signal marker; reading the gap is more honest about how blunt the indicator actually is.
- Cycle chart uses `mode: 1` (log scale) on the right price scale so multi-year BTC price
  history doesn't get squashed by recent values.
- 8 cards in a 2-col grid = 4 rows, no empty slots.

### Gotchas
- Binance fapi top L/S endpoint sometimes returns rate-block on specific cloud IPs from
  certain regions; same risk profile as the existing funding/OI endpoints.
- CoinMetrics community MVRV and now Coinbase Exchange API are both rate-limited — our cache
  TTLs (6h MVRV, 5m smart-money) stay well under the limits.

---

## 2026-05-25 — Fundamentals: chart tooltips + expand-to-modal

### What changed
- Every chart now has a **hover tooltip** anchored in the top-left corner of the
  chart area, showing the values for each series at the hovered timestamp.
- Every chart card now has a **maximize button** in the top-right that opens a
  native `<dialog>` rendering the same chart at 70vh height. ESC and backdrop
  click close it; focus is trapped natively.

### Tooltip content per chart
- **Fear & Greed**: Date · F&G value · Mood classification
- **MVRV**: Date · MVRV · ± vs long-term mean · Zone
- **Wyckoff Regime**: Date · O H L C · EMA50 · EMA200
- **Funding rate**: Time · % per 8h · Annualized APR
- **Open Interest**: Time · $B · Δ vs previous bar
- **Volatility**: Date · 30D RV · 7D RV · ATR% · Zone
- **Cycle (price + 200/111×2/350)**: Date · BTC · 200DMA · Mayer · 111×2 · 350DMA · Pi gap
- **Top-trader L/S**: Time · Ratio · Reading (crowded long/balanced/lean short)
- **Coinbase Premium**: Date · Premium % · Reading (US bidding / Asia-led / flat)

Dominance card stays as bars — no chart, no tooltip (bars already show exact %).

### Implementation
- New `attachTooltip(el, chart, formatter)` helper in `FundamentalsPage.tsx`
  creates an absolutely-positioned `.chart-tooltip` div inside the chart
  container and subscribes to `subscribeCrosshairMove`. The formatter receives
  the LWC param and returns the tooltip HTML (or null to hide). Returns a
  cleanup that unsubscribes and removes the DOM node.
- Each card extracts its chart-building logic into a `setupChart(el)` callback
  via `useCallback`. The same setup runs once for the inline chart and again
  inside the dialog when opened — two independent LWC instances share the
  same data + tooltip behaviour with zero duplication.
- New `<ExpandableQCard>` component handles the inline+modal pattern for
  single-chart cards (Fng/MVRV/Regime/Vol/Cycle). Multi-chart cards
  (FundingOi + SmartMoney) inline their own dialog because they have two
  charts in the body that both need to render twice.
- Tooltip uses `nearest(history, time)` binary search to find the closest
  data point — works on every series shape we have.

### Decisions worth remembering
- Used the **native `<dialog>`** element instead of a portal modal. ESC, focus
  trap, scroll lock, `::backdrop` all come for free. Wired via
  `dialog.showModal()` / `dialog.close()` in a side-effect that mirrors the
  `open` React state.
- Tooltips are **anchored top-left** (not cursor-following). Less jittery,
  doesn't occlude what the user is hovering, and matches the dashboard
  aesthetic. Trade-off: slightly less precise about which bar the readings
  correspond to, but the date row makes that explicit.
- `reduced-motion` already disables the tooltip's opacity transition via the
  global rule in `index.css`.

### Gotchas
- LWC v5 `subscribeCrosshairMove` types are a bit awkward — cast through
  `unknown as CrosshairSubscribe` for both subscribe and unsubscribe.
- The dialog's modal chart needs `if (open && ref.current)` in the effect so
  the setup only runs after the dialog is actually mounted; otherwise the
  container is `null` on the first open.

---

## 2026-05-25 — Bugfix: Trade page wasn't actually placing SL on Hyperliquid

### What was broken
Manual orders placed from the Trade page in Risk-based sizing mode were going
out as bare market orders — no SL, no TP attached. The SL% field was being
used *only* to back out the position size in the calculator and render the
"SL long / short" preview; the actual `POST /api/order` body did not include
`slPct` or `slPrice`, so `placeOrder()` had nothing to convert into a reduce-
only stop on Hyperliquid.

Behaviour observed: the "Where's my stop loss?" stat tile on the position
detail card kept showing "—" for manually-opened positions, while signal-bot
and grid-bot positions on the same account showed their SL correctly. The
brackets fetcher was working — there was just no SL trigger order to find.

### What changed
- `src/pages/TradePage.tsx` — risk-based sizing form now includes an optional
  **TP %** input alongside the existing SL %. Layout changed from 2-col
  (Risk / SL) to 3-col (Risk / SL / TP).
- `sizing` calc extended with `tpLong`, `tpShort`, `rrRatio` (= tpPct/slPct).
- Preview card now shows the TP prices and the R:R ratio with tone (green
  ≥2:1, warn ≥1:1, loss otherwise) so the user sees the trade-off before
  pulling the trigger.
- `placeOrder()` order body now includes `slPct` and (if set) `tpPct` when
  `sizingMode === 'risk'`. Fixed-USDC mode is unchanged — still places bare
  market for now, by design.
- Order status toast now reads `✓ BUY 0.01 BTC (SL -2%, TP +4%) placed`
  when brackets are sent, so the user has explicit confirmation that the SL
  went out with the entry.

### Why this matters
The brackets are placed by `bot/src/trade.ts::placeOrder` from the **actual
fill price** (not the form's mid-px estimate), so a 2% SL is exactly 2% from
where the position opened — slippage doesn't compound the risk. The same
code path is what powers signal-bot and grid-bot SL placement, so manual
trades now have the same safety surface.

### Verifying the fix
1. Open a small position from the Trade page in Risk-based mode with SL %
   and (optionally) TP % set.
2. Within ~10s the "Where's my stop loss?" tile on the position detail
   card populates with the actual SL price.
3. The position chart overlays show entry + SL (+ TP) lines.
4. On Hyperliquid web: the orders list should show two reduce-only stop
   orders alongside the position.

### Gotchas
- `getPositionBrackets()` in `bot/src/trade.ts` returns `null` for both
  slPx and tpPx when it can't resolve a reference mid-price (the asset
  meta call is wrapped in try/catch but the classification logic only runs
  `if (refPx !== null)`). Not the cause of this bug (no triggers existed
  in the first place), but worth flagging for future: if HL ever rate-
  limits the meta call, the brackets card would silently go blank even
  with valid SL/TP on the exchange.
