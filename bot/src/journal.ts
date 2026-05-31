// Trade journal — reads from Hyperliquid (authoritative fills + closedPnl) and
// from our local audit log (every order attempt, including rejections). Pairs
// fills into round-trips per asset using position-tracking math and tags each
// one with the owning bot when one is configured for that asset.
//
// Pure read-side module. Does not mutate bot state.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import type { EnvConfig } from './config.js'
import { listConfigs } from './config.js'
import { listSignalBots } from './signal-bot.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUDIT_PATH_LEGACY = join(__dirname, '..', 'trade-audit.log')
const DATA_DIR = join(__dirname, '..', 'data')

// ─── Shared types ─────────────────────────────────────────────────────────────

export type SourceKind = 'signal' | 'grid' | 'manual'

export interface FillSource {
  kind: SourceKind
  botId?: string
  botName?: string
}

export interface Fill {
  time: number               // ms since epoch
  asset: string              // coin, e.g. "ETH"
  side: 'buy' | 'sell'       // normalized from HL "B"/"A"
  price: number              // fill price
  size: number               // fill size
  startPosition: number      // signed position size before this fill
  dir: string                // raw HL direction, e.g. "Open Long"
  closedPnl: number          // realized PnL contribution
  fee: number                // fee paid (negative = rebate)
  oid: number                // order id
  hash: string               // l1 tx hash
  source: FillSource
}

export interface RoundTrip {
  id: string                 // hash of first-fill oid + asset, stable across reloads
  asset: string
  side: 'long' | 'short'
  entryTime: number          // ms — first fill that opened the position
  exitTime: number           // ms — fill that brought position to zero
  entryPx: number            // size-weighted average entry price
  exitPx: number             // size-weighted average exit price
  size: number               // max absolute position size held during the trip
  fees: number               // total fees across all fills in the trip
  closedPnl: number          // sum of closedPnl across closing fills
  pnlPct: number             // closedPnl / (entryPx * size) × 100
  holdMs: number             // exitTime - entryTime
  fillCount: number          // total fills in the round-trip
  source: FillSource         // taken from the opening fill
}

export interface AuditLine {
  ts: string                 // ISO
  asset: string
  side: 'buy' | 'sell'
  requestedSize: number
  filled: boolean
  filledSize: number
  avgPx: number | null
  notionalUsd: number
  resting?: boolean
  reason?: string
}

export interface DailyBucket {
  date: string               // YYYY-MM-DD (UTC)
  pnl: number
  trades: number
}

export interface BotRollup {
  source: FillSource         // includes kind for "Manual"
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number            // 0-100
}

export interface JournalSummary {
  range: '24h' | '7d' | '30d'
  from: number
  to: number
  netPnl: number
  fillsCount: number
  roundTripCount: number
  winRate: number            // 0-100
  best: { pnl: number; asset: string; source: FillSource } | null
  worst: { pnl: number; asset: string; source: FillSource } | null
  openValue: number          // notional value of currently-open positions (placeholder if not provided)
  dailySeries: DailyBucket[]
  byBot: BotRollup[]
}

// ─── Source map (asset → bot) ─────────────────────────────────────────────────

// Same composition as /api/positions/sources in server.ts — kept in sync by eye.
// Returns the first bot configured for an asset; if none, the fill is tagged
// "manual". Per-asset multi-bot is rare and the journal collapses to the first
// match to keep round-trip attribution stable.
export function buildAssetSourceMap(uid?: string): Map<string, FillSource> {
  const map = new Map<string, FillSource>()
  for (const sum of listSignalBots(uid)) {
    const asset = sum.symbol.replace(/USDT$/i, '').toUpperCase()
    if (!asset || map.has(asset)) continue
    map.set(asset, { kind: 'signal', botId: sum.id, botName: sum.name })
  }
  for (const cfg of listConfigs(uid)) {
    const asset = (cfg.asset || '').toUpperCase()
    if (!asset || map.has(asset)) continue
    map.set(asset, { kind: 'grid', botId: cfg.id || '', botName: cfg.name || `${asset}-GRID` })
  }
  return map
}

function attribute(asset: string, srcMap: Map<string, FillSource>): FillSource {
  return srcMap.get(asset.toUpperCase()) ?? { kind: 'manual' }
}

// ─── Audit log loader ─────────────────────────────────────────────────────────

