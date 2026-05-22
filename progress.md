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

### Phase 5 — Signal Trader: autonomous indicator bot + dedicated page (current)

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

## Current state

| Area | Status |
|---|---|
| Web app (Vercel) | ✅ deployed — garlic-trading.vercel.app |
| Bot (local) | ✅ running — `cd bot && npm start` |
| GitHub | ✅ pushed to master & new branch `autotrade` created |
| SL/TP on Hyperliquid | ✅ verified — correct trigger conditions confirmed in order history |
| Multi-bot | ✅ working — manage via dashboard at `http://localhost:3001` |
| Signal Trader | ✅ verified — autonomous indicator bot, 3rd tab, localhost-gated |
| Trade API security | ✅ CORS locked to localhost; input validated; slippage capped |

---

## Known limitations / next ideas

- Grid lines not visible on bot dashboard chart (GridChart not re-rendering after config load)
- No position sizing for "both" direction grids (current formula assumes long-only)
- Grid bot has no auto-restart on crash (the Signal Trader does — resumes from saved state)
- Signal Trader supports one bot at a time (grid bots support many)
- Signal Trader polls candles every 30s rather than streaming on candle close
- No webhook / alert when SL or TP triggers

