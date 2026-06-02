// User accounts and credential storage for multi-user mode.
//
// Users are stored in a SQLite DB (bot/data/users.db). Each user can save
// their own Hyperliquid agent key, which is AES-256-GCM encrypted at rest
// using KEY_ENCRYPTION_SECRET. The HL user address is stored in plaintext
// since it's not secret (it's your public wallet address).
//
// KEY_ENCRYPTION_SECRET is unrecoverable — losing it means all stored HL
// keys are permanently inaccessible. Back it up securely, separate from the
// database file.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'
import { HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import type { EnvConfig } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const DB_PATH = join(DATA_DIR, 'users.db')

const BCRYPT_ROUNDS = 12

// ─── Database setup ───────────────────────────────────────────────────────────

let _db: ReturnType<typeof Database> | null = null

export function getDb(): ReturnType<typeof Database> {
  if (_db) return _db
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      hl_key_enc  TEXT,      -- AES-256-GCM encrypted HL agent private key
      hl_user     TEXT,      -- HL user/wallet address (public, not secret)
      hl_network  TEXT NOT NULL DEFAULT 'mainnet'
    );
  `)
  // Kill-switch columns — added in a later migration. ALTER TABLE ADD COLUMN
  // is idempotent only via try/catch since SQLite errors if the column exists.
  for (const col of [
    `ALTER TABLE users ADD COLUMN kill_switch_enabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN kill_switch_pct REAL NOT NULL DEFAULT 15`,
    // Per-network agent keys — a Hyperliquid agent is network-specific, so each
    // network keeps its own key and switching networks no longer wipes it.
    `ALTER TABLE users ADD COLUMN hl_key_testnet TEXT`,
    `ALTER TABLE users ADD COLUMN hl_key_mainnet TEXT`,
  ]) {
    try { _db.exec(col) } catch { /* column already exists */ }
  }
  // One-time backfill: move the legacy single key into the slot for whichever
  // network it was saved on, so existing users don't have to re-paste.
  try {
    _db.exec(`UPDATE users SET hl_key_testnet = hl_key_enc WHERE hl_network = 'testnet' AND hl_key_testnet IS NULL AND hl_key_enc IS NOT NULL`)
    _db.exec(`UPDATE users SET hl_key_mainnet = hl_key_enc WHERE hl_network = 'mainnet' AND hl_key_mainnet IS NULL AND hl_key_enc IS NOT NULL`)
  } catch { /* best effort */ }
  return _db
}

export interface User {
  id: string
  email: string
  isAdmin: boolean
  createdAt: number
  hlUser: string | null
  hlNetwork: 'testnet' | 'mainnet'
  hlConfigured: boolean // true if hl_key_enc is set
}

export interface UserRow {
  id: string
  email: string
  is_admin: number
  password_hash: string
  created_at: number
  hl_key_enc: string | null
  hl_user: string | null
  hl_network: string
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin !== 0,
    createdAt: row.created_at,
    hlUser: row.hl_user,
    hlNetwork: row.hl_network === 'testnet' ? 'testnet' : 'mainnet',
    hlConfigured: !!row.hl_key_enc,
  }
}

// ─── AES-256-GCM helpers ──────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET?.trim()
  if (!secret) {
    throw new Error(
      'KEY_ENCRYPTION_SECRET is not set. Multi-user mode requires this env var. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }
  if (secret.length !== 64) {
    throw new Error('KEY_ENCRYPTION_SECRET must be exactly 64 hex characters (32 bytes)')
  }
  return Buffer.from(secret, 'hex')
}

// Encrypt a plaintext string. Returns `iv:authTag:ciphertext` as hex, colon-separated.
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

// Decrypt an `iv:authTag:ciphertext` blob back to plaintext. Throws on tamper.
export function decryptSecret(blob: string): string {
  const parts = blob.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format')
  const key = getEncryptionKey()
  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const ciphertext = Buffer.from(parts[2], 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createUser(
  email: string,
  password: string,
  isAdmin = false,
): User {
  const db = getDb()
  const id = randomUUID()
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS)
  const now = Date.now()
  db.prepare(
    `INSERT INTO users (id, email, password_hash, is_admin, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email.trim().toLowerCase(), hash, isAdmin ? 1 : 0, now)
  return rowToUser(
    db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow,
  )
}

