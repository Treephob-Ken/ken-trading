// Bot connection settings.
//
// The Signal Trader UI talks to a trading bot's HTTP API. The bot can run:
//   - locally  — http://localhost:3001 (default for `npm run dev`)
//   - remotely — reached through a tunnel, e.g. https://bot.yourdomain.com
//
// The bot itself is the security boundary: a strict CORS allow-list, an
// optional API token, server-side trade caps, and (recommended) Cloudflare
// Access in front. The UI only needs to know where to send requests; it holds
// no secrets in the bundle. The bot URL and an optional token are stored in
// localStorage so each user sets them once on their own device.

const BUILD_BOT_URL = (import.meta.env.VITE_BOT_URL as string | undefined)?.trim()

// Compile-time default. Set VITE_BOT_URL in the hosted deploy so the published
// dashboard points at the tunnel; local dev falls back to localhost.
export const DEFAULT_BOT_URL = BUILD_BOT_URL || 'http://localhost:3001'

// True when the app is being served from localhost.
export const IS_LOCAL: boolean =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)

const URL_KEY = 'lab_bot_url'
const TOKEN_KEY = 'lab_bot_token'

export function getBotUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BOT_URL
  return window.localStorage.getItem(URL_KEY)?.trim() || DEFAULT_BOT_URL
}

export function setBotUrl(url: string): void {
  if (typeof window === 'undefined') return
  const clean = url.trim().replace(/\/+$/, '')
  if (clean) window.localStorage.setItem(URL_KEY, clean)
  else window.localStorage.removeItem(URL_KEY)
}

export function getBotToken(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(TOKEN_KEY)?.trim() || ''
}

export function setBotToken(token: string): void {
  if (typeof window === 'undefined') return
  const clean = token.trim()
  if (clean) window.localStorage.setItem(TOKEN_KEY, clean)
  else window.localStorage.removeItem(TOKEN_KEY)
}
