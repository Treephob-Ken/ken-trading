// Telegram notifications.
//
// Single chat. Sends a message every time a fill *closes or reduces* a
// position — i.e. when Hyperliquid reports a non-zero `closedPnl`. That
// covers manual closes, signal-bot flips, grid-bot scalps, and SL/TP hits.
//
// Config: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in bot/.env.
// If either is unset this module is a no-op and bots run as before.
//
// Setup steps:
//   1. Talk to @BotFather on Telegram → /newbot → copy the bot token.
//   2. Open the new bot's chat → send /start so the bot can DM you.
//   3. Visit https://api.telegram.org/bot<TOKEN>/getUpdates → find
//      "chat":{"id": <your-chat-id> }.
//   4. Put both into bot/.env.

import { getClients } from './trade.js'
import { log } from './logger.js'
import type { EnvConfig } from './config.js'

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim()
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID ?? '').trim()
const ENABLED = BOT_TOKEN.length > 0 && CHAT_ID.length > 0

// Format USD with 2 decimals and a sign — "+12.34" or "-12.34".
function fmtPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : ''
  return `${sign}${pnl.toFixed(2)}`
}

// POST a plain-text message to the configured Telegram chat. Swallowed on
// failure so a network hiccup never blocks trading. Telegram allows up to
// 4096 chars per message — we never approach that here.
async function postToTelegram(text: string): Promise<void> {
  if (!ENABLED) return
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      log.warn(`Telegram sendMessage returned ${res.status}: ${body.slice(0, 200)}`)
    }
  } catch (e) {
    log.warn(`Telegram POST failed: ${(e as Error).message}`)
  }
}

// Public: send the "position closed" notification. asset is the HL coin
// (e.g. "FET"), pnlUsd is the realized PnL of this fill.
export async function notifyPositionClose(asset: string, pnlUsd: number): Promise<void> {
  if (!ENABLED) return
  // User-chosen Thai wording. Profit → "รวย..รวย!!"  Loss → "สัส..แตก!!"
  const headline = pnlUsd >= 0 ? 'รวย..รวย!!' : 'สัส..แตก!!'
  const emoji = pnlUsd >= 0 ? '🤑' : '💀'
  const msg = `${emoji} ${headline} ${fmtPnl(pnlUsd)} USDC · ${asset}`
  await postToTelegram(msg)
}

// Hyperliquid `userFills` event shape we care about.
interface UserFillLike {
  coin: string
  closedPnl: string
  px: string
  sz: string
}

// Track which user addresses already have a fills subscription so a second
// call (e.g. when a user updates their credentials) doesn't spawn duplicate
// subscriptions that double-fire notifications.
const subscribed = new Set<string>()

// Subscribe to userFills for a user and fire Telegram notifications on
// every fill that has a non-zero closedPnl. Idempotent per user address.
export async function startFillNotifier(creds: EnvConfig | null): Promise<void> {
  if (!ENABLED) return
  if (!creds) return
  if (subscribed.has(creds.user)) return
  try {
    const clients = getClients(creds)
    await clients.subs.userFills({ user: clients.user }, (event) => {
      // Skip the historical snapshot HL sends on connect — those are old
      // fills we've already lived through.
      if (event.isSnapshot) return
      for (const fill of event.fills as UserFillLike[]) {
        const pnl = Number(fill.closedPnl)
        if (!Number.isFinite(pnl) || pnl === 0) continue
        // Strip HIP-3 dex prefix if present ("xyz:GOLD" → "GOLD") for cleaner display.
        const asset = fill.coin.includes(':') ? fill.coin.split(':')[1] : fill.coin
        void notifyPositionClose(asset, pnl)
      }
    })
    subscribed.add(creds.user)
    log.ok(`Telegram fill notifier subscribed for ${creds.user.slice(0, 8)}…`)
  } catch (e) {
    log.warn(`Could not start Telegram fill notifier: ${(e as Error).message}`)
  }
}

export function isNotifyEnabled(): boolean {
  return ENABLED
}
