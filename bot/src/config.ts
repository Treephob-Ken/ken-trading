import 'dotenv/config'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Single-tenant (legacy) paths — used when MULTI_USER is not set.
const CONFIGS_DIR_LEGACY = join(__dirname, '..', 'configs')
const LEGACY_PATH = join(__dirname, '..', 'grid.config.json')

// Multi-tenant: configs live under data/<userId>/configs/
const DATA_DIR = join(__dirname, '..', 'data')

export function configsDirForUser(userId?: string): string {
  if (userId) return join(DATA_DIR, userId, 'configs')
  return CONFIGS_DIR_LEGACY
}

// Keep the old name as a convenience so call sites that don't yet pass userId still compile.
const CONFIGS_DIR = CONFIGS_DIR_LEGACY

export type GridMode = 'arithmetic' | 'geometric'

export interface GridConfig {
  // Identity (set automatically on save when missing)
  id?: string              // kebab-case slug, also the filename stem
  name?: string            // display name in the dashboard
  asset: string
  lower: number
  upper: number
  gridCount: number
  mode: GridMode
  // Either provide orderSize directly OR investment + leverage (orderSize wins)
  orderSize?: number
  investment?: number      // USDC budget — used to derive orderSize
  leverage?: number        // default 1
  stopLossPrice?: number   // close all and halt if price <= this
  takeProfitPrice?: number // close all and halt if price >= this
  triggerPrice?: number    // don't start placing until price crosses this
  rebalanceIntervalMs?: number // how often to re-center and adapt spacing (ms)
  adaptiveSpacing?: boolean    // adapt spacing dynamically using ATR
}

export interface EnvConfig {
  agentKey: `0x${string}`
  user: `0x${string}`
  isTestnet: boolean
}

function required(key: string): string {
  const v = process.env[key]
  if (!v) {
    console.error(`Missing required env var: ${key}`)
    console.error('Copy bot/.env.example to bot/.env and fill it in.')
    process.exit(1)
  }
  return v
}

