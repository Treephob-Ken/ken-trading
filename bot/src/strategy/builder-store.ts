// Filesystem store for CustomStrategySpec presets. Matches the pattern used
// for grid configs and signal-bot configs: one JSON file per spec under
// data/<userId>/custom-strategies/ for multi-tenant; data/custom-strategies
// (legacy path) for single-tenant.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CustomStrategySpec } from './builder-types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', '..', 'data')

function dirForUser(userId?: string): string {
  if (userId) return join(DATA_DIR, userId, 'custom-strategies')
  return join(DATA_DIR, 'custom-strategies')
}

function ensureDir(d: string): void {
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
}

function nextId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export interface PresetSummary {
  id: string
  name: string
  updatedAt: number
}

export function listSpecs(userId?: string): PresetSummary[] {
  const d = dirForUser(userId)
  if (!existsSync(d)) return []
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const spec = JSON.parse(readFileSync(join(d, f), 'utf8')) as CustomStrategySpec
      return { id: spec.id, name: spec.name, updatedAt: spec.updatedAt ?? 0 }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadSpec(id: string, userId?: string): CustomStrategySpec | null {
  const d = dirForUser(userId)
  const path = join(d, `${id}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as CustomStrategySpec
}

export function saveSpec(spec: CustomStrategySpec, userId?: string): CustomStrategySpec {
  const d = dirForUser(userId)
  ensureDir(d)
  const now = Date.now()
  // Allocate a stable id if the client didn't pre-generate one. Once written,
  // subsequent saves overwrite the same file.
  if (!spec.id) spec.id = nextId()
  spec.updatedAt = now
  if (!spec.createdAt) spec.createdAt = now
  // Minimal hardening: keep only known fields, no random bloat from clients.
  const clean: CustomStrategySpec = {
    id: spec.id,
    name: (spec.name ?? 'Untitled').toString().slice(0, 100),
    description: spec.description?.toString().slice(0, 500),
    entryLong: spec.entryLong,
    exitLong: spec.exitLong,
    entryShort: spec.entryShort,
    exitShort: spec.exitShort,
    tpPct: typeof spec.tpPct === 'number' ? spec.tpPct : undefined,
    slPct: typeof spec.slPct === 'number' ? spec.slPct : undefined,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
  }
  writeFileSync(join(d, `${clean.id}.json`), JSON.stringify(clean, null, 2))
  return clean
}

export function deleteSpec(id: string, userId?: string): boolean {
  const d = dirForUser(userId)
  const path = join(d, `${id}.json`)
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}
