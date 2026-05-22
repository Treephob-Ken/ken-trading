# Remote Access — triggering the bot from a hosted dashboard

By default the bot only listens on `localhost:3001`, so only a browser on the
same machine can reach it. This guide explains how to safely reach the bot from
a **hosted dashboard** — for example so you and a friend can log in on the web
and trigger your bot — without exposing a trade API to the open internet.

There are two setups. **Setup A (Cloudflare Tunnel + Access)** is recommended.
**Setup B (plain tunnel + API token)** is a simpler fallback.

---

## Why the hosted site can't just call `localhost`

`localhost` always means *the machine the browser is on*. If your friend opens
the dashboard, their browser's `localhost` is *their* PC — not yours. To trigger
**your** bot, the bot needs **one address both browsers can reach**. A tunnel
gives the bot that address.

Vercel itself can never *run* the bot — Vercel is serverless and kills each
function after seconds; the bot is a long-lived process. Vercel hosts the
**frontend**; the bot runs on your PC (or a small VPS) and a tunnel connects
them.

---

## Setup A — Cloudflare Tunnel + Access (recommended)

The bot stays on your PC. Cloudflare gives it an HTTPS URL and puts a **login
page** in front. No auth code, no open ports, your keys never leave your
machine.

### What you need
- A domain on Cloudflare (~$10/year). Required for Cloudflare Access.
- `cloudflared` installed: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>

### 1. Put the frontend and bot on the same parent domain
This is the key detail that makes login work cleanly. Use two subdomains of the
**same** domain:

| Subdomain | Serves | Hosted on |
|---|---|---|
| `app.yourdomain.com`  | the dashboard | Vercel (add it as a custom domain) |
| `bot.yourdomain.com`  | the bot API   | Cloudflare Tunnel → your PC |

Because both are under `yourdomain.com`, the Access login cookie covers both,
and `app → bot` requests are *same-site* so the cookie is sent.

### 2. Create the tunnel for the bot
```bash
cloudflared tunnel login
cloudflared tunnel create trading-bot
cloudflared tunnel route dns trading-bot bot.yourdomain.com
```
Create `~/.cloudflared/config.yml`:
```yaml
tunnel: trading-bot
credentials-file: /path/to/<tunnel-id>.json
ingress:
  - hostname: bot.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
```
Run it (keep it running alongside the bot):
```bash
cloudflared tunnel run trading-bot
```

### 3. Add the login with Cloudflare Access
In the Cloudflare dashboard → **Zero Trust → Access → Applications → Add an
application → Self-hosted**:
- Application domain: `bot.yourdomain.com` (and add `app.yourdomain.com` too)
- Add a policy → Action **Allow** → Include → **Emails** → list your email and
  your friend's email
- Save.

Now any request to those subdomains shows a Cloudflare login page; only the two
whitelisted emails get through. **This is your login — you wrote no auth code.**

### 4. Configure the bot
In `bot/.env`:
```ini
ALLOWED_ORIGINS=https://app.yourdomain.com
# Trade safety caps — strongly recommended once the bot is remote-reachable:
MAX_TRADE_NOTIONAL_USD=500
ALLOWED_ASSETS=ETH,BTC,SOL
MAX_TRADES_PER_HOUR=20
# Leave BOT_API_TOKEN blank — Access already handles auth.
```
Restart the bot.

### 5. Point the dashboard at the bot
- Build the Vercel frontend with `VITE_BOT_URL=https://bot.yourdomain.com`
  (set it in Vercel → Project → Settings → Environment Variables), **or**
- Just type the URL into the **Bot URL** field on the Signal Trader page — it
  is saved in your browser.

Done. Open `app.yourdomain.com`, log in via Cloudflare, and the dashboard drives
your local bot.

---

## Setup B — plain tunnel + API token (simpler, no domain)

No domain, no Access. The tunnel gives a public URL; a shared secret token
guards the API. Slightly weaker (a leaked token = full access) but quick.

