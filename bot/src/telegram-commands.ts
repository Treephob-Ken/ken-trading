// Inbound Telegram commands (READ-ONLY). Long-polls getUpdates and answers
// /today, /status, /guard, /help — but ONLY for the configured chat id, and it
// can't change anything. No-op unless TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are
// set. Exactly one poller runs per process (a second getUpdates consumer on the
// same token would steal each other's updates).

import { log } from './logger.js'

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim()
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID ?? '').trim()
const ENABLED = BOT_TOKEN.length > 0 && CHAT_ID.length > 0

const HELP = [
  '📋 Commands',
  '/today — today’s realized PnL vs your daily goal',
  '/week — last 7 days: PnL · trades · win%',
  '/month — this month: PnL · trades · win%',
  '/status — bots + open positions',
  '/guard — daily PnL guard state',
  '/help — this list',
].join('\n')

async function tgApi<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as { ok: boolean; result: T }
    return json.ok ? json.result : null
  } catch {
    return null
  }
}

async function reply(text: string): Promise<void> {
  await tgApi('sendMessage', { chat_id: CHAT_ID, text, disable_web_page_preview: true })
}

interface TgUpdate {
  update_id: number
  message?: { chat?: { id: number }; text?: string }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let started = false

// `handle` returns the reply text for a command, or '' for unknown (we send help).
export function startTelegramCommands(handle: (cmd: string) => Promise<string>): void {
  if (!ENABLED || started) return
  started = true
  void poll(handle)
  log.ok('Telegram command poller started (read-only)')
}

async function poll(handle: (cmd: string) => Promise<string>): Promise<void> {
  // Skip any backlog queued while the server was down (offset -1 = latest only).
  let offset = 0
  const init = await tgApi<TgUpdate[]>('getUpdates', { timeout: 0, offset: -1 })
  if (init && init.length > 0) offset = init[init.length - 1].update_id + 1

  for (;;) {
    const updates = await tgApi<TgUpdate[]>('getUpdates', { timeout: 30, offset })
    if (!updates) { await sleep(3000); continue } // network hiccup — back off, retry
    for (const u of updates) {
      offset = u.update_id + 1
      const text = u.message?.text
      const chatId = u.message?.chat?.id
      if (!text || chatId === undefined) continue
      if (String(chatId) !== CHAT_ID) continue // ignore everyone but the owner
      const cmd = text.trim().split(/\s+/)[0].toLowerCase().replace(/@.*$/, '')
      if (cmd === '/help' || cmd === '/start') { await reply(HELP); continue }
      try {
        const out = await handle(cmd)
        await reply(out || HELP)
      } catch (e) {
        await reply(`⚠️ ${(e as Error).message}`)
      }
    }
  }
}
