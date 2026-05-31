# Progress — current status

> This file is a **snapshot of where the project is now**, not a changelog.
> Max ~200 lines. When something changes, **edit the relevant section** —
> don't append a dated entry. Git history is the changelog.

Last reviewed: 2026-05-31 (Portfolio page redesign — account-value trend, max drawdown, bot leaderboard, cross-filter)

---

## What this project is

A self-hosted crypto trading workbench for Hyperliquid perps. One Express
server on a VPS serves both the React SPA (backtester, grid optimizer, live
bot controls) and the trading engines (grid bots + signal bots).

Live at **https://bot.garlic-trading.net** (Cloudflare Tunnel → VPS).

---

## Current architecture (high level)

```
Browser → https://bot.garlic-trading.net (Cloudflare Tunnel)
        → VPS localhost:3001 (pm2: trading-bot)
        → Express server
            ├─ GET /            → React SPA from bot/public/ (committed)
            ├─ GET /api/*       → REST API (JWT-gated in multi-user mode)
            ├─ GET /auth/*      → register / login / me
            ├─ GET /settings/*  → per-user HL creds (AES-256-GCM at rest)
            └─ GET /admin/*     → admin-only user management
        → Hyperliquid API (testnet/mainnet) for orders
        → Binance REST (data-api.binance.vision) for market data
```

Vercel is **decommissioned**. Single live surface = the VPS.

Multi-user mode (`MULTI_USER=true`) is enabled. Registration is
**invite-only** via `ALLOWED_EMAILS`. Each user has their own HL agent
key, their own bot configs, and isolated data under `bot/data/<userId>/`.

---

## What's working today

| Area | Status |
|---|---|
| Live VPS (DigitalOcean SGP1, $6/mo) | ✅ 24/7, pm2 autostart |
| Cloudflare Tunnel at bot.garlic-trading.net | ✅ pm2 process `cloudflare-tunnel` |
| Multi-user auth (register / login / JWT) | ✅ invite-only via `ALLOWED_EMAILS` |
| Per-user HL credentials (encrypted at rest) | ✅ saved via Settings page |
| Grid bots (multi-bot, per-asset) | ✅ autostart + HL order reconciliation across restarts |
| Signal bots (13 strategies + ensemble) | ✅ position-aware (flip on opposite signal), risk-based sizing |
| Manual trade page (Buy/Sell + SL/TP brackets) | ✅ uses `positionTpsl` grouping; both legs reported in toast |
| Close All Positions (single confirm, parallel) | ✅ |
| Account-wide kill switch | ✅ stops every bot for the user |
| Slippage gate (rejects orders past N% past mid) | ✅ |
| Network badge (testnet/mainnet) | ✅ in sidebar |
| Strategy Backtester (Binance candles, MTF, regime, walk-forward) | ✅ |
| Grid Optimizer (sweep + deploy-to-bot) | ✅ |
| Currency Scanner (Indicator + Grid tabs, batch-rank top 30 HL coins, persisted results + colored verdicts) | ✅ |
| Scanner — "Stocks & Commodities" universe toggle (HIP-3 ranked by HL open interest) | ✅ Phase A read-only |
| HIP-3 markets (Gold, S&P 500, US stocks, forex, oil) in Backtester + Symbol picker | ✅ Phase A — backtest |
| HIP-3 live trading via Trade page market + limit orders | ✅ Phase B + C.3 |
| HIP-3 positions visible + closeable in Trade page Open Positions (cross-dex) | ✅ Phase C.1 |
| Signal bots can target HIP-3 symbols (xyz:GOLD etc.) end-to-end | ✅ Phase C.2 |
| Live SSE log tail across all bots | ✅ Logs page |
| Market Structure page (LuxAlgo SMC port) | ✅ `/structure`: BOS/CHoCH + structure lines, Strong/Weak, Order Blocks (boxes), EQH/EQL, Fair Value Gaps, Premium/Discount zones, MTF prev D/W/M levels. Internal structure (dashed, length 5), trend-colored candles. Per-layer show/hide toggles, SymbolSearch dropdown, **Setup Summary** panel (bias/zone/nearest OB-FVG-liquidity + plain-language note via `src/lib/smc/summary.ts`), **Strategy Test** panel (`src/lib/smc/strategyTest.ts` — compares CHoCH / BOS+CHoCH / CHoCH-in-zone entries by win-rate + expectancy + profit factor, causal 2R sim), and **Deploy to Signal Bot** (strategy=smc, risk-based sizing). Engine `src/lib/smc/` is pure + unit-tested (Vitest, 20 tests) |
| Unit tests (Vitest) | ✅ `npm test` — SMC engine covered; first test suite in the repo |
| Login page redesign (dot-grid, framer-motion) | ✅ |
| Portfolio page — account-value trend (HL portfolio), max drawdown, bot leaderboard, Power BI cross-filter | ✅ two-layer model (see gotcha) |

