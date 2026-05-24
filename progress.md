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