function auditPathForUser(uid?: string): string {
  if (!uid) return AUDIT_PATH_LEGACY
  return join(DATA_DIR, uid, 'trade-audit.log')
}

export function loadAuditLines(uid: string | undefined, from: number, to: number): AuditLine[] {
  const path = auditPathForUser(uid)
  if (!existsSync(path)) return []
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch { return [] }
  const out: AuditLine[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line) as Partial<AuditLine> & { ts?: string }
      if (!j.ts) continue
      const t = Date.parse(j.ts)
      if (!Number.isFinite(t) || t < from || t > to) continue
      out.push({
        ts: j.ts,
        asset: String(j.asset ?? '').toUpperCase(),
        side: j.side === 'sell' ? 'sell' : 'buy',
        requestedSize: Number(j.requestedSize ?? 0),
        filled: Boolean(j.filled),
        filledSize: Number(j.filledSize ?? 0),
        avgPx: j.avgPx == null ? null : Number(j.avgPx),
        notionalUsd: Number(j.notionalUsd ?? 0),
        resting: j.resting === true ? true : undefined,
        reason: typeof j.reason === 'string' ? j.reason : undefined,
      })
    } catch { /* skip malformed line */ }
  }
  // Newest first matches what the UI wants by default.
  return out.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
}

// ─── Hyperliquid fills ────────────────────────────────────────────────────────

// One InfoClient per address — cheap to keep, avoids reconnecting on every
// request. Mainnet/testnet are different transports so we key on both.
const infoCache = new Map<string, InfoClient>()

function getInfoClient(isTestnet: boolean): InfoClient {
  const key = isTestnet ? 'test' : 'main'
  let c = infoCache.get(key)
  if (!c) {
    c = new InfoClient({ transport: new HttpTransport({ isTestnet }) })
    infoCache.set(key, c)
  }
  return c
}

export async function fetchFillsFromHL(
  creds: EnvConfig,
  from: number,
  to: number,
  srcMap: Map<string, FillSource>,
): Promise<Fill[]> {
  const info = getInfoClient(creds.isTestnet)
  const raw = await info.userFillsByTime({ user: creds.user, startTime: from, endTime: to })
  const fills: Fill[] = raw.map((r) => ({
    time: r.time,
    asset: r.coin.toUpperCase(),
    side: r.side === 'B' ? 'buy' : 'sell',
    price: Number(r.px),
    size: Number(r.sz),
    startPosition: Number(r.startPosition),
    dir: r.dir,
    closedPnl: Number(r.closedPnl),
    fee: Number(r.fee),
    oid: r.oid,
    hash: r.hash,
    source: attribute(r.coin, srcMap),
  }))
  // Oldest first — required for round-trip pairing.
  return fills.sort((a, b) => a.time - b.time)
}

// ─── Round-trip pairing ───────────────────────────────────────────────────────

