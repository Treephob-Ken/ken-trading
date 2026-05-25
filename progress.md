# Progress — current status

> This file is a **snapshot of where the project is now**, not a changelog.
> Max ~200 lines. When something changes, **edit the relevant section** —
> don't append a dated entry. Git history is the changelog.

Last reviewed: 2026-05-25

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
| Live SSE log tail across all bots | ✅ Logs page |
| Login page redesign (dot-grid, framer-motion) | ✅ |

---

## What's still pending

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

---

## 2026-05-25 — Currency Scanner page (Indicator + Grid)

**Why:** Backtester and Grid Optimizer pages are single-combo analyzers — user had to manually iterate through every symbol/strategy/timeframe to find the best one. The Scanner page batch-runs the same engines across many combos and ranks them, then click-throughs back into the analyzer pages with the winning combo pre-selected.

**Built:**
- `src/lib/scanner/universe.ts` — `getScannerUniverse()` intersects HL `/api/assets` (so symbols are HL-tradeable, since HL uses USDC perps) with Binance 24h `/ticker/24hr` volume, returns top 30 by `quoteVolume`. Module-level cache + `clearUniverseCache()` for refresh.
- `src/lib/scanner/indicatorScan.ts` — `runIndicatorScan(universe, options, onProgress, signal)`. Loops 30 symbols × 2 TFs (1h + 4h) × 14 strategies = 840 backtests. Uses `defaultParams()`, `generateSignals()`, `runBacktest()` — identical to BacktesterPage so reported return % matches the row when user opens that combo. Concurrency cap of 6 in-flight Binance fetches via inline `pool()` helper. Lookback 90 days.
- `src/lib/scanner/gridScan.ts` — `runGridScan(universe, options, onProgress, signal)`. For each of 30 symbols on 4h × 30 days, calls `optimizeGrid()` (reuses built-in `MarketFit.score` 0–100) + `analyzeRegime()` for Bull/Sideways/Bear classification + derived `tradesPerDay`, `spacingMultiple = spacing/breakeven`.
- `src/components/scanner/IndicatorScanTab.tsx` — controls (direction, TF chips, min trades, strategy chips), progress bar, Top-3 highlight cards, sortable results table (return / trades / win / DD / Sharpe). ▶ button calls `onPickSymbol` + `onPickTimeframe` then `navigate('/backtest', { state: { presetStrategy } })`.
- `src/components/scanner/GridScanTab.tsx` — sideways-only / spacing-multiple / trades-per-day filters, Top-3 cards, table with Score / Verdict / Regime / Trades-per-day / Range% / ATR% / Spacing× / Sim Return. ▶ button routes to `/grid` with the symbol preset.
- `src/pages/ScannerPage.tsx` — page shell with tab switcher (Indicator | Grid), symbol-count chip + refresh button in header.

**Wired:**
- `src/App.tsx` — added `<Route path="scanner" />` with `setSymbol` / `setTimeframe` lifted props (same pattern Backtester + Grid use).
- `src/components/Sidebar.tsx` — added Radar icon nav item between Backtester and Grid Optimizer.
- `src/pages/BacktesterPage.tsx` — reads `location.state.presetStrategy` on mount, applies it via the existing `defaultParams()` + `bt_params_<id>` localStorage lookup, then `navigate(..., { replace: true, state: null })` so refresh doesn't re-trigger.

**Reused as-is:** `binance.fetchKlines`, `hlAssets.fetchHLAssets`, `strategies.{generateSignals,defaultParams,STRATEGIES}`, `backtest.runBacktest`, `grid.optimizeGrid`, `markov.analyzeRegime`. No backend changes — fully client-side.

**Gotchas:**
- HL `/api/assets` requires JWT in multi-user mode; if the auth call 401s, `fetchHLAssets()` falls back to the hardcoded BTC/ETH/SOL/BNB/XRP list so the page still renders.
- One bad symbol's Binance fetch failing must not sink the entire scan — both scanners swallow per-symbol errors and continue.
- Binance Vision public API tolerates ~1200 req/min; we throttle to 6 in-flight fetches via inline pool to stay polite.
- `pool()` helper is duplicated in `indicatorScan.ts` and `gridScan.ts` — small enough to inline; keep them in sync if either changes.

**Verify (local):**
1. `cd bot && npm run serve` (one terminal), `npm run dev` (another). Open http://localhost:5173/scanner.
2. Indicator tab → Scan → wait ~10s for 840/840. Top-3 chips should populate. Click ▶ on row #1 → lands on `/backtest` with same symbol/TF/strategy; the equity card's totalReturnPct should match the scanner row within rounding.
3. Grid tab → Scan → ~2s. Default filters (Sideways only, ≥3× spacing, ≥1 trade/day) may show 0–5 rows depending on market regime; toggle "All regimes" to see more. ▶ on row #1 → `/grid` with that symbol; optimizer re-runs.
