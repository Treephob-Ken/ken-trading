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

## ▶ Phase A — Deploy on a 24/7 server

Move the bot off the local PC onto an always-on VPS so it trades around the clock.
Full walkthrough is in **`bot/DEPLOY_VPS.md`** — summary:

1. **Pick a server** — good cheap options:
   - **Hetzner CX22** (~€4/mo, Germany) — best price/perf, needs ID verification
   - **Oracle Cloud Free Tier** (Always Free, US region) — truly free, ARM, slower signup
   - **DigitalOcean Basic** (~$6/mo) — simplest UX, instant signup
   → Hetzner CX22 recommended once ID clears.

2. **Install** — SSH in; `apt install nodejs npm git`; install `pm2` globally;
   clone the repo; `cd bot && npm install`.

3. **Configure `.env`** — copy the agent wallet key + user address; set
   `ALLOWED_ORIGINS`, safety caps (`MAX_TRADE_NOTIONAL_USD`, `ALLOWED_ASSETS`,
   `MAX_TRADES_PER_HOUR`).

4. **Move the Cloudflare tunnel to the VPS** — install `cloudflared`, migrate the
   `trading-bot` tunnel credentials there, re-point `bot.garlic-trading.net`.
   Cloudflare Access (email-OTP) policy stays the same — no config change needed.

5. **Process supervision** — `pm2 start "npm run serve" --name bot` and
   `pm2 start "cloudflared tunnel run trading-bot" --name tunnel`;
   `pm2 startup && pm2 save` so both survive reboots and crashes.

6. **Vercel alignment** — confirm `VITE_BOT_URL=https://bot.garlic-trading.net`
   in Vercel env vars so `garlic-trading.vercel.app` points at the VPS bot.

Once deployed, stop the local PC tunnel — the VPS is the permanent 24/7 home.

---

## ▶ Phase B — Multi-user support (one server, many traders)

Right now the bot is single-tenant — one Hyperliquid account, one `.env`, one
dashboard. To let multiple people use it with their own accounts and private data:

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

## Later ideas

- Streaming candle-close evaluation instead of 30s polling for the signal bots
- Webhook / Telegram alert when a Grid SL or TP triggers
- Mobile-friendly dashboard layout
- Performance dashboard: per-user cumulative P&L chart over time
