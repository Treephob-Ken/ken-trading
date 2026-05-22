// Server-side trade safety caps and an audit trail.
//
// Once the bot is reachable beyond localhost (e.g. through a tunnel) the API
// can place real orders from off-machine. These caps are hard limits enforced
// here regardless of what the caller asks for, so a stolen session or a UI bug
// has bounded damage. They are independent of the per-request slippage cap in
// trade.ts.

import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUDIT_PATH = join(__dirname, '..', 'trade-audit.log')

// Largest notional (size × price, in USD) a single order may carry. 0 / unset
// means no cap.
const MAX_TRADE_NOTIONAL_USD = Number(process.env.MAX_TRADE_NOTIONAL_USD ?? 0)

// Comma-separated allow-list of tradeable assets, e.g. "ETH,BTC,SOL". Empty
// means every asset is permitted.
const ALLOWED_ASSETS = (process.env.ALLOWED_ASSETS ?? '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

// Most filled orders allowed in any rolling 60-minute window. 0 / unset means
// no limit.
const MAX_TRADES_PER_HOUR = Number(process.env.MAX_TRADES_PER_HOUR ?? 0)

// Timestamps of recent trades, used for the rolling rate-limit window.
const recentTrades: number[] = []

export function assertAssetAllowed(asset: string): void {
  if (ALLOWED_ASSETS.length > 0 && !ALLOWED_ASSETS.includes(asset.toUpperCase())) {
    throw new Error(
      `Asset ${asset} is not in ALLOWED_ASSETS (${ALLOWED_ASSETS.join(', ')})`,
    )
  }
}

export function assertNotionalAllowed(notionalUsd: number): void {
  if (MAX_TRADE_NOTIONAL_USD > 0 && notionalUsd > MAX_TRADE_NOTIONAL_USD) {
    throw new Error(
      `Order notional $${notionalUsd.toFixed(2)} exceeds the ` +
        `MAX_TRADE_NOTIONAL_USD cap of $${MAX_TRADE_NOTIONAL_USD.toFixed(2)}`,
    )
  }
}

export function assertRateLimit(): void {
  if (MAX_TRADES_PER_HOUR <= 0) return
  const cutoff = Date.now() - 3_600_000
  while (recentTrades.length > 0 && recentTrades[0] < cutoff) recentTrades.shift()
  if (recentTrades.length >= MAX_TRADES_PER_HOUR) {
    throw new Error(
      `Rate limit reached — ${MAX_TRADES_PER_HOUR} trades in the last hour. ` +
        'Try again later.',
    )
  }
}

export interface AuditEntry {
  asset: string
  side: 'buy' | 'sell'
  requestedSize: number
  filled: boolean
  filledSize: number
  avgPx: number | null
  notionalUsd: number
}

// Append one line of NDJSON to trade-audit.log and count it toward the rolling
// rate-limit window. Called once per executed order, fill or no fill.
export function recordTrade(entry: AuditEntry): void {
  recentTrades.push(Date.now())
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry })
  try {
    appendFileSync(AUDIT_PATH, line + '\n')
  } catch (e) {
    log.err(`Could not write trade audit log: ${(e as Error).message}`)
  }
}
