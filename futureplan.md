# Future Plan

## ✅ Done (branch `trigger-bot`)

Remote access is built and working from the local PC:
- Cloudflare Tunnel + Zero Trust Access → `bot.garlic-trading.net` (email-OTP login)
- Bot security: `ALLOWED_ORIGINS` CORS, optional `BOT_API_TOKEN`, server-side trade
  caps (`bot/src/limits.ts`), NDJSON audit log
- Dashboard: searchable comboboxes, no-save Start flow, violet restyle
- **Multiple concurrent signal traders** (multi-bot manager)
- **Signal Trader position sizing** — budget (USDC) + leverage inputs; effective order
  size computed from live price on start, shown in dashboard sizing preview box
- **Vercel app simplified** — Signal Trader tab removed; SummaryPanel (plain-English
  verdict) added below Results; advanced analysis panels collapsed by default

The tunnel currently runs from the local PC — it only works while the PC is awake.

---

## ✅ Phase B — Multi-user support (one server, many traders)

**Built 2026-05-24.** Opt-in via `MULTI_USER=true` in `bot/.env`; single-tenant mode
is completely unchanged when the flag is absent.

What was implemented:
- **User accounts + login** — `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
  with bcrypt (12 rounds) + JWT (7-day expiry, `JWT_SECRET`).
- **Per-user HL credentials** — each user enters their agent key + wallet address via the
  dashboard Credentials modal; key encrypted at rest with AES-256-GCM (`KEY_ENCRYPTION_SECRET`).
- **Data isolation** — bot configs, signal-bot state files, and trade audit logs stored in
  `bot/data/<userId>/` directories; API routes reject cross-user access.
- **Bot runner isolation** — grid/signal bots keyed by `"<userId>:<botId>"` in the manager
  maps; each bot's `placeOrder`/`getAccountState` calls use the owner's decrypted creds.
- **Admin panel** — `GET /admin/users`, `DELETE /admin/users/:id`, `POST /admin/users/:id/kill-bots`.
- **Data migration** — on first admin registration, existing `bot/configs/` and
  `bot/signal-bots/` are copied into the owner's data directory (idempotent).
- **Dashboard auth flow** — login/register overlay, mode detection via `GET /auth/me`,
  HL credentials modal, header user-chip with logout.

Known gap: per-user audit log path is wired in `limits.ts` but callers in `trade.ts` don't
yet pass `userId`, so all audit entries still go to the global `bot/trade-audit.log`.

---

## ✅ Phase A — Deploy on a 24/7 server (DONE — 2026-05-24)

Bot is live on **DigitalOcean Singapore** ($6/mo, 1 vCPU / 1GB RAM), always on.

- **Server:** 68.183.184.170 (Ubuntu 24.04, Node.js 22)
- **Bot URL:** https://bot.garlic-trading.net (Cloudflare Tunnel via pm2)
- **Web app:** https://garlic-trading.vercel.app (Vercel, analytics only)
- **Process manager:** pm2 — both `trading-bot` and `cloudflare-tunnel` auto-restart on reboot
- **Auth:** Multi-user JWT (no Cloudflare Access — removed; bot's own login handles it)

See `progress.md` (2026-05-24) for full deployment log and gotchas.

---

## ✅ Phase B — Multi-user support (DONE — 2026-05-24)

Live on VPS with `MULTI_USER=true`. Each user registers at `bot.garlic-trading.net`,
enters their own HL credentials, and runs their own isolated bots. See CLAUDE.md
for architecture details.

---

## ▶ Phase C — Next improvements

### What needs to change

**1. User accounts + login**
- Add a proper login system so each person has their own account on the server.
- Simplest path: **username + password** stored server-side (bcrypt hashed), with
  a JWT session token issued on login. No OAuth needed initially.
- Cloudflare Access (current email-OTP gate) can stay as a first layer, but each
  logged-in user should only see their own bots and data.

**2. Per-user Hyperliquid credentials**
- Each user provides their own **HL Agent Private Key** + **HL User Address** via
  the dashboard (Settings page or on-boarding flow).
- Keys stored encrypted at rest on the server (e.g. AES-256 with a server master
  key stored in an env var, never in the DB in plaintext).
- The `SignalBot` and `GridBot` instances are spawned with the user's own key —
  completely isolated from other users' bots.

**3. Data isolation**
- Bot config files, log files, trade audit logs, and bot state (`signal-bots/*.json`,
  `configs/*.json`, `trade-audit.log`) are namespaced per user:
  `data/<userId>/signal-bots/`, `data/<userId>/configs/`, etc.
- API routes scoped behind auth middleware that injects `req.userId` and rejects
  requests targeting another user's resources.
- Dashboard: after login you only ever see your own bots, P&L, trades, and logs —
  nothing from other users leaks through.

**4. Bot runner isolation**
- Each user's bots run as separate `SignalBot` / `GridBot` instances in the same
  Node process, but keyed by `userId` in the bot manager map.
- Or: spawn a child process per user for stronger isolation (harder crashes stay
  contained). Decide based on user count — child process per user if > 5 users.

**5. Admin panel**
- Simple admin view (owner-only) to see all users, active bot counts, kill a runaway
  bot, or revoke a user's access.

### Rough tech stack additions needed
- `jsonwebtoken` + `bcryptjs` — auth tokens + password hashing
- A lightweight DB for user records — **SQLite** (via `better-sqlite3`) is fine for
  < 50 users, no separate DB server needed
- Encrypted key storage — Node `crypto` AES-256-GCM with a `KEY_ENCRYPTION_SECRET`
  env var
- New routes: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`,
  `PUT /settings/credentials`
- Middleware: `requireAuth(req, res, next)` on all `/api/*` routes

---

## ▶ Phase D — Funding Arbitrage (PLANNED — waiting on capital)

**Why waiting:** This strategy only makes sense with **$3,000-5,000 USDC** on HL.
Below that, HL fees (perp 0.035% + spot 0.07%) eat most of the funding income
and the absolute dollar profit isn't worth the time. Currently saving up to that
amount — once funded, ship this phase.

### What it is (plain words)
Perp futures pay a fee called **funding** every hour on HL. When funding is
positive (which it usually is, because retail tends to go long), **shorts get
paid**. To not care about price moving, hedge by **buying the same coin on HL
spot**. Result: collect funding hourly, market-neutral, like a yield farm.

### Realistic numbers (HL-only, after fees)
- Net APR: **8-15%** on a diversified basket, with low drawdown.
- $3k capital → ~$240-450/yr
- $5k capital → ~$400-700/yr
- $10k capital → ~$800-1,500/yr

Not life-changing money, but earns while sleeping and scales linearly with
capital. Real income kicks in at $20k+.

### Strategy ranking (ship in this order)

| # | Strategy | Notes |
|---|---|---|
| 1 | **Diversified carry basket** | Short perp + long spot on 5-7 HL coins, equal weight, 1.5x leverage max. Boring, stable. |
| 2 | **High-APR sniper** | Only enter when predicted funding APR > 15%. Exit when it drops below 10%. Better $/effort. |
| 3 | **New listing hype farm** | When HL lists a new coin (e.g. HYPE/PURR launches), funding can hit 200-500% APR for 1-3 days. Manual only, capped at 5% of capital per trade. |
| 4 | Cross-exchange spread (HL vs Binance) | Needs Binance integration — not first to ship. |

### The trick that makes HL-only profitable: maker rebates
HL pays **0.015%** to provide liquidity (limit orders that rest, not market
orders). If all 4 legs (enter perp/spot, exit perp/spot) are filled as maker:
- Round-trip fees drop from 0.21% → ~0.05%
- Break even at 10% APR drops from 8 days to 2 days
- **Always use limit orders.** Market-order farming is barely worth it.

### What to build (in order)

**Layer 1 — Funding Scanner page** (1-2 days work, no trading code)
- New `src/pages/FundingPage.tsx` following the existing `ScannerPage` pattern.
- New backend route `GET /api/funding/rates` that calls HL `predictedFundings`
  + `fundingHistory` endpoints.
- Table columns: coin, current funding APR, 7d avg, predicted next funding,
  HL spot available (yes/no), **net APR after estimated fees**, verdict badge
  (Great / Good / Skip — reusing the `verdict.ts` pattern from Scanner).
- Click a row → opens Trade page pre-filled with a short order.
- Persist filters in `localStorage`; persist scan results in `sessionStorage`.

**Layer 2 — Funding backtester** (after Layer 1 has run for 2 weeks of data)
- Feed historical funding + price into a delta-neutral simulator.
- Show APR you would have earned per coin, drawdowns from imperfect hedge,
  fee drag, time-in-position distribution.

**Layer 3 — Funding bot** (only after manually trading for 1+ month)
- New bot type alongside `SignalBot` / `GridBot`: `FundingBot`.
- Reuses existing registry, multi-user, persistence patterns in `server.ts`.
- Logic: enter when net APR > X%, rebalance hedge ratio daily, exit when
  funding flips or drops below Y%, time-stop after 48h.

### Risks to handle in code
- **Funding flips negative** mid-position → need exit rule, not "hold forever."
- **Liquidation on the perp leg** even with a hedge → cap leverage at 2x, monitor
  margin ratio, auto-add margin if it drops below threshold.
- **Spot leg slippage on entry** → use limit orders; abort entry if book is too thin.
- **Wallet transfers** — HL has separate spot and perp sub-accounts; `usdClassTransfer`
  needs to be wired into the bot when moving capital between them.

### Capital plan
- **Now:** save $3,000+ USDC.
- **Once funded:** ship Layer 1 (Scanner), watch for 2 weeks before any trading.
- **First trades:** manual, 3-5 picks, limit orders only, ~$500-1000 per position.
- **After 1 month of proven returns:** decide whether to build the auto-bot.

---

## Later ideas

- Streaming candle-close evaluation instead of 30s polling for the signal bots
- Webhook / Telegram alert when a Grid SL or TP triggers
- Mobile-friendly dashboard layout
- Performance dashboard: per-user cumulative P&L chart over time