---

## What's still pending

- [ ] **SMC Market Structure — follow-ups** (spec: `docs/superpowers/specs/2026-05-31-smc-market-structure-design.md`).
      Phases 1-3 shipped. Remaining nice-to-haves: trend-colored candles; internal-structure (length-5)
      BOS/CHoCH + internal order blocks; richer deploy-to-bot triggers (order-block tap / FVG entry, not just
      swing CHoCH — would need the SMC engine ported into `bot/src/strategy/` to keep web↔bot in sync);
      volume-profile-weighted order blocks (JacobMagleby idea — needs lower-TF volume). ⚠️ LuxAlgo SMC is
      CC BY-NC-SA (non-commercial only). Chart visuals are verified by the user on deploy, not by automated test.
- [ ] HIP-3 follow-ups (none blocking; nice-to-haves):
      - Resting limit orders aren't shown anywhere in the dashboard; you only
        know a limit didn't fill by checking the HL UI directly.
      - Position detail chart for HIP-3 (the inline candle chart you see after
        clicking an Open Position row) still hits Binance with `${asset}USDT`
        and silently fails — switch to the HL candleSnapshot path like the
        Backtester already does.
      - No Grid Bot creation flow for HIP-3 yet (Grid math + UI need the same
        canonAsset treatment we applied to signal bots).
- [ ] Per-user audit log: `limits.ts:recordTrade` accepts `userId` but
      `trade.ts` doesn't thread it through, so all entries still land in the
      global `bot/trade-audit.log`.
- [ ] Grid bot has no auto-restart on crash (signal bots do — resume from
      saved state).
- [ ] Signal bot polls candles every 30s instead of streaming on candle close.
- [ ] No webhook / push alert when SL or TP triggers.
- [ ] Budget/risk mode freezes size at start — no periodic recalculation as
      price drifts.
- [ ] If HL rate-limits `info.meta()`, the brackets card on the position
      detail can silently go blank even when SL/TP exist on the exchange.

---

## How to run

### Local dev
```powershell
# Terminal 1 — bot
cd bot ; npm run serve

# Terminal 2 — web (proxies /api + /auth to localhost:3001)
npm run dev
```
Open http://localhost:5173.

### Deploy to VPS
```powershell
# Local — only if anything under src/ changed
npm run build
git add . ; git commit -m "<desc>" ; git push origin master

# On VPS (ssh root@68.183.184.170)
cd ~/ken-trading ; ./deploy.sh
```
`deploy.sh` does: `git reset --hard origin/master` → conditional `npm install`
(only if `bot/package-lock.json` changed) → `pm2 restart trading-bot`.
Safe — `.env`, `bot/data/`, `bot/configs/`, audit log are all preserved.

### VPS health
```bash
pm2 status
pm2 logs trading-bot --lines 50
pm2 restart cloudflare-tunnel    # if tunnel drops
```

---

## Key env vars (`bot/.env`)

| Var | Purpose |
|---|---|
| `MULTI_USER=true` | Enable multi-user auth (currently on) |
| `ALLOWED_EMAILS` | Comma-separated registration whitelist (locked to ken2540@gmail.com) |
| `OWNER_EMAIL` | First registration with this email becomes admin |
| `KEY_ENCRYPTION_SECRET` | 64-hex string for AES-256-GCM on HL agent keys (**unrecoverable if lost**) |
| `JWT_SECRET` | Signs 7-day session tokens |
| `MAX_TRADE_NOTIONAL_USD` | Hard cap per order |
| `ALLOWED_ASSETS` | Allow-list of tradeable perps |
| `MAX_TRADES_PER_HOUR` | Rolling rate limit |
| `HOST=127.0.0.1` | Bind localhost only (behind tunnel) |

---

## Gotchas to remember

- **Node.js 22+ required on VPS.** Node 20 has no native `WebSocket`, which
  `@nktkas/hyperliquid`'s `WebSocketTransport` needs. After any Node upgrade,
  run `npm rebuild` in `bot/` to recompile `better-sqlite3`.
- **Two strategy code trees stay in sync.** `src/lib/strategies.ts` (web)
  and `bot/src/strategy/strategies.ts` (bot) — the bot must trade what the
  backtester shows.
- **Two entry points in `bot/`.** Use `npm run serve` (→ `server.ts`, the
  Express server + dashboard). `npm start` (→ `index.ts`) is the legacy
  standalone single-bot runner — no API, no dashboard.
- **Hyperliquid bracket orders use `grouping: 'positionTpsl'`** — not `'na'`.
  Bare `na` grouping silently fails for TP-style triggers.
- **Brackets lookup uses `info.frontendOpenOrders`**, not `info.openOrders` —
  the basic schema doesn't expose `isTrigger`/`triggerPx`/etc.
