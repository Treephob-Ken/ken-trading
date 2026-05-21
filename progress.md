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

## Current state

| Area | Status |
|---|---|
| Web app (Vercel) | ✅ deployed — garlic-trading.vercel.app |
| Bot (local) | ✅ running — `cd bot && npm start` |
| GitHub | ✅ pushed to master & new branch `autotrade` created |
| SL/TP on Hyperliquid | ✅ verified — correct trigger conditions confirmed in order history |
| Multi-bot | ✅ working — manage via dashboard at `http://localhost:3001` |
| Auto-Trading | ✅ verified — orders trigger on simulated BUY/SELL signals |

---

## Known limitations / next ideas

- Grid lines not visible on bot dashboard chart (GridChart not re-rendering after config load)
- No position sizing for "both" direction grids (current formula assumes long-only)
- No auto-restart if bot crashes mid-session
- Backtester drawing tools: trend line and Fibonacci not yet implemented
- No webhook / alert when SL or TP triggers

