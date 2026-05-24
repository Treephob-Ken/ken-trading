# Remote Access

The bot runs on a VPS and is exposed to the internet via a **Cloudflare Tunnel**.
This gives it a permanent HTTPS URL without port-forwarding or a static IP.

**Live URL:** https://bot.garlic-trading.net

---

## Architecture

```
Browser → Cloudflare Edge → Cloudflare Tunnel (cloudflared) → localhost:3001 (Express)
```

- The tunnel runs as a pm2 process: `cloudflared tunnel run --token <TOKEN>`
- No Cloudflare Access is used — the bot's own JWT auth handles authentication
- `ALLOWED_ORIGINS=https://garlic-trading.vercel.app` in `.env` permits the Vercel web app to call the API

---

## Why no Cloudflare Access?

Cloudflare Access intercepts ALL requests (including API calls like `GET /auth/me`)
and redirects them to its own login page before they reach the bot. This breaks the
dashboard's multi-user mode detection. Since the bot has its own JWT login system,
Cloudflare Access is redundant and should be left disabled.

---

## Security model

| Layer | Mechanism |
|---|---|
| Transport | HTTPS via Cloudflare (TLS terminated at edge) |
| Authentication | JWT (7-day expiry, signed with `JWT_SECRET`) |
| API protection | `requireAuth` middleware on all `/api/*` routes |
| Key storage | HL agent keys AES-256-GCM encrypted at rest |
| CORS | Only `ALLOWED_ORIGINS` + localhost can call the API |

---

## Single-tenant mode (no multi-user)

If `MULTI_USER` is not set, set `BOT_API_TOKEN` in `.env` and pass it
as `Authorization: Bearer <token>` from the Signal Trader UI's "API Token" field.
