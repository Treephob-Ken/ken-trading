// Frontend mirror of the journal types defined in bot/src/journal.ts.
// Kept in sync by eye (same convention used for grid math + strategies).

export type SourceKind = 'signal' | 'grid' | 'manual'

export interface FillSource {
  kind: SourceKind
  botId?: string
  botName?: string
}

export interface Fill {
  time: number
  asset: string
  side: 'buy' | 'sell'
  price: number
  size: number
  startPosition: number
  dir: string
  closedPnl: number
  fee: number
  oid: number
  hash: string
  source: FillSource
}

export interface RoundTrip {
  id: string
  asset: string
  side: 'long' | 'short'
  entryTime: number
  exitTime: number
  entryPx: number
  exitPx: number
  size: number
  fees: number
  closedPnl: number
  pnlPct: number
  holdMs: number
  fillCount: number
  source: FillSource
}

export interface AuditLine {
  ts: string
  asset: string
  side: 'buy' | 'sell'
  requestedSize: number
  filled: boolean
  filledSize: number
  avgPx: number | null
  notionalUsd: number
}

export interface DailyBucket {
  date: string
  pnl: number
  trades: number
}

export interface BotRollup {
  source: FillSource
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number
}

export interface JournalSummary {
  range: '24h' | '7d' | '30d'
  from: number
  to: number
  netPnl: number
  fillsCount: number
  roundTripCount: number
  winRate: number
  best: { pnl: number; asset: string; source: FillSource } | null
  worst: { pnl: number; asset: string; source: FillSource } | null
  openValue: number
  dailySeries: DailyBucket[]
  byBot: BotRollup[]
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function money(v: number, signed = false): string {
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (v < 0) return '-$' + abs
  if (signed && v > 0) return '+$' + abs
  return '$' + abs
}

export function pct(v: number, signed = false): string {
  const fixed = v.toFixed(2)
  if (v < 0) return fixed + '%'
  if (signed && v > 0) return '+' + fixed + '%'
  return fixed + '%'
}

export function fmtHoldMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.round(s / 60)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h < 24) return rm > 0 ? `${h}h ${rm}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}

export function fmtTimeShort(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const mon = d.toLocaleString('en-US', { month: 'short' })
  return `${day} ${mon} ${hh}:${mm}`
}

export function sourceLabel(s: FillSource): string {
  if (s.kind === 'manual') return 'Manual'
  return s.botName || s.kind
}
