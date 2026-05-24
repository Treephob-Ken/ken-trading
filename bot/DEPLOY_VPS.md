# Deploy the bot 24/7 on a VPS

The bot runs on **DigitalOcean Singapore** ($6/mo). This is the actual setup used in production.

**Live URLs:**
- Bot dashboard: https://bot.garlic-trading.net
- Web app (analytics): https://garlic-trading.vercel.app

---

## Server specs

| Setting | Value |
|---|---|
| Provider | DigitalOcean |
| Region | Singapore (SGP1) — lowest latency to Binance/Hyperliquid from SEA |
| Plan | Basic, 1 vCPU / 1GB RAM / 25GB SSD — $6/mo |
| OS | Ubuntu 24.04 LTS x64 |
| IP | 68.183.184.170 |

---

## One-time setup (already done)

### 1. Install Node.js 22
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
```
> **Must be Node 22+** — Node 20 lacks native WebSocket which `@nktkas/hyperliquid` requires.

### 2. Install build tools (required for better-sqlite3)
```bash
apt install -y build-essential git
```

### 3. Clone the repo
```bash
git clone https://github.com/Treephob-Ken/ken-trading.git
cd ken-trading/bot
```

### 4. Install dependencies
```bash
npm install
```

### 5. Configure `.env`
```bash
cp .env.example .env
nano .env
```

Required fields:
```
ALLOWED_ORIGINS=https://garlic-trading.vercel.app
MULTI_USER=true
OWNER_EMAIL=ken2540@gmail.com
KEY_ENCRYPTION_SECRET=<openssl rand -hex 32>
JWT_SECRET=<openssl rand -hex 32>
```

### 6. Start with pm2
```bash
npm install -g pm2
pm2 start npm --name "trading-bot" -- run serve
pm2 save && pm2 startup   # auto-restart on reboot
```

### 7. Cloudflare Tunnel
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb && dpkg -i cloudflared.deb
cloudflared tunnel login
cloudflared tunnel token trading-bot   # copy the token
pm2 start "cloudflared tunnel run --token <TOKEN>" --name "cloudflare-tunnel"
pm2 save
```

> **Note:** Use `--token` flag instead of `cloudflared tunnel run <name>` — the credentials JSON file is not needed with token-based auth.

> **Note:** Do NOT use Cloudflare Access in front of the tunnel. The bot has its own JWT auth. Cloudflare Access intercepts API calls and breaks the dashboard's `/auth/me` detection.

---

## Day-to-day management

```bash
# SSH in
ssh root@68.183.184.170

# Check status
pm2 status

# View logs
pm2 logs trading-bot --lines 50 --nostream

# Update bot after code change
cd ~/ken-trading && git pull && cd bot && npm install
pm2 restart trading-bot

# If Node.js version was upgraded, rebuild native addon
cd ~/ken-trading/bot && npm rebuild && pm2 restart trading-bot
```

---

## User onboarding

1. Share **https://bot.garlic-trading.net** with the user
2. They click **Register** and create an account
3. They go to **Settings** → enter their Hyperliquid agent key + wallet address + network
4. They create signal/grid bots — fully isolated from other users