export function loadEnv(): EnvConfig {
  const agentKey = required('HL_AGENT_PRIVATE_KEY')
  const user = required('HL_USER_ADDRESS')
  const network = process.env.HL_NETWORK ?? 'testnet'
  if (!agentKey.startsWith('0x') || agentKey.length !== 66) {
    console.error('HL_AGENT_PRIVATE_KEY must be a 0x-prefixed 64-hex-char private key')
    process.exit(1)
  }
  if (!user.startsWith('0x') || user.length !== 42) {
    console.error('HL_USER_ADDRESS must be a 0x-prefixed 40-hex-char address')
    process.exit(1)
  }
  return {
    agentKey: agentKey as `0x${string}`,
    user: user as `0x${string}`,
    isTestnet: network !== 'mainnet',
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// Keep the old zero-arg call working (single-tenant).
function ensureConfigsDir(dir: string = CONFIGS_DIR): void {
  ensureDir(dir)
}

// One-time migration: if a legacy grid.config.json sits in bot/ but
// configs/ is empty, move it into configs/<asset-lowercase>.json so the
// dashboard sees it as a bot.
function migrateLegacyConfig(): void {
  ensureConfigsDir()
  if (!existsSync(LEGACY_PATH)) return
  const existing = readdirSync(CONFIGS_DIR).filter((f) => f.endsWith('.json'))
  if (existing.length > 0) return
  try {
    const raw = JSON.parse(readFileSync(LEGACY_PATH, 'utf8')) as GridConfig
    const id = (raw.asset || 'bot').toLowerCase()
    const cfg: GridConfig = { ...raw, id, name: raw.name ?? `${raw.asset} grid` }
    writeFileSync(join(CONFIGS_DIR, `${id}.json`), JSON.stringify(cfg, null, 2))
    unlinkSync(LEGACY_PATH)
  } catch { /* ignore — let the dashboard show empty state */ }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'bot'
}

function configPath(id: string, dir: string = CONFIGS_DIR): string {
  return join(dir, `${id}.json`)
}

// userId is optional — omit for single-tenant, pass for multi-tenant.
export function listConfigs(userId?: string): GridConfig[] {
  const dir = configsDirForUser(userId)
  if (!userId) migrateLegacyConfig() // only run legacy migration in single-tenant mode
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.runtime.json'))
    .map((f) => {
      const cfg = JSON.parse(readFileSync(join(dir, f), 'utf8')) as GridConfig
      cfg.id = cfg.id ?? f.replace(/\.json$/, '')
      return cfg
    })
    .sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
}

export function loadConfig(id: string, userId?: string): GridConfig {
  const dir = configsDirForUser(userId)
  const cfg = JSON.parse(readFileSync(configPath(id, dir), 'utf8')) as GridConfig
  cfg.id = id
  validateConfig(cfg)
  return cfg
}

// Same as loadConfig but skips validation. Used by the dashboard's GET
// /api/bots/:id/config so a corrupted config (e.g. lower=null) can still be
// surfaced in the form and fixed by the user — instead of stranding them
// with a 404 they can't recover from. Start/save endpoints continue to use
// the strict loadConfig so an invalid config can never be run.
export function loadConfigUnsafe(id: string, userId?: string): GridConfig {
  const dir = configsDirForUser(userId)
  const cfg = JSON.parse(readFileSync(configPath(id, dir), 'utf8')) as GridConfig
  cfg.id = id
  return cfg
}

export function saveConfig(cfg: GridConfig, existingId?: string, userId?: string): GridConfig {
  validateConfig(cfg)
  const dir = configsDirForUser(userId)
  ensureConfigsDir(dir)
  // If renamed/created, generate a unique id from name or asset
  if (!cfg.id) cfg.id = slugify(cfg.name || cfg.asset)
  // Avoid collision with another bot
  if (!existingId || existingId !== cfg.id) {
    let candidate = cfg.id
    let i = 2
    while (existsSync(configPath(candidate, dir))) {
      candidate = `${cfg.id}-${i++}`
    }
    cfg.id = candidate
  }
  if (!cfg.name) cfg.name = `${cfg.asset} grid`
  writeFileSync(configPath(cfg.id, dir), JSON.stringify(cfg, null, 2))
  // If id changed, drop the old file
  if (existingId && existingId !== cfg.id && existsSync(configPath(existingId, dir))) {
    unlinkSync(configPath(existingId, dir))
  }
  return cfg
}

export function deleteConfig(id: string, userId?: string): void {
  const dir = configsDirForUser(userId)
  const p = configPath(id, dir)
  if (existsSync(p)) unlinkSync(p)
}

// CLI helper — used by `npm start` to load the first config it finds.
export function loadGridConfig(): GridConfig {
  const all = listConfigs()
  if (all.length === 0) {
    throw new Error('No bot configs found. Open the dashboard (npm run serve) to create one.')
  }
  return all[0]
}

export function validateConfig(cfg: GridConfig): void {
  if (!(cfg.upper > cfg.lower)) throw new Error('upper must be > lower')
  if (cfg.gridCount < 2) throw new Error('gridCount must be >= 2')
  if (!cfg.orderSize && !cfg.investment) {
    throw new Error('Either orderSize or investment must be provided')
  }
  if (cfg.orderSize !== undefined && cfg.orderSize <= 0) {
    throw new Error('orderSize must be > 0')
  }
  if (cfg.investment !== undefined && cfg.investment <= 0) {
    throw new Error('investment must be > 0')
  }
  if (cfg.leverage !== undefined && cfg.leverage < 1) {
    throw new Error('leverage must be >= 1')
  }
  if (cfg.stopLossPrice !== undefined && cfg.stopLossPrice >= cfg.lower) {
    throw new Error('stopLossPrice must be below the lower grid bound')
  }
  if (cfg.takeProfitPrice !== undefined && cfg.takeProfitPrice <= cfg.upper) {
    throw new Error('takeProfitPrice must be above the upper grid bound')
  }
  if (cfg.rebalanceIntervalMs !== undefined && cfg.rebalanceIntervalMs <= 0) {
    throw new Error('rebalanceIntervalMs must be > 0')
  }
}

// Derives the per-grid order size from a USDC budget.
//
// Worst case all sells fill (price spikes up) → max short notional =
// gridCount × orderSize × upper. We size so this notional uses half the
// budget × leverage, leaving the other half as a margin cushion.
export function deriveOrderSize(cfg: GridConfig): number {
  if (cfg.orderSize) return cfg.orderSize
  if (!cfg.investment) throw new Error('investment required to derive orderSize')
  const lev = cfg.leverage ?? 1
  const safety = 0.5
  return (cfg.investment * lev * safety) / (cfg.gridCount * cfg.upper)
}

export function buildLines(cfg: GridConfig): number[] {
  const { lower, upper, gridCount, mode } = cfg
  const lines: number[] = []
  if (mode === 'geometric' && lower > 0) {
    const r = Math.pow(upper / lower, 1 / gridCount)
    for (let i = 0; i <= gridCount; i++) lines.push(lower * Math.pow(r, i))
  } else {
    const step = (upper - lower) / gridCount
    for (let i = 0; i <= gridCount; i++) lines.push(lower + step * i)
  }
  return lines
}

export function buildCenteredGrid(
  anchor: number,
  spacing: number,
  count: number,
  mode: GridMode,
): number[] {
  const lines: number[] = []
  const half = Math.floor(count / 2)
  if (mode === 'geometric' && anchor > 0) {
    const r = (anchor + spacing) / anchor
    for (let i = 0; i <= count; i++) lines.push(anchor * Math.pow(r, i - half))
  } else {
    for (let i = 0; i <= count; i++) lines.push(anchor + (i - half) * spacing)
  }
  return lines.filter((x) => x > 0)
}
