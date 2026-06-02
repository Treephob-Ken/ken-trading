// Account-wide kill switch.
//
// Watches each user's Hyperliquid account equity on a 30s loop. If equity
// drops more than `pct` below the UTC-midnight snapshot, all bots are stopped,
// all open orders cancelled, all positions force-closed, and a "tripped" flag
// is written to disk. The user must explicitly unlock to resume trading.
//
// State: per-user JSON file at bot/data/<userId>/kill-switch.json.
// Config (enabled, pct): per-user columns on the users table.
//
// Multi-user mode only — single-tenant is a no-op.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EnvConfig } from './config.js'
import { getAccountState } from './trade.js'
import { log } from './logger.js'
import { notifyKillSwitch } from './notify.js'
import { getKillSwitchConfig } from './users.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')

const POLL_MS = 30_000

// EnvConfig stores network as `isTestnet`. Convert to the snapshot tag.
function netFromCreds(creds: EnvConfig | null): 'testnet' | 'mainnet' | undefined {
  if (!creds) return undefined
  return creds.isTestnet ? 'testnet' : 'mainnet'
}

export interface KillSwitchState {
  // Reference equity for today (UTC). Snapshot is re-taken at the first poll
  // of each new UTC day (unless tripped — then the snapshot is frozen until unlock).
  snapshotEquity: number | null
  snapshotAt: number       // ms epoch of the snapshot. 0 = never set
  currentEquity: number | null
  drawdownPct: number      // signed; negative = down. Last computed value.
  tripped: boolean
  trippedAt: number | null
  trippedAtEquity: number | null
  reason: string | null
  // Network the snapshot was taken on. Testnet and mainnet have wildly
  // different equity, so comparing across them produces phantom drawdowns
  // (e.g. testnet $1100 → mainnet $5 = -99% trip). When the stored network
  // doesn't match the current one, the state is treated as fresh.
  network?: 'testnet' | 'mainnet'
}

function statePath(userId: string): string {
  return join(DATA_DIR, userId, 'kill-switch.json')
}