export function findUserByEmail(email: string): UserRow | null {
  const db = getDb()
  return (
    (db.prepare('SELECT * FROM users WHERE email = ?').get(
      email.trim().toLowerCase(),
    ) as UserRow | undefined) ?? null
  )
}

export function findUserById(id: string): User | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  return row ? rowToUser(row) : null
}

export function verifyPassword(email: string, password: string): UserRow | null {
  const row = findUserByEmail(email)
  if (!row) return null
  return bcrypt.compareSync(password, row.password_hash) ? row : null
}

export function listUsers(): User[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[]
  return rows.map(rowToUser)
}

export function deleteUser(id: string): void {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id)
}

export function userCount(): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }
  return row.n
}

// ─── HL credentials ───────────────────────────────────────────────────────────

const HEX_KEY_RE = /^0x[0-9a-fA-F]{64}$/
const HEX_ADDR_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * Strict format check on a pasted agent private key. Trims whitespace,
 * verifies the 0x + 64-hex shape, and returns the derived agent address —
 * which is what Hyperliquid sees as the signer. Throws with a specific,
 * user-actionable message on any failure.
 */
export function validateAgentKeyFormat(rawKey: string): {
  key: `0x${string}`
  address: `0x${string}`
} {
  const key = rawKey.trim()
  if (!key) {
    throw new Error('Agent key is empty — paste the long 0x… string from Hyperliquid\'s API page.')
  }
  if (!key.startsWith('0x')) {
    throw new Error('Agent key must start with "0x". Make sure you copied the whole string (no leading quote or space).')
  }
  if (key.length !== 66) {
    throw new Error(
      `Agent key must be exactly 66 characters (0x + 64 hex digits). Got ${key.length}. ` +
      'Re-copy from Hyperliquid — partial selections silently truncate.',
    )
  }
  if (!HEX_KEY_RE.test(key)) {
    throw new Error('Agent key contains non-hex characters. Only 0-9 and a-f are allowed after the "0x" prefix.')
  }
  const account = privateKeyToAccount(key as `0x${string}`)
  return { key: key as `0x${string}`, address: account.address as `0x${string}` }
}

export function validateHLUserFormat(rawUser: string): `0x${string}` {
  const u = rawUser.trim()
  if (!HEX_ADDR_RE.test(u)) {
    throw new Error('Wallet address must be a 0x-prefixed 40-hex-char address (the wallet you connected to Hyperliquid).')
  }
  return u.toLowerCase() as `0x${string}`
}

/**
 * Ask Hyperliquid whether `agentAddress` is currently approved for `hlUser`
 * on the given network. Catches the most common error ("user does not exist"
 * = wallet never deposited) and turns it into a clear, actionable message.
 *
 * Network IO — call from request handlers, not from DB write paths.
 */
export async function verifyAgentOnHL(
  agentAddress: `0x${string}`,
  hlUser: `0x${string}`,
  network: 'testnet' | 'mainnet',
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet: network === 'testnet' }) })
  const subdomain = network === 'testnet' ? 'app.hyperliquid-testnet.xyz' : 'app.hyperliquid.xyz'
  try {
    const agents = await info.extraAgents({ user: hlUser })
    const target = agentAddress.toLowerCase()
    const found = agents.find((a) => a.address.toLowerCase() === target)
    if (!found) {
      const approvedList = agents.length === 0
        ? 'No agents are currently approved for this wallet on this network.'
        : `Currently approved on this wallet: ${agents.map((a) => a.address.slice(0, 8) + '…').join(', ')}.`
      return {
        ok: false,
        reason: `Agent ${agentAddress.slice(0, 10)}… is not approved on ${network} for wallet ${hlUser.slice(0, 10)}…. ` +
                approvedList + ' ' +
                `Generate a fresh agent at ${subdomain} → More → API while connected as ${hlUser}, then re-save.`,
      }
    }
    return { ok: true }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
    if (msg.includes('does not exist') || msg.includes('user does not exist')) {
      return {
        ok: false,
        reason: `Wallet ${hlUser} has no account on ${network}. ` +
                (network === 'testnet'
                  ? `Get free testnet USDC at ${subdomain}/drip, then any wallet activity creates the account.`
                  : `Bridge USDC into Hyperliquid mainnet first via the deposit flow at ${subdomain}.`),
      }
    }
    return {
      ok: false,
      reason: `Could not verify agent against Hyperliquid (${network}): ${(e as Error).message ?? String(e)}`,
    }
  }
}

