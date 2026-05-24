# Garlic Trading Bot

Live trading bot for Hyperliquid (testnet + mainnet). Runs a grid bot and/or signal bots,
managed via an Express HTTP server and native HTML dashboard.

**Live:** https://bot.garlic-trading.net  
**Analytics web app:** https://garlic-trading.vercel.app

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
├── dashboard/
│   └── index.html         # native HTML dashboard (served at GET /)
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

---

## Multi-user mode

Set `MULTI_USER=true` in `.env`. Each user registers at the dashboard URL, enters their
own Hyperliquid credentials, and runs their own isolated bots. Keys are AES-256-GCM
encrypted at rest. See `REMOTE_ACCESS.md` and `CLAUDE.md` for details.
