# Deploy the bot 24/7 on a VPS

A copy-paste walkthrough to run the bot around the clock on a small Hetzner
server, reachable from your hosted dashboard through a Cloudflare Tunnel with a
login page.

**Budget:** ~€4/month (the server) + ~$10/year (a domain). Everything else is free.

---

## What you need to register first

Do these three before starting — the rest of the guide assumes you have them.

1. **Cloudflare account** — <https://dash.cloudflare.com/sign-up> — free.
   Used for DNS, the tunnel, and the login page.
2. **A domain name** — easiest is **Cloudflare Registrar** (inside your
   Cloudflare account, sold at cost ~$10/yr). Or buy from Porkbun / Namecheap.
   Pick anything, e.g. `yourname-trading.com`.
3. **Hetzner Cloud account** — <https://www.hetzner.com/cloud> — needs a
   payment method; Hetzner may ask for ID verification on new accounts.

You already have GitHub, Vercel, and your Hyperliquid agent wallet.

---

## Part 1 — Create the server (Hetzner)

1. Open <https://console.hetzner.cloud> → **New Project** → name it `trading-bot`.
2. **Add Server**:
   - **Location** — pick the one nearest you
   - **Image** — Ubuntu 24.04
   - **Type** — **CX22** (Shared vCPU, ~€4/mo) — far more than this bot needs
   - **SSH key** — paste your public key if you have one (recommended). No key?
     Hetzner emails you a root password instead.
   - Leave the rest default → **Create & Buy now**
3. Copy the server's **IP address** from the dashboard.

## Part 2 — Connect and install

From your PC's terminal (PowerShell works):
```bash
ssh root@<SERVER_IP>
```
Then, on the server:
```bash
# Node 22 + git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git

# Get the code
git clone https://github.com/Treephob-Ken/ken-trading.git
cd ken-trading/bot
npm install
```
> If the repo is private, GitHub will ask you to log in — create a Personal
> Access Token (GitHub → Settings → Developer settings → Tokens) and use it as
> the password.

## Part 3 — Configure the bot

Create `bot/.env` on the server:
```bash
nano .env
```
Paste and fill in (see `bot/.env.example` for the full list):
```ini
HL_AGENT_PRIVATE_KEY=0x...your agent key...
HL_USER_ADDRESS=0x...your main wallet...
HL_NETWORK=testnet

ALLOWED_ORIGINS=https://app.yourdomain.com
MAX_TRADE_NOTIONAL_USD=500
ALLOWED_ASSETS=ETH,BTC,SOL
MAX_TRADES_PER_HOUR=20
```
Save with `Ctrl+O`, `Enter`, `Ctrl+X`.

## Part 4 — Domain + tunnel + login (Cloudflare)

1. **Add your domain to Cloudflare** — dash.cloudflare.com → Add a site. If you
   bought the domain elsewhere, change its nameservers as Cloudflare instructs.
   Bought via Cloudflare Registrar → already done.

2. **Install cloudflared on the server**:
   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
   chmod +x /usr/local/bin/cloudflared
   ```

3. **Create the tunnel**:
   ```bash
   cloudflared tunnel login          # opens a URL — approve your domain
   cloudflared tunnel create trading-bot
   cloudflared tunnel route dns trading-bot bot.yourdomain.com
   ```

4. **Tunnel config** — `nano ~/.cloudflared/config.yml`:
   ```yaml
   tunnel: trading-bot
   credentials-file: /root/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: bot.yourdomain.com
       service: http://localhost:3001
     - service: http_status:404
   ```
   (The `<tunnel-id>.json` filename is printed by the `create` command.)

5. **Add the login** — Cloudflare dashboard → **Zero Trust → Access →
   Applications → Add an application → Self-hosted**:
   - Domain: `bot.yourdomain.com` (add `app.yourdomain.com` too)
   - Add a policy → Action **Allow** → Include → **Emails** → your email and
     your friend's email
   - Save.

## Part 5 — Run it 24/7 with pm2

```bash
npm install -g pm2
cd ~/ken-trading/bot
pm2 start "npm run serve" --name trading-bot
pm2 start "cloudflared tunnel run trading-bot" --name tunnel
pm2 save
pm2 startup            # run the command it prints — enables start-on-boot
```
The bot and the tunnel now restart on crash and after a server reboot.

## Part 6 — Point the dashboard at the bot

In **Vercel → your project → Settings → Environment Variables** add:
```
VITE_BOT_URL = https://bot.yourdomain.com
```
Redeploy. (Or skip this and just type the URL into the **Bot URL** field on the
Signal Trader page — it is saved in your browser.)

Optionally add `app.yourdomain.com` to Vercel as a custom domain, so the
dashboard and the bot share one parent domain and one Cloudflare login.

---

## Daily use

- Open your dashboard → log in via Cloudflare → drive the bot.
- `ssh root@<IP>` then `pm2 logs` to watch it, `pm2 restart trading-bot` to bounce it.
- Update the bot later:
  ```bash
  cd ~/ken-trading && git pull && cd bot && npm install && pm2 restart trading-bot
  ```
- Every order is logged to `bot/trade-audit.log`.

Keep `HL_NETWORK=testnet` until you fully trust the setup.
