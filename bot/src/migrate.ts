// One-time migration: on the first multi-user boot, copy existing single-tenant
// configs and signal-bot state into the owner user's data directory.
//
// Existing files:
//   bot/configs/*.json        → data/<ownerId>/configs/*.json
//   bot/signal-bots/*.json    → data/<ownerId>/signal-bots/*.json
//
// A marker file (data/.migrated) is written on completion so we only run once.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const LEGACY_CONFIGS = join(__dirname, '..', 'configs')
const LEGACY_SIGNALS = join(__dirname, '..', 'signal-bots')
const MARKER_PATH = join(DATA_DIR, '.migrated')

export function runMigrationIfNeeded(ownerId: string): void {
  if (existsSync(MARKER_PATH)) return // already done

  let migrated = 0

  // Migrate grid bot configs
  if (existsSync(LEGACY_CONFIGS)) {
    const destDir = join(DATA_DIR, ownerId, 'configs')
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    for (const file of readdirSync(LEGACY_CONFIGS)) {
      if (!file.endsWith('.json')) continue
      const src = join(LEGACY_CONFIGS, file)
      const dst = join(destDir, file)
      if (!existsSync(dst)) {
        copyFileSync(src, dst)
        migrated++
      }
    }
  }

  // Migrate signal bot state
  if (existsSync(LEGACY_SIGNALS)) {
    const destDir = join(DATA_DIR, ownerId, 'signal-bots')
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    for (const file of readdirSync(LEGACY_SIGNALS)) {
      if (!file.endsWith('.json')) continue
      const src = join(LEGACY_SIGNALS, file)
      const dst = join(destDir, file)
      if (!existsSync(dst)) {
        copyFileSync(src, dst)
        migrated++
      }
    }
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(MARKER_PATH, JSON.stringify({ migratedAt: new Date().toISOString(), ownerId, files: migrated }))

  if (migrated > 0) {
    log.ok(`Migration: copied ${migrated} existing bot file(s) to data/${ownerId}/`)
  } else {
    log.info(`Migration: no existing bot files found — starting fresh for owner ${ownerId}`)
  }
}
