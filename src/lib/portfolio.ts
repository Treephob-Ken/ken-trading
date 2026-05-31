// Client-side derivation of the "realized" portfolio layer from round-trips.
// Powers instant Power BI–style cross-filtering: filtering by bot recomputes
// everything in-browser with no server round-trip. All figures are realized
// (closed-trade) PnL — distinct from the account-value trend (HL endpoint).

import type { RoundTrip, FillSource, DailyBucket } from './journal'

export function botKey(s: FillSource): string {
  return s.kind === 'manual' ? 'manual' : `${s.kind}:${s.botId}`
}

export interface BotPerf {
  key: string
  source: FillSource
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number
  maxDrawdown: number          // on the bot's cumulative realized PnL
  equity: { t: number; value: number }[]   // cumulative realized PnL (for sparkline)
}

export interface RealizedView {
  netPnl: number
  trades: number
  winRate: number
  maxDrawdown: number
  maxDrawdownPct: number
  equity: { t: number; value: number }[]   // cumulative realized PnL over time
  daily: DailyBucket[]
  byAsset: { asset: string; pnl: number; trades: number; winRate: number }[]
  best: { pnl: number; asset: string } | null
  worst: { pnl: number; asset: string } | null
}

function dayKeyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// Lightweight Charts requires unique, ascending timestamps and throws otherwise.
// Round-trips can close in the same second (Close-All, multi-fill exits), which
// collide once floored to seconds. Collapse duplicates keeping the latest
// cumulative value, yielding strictly-ascending unique second-resolution points.
// Input must already be ascending by `t` (cumulative series are).
export function dedupeByTime(points: { t: number; value: number }[]): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = []
  for (const p of points) {
    const time = Math.floor(p.t / 1000)
    const last = out[out.length - 1]
    if (last && last.time === time) last.value = p.value
    else out.push({ time, value: p.value })
  }
  return out
}

// Cumulative realized-PnL series + its peak-to-trough drawdown, ordered by exit time.
function cumulative(trips: RoundTrip[]): {
  equity: { t: number; value: number }[]
  maxDrawdown: number
  maxDrawdownPct: number
} {
  const sorted = [...trips].sort((a, b) => a.exitTime - b.exitTime)
  let running = 0
  const equity = sorted.map((t) => {
    running += t.closedPnl
    return { t: t.exitTime, value: running }
  })
  let peak = 0
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  for (const p of equity) {
    if (p.value > peak) peak = p.value
    const drop = peak - p.value
    if (drop > maxDrawdown) {
      maxDrawdown = drop
      maxDrawdownPct = peak > 0 ? (drop / peak) * 100 : 0
    }
  }
  return { equity, maxDrawdown, maxDrawdownPct }
}

// Build a ranked per-bot performance list (best realized PnL first).
export function botPerformance(trips: RoundTrip[]): BotPerf[] {
  const groups = new Map<string, RoundTrip[]>()
  for (const t of trips) {
    const k = botKey(t.source)
    const arr = groups.get(k) ?? []
    arr.push(t)
    groups.set(k, arr)
  }
  const out: BotPerf[] = []
  for (const [key, arr] of groups) {
    const pnl = arr.reduce((s, t) => s + t.closedPnl, 0)
    const wins = arr.filter((t) => t.closedPnl > 0).length
    const losses = arr.filter((t) => t.closedPnl < 0).length
    const { equity, maxDrawdown } = cumulative(arr)
    out.push({
      key,
      source: arr[0].source,
      pnl,
      trades: arr.length,
      wins,
      losses,
      winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
      maxDrawdown,
      equity,
    })
  }
  return out.sort((a, b) => b.pnl - a.pnl)
}

// Compute the full realized view for the current selection. Pass a botKey to
// filter to one bot (the cross-filter), or null/undefined for "All bots".
export function realizedView(trips: RoundTrip[], selectedBot?: string | null): RealizedView {
  const rows = selectedBot ? trips.filter((t) => botKey(t.source) === selectedBot) : trips
  const netPnl = rows.reduce((s, t) => s + t.closedPnl, 0)
  const wins = rows.filter((t) => t.closedPnl > 0).length
  const losses = rows.filter((t) => t.closedPnl < 0).length
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0

  const dayMap = new Map<string, DailyBucket>()
  for (const t of rows) {
    const k = dayKeyUTC(t.exitTime)
    const b = dayMap.get(k) ?? { date: k, pnl: 0, trades: 0 }
    b.pnl += t.closedPnl
    b.trades += 1
    dayMap.set(k, b)
  }
  const daily = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  const assetMap = new Map<string, { asset: string; pnl: number; trades: number; wins: number; losses: number }>()
  for (const t of rows) {
    const e = assetMap.get(t.asset) ?? { asset: t.asset, pnl: 0, trades: 0, wins: 0, losses: 0 }
    e.pnl += t.closedPnl
    e.trades += 1
    if (t.closedPnl > 0) e.wins += 1
    else if (t.closedPnl < 0) e.losses += 1
    assetMap.set(t.asset, e)
  }
  const byAsset = [...assetMap.values()]
    .map((a) => ({ asset: a.asset, pnl: a.pnl, trades: a.trades, winRate: a.wins + a.losses > 0 ? (a.wins / (a.wins + a.losses)) * 100 : 0 }))
    .sort((a, b) => b.pnl - a.pnl)

  let best: RealizedView['best'] = null
  let worst: RealizedView['worst'] = null
  for (const t of rows) {
    if (!best || t.closedPnl > best.pnl) best = { pnl: t.closedPnl, asset: t.asset }
    if (!worst || t.closedPnl < worst.pnl) worst = { pnl: t.closedPnl, asset: t.asset }
  }
  if (best && best.pnl <= 0) best = null
  if (worst && worst.pnl >= 0) worst = null

  const { equity, maxDrawdown, maxDrawdownPct } = cumulative(rows)
  return { netPnl, trades: rows.length, winRate, maxDrawdown, maxDrawdownPct, equity, daily, byAsset, best, worst }
}