- **HL price rules:** 5 significant figures AND `(6 - szDecimals)` decimal
  places. `roundPrice()` in `hyperliquid.ts` enforces both. Skipping →
  silent order rejection.
- **Signal bot IDs are UUIDs in multi-user mode** to avoid cross-user
  registry collisions in the shared `Map`.
- **`bot/public/` is committed to git.** No separate frontend deploy —
  `git push` ships the SPA along with the bot.
- **PowerShell `&&` doesn't work** on Windows 11 (PS 5.1). Use `;` or
  `; if ($?) { ... }`.
- **Scanner persistence uses `sessionStorage`** (not `localStorage`) so results
  survive page navigation but reset on tab close — by design, so stale scans
  don't carry across sessions. Filters use `localStorage`.
- **Scanner symbol universe** = intersection of HL `/api/assets` × Binance
  top-30 24h `quoteVolume`. If `/api/assets` 401s in multi-user mode,
  `hlAssets.ts` falls back to a hardcoded BTC/ETH/SOL/BNB/XRP list so the
  page still renders something.
- **HIP-3 asset names use a `dex:coin` shape** (e.g. `xyz:GOLD`, `xyz:TSLA`).
  The dex prefix must be lowercase, coin uppercase — `normalizeAssetName()` in
  `bot/src/hyperliquid-hip3.ts` enforces both. The same module wraps
  `metaAndAssetCtxs({ dex })` so `getAssetMeta()` resolves stocks/commodities.
  Candles for HIP-3 come from HL's `candleSnapshot` endpoint, not Binance —
  see `bot/src/strategy/hl-market-data.ts` and the `/api/candles` proxy in
  `server.ts`. The web's `binance.ts` and the bot's `market-data.ts` both
  branch on `symbol.includes(':')`.
- **Grid bot reconcile order matters.** `start({ reconcile: true })` now
  places SL/TP triggers BEFORE adopting the pre-existing grid orders, and the
  orphan-cancel sweep skips our own fresh `slTriggerOid`/`tpTriggerOid`.
  Reason: in reconcile the old grid orders can fill at any moment, so the
  position must be protected before we touch the order book. Old-run SL/TP
  (different oid) are still cancelled as orphans and immediately replaced —
  coverage never drops to zero.
- **Portfolio page has two non-reconciling data layers — by design.**
  (1) *Account layer* = `GET /api/portfolio/equity` → Hyperliquid `info.portfolio()`
  account-value history (true equity incl. unrealized/funding/transfers). Only
  `day/week/month/allTime` granularity exists on HL, so the hero trend chart has
  its own Day/Week/Month/All toggle, independent of the page's detail-range
  buttons. `mapEquitySeries()` in `bot/src/journal.ts` trims HL's leading $0
  (pre-funding) points from the chart. **Return % and max drawdown are based on
  HL `pnlHistory` (real trading PnL, excludes deposits/withdrawals), NOT start→end
  account value** — else a tiny first balance funded up by deposits reports an
  absurd return (the "$5 → $157 = +3047%" bug). Return % = periodPnl ÷ avg funded
  capital. Hero = account value (headline) + Net PnL ($) + "% on avg capital".
  The monthly PnL calendar + insights (`MonthlyPnlCalendar` in `PortfolioPage.tsx`)
  is realized round-trip data, cross-filtered like the rest.
  (2) *Realized layer* = closed round-trips from `/api/portfolio/trips`, derived
  **client-side** in `src/lib/portfolio.ts` (`botPerformance`, `realizedView`).
  Powers the bot leaderboard, daily PnL, calendar, by-asset, closed-trades — and
  cross-filters instantly when a bot card is clicked (no server round-trip). The
  account-value line is account-wide and **cannot** be split per bot, so selecting
  a bot swaps the trend chart to that bot's realized-PnL curve (header relabels).
  The two layers' totals won't match — labels make this explicit.
- **Kill-switch state is network-tagged.** `readState()` accepts a
  `currentNetwork` arg and drops the snapshot if it was taken on a different
  network. The GET endpoint (`/api/killswitch`) and PUT config endpoint both
  pass the user's current network so testnet→mainnet switches don't show a
  phantom drawdown until the next watcher tick.

---

## Useful URLs / paths

| Thing | Where |
|---|---|
| Live site | https://bot.garlic-trading.net |
| VPS SSH | `ssh root@68.183.184.170` |
| Repo (local) | `c:\Users\ken25\trading` |
| Repo (VPS) | `~/ken-trading` |
| User DB | `bot/data/users.db` (SQLite) |
| Per-user configs | `bot/data/<userId>/configs/`, `bot/data/<userId>/signal-bots/` |
| Audit log | `bot/trade-audit.log` (NDJSON, append-only) |
| Lessons file | `docs/lessons.md` (if/when created) |