export function saveHLCredentials(
  userId: string,
  agentKey: string,
  hlUser: string,
  network: 'testnet' | 'mainnet',
): void {
  // agentKey may be blank — caller wants to update address/network only (keep existing key).
  if (agentKey) {
    // Use the strict validator so all callers get the same helpful errors.
    validateAgentKeyFormat(agentKey)
  }
  const normalizedUser = validateHLUserFormat(hlUser)
  const db = getDb()
  // Per-network key column for the network being saved. `hl_key_enc` is kept as
  // a mirror of the ACTIVE network's key so any legacy reader stays correct.
  const col = network === 'testnet' ? 'hl_key_testnet' : 'hl_key_mainnet'
  if (agentKey) {
    const encrypted = encryptSecret(agentKey.trim())
    db.prepare(
      `UPDATE users SET ${col} = ?, hl_key_enc = ?, hl_user = ?, hl_network = ? WHERE id = ?`,
    ).run(encrypted, encrypted, normalizedUser, network, userId)
  } else {
    // Network/address-only update: keep each network's stored key, switch the
    // active network, and point hl_key_enc at the target network's key (which
    // may be null if that network hasn't been keyed yet — handled on load).
    db.prepare(
      `UPDATE users SET hl_user = ?, hl_network = ?, hl_key_enc = ${col} WHERE id = ?`,
    ).run(normalizedUser, network, userId)
  }
}

// Which networks currently have an agent key saved — drives the Settings UI so
// the user can see "testnet ✓ / mainnet —" and only re-paste when needed.
export function getHLConfiguredNetworks(userId: string): { testnet: boolean; mainnet: boolean } {
  const row = getDb()
    .prepare('SELECT hl_key_testnet, hl_key_mainnet FROM users WHERE id = ?')
    .get(userId) as { hl_key_testnet: string | null; hl_key_mainnet: string | null } | undefined
  return { testnet: !!row?.hl_key_testnet, mainnet: !!row?.hl_key_mainnet }
}

// ─── Kill-switch config ────────────────────────────────────────────────────────

export interface KillSwitchConfig {
  enabled: boolean
  pct: number   // drawdown % from UTC-midnight snapshot that trips the switch
}

export function getKillSwitchConfig(userId: string): KillSwitchConfig {
  const row = getDb()
    .prepare('SELECT kill_switch_enabled, kill_switch_pct FROM users WHERE id = ?')
    .get(userId) as { kill_switch_enabled: number; kill_switch_pct: number } | undefined
  if (!row) return { enabled: false, pct: 15 }
  return { enabled: row.kill_switch_enabled !== 0, pct: row.kill_switch_pct }
}

export function setKillSwitchConfig(userId: string, enabled: boolean, pct: number): void {
  if (!Number.isFinite(pct) || pct < 1 || pct > 90) {
    throw new Error('Kill-switch drawdown must be between 1% and 90%')
  }
  getDb()
    .prepare('UPDATE users SET kill_switch_enabled = ?, kill_switch_pct = ? WHERE id = ?')
    .run(enabled ? 1 : 0, pct, userId)
}

// Load a user's HL credentials as an EnvConfig, ready to pass to createClients().
// Throws if the user hasn't saved credentials yet.
export function loadUserCreds(userId: string): EnvConfig {
  const db = getDb()
  const row = db.prepare('SELECT hl_key_enc, hl_key_testnet, hl_key_mainnet, hl_user, hl_network FROM users WHERE id = ?').get(userId) as
    | { hl_key_enc: string | null; hl_key_testnet: string | null; hl_key_mainnet: string | null; hl_user: string | null; hl_network: string }
    | undefined
  if (!row) throw new Error(`User ${userId} not found`)
  const isTestnet = row.hl_network === 'testnet'
  // Use the active network's own key; fall back to the legacy single key.
  const enc = (isTestnet ? row.hl_key_testnet : row.hl_key_mainnet) ?? row.hl_key_enc
  if (!enc || !row.hl_user) {
    throw new Error(
      `Hyperliquid credentials not configured for ${row.hl_network}. Go to Settings and paste your ${row.hl_network} agent key.`,
    )
  }
  const agentKey = decryptSecret(enc)
  return {
    agentKey: agentKey as `0x${string}`,
    user: row.hl_user as `0x${string}`,
    isTestnet,
  }
}
