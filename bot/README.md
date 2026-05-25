# Garlic Trading Bot

Live trading bot for Hyperliquid (testnet + mainnet). Runs a grid bot and/or signal bots,
managed via an Express HTTP server that **also serves the React analytics SPA** from
`bot/public/` — single live surface, no separate frontend deploy.

**Live:** https://bot.garlic-trading.net

> The legacy native-HTML dashboard at `bot/dashboard/index.html` still exists but is no
> longer the primary UI — the React SPA (backtester, grid optimizer, scanner, live bot
> management) is. Build the SPA from the repo root with `npm run build`; output goes to
> `bot/public/` which is committed to git.

---

## Structure

```
bot/
├── src/
│   ├── server.ts          # entry point — Express server + dashboard on port 3001
│   ├── auth.ts            # JWT middleware (multi-user mode)
│   ├── users.ts           # SQLite user accounts + HL credential encryption
│   ├── migrate.ts         # single→multi-user data migration
│   ├── grid-bot.ts        # grid trading loop
│   ├── signal-bot.ts      # signal trading loop (polls Binance, fires on strategy signals)
│   ├── trade.ts           # shared order execution (placeOrder, closePosition, etc.)
│   ├── limits.ts          # server-side safety caps
│   ├── hyperliquid.ts     # SDK wrapper + price/size rounding
│   ├── config.ts          # env + grid config loader
│   ├── market-data.ts     # Binance REST candle fetcher
│   ├── logger.ts          # structured logging
│   └── strategy/
│       ├── indicators.ts  # EMA, ATR, Bollinger, Supertrend, etc.
│       └── strategies.ts  # 14 named strategies (must stay in sync with web app)
├── public/                # React SPA build output (committed) — served at GET /
├── dashboard/
│   └── index.html         # legacy native HTML dashboard (no longer primary)
├── .env.example           # env template
├── DEPLOY_VPS.md          # VPS deployment guide (DigitalOcean)
└── REMOTE_ACCESS.md       # Cloudflare tunnel + security model
```

---

## Running locally

```bash
cd bot
npm install
cp .env.example .env      # fill in your HL keys
npm run serve             # http://localhost:3001
```

> Requires **Node.js 22+** (native WebSocket). After any Node upgrade run `npm rebuild`.

---

## Running on VPS (production)

See `DEPLOY_VPS.md` for the full guide. TL;DR:

```bash
pm2 start npm --name "trading-bot" -- run serve
pm2 start "cloudflared tunnel run --token <TOKEN>" --name "cloudflare-tunnel"
pm2 save && pm2 startup
```

---

## Two bot types

**Grid bot** — places a ladder of limit orders across a price range. Reacts to fills:
buy fill → sell one line up; sell fill → buy one line down. Config via dashboard.

**Signal bot** — polls Binance every 30s, evaluates a strategy on the last closed bar,
fires a market order on a fresh signal. Supports ensemble mode, MTF filter, daily loss
circuit-breaker, bracket orders (TP/SL), and budget sizing.

The SPA's **Scanner page** batch-ranks the top ~30 HL-tradeable coins so you don't have
to hand-pick a symbol + strategy: the Indicator tab finds the best-performing
strategy+coin+timeframe combo over the last 90d, the Grid tab finds coins currently
suited to grid trading (Sideways regime, healthy spacing×). Click a row → opens the
Backtester or Grid Optimizer with that pick preloaded; from there hit "Deploy to bot".

---

## Multi-user mode

Set `MULTI_USER=true` in `.env`. Each user registers at the dashboard URL, enters their
own Hyperliquid credentials, and runs their own isolated bots. Keys are AES-256-GCM
encrypted at rest. See `REMOTE_ACCESS.md` and `CLAUDE.md` for details.