// Walks fills per asset in chronological order, tracking signed position size.
// A round-trip starts when the position goes from 0 to non-zero and ends when
// it returns to 0. Size flips (long → short in a single fill) are split into a
// closing fill + an opening fill of the new direction.
//
// Same-millisecond ordering: when the bot flips direction it fires close-then-
// open back-to-back. HL may return those fills in either order, but the math
// only works if closes are processed first (otherwise the close-fill's PnL is
// absorbed by the wrong round-trip). We pre-sort same-time fills using HL's
// `dir` string: anything with "Close" goes before anything with "Open".
export function pairRoundTrips(fills: Fill[]): RoundTrip[] {
  const dirRank = (dir: string): number => {
    const d = dir.toLowerCase()
    if (d.includes('close')) return 0   // close fills first
    if (d.includes('open')) return 2    // opens last
    return 1                            // anything else (flips, unknown) in the middle
  }

  const byAsset = new Map<string, Fill[]>()
  for (const f of fills) {
    if (!byAsset.has(f.asset)) byAsset.set(f.asset, [])
    byAsset.get(f.asset)!.push(f)
  }
  // Stable sort: chronological first, then closes-before-opens within same ms.
  for (const list of byAsset.values()) {
    list.sort((a, b) => a.time - b.time || dirRank(a.dir) - dirRank(b.dir))
  }

  const trips: RoundTrip[] = []

  for (const [asset, list] of byAsset) {
    let pos = 0
    let openSide: 'long' | 'short' | null = null
    let openTime = 0
    let entryNotional = 0     // sum of px*sz for opening fills
    let entrySizeAbs = 0      // sum of |sz| for opening fills
    let exitNotional = 0
    let exitSizeAbs = 0
    let maxSize = 0
    let fees = 0
    let pnl = 0
    let fillCount = 0
    let firstOid = 0
    let openSource: FillSource = { kind: 'manual' }
    let lastTime = 0

    const flush = () => {
      if (openSide && entrySizeAbs > 0 && exitSizeAbs > 0) {
        const entryPx = entryNotional / entrySizeAbs
        const exitPx = exitNotional / exitSizeAbs
        const pnlPct = entryPx > 0 ? (pnl / (entryPx * maxSize)) * 100 : 0
        trips.push({
          id: `${asset}-${firstOid}`,
          asset,
          side: openSide,
          entryTime: openTime,
          exitTime: lastTime,
          entryPx,
          exitPx,
          size: maxSize,
          fees,
          closedPnl: pnl,
          pnlPct,
          holdMs: lastTime - openTime,
          fillCount,
          source: openSource,
        })
      }
      openSide = null
      openTime = 0
      entryNotional = 0
      entrySizeAbs = 0
      exitNotional = 0
      exitSizeAbs = 0
      maxSize = 0
      fees = 0
      pnl = 0
      fillCount = 0
      firstOid = 0
    }

    for (const f of list) {
      const signed = f.side === 'buy' ? +f.size : -f.size
      const prevPos = pos
      const nextPos = prevPos + signed
      lastTime = f.time

      // Detect flip: prev and next have opposite signs and prev !== 0.
      // Split into close-to-zero + open-new logically.
      const flipped = prevPos !== 0 && nextPos !== 0 && Math.sign(prevPos) !== Math.sign(nextPos)

      if (prevPos === 0 && nextPos !== 0) {
        // Pure opener
        openSide = nextPos > 0 ? 'long' : 'short'
        openTime = f.time
        openSource = f.source
        firstOid = f.oid
        entryNotional += f.price * f.size
        entrySizeAbs += f.size
        maxSize = Math.max(maxSize, Math.abs(nextPos))
      } else if (prevPos !== 0 && nextPos === 0) {
        // Pure closer — completes the round-trip
        exitNotional += f.price * f.size
        exitSizeAbs += f.size
        pnl += f.closedPnl
        fees += f.fee
        fillCount += 1
        pos = nextPos
        flush()
        continue
      } else if (flipped) {
        // Treat as: close the prev side, open the new side.
        // Approximate: split the fill size proportionally.
        const closeSz = Math.abs(prevPos)
        const openSz = Math.abs(nextPos)
        exitNotional += f.price * closeSz
        exitSizeAbs += closeSz
        pnl += f.closedPnl
        fees += f.fee * (closeSz / f.size)
        fillCount += 1
        pos = nextPos
        flush()
        // Now open the new direction with the remainder.
        openSide = nextPos > 0 ? 'long' : 'short'
        openTime = f.time
        openSource = f.source
        firstOid = f.oid
        entryNotional += f.price * openSz
        entrySizeAbs += openSz
        maxSize = Math.max(maxSize, openSz)
        fees += f.fee * (openSz / f.size)
        fillCount += 1
        continue
      } else if (Math.sign(signed) === Math.sign(prevPos)) {
        // Increasing the open position (same direction)
        entryNotional += f.price * f.size
        entrySizeAbs += f.size
        maxSize = Math.max(maxSize, Math.abs(nextPos))
      } else {
        // Reducing the position (partial close, doesn't reach zero)
        exitNotional += f.price * f.size
        exitSizeAbs += f.size
        pnl += f.closedPnl
      }

      fees += f.fee
      fillCount += 1
      pos = nextPos
    }
    // If the position is still open at the end of the window, we skip emitting
    // the unclosed trip — it'll show up in the next window when it closes.
  }

  return trips.sort((a, b) => b.exitTime - a.exitTime)
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function rangeBoundsMs(range: '24h' | '7d' | '30d'): { from: number; to: number } {
  const to = Date.now()
  const span = range === '24h' ? 86_400_000 : range === '7d' ? 7 * 86_400_000 : 30 * 86_400_000
  return { from: to - span, to }
}

export function summarize(
  fills: Fill[],
  trips: RoundTrip[],
  range: '24h' | '7d' | '30d',
  openValue: number,
): JournalSummary {
  const { from, to } = rangeBoundsMs(range)

  const netPnl = trips.reduce((s, t) => s + t.closedPnl, 0)
  const wins = trips.filter((t) => t.closedPnl > 0).length
  const losses = trips.filter((t) => t.closedPnl < 0).length
  const winRate = trips.length > 0 ? (wins / (wins + losses || 1)) * 100 : 0

  let best: JournalSummary['best'] = null
  let worst: JournalSummary['worst'] = null
  for (const t of trips) {
    if (!best || t.closedPnl > best.pnl) best = { pnl: t.closedPnl, asset: t.asset, source: t.source }
    if (!worst || t.closedPnl < worst.pnl) worst = { pnl: t.closedPnl, asset: t.asset, source: t.source }
  }
  if (best && best.pnl <= 0) best = null
  if (worst && worst.pnl >= 0) worst = null

  // Daily buckets — fill in every day in the window so the heatmap is dense.
  const buckets = new Map<string, DailyBucket>()
  const dayMs = 86_400_000
  const startDay = Math.floor(from / dayMs) * dayMs
  for (let t = startDay; t <= to; t += dayMs) {
    const k = dayKey(t)
    buckets.set(k, { date: k, pnl: 0, trades: 0 })
  }
  for (const t of trips) {
    const k = dayKey(t.exitTime)
    const b = buckets.get(k) ?? { date: k, pnl: 0, trades: 0 }
    b.pnl += t.closedPnl
    b.trades += 1
    buckets.set(k, b)
  }
  const dailySeries = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))

  // By-bot rollup. Key by source identity (botId for bots, "manual" for manual).
  const botMap = new Map<string, BotRollup>()
  for (const t of trips) {
    const key = t.source.kind === 'manual' ? 'manual' : `${t.source.kind}:${t.source.botId}`
    let entry = botMap.get(key)
    if (!entry) {
      entry = { source: t.source, pnl: 0, trades: 0, wins: 0, losses: 0, winRate: 0 }
      botMap.set(key, entry)
    }
    entry.pnl += t.closedPnl
    entry.trades += 1
    if (t.closedPnl > 0) entry.wins += 1
    else if (t.closedPnl < 0) entry.losses += 1
  }
  const byBot = [...botMap.values()].map((b) => ({
    ...b,
    winRate: b.wins + b.losses > 0 ? (b.wins / (b.wins + b.losses)) * 100 : 0,
  })).sort((a, b) => b.pnl - a.pnl)

  return {
    range,
    from,
    to,
    netPnl,
    fillsCount: fills.length,
    roundTripCount: trips.length,
    winRate,
    best,
    worst,
    openValue,
    dailySeries,
    byBot,
  }
}