### 1. Quick tunnel
```bash
cloudflared tunnel --url http://localhost:3001
```
This prints a random `https://<random>.trycloudflare.com` URL.

### 2. Set a token in `bot/.env`
```ini
BOT_API_TOKEN=<paste-a-long-random-string-here>
ALLOWED_ORIGINS=https://your-frontend.vercel.app
MAX_TRADE_NOTIONAL_USD=500
ALLOWED_ASSETS=ETH,BTC,SOL
MAX_TRADES_PER_HOUR=20
```
Generate a token with: `node -e "console.log(crypto.randomBytes(24).toString('hex'))"`

### 3. Enter it on the dashboard
- **Signal Trader page:** put the tunnel URL in **Bot URL** and the token in
  **API Token**. Both are saved in your browser, never in the code bundle.
- **Bot's own dashboard** (`bot.../`): it prompts for the token on first load.

Give the URL + token to your friend over a secure channel — anyone with both
can trade.

---

## Running the bot 24/7

The bot trades only while its process is alive. If the host sleeps or shuts
down, the bot stops. A bot you rely on needs a host that stays on **and** a
process manager that restarts it after a crash or reboot.

### Best options, cheapest first

| Host | Cost | Reliability | Notes |
|---|---|---|---|
| **Oracle Cloud "Always Free" VM** | **$0/mo** | High | A real Linux VPS, free forever. A card is needed at signup (not charged). Best zero-cost option. |
| Old laptop / Raspberry Pi at home | one-time ~$0–50 | Medium–High | You own it, near-zero running cost. Pair with Cloudflare Tunnel — no router config needed. |
| Cheap VPS (Hetzner ~€4/mo, DigitalOcean ~$6/mo) | ~$4–6/mo | High | Simplest and most reliable. Worth it if the free options frustrate you. |
| Your own PC, always on | $0 + electricity | Low | Windows updates reboot it, sleep stops it. Fine for testing, not for real money. |

**Recommendation:** start with **Oracle Cloud Always Free** — a genuine
always-on server for $0. If its signup or ARM-capacity limits annoy you, a
~€4/mo Hetzner VPS is the no-hassle choice. Avoid free hosts that "sleep on
idle" (e.g. Render free tier) — a sleeping bot misses trades.

### Keep it alive with pm2 (any Linux host)

`pm2` restarts the bot if it crashes and relaunches it after a reboot:
```bash
npm install -g pm2
cd bot
pm2 start "npm run serve" --name trading-bot
pm2 start "cloudflared tunnel run trading-bot" --name tunnel
pm2 save
pm2 startup        # run the line it prints — enables start-on-boot
```
Both the bot and the tunnel are now supervised. Use `pm2 logs` to watch them
and `pm2 restart trading-bot` to bounce the bot.

### Windows PC always-on (testing only)

If you keep it on your PC: disable sleep (Settings → Power → Sleep → Never) and
add `start_bot.bat` to Task Scheduler set to run "at log on". This survives
reboots but not Windows updates — don't trust it with real funds.

---

## Security checklist

- [ ] **Agent wallet only.** `HL_AGENT_PRIVATE_KEY` must be a Hyperliquid *API
      agent* key — it can trade but **cannot withdraw**. Never put a
      withdrawal-capable key on a remote-reachable machine.
- [ ] **Trade caps set** — `MAX_TRADE_NOTIONAL_USD`, `ALLOWED_ASSETS`,
      `MAX_TRADES_PER_HOUR`. These are hard server-side limits, so even a stolen
      session has bounded damage.
- [ ] **`ALLOWED_ORIGINS`** is your exact frontend origin — never a wildcard.
- [ ] Auth in front: Cloudflare Access (Setup A) **or** `BOT_API_TOKEN`
      (Setup B). Never expose the API with neither.
- [ ] Stay on **`HL_NETWORK=testnet`** until you fully trust the setup.
- [ ] Every order is appended to `bot/trade-audit.log` — review it.
