// Daily realized-PnL guard. Multi-user only (no-op in single-tenant, like the
// kill switch).
//
// Watches REALIZED PnL — the sum of closed-trade PnL (USDC) since the window
// start (UTC midnight, or the moment you re-armed). When it crosses -lossUsd or
// +profitUsd it STOPS all the user's bots (signal + grid) so no NEW trades fire.
// It deliberately does NOT cancel orders or close positions — open trades keep
// running under their own SL/TP, so nothing gets cut early on an unrealized dip.
//
// One-shot per window: after it trips, the user can manually restart bots and it
// won't re-stop them; it auto-resets at the next UTC midnight (or via a manual
// re-arm, which moves the window start to "now" so the already-realized PnL
// doesn't instantly re-trip).
//
// Config + state live together in bot/data/<userId>/daily-guard.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EnvConfig } from './config.js'
import { log } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')

// Gentler than the kill switch's 30s — fills history is heavier than an equity
// read, and a daily PnL guard doesn't need second-level precision.
const POLL_MS = 60_000

export interface DailyGuardConfig {
  enabled: boolean
  lossUsd: number     // trip when realized PnL <= -lossUsd
  profitUsd: number   // trip when realized PnL >= +profitUsd
}

export interface DailyGuardState {
  config: DailyGuardConfig
  windowStart: number         // ms epoch — realized PnL is summed from here
  day: string | null          // UTC date (YYYY-MM-DD) the window belongs to
  realizedUsd: number | null  // last computed realized PnL in the window
  tripped: boolean
  trippedAt: number | null
  reason: string | null
}

function defaults(): DailyGuardState {
  return {
    config: { enabled: false, lossUsd: 30, profitUsd: 30 },
    windowStart: 0,
    day: null,
    realizedUsd: null,
    tripped: false,
    trippedAt: null,
    reason: null,
  }
}

function statePath(userId: string): string {
  return join(DATA_DIR, userId, 'daily-guard.json')
}
function ensureDir(userId: string): void {
  const dir = join(DATA_DIR, userId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function readGuard(userId: string): DailyGuardState {
  try {
    return JSON.parse(readFileSync(statePath(userId), 'utf8')) as DailyGuardState
  } catch {
    return defaults()
  }
}
function writeGuard(userId: string, s: DailyGuardState): void {
  try {
    ensureDir(userId)
    writeFileSync(statePath(userId), JSON.stringify(s, null, 2))
  } catch (e) {
    log.err(`Daily guard write failed for ${userId}: ${(e as Error).message}`)
  }
}

export function getDailyGuardStatus(userId: string): DailyGuardState {
  return readGuard(userId)
}

export function setDailyGuardConfig(userId: string, cfg: DailyGuardConfig): DailyGuardState {
  const s = readGuard(userId)
  s.config = cfg
  writeGuard(userId, s)
  return s
}

// Clear a trip and re-arm WITHOUT waiting for tomorrow: move the window start to
// now so the PnL already realized today doesn't instantly trip it again.
export function rearmDailyGuard(userId: string): DailyGuardState {
  const s = readGuard(userId)
  s.tripped = false
  s.trippedAt = null
  s.reason = null
  s.windowStart = Date.now()
  s.day = utcDay(s.windowStart)
  s.realizedUsd = 0
  writeGuard(userId, s)
  log.ok(`Daily guard re-armed for ${userId.slice(0, 8)} — window reset to now`)
  return s
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
function utcMidnightMs(ms: number): number {
  return Date.parse(utcDay(ms) + 'T00:00:00.000Z')
}

export interface DailyGuardHooks {
  credsProvider: () => EnvConfig | null
  // Sum of closed-trade PnL (USDC) from `sinceMs` to now for this user.
  realizedPnlToday: (creds: EnvConfig, sinceMs: number) => Promise<number>
  // Stop every running bot for the user — NO order cancel, NO position close.
  stopAllBots: (userId: string) => Promise<void>
  onTrip?: (userId: string, reason: string) => void
}

const watchers = new Map<string, NodeJS.Timeout>()

export function startDailyGuardWatcher(userId: string, hooks: DailyGuardHooks): void {
  if (watchers.has(userId)) return
  const tick = async (): Promise<void> => {
    const s = readGuard(userId)
    if (!s.config.enabled) return
    const creds = hooks.credsProvider()
    if (!creds) return
    const now = Date.now()
    const today = utcDay(now)

    // New UTC day → reset the window to this midnight.
    if (s.day !== today) {
      s.day = today
      s.windowStart = utcMidnightMs(now)
      s.realizedUsd = 0
      s.tripped = false
      s.trippedAt = null
      s.reason = null
      writeGuard(userId, s)
    }

    // Already tripped this window → respect manual restarts, do nothing.
    if (s.tripped) return

    let realized: number
    try {
      realized = await hooks.realizedPnlToday(creds, s.windowStart || utcMidnightMs(now))
    } catch {
      return // can't reach HL — fail open, never block on a transient error
    }
    s.realizedUsd = realized

    const loss = Math.abs(s.config.lossUsd)
    const profit = Math.abs(s.config.profitUsd)
    const hitLoss = loss > 0 && realized <= -loss
    const hitProfit = profit > 0 && realized >= profit

    if (hitLoss || hitProfit) {
      s.tripped = true
      s.trippedAt = now
      s.reason = hitProfit
        ? `Daily profit target reached: +$${realized.toFixed(2)} (cap +$${profit.toFixed(2)})`
        : `Daily loss limit reached: -$${Math.abs(realized).toFixed(2)} (cap -$${loss.toFixed(2)})`
      writeGuard(userId, s)
      log.warn(`⏸ Daily guard tripped for ${userId.slice(0, 8)}: ${s.reason} — stopping all bots`)
      try {
        await hooks.stopAllBots(userId)
      } catch (e) {
        log.err(`Daily guard stop failed for ${userId}: ${(e as Error).message}`)
      }
      hooks.onTrip?.(userId, s.reason)
      return
    }

    writeGuard(userId, s)
  }
  void tick()
  const id = setInterval(() => void tick(), POLL_MS)
  watchers.set(userId, id)
}

export function stopDailyGuardWatcher(userId: string): void {
  const t = watchers.get(userId)
  if (t) clearInterval(t)
  watchers.delete(userId)
}