export function rangeToBounds(range: string | undefined): { from: number; to: number; range: '24h' | '7d' | '30d' } {
  const r = (range === '7d' || range === '30d') ? range : '24h'
  return { ...rangeBoundsMs(r), range: r }
}

// ─── Portfolio summary ────────────────────────────────────────────────────────
//
// A richer summary tailored for the Portfolio page. Reuses the round-trip
// pairing but adds: extended time ranges (90d / 1y / all), a by-asset
// rollup, and a running-equity series that turns the daily PnL into a
// cumulative line the UI can chart directly.

export type PortfolioRange = '24h' | '7d' | '30d' | '90d' | '1y' | 'all'

export interface AssetRollup {
  asset: string
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number            // 0-100
}

export interface EquityPoint {
  date: string               // YYYY-MM-DD (UTC)
  equity: number             // cumulative PnL up to and including this day
}

export interface PortfolioSummary {
  range: PortfolioRange
  from: number
  to: number
  netPnl: number
  fillsCount: number
  roundTripCount: number
  winRate: number            // 0-100 — wins / (wins + losses)
  best: { pnl: number; asset: string; source: FillSource } | null
  worst: { pnl: number; asset: string; source: FillSource } | null
  // Worst peak-to-trough drawdown on the equity series. Both expressed in
  // dollars; pct is relative to the running peak at the time of the trough.
  // Positive numbers; 0 if no drawdown.
  maxDrawdown: number
  maxDrawdownPct: number
  dailySeries: DailyBucket[]
  equitySeries: EquityPoint[]
  byBot: BotRollup[]
  byAsset: AssetRollup[]
}

