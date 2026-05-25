// Per-grid-bot runtime state sidecar files. Lets the server remember which
// bots were running across process restarts so they can auto-resume.
//
// We deliberately keep this separate from GridConfig (which the user edits)
// so user-driven config saves never accidentally wipe the running flag.
//
// Single-tenant layout:  bot/configs/<id>.runtime.json
// Multi-tenant layout:   bot/data/<userId>/configs/<id>.runtime.json

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIGS_DIR_LEGACY = join(__dirname, '..', 'configs')
const DATA_DIR = join(__dirname, '..', 'data')

function runtimeDir(uid?: string): string {
  if (uid) return join(DATA_DIR, uid, 'configs')
  return CONFIGS_DIR_LEGACY
}

function runtimePath(uid: string | undefined, botId: string): string {
  return join(runtimeDir(uid), botId + '.runtime.json')
}

export interface GridRuntimeState {
  running: boolean
  lastSavedAt: number
  // True when the bot was auto-stopped because the user switched to mainnet
  // while it was running. The next switch back to testnet auto-resumes bots
  // with this flag set. Independent of `running` so the UI can show "Paused"
  // distinctly from "Stopped".
  pausedForNetworkSwitch?: boolean
}

export function writeGridRuntime(
  uid: string | undefined,
  botId: string,
  running: boolean,
  pausedForNetworkSwitch?: boolean,
): void {
  try {
    const dir = runtimeDir(uid)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const state: GridRuntimeState = {
      running,
      lastSavedAt: Date.now(),
      ...(pausedForNetworkSwitch ? { pausedForNetworkSwitch: true } : {}),
    }
    writeFileSync(runtimePath(uid, botId), JSON.stringify(state, null, 2))
  } catch {
    // Persistence is best-effort. If we can't write, the bot still runs;
    // it just won't auto-resume after a restart.
  }
}

export function readGridRuntime(uid: string | undefined, botId: string): GridRuntimeState | null {
  try {
    const p = runtimePath(uid, botId)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')) as GridRuntimeState
  } catch {
    return null
  }
}

// Bot ids that were paused for a network switch. Used by /settings/credentials
// to auto-resume them when the user switches back to testnet.
export function listPausedGridBotIds(uid?: string): string[] {
  const dir = runtimeDir(uid)
  if (!existsSync(dir)) return []
  const ids: string[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.runtime.json')) continue
    const botId = file.slice(0, -'.runtime.json'.length)
    const state = readGridRuntime(uid, botId)
    if (state?.pausedForNetworkSwitch) ids.push(botId)
  }
  return ids
}

// Return the bot ids that were marked running last time, so the server can
// resume them on boot. Pairs with the config dir's *.json files (each bot id
// has both a <id>.json config and a <id>.runtime.json sidecar).
export function listRunningGridBotIds(uid?: string): string[] {
  const dir = runtimeDir(uid)
  if (!existsSync(dir)) return []
  const ids: string[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.runtime.json')) continue
    const botId = file.slice(0, -'.runtime.json'.length)
    const state = readGridRuntime(uid, botId)
    if (state?.running) ids.push(botId)
  }
  return ids
}