function ensureDir(userId: string): void {
  const dir = join(DATA_DIR, userId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function freshState(network?: 'testnet' | 'mainnet'): KillSwitchState {
  return {
    snapshotEquity: null,
    snapshotAt: 0,
    currentEquity: null,
    drawdownPct: 0,
    tripped: false,
    trippedAt: null,
    trippedAtEquity: null,
    reason: null,
    network,
  }
}

// Reads the persisted state. If `currentNetwork` is provided AND the stored
// network differs, the snapshot is dropped — preventing cross-network phantom
// drawdowns. Untagged legacy state (no `network` field) is accepted to keep
// existing users unaffected on first read after deploy.
export function readState(
  userId: string,
  currentNetwork?: 'testnet' | 'mainnet',
): KillSwitchState {
  try {
    const raw = JSON.parse(readFileSync(statePath(userId), 'utf8')) as KillSwitchState
    if (currentNetwork && raw.network && raw.network !== currentNetwork) {
      return freshState(currentNetwork)
    }
    return raw
  } catch {
    return freshState(currentNetwork)
  }
}

function writeState(userId: string, state: KillSwitchState): void {
  try {
    ensureDir(userId)
    writeFileSync(statePath(userId), JSON.stringify(state, null, 2))
  } catch (e) {
    log.err(`Kill-switch state write failed for ${userId}: ${(e as Error).message}`)
  }
}

export function isTripped(userId: string): boolean {
  return readState(userId).tripped
}

// Returns the same shape the GET /api/killswitch endpoint serves to the UI.
// `currentNetwork` is forwarded into readState so stale cross-network state
// (e.g. a testnet snapshot when the user is now on mainnet) is dropped instead
// of being shown as a phantom drawdown.
export function getKillSwitchStatus(
  userId: string,
  currentNetwork?: 'testnet' | 'mainnet',
): {
  config: { enabled: boolean; pct: number }
  state: KillSwitchState
} {
  return { config: getKillSwitchConfig(userId), state: readState(userId, currentNetwork) }
}

// Force the snapshot to the current equity (best effort) and clear the tripped
// flag. Called from the UI "Resume" button after the user reviewed the trip.
export async function unlock(
  userId: string,
  creds: EnvConfig | null,
): Promise<KillSwitchState> {
  const current = creds ? await safeEquity(creds) : null
  const fresh: KillSwitchState = {
    snapshotEquity: current,
    snapshotAt: Date.now(),
    currentEquity: current,
    drawdownPct: 0,
    tripped: false,
    trippedAt: null,
    trippedAtEquity: null,
    reason: null,
    network: netFromCreds(creds),
  }
  writeState(userId, fresh)
  log.ok(`Kill switch unlocked for user ${userId}`)
  return fresh
}

// Called when the user switches HL network (testnet ↔ mainnet). Drops the
// existing snapshot + tripped flag and rewrites with the new network tag, so
// the next watcher tick takes a fresh snapshot on the new network instead of
// computing drawdown against the old network's equity.
export function resetForNetworkChange(
  userId: string,
  newNetwork: 'testnet' | 'mainnet',
): KillSwitchState {
  const fresh = freshState(newNetwork)
  writeState(userId, fresh)
  log.info(`Kill switch reset for user ${userId.slice(0, 8)} — network now ${newNetwork}`)
  return fresh
}

async function safeEquity(creds: EnvConfig): Promise<number | null> {
  try {
    const acct = await getAccountState(undefined, creds)
    return acct.accountValue
  } catch {
    return null
  }
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// Per-user watcher registry — one interval per user. Re-calling
// startKillSwitchWatcher with the same userId is a no-op.
const watchers = new Map<string, NodeJS.Timeout>()

export interface KillSwitchHooks {
  // Stop every running bot for this user (signal + grid), cancel all open
  // orders, close every open position. Implemented by server.ts.
  stopEverythingAndClose: (userId: string, creds: EnvConfig) => Promise<void>
  // Re-fetch the user's HL credentials (returns null if they've been removed).
  credsProvider: () => EnvConfig | null
}

export function startKillSwitchWatcher(userId: string, hooks: KillSwitchHooks): void {
  if (watchers.has(userId)) return
  const tick = async (): Promise<void> => {
    const cfg = getKillSwitchConfig(userId)
    if (!cfg.enabled) return
    const creds = hooks.credsProvider()
    if (!creds) return
    // Pass currentNetwork so stale cross-network state is dropped on read.
    const currentNet = netFromCreds(creds)
    const state = readState(userId, currentNet)
    const equity = await safeEquity(creds)
    if (equity === null) return
    const now = Date.now()

    // Take or refresh the daily snapshot.
    if (state.snapshotEquity === null || state.snapshotAt === 0) {
      writeState(userId, { ...state, snapshotEquity: equity, snapshotAt: now, currentEquity: equity, drawdownPct: 0, network: currentNet })
      log.info(`Kill switch [${userId.slice(0, 8)}]: snapshot set at $${equity.toFixed(2)} (${currentNet})`)
      return
    }
    if (!state.tripped && utcDay(now) !== utcDay(state.snapshotAt)) {
      writeState(userId, { ...state, snapshotEquity: equity, snapshotAt: now, currentEquity: equity, drawdownPct: 0, network: currentNet })
      log.info(`Kill switch [${userId.slice(0, 8)}]: daily snapshot reset at $${equity.toFixed(2)} (${currentNet})`)
      return
    }

    const dd = state.snapshotEquity > 0 ? ((equity - state.snapshotEquity) / state.snapshotEquity) * 100 : 0
    const next: KillSwitchState = { ...state, currentEquity: equity, drawdownPct: dd, network: currentNet }

    if (!state.tripped && dd <= -cfg.pct) {
      next.tripped = true
      next.trippedAt = now
      next.trippedAtEquity = equity
      next.reason = `Account drawdown ${dd.toFixed(2)}% exceeded limit ${cfg.pct}% (snapshot $${state.snapshotEquity.toFixed(2)} → current $${equity.toFixed(2)})`
      writeState(userId, next)
      log.err(`🛑 KILL SWITCH TRIPPED for ${userId.slice(0, 8)}: ${next.reason}`)
      void notifyKillSwitch(next.reason ?? 'drawdown limit exceeded')
      try {
        await hooks.stopEverythingAndClose(userId, creds)
      } catch (e) {
        log.err(`Kill switch cleanup error for ${userId}: ${(e as Error).message}`)
      }
      return
    }

    writeState(userId, next)
  }
  // Fire once immediately to set the snapshot, then on the interval.
  void tick()
  const id = setInterval(() => void tick(), POLL_MS)
  watchers.set(userId, id)
}

export function stopKillSwitchWatcher(userId: string): void {
  const t = watchers.get(userId)
  if (t) clearInterval(t)
  watchers.delete(userId)
}