export type EquityPeriod = 'day' | 'week' | 'month' | 'all'

export interface EquitySeriesResponse {
  period: EquityPeriod
  points: { t: number; value: number }[]      // account value over time (ms, $) — for the chart
  pnlPoints: { t: number; value: number }[]    // cumulative trading pnl over time (ms, $)
  startValue: number                           // first funded account value
  currentValue: number                         // latest account value (headline)
  periodPnl: number                            // trading PnL over the period ($), deposit-adjusted
  avgCapital: number                           // mean funded account value (return denominator)
  returnPct: number                            // periodPnl / avgCapital * 100 (deposit-proof)
  maxDrawdown: number                          // peak-to-trough on cumulative trading pnl ($)
  maxDrawdownPct: number                       // maxDrawdown / avgCapital * 100
}

// Map one Hyperliquid portfolio period's raw [ts, "value"] arrays into a chart-
// ready series.
//
// Return % and drawdown are based on `pnlHistory` (real trading PnL, which
// EXCLUDES deposits/withdrawals) — NOT on start→end account value. Account
// value includes deposits, so a tiny first balance funded up by transfers would
// otherwise report an absurd return (e.g. $5 → $157 = "+3047%"). We divide by
// average funded capital so the denominator is never a near-zero baseline.
export function mapEquitySeries(
  period: EquityPeriod,
  accountValueHistory: [number, string][],
  pnlHistory: [number, string][],
): EquitySeriesResponse {
  const raw = accountValueHistory.map(([t, v]) => ({ t, value: Number(v) }))
  // HL pads the start of month/allTime windows with $0 entries from before the
  // account was first funded. Trim those leading zeros so the chart starts at
  // the first funded value, not a misleading $0.
  const firstFunded = raw.findIndex((p) => p.value > 0)
  const points = firstFunded > 0 ? raw.slice(firstFunded) : raw
  const pnlPoints = pnlHistory.map(([t, v]) => ({ t, value: Number(v) }))
  const startValue = points.length ? points[0].value : 0
  const currentValue = points.length ? points[points.length - 1].value : 0

  // Average funded capital — robust denominator for a percentage that isn't
  // wrecked by a tiny starting balance or distorted hard by a single deposit.
  const avgCapital = points.length
    ? points.reduce((s, p) => s + p.value, 0) / points.length
    : 0

  // Trading PnL over the period: last cumulative pnl minus the first (≈0).
  const periodPnl = pnlPoints.length
    ? pnlPoints[pnlPoints.length - 1].value - pnlPoints[0].value
    : 0
  const returnPct = avgCapital > 0 ? (periodPnl / avgCapital) * 100 : 0

  // Max drawdown on the cumulative trading-pnl curve (deposit-proof).
  let peak = -Infinity
  let maxDrawdown = 0
  for (const p of pnlPoints) {
    if (p.value > peak) peak = p.value
    const drop = peak - p.value
    if (drop > maxDrawdown) maxDrawdown = drop
  }
  const maxDrawdownPct = avgCapital > 0 ? (maxDrawdown / avgCapital) * 100 : 0

  return { period, points, pnlPoints, startValue, currentValue, periodPnl, avgCapital, returnPct, maxDrawdown, maxDrawdownPct }
}

function portfolioRangeBoundsMs(range: PortfolioRange): { from: number; to: number } {
  const to = Date.now()
  switch (range) {
    case '24h': return { from: to - 86_400_000, to }
    case '7d':  return { from: to - 7  * 86_400_000, to }
    case '30d': return { from: to - 30 * 86_400_000, to }
    case '90d': return { from: to - 90 * 86_400_000, to }
    case '1y':  return { from: to - 365 * 86_400_000, to }
    case 'all': return { from: to - 365 * 86_400_000, to }  // HL retention cap
  }
}

export function portfolioRangeToBounds(
  range: string | undefined,
): { from: number; to: number; range: PortfolioRange } {
  const valid: PortfolioRange[] = ['24h', '7d', '30d', '90d', '1y', 'all']
  const r = valid.includes(range as PortfolioRange) ? (range as PortfolioRange) : '24h'
  return { ...portfolioRangeBoundsMs(r), range: r }
}

