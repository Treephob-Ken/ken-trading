# Future Plan

## ✅ Done (branch `trigger-bot`)

Remote access is built and working from the local PC:
- Cloudflare Tunnel + Zero Trust Access → `bot.garlic-trading.net` (email-OTP login)
- Bot security: `ALLOWED_ORIGINS` CORS, optional `BOT_API_TOKEN`, server-side trade
  caps (`bot/src/limits.ts`), NDJSON audit log
- Dashboard: searchable comboboxes, no-save Start flow, violet restyle
- **Multiple concurrent signal traders** (multi-bot manager)

The tunnel currently runs from the local PC — it only works while the PC is awake.

---

## ▶ Next up — Deploy on Hetzner for a 24/7 bot

Move the bot off the local PC onto an always-on Hetzner VPS so it trades around
the clock. Full walkthrough is in **`bot/DEPLOY_VPS.md`** — summary:

1. **Provision the server** — Hetzner CX22, Ubuntu 24.04 (once ID verification clears).
2. **Install** — SSH in; install Node 22, git, `pm2`; clone the repo; `npm install` in `bot/`.
3. **Configure `.env`** — agent wallet key, `ALLOWED_ORIGINS`, and the safety caps
   (`MAX_TRADE_NOTIONAL_USD`, `ALLOWED_ASSETS`, `MAX_TRADES_PER_HOUR`).
4. **Move the tunnel to the VPS** — install `cloudflared`, recreate the `trading-bot`
   tunnel there, re-point `bot.garlic-trading.net`. Cloudflare Access policy stays as-is.
5. **Process supervision** — `pm2` runs both `npm run serve` and `cloudflared tunnel run`;
   `pm2 startup` + `pm2 save` so they survive reboots and crashes.
6. **Frontend alignment** — set `VITE_BOT_URL` in Vercel; add `app.garlic-trading.net`
   as a Vercel custom domain so the dashboard and bot share one parent domain + login.

Once this is done the local PC tunnel can be stopped — the VPS becomes the 24/7 home.

---

## Later ideas

- Streaming candle-close evaluation instead of 30s polling for the signal bots
- Webhook / alert when a Grid SL or TP triggers
- Position sizing for "both"-direction grids (current formula assumes long-only)
- Fix grid lines not rendering on the bot dashboard chart after config load
