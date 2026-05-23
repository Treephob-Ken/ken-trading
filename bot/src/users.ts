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

export function saveHLCredentials(
  userId: string,
  agentKey: string,
  hlUser: string,
  network: 'testnet' | 'mainnet',
): void {
  // agentKey may be blank — caller wants to update address/network only (keep existing key).
  if (agentKey && (!agentKey.startsWith('0x') || agentKey.length !== 66)) {
    throw new Error('agentKey must be a 0x-prefixed 64-hex-char private key')
  }
  if (!hlUser.startsWith('0x') || hlUser.length !== 42) {
    throw new Error('hlUser must be a 0x-prefixed 40-hex-char address')
  }
  const db = getDb()
  if (agentKey) {
    const encrypted = encryptSecret(agentKey)
    db.prepare(
      `UPDATE users SET hl_key_enc = ?, hl_user = ?, hl_network = ? WHERE id = ?`,
    ).run(encrypted, hlUser.toLowerCase(), network, userId)
  } else {
    // Keep the existing encrypted key — only refresh address and network.
    db.prepare(
      `UPDATE users SET hl_user = ?, hl_network = ? WHERE id = ?`,
    ).run(hlUser.toLowerCase(), network, userId)
  }
}

// Load a user's HL credentials as an EnvConfig, ready to pass to createClients().
// Throws if the user hasn't saved credentials yet.
export function loadUserCreds(userId: string): EnvConfig {
  const db = getDb()
  const row = db.prepare('SELECT hl_key_enc, hl_user, hl_network FROM users WHERE id = ?').get(userId) as
    | Pick<UserRow, 'hl_key_enc' | 'hl_user' | 'hl_network'>
    | undefined
  if (!row) throw new Error(`User ${userId} not found`)
  if (!row.hl_key_enc || !row.hl_user) {
    throw new Error(
      'Hyperliquid credentials not configured. Go to Settings → HL Credentials to set your agent key.',
    )
  }
  const agentKey = decryptSecret(row.hl_key_enc)
  return {
    agentKey: agentKey as `0x${string}`,
    user: row.hl_user as `0x${string}`,
    isTestnet: row.hl_network === 'testnet',
  }
}