export function summarizePortfolio(
  fills: Fill[],
  trips: RoundTrip[],
  range: PortfolioRange,
): PortfolioSummary {
  const { from, to } = portfolioRangeBoundsMs(range)

  const netPnl = trips.reduce((s, t) => s + t.closedPnl, 0)
  const wins = trips.filter((t) => t.closedPnl > 0).length
  const losses = trips.filter((t) => t.closedPnl < 0).length
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0

  let best: PortfolioSummary['best'] = null
  let worst: PortfolioSummary['worst'] = null
  for (const t of trips) {
    if (!best || t.closedPnl > best.pnl) best = { pnl: t.closedPnl, asset: t.asset, source: t.source }
    if (!worst || t.closedPnl < worst.pnl) worst = { pnl: t.closedPnl, asset: t.asset, source: t.source }
  }
  if (best && best.pnl <= 0) best = null
  if (worst && worst.pnl >= 0) worst = null

  // Daily buckets — fill in every day in the window so charts are dense.
  // For long ranges we still bucket by day; the UI compresses visually.
  const buckets = new Map<string, DailyBucket>()
  const dayMs = 86_400_000
  const startDay = Math.floor(from / dayMs) * dayMs
  for (let t = startDay; t <= to; t += dayMs) {
    const k = dayKey(t)
    buckets.set(k, { date: k, pnl: 0, trades: 0 })
  }
  for (const t of trips) {
    const k = dayKey(t.exitTime)
    const b = buckets.get(k) ?? { date: k, pnl: 0, trades: 0 }
    b.pnl += t.closedPnl
    b.trades += 1
    buckets.set(k, b)
  }
  const dailySeries = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))

  // Equity series = cumulative PnL day-by-day. Starts at 0 on the first day
  // of the window so the line shows the gain produced *within* the period.
  let running = 0
  const equitySeries: EquityPoint[] = dailySeries.map((d) => {
    running += d.pnl
    return { date: d.date, equity: running }
  })

  // Max drawdown — walk the equity series tracking the running peak. The
  // worst trough-from-peak distance is the max drawdown. Pct uses the peak
  // value as the denominator (so a $50 drop from a $200 peak = 25%). When
  // the peak is 0 or negative we fall back to the absolute drop only.
  let peak = 0
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  for (const p of equitySeries) {
    if (p.equity > peak) peak = p.equity
    const drop = peak - p.equity
    if (drop > maxDrawdown) {
      maxDrawdown = drop
      maxDrawdownPct = peak > 0 ? (drop / peak) * 100 : 0
    }
  }

  // By-bot rollup — keyed by source identity.
  const botMap = new Map<string, BotRollup>()
  for (const t of trips) {
    const key = t.source.kind === 'manual' ? 'manual' : `${t.source.kind}:${t.source.botId}`
    let entry = botMap.get(key)
    if (!entry) {
      entry = { source: t.source, pnl: 0, trades: 0, wins: 0, losses: 0, winRate: 0 }
      botMap.set(key, entry)
    }
    entry.pnl += t.closedPnl
    entry.trades += 1
    if (t.closedPnl > 0) entry.wins += 1
    else if (t.closedPnl < 0) entry.losses += 1
  }
  const byBot = [...botMap.values()].map((b) => ({
    ...b,
    winRate: b.wins + b.losses > 0 ? (b.wins / (b.wins + b.losses)) * 100 : 0,
  })).sort((a, b) => b.pnl - a.pnl)

  // By-asset rollup — same shape but keyed on coin.
  const assetMap = new Map<string, AssetRollup>()
  for (const t of trips) {
    let entry = assetMap.get(t.asset)
    if (!entry) {
      entry = { asset: t.asset, pnl: 0, trades: 0, wins: 0, losses: 0, winRate: 0 }
      assetMap.set(t.asset, entry)
    }
    entry.pnl += t.closedPnl
    entry.trades += 1
    if (t.closedPnl > 0) entry.wins += 1
    else if (t.closedPnl < 0) entry.losses += 1
  }
  const byAsset = [...assetMap.values()].map((a) => ({
    ...a,
    winRate: a.wins + a.losses > 0 ? (a.wins / (a.wins + a.losses)) * 100 : 0,
  })).sort((a, b) => b.pnl - a.pnl)

  return {
    range,
    from,
    to,
    netPnl,
    fillsCount: fills.length,
    roundTripCount: trips.length,
    winRate,
    best,
    worst,
    maxDrawdown,
    maxDrawdownPct,
    dailySeries,
    equitySeries,
    byBot,
    byAsset,
  }
}
