// Trade Analytics — the "how WELL am I trading?" tab of the Performance hub.
// Built entirely from closed round-trips (the same /api/portfolio/trips the
// Overview uses), so no new backend. It answers what the Overview's money KPIs
// don't: trade quality (profit factor, expectancy, payoff, hold time, streaks,
// fees) and where the edge actually comes from (long vs short, which bot, which
// asset).

import { useEffect, useMemo, useState } from 'react'
import { BarChart3, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'
import { money, pct, sourceLabel } from '@/lib/journal'
import type { PortfolioRange, RoundTrip } from '@/lib/journal'

const RANGES: { id: PortfolioRange; label: string }[] = [
  { id: '24h', label: 'Today' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: '1y', label: '1y' },
  { id: 'all', label: 'All' },
]

function fmtHold(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

interface GroupStat {
  key: string
  label: string
  trades: number
  winRate: number
  net: number
  pf: number
}

// Win rate / net / profit factor for an arbitrary grouping of trips.
function groupStats(trips: RoundTrip[], keyOf: (t: RoundTrip) => string, labelOf: (t: RoundTrip) => string): GroupStat[] {
  const m = new Map<string, RoundTrip[]>()
  for (const t of trips) {
    const k = keyOf(t)
    const arr = m.get(k)
    if (arr) arr.push(t)
    else m.set(k, [t])
  }
  const out: GroupStat[] = []
  for (const [key, arr] of m) {
    const wins = arr.filter((t) => t.closedPnl > 0).length
    const gw = arr.filter((t) => t.closedPnl > 0).reduce((s, t) => s + t.closedPnl, 0)
    const gl = Math.abs(arr.filter((t) => t.closedPnl < 0).reduce((s, t) => s + t.closedPnl, 0))
    out.push({
      key,
      label: labelOf(arr[0]),
      trades: arr.length,
      winRate: arr.length ? (wins / arr.length) * 100 : 0,
      net: arr.reduce((s, t) => s + t.closedPnl, 0),
      pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    })
  }
  return out.sort((a, b) => b.net - a.net)
}

function StatTile({ title, value, sub, tone }: {
  title: string; value: string; sub?: string; tone?: 'gain' | 'loss' | 'neutral'
}) {
  const c = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-text'
  return (
    <div className="rounded-lg border border-border bg-panel-2/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">{title}</div>
      <div className={`mt-1 font-mono text-lg font-bold tabular-nums ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-dim">{sub}</div>}
    </div>
  )
}

function fmtPf(pf: number): string {
  return pf === Infinity ? '∞' : pf.toFixed(2)
}

function QualityTable({ title, rows }: { title: string; rows: GroupStat[] }) {
  if (rows.length === 0) return null
  return (
    <div className="card p-3">
      <div className="mb-2 text-xs font-semibold text-text">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-dim">
              <th className="py-1 pr-3">Name</th>
              <th className="py-1 pr-3 text-right">Trades</th>
              <th className="py-1 pr-3 text-right">Win</th>
              <th className="py-1 pr-3 text-right">PF</th>
              <th className="py-1 pr-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="py-1 pr-3 font-bold truncate max-w-[160px]" title={r.label}>{r.label}</td>
                <td className="py-1 pr-3 text-right font-mono tabular-nums text-dim">{r.trades}</td>
                <td className="py-1 pr-3 text-right font-mono tabular-nums">{pct(r.winRate)}</td>
                <td className="py-1 pr-3 text-right font-mono tabular-nums">{fmtPf(r.pf)}</td>
                <td className={`py-1 pr-3 text-right font-mono font-bold tabular-nums ${r.net >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {money(r.net, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function TradeAnalytics() {
  const [range, setRange] = useState<PortfolioRange>(
    () => (localStorage.getItem('analytics_range') as PortfolioRange) || '30d',
  )
  const [trips, setTrips] = useState<RoundTrip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { localStorage.setItem('analytics_range', range) }, [range])

  const fetchTrips = (r: PortfolioRange) => {
    setLoading(true)
    setError(null)
    apiFetch(`/api/portfolio/trips?range=${r}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`trips ${res.status}`))))
      .then((t) => setTrips((t as RoundTrip[]).sort((a, b) => a.exitTime - b.exitTime)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { fetchTrips(range) }, [range])

  const a = useMemo(() => {
    const n = trips.length
    if (n === 0) return null
    const wins = trips.filter((t) => t.closedPnl > 0)
    const losses = trips.filter((t) => t.closedPnl < 0)
    const net = trips.reduce((s, t) => s + t.closedPnl, 0)
    const gw = wins.reduce((s, t) => s + t.closedPnl, 0)
    const gl = Math.abs(losses.reduce((s, t) => s + t.closedPnl, 0))
    const fees = trips.reduce((s, t) => s + (t.fees || 0), 0)
    const avgHold = trips.reduce((s, t) => s + t.holdMs, 0) / n
    const best = trips.reduce((b, t) => (t.closedPnl > b ? t.closedPnl : b), -Infinity)
    const worst = trips.reduce((w, t) => (t.closedPnl < w ? t.closedPnl : w), Infinity)

    // Longest consecutive win / loss streaks (trips are sorted by exitTime asc).
    let winStreak = 0, lossStreak = 0, curW = 0, curL = 0
    for (const t of trips) {
      if (t.closedPnl > 0) { curW++; curL = 0 } else if (t.closedPnl < 0) { curL++; curW = 0 } else { curW = 0; curL = 0 }
      winStreak = Math.max(winStreak, curW)
      lossStreak = Math.max(lossStreak, curL)
    }

    return {
      n,
      wins: wins.length,
      losses: losses.length,
      net,
      pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
      expectancy: net / n,
      winRate: (wins.length / n) * 100,
      avgWin: wins.length ? gw / wins.length : 0,
      avgLoss: losses.length ? gl / losses.length : 0,
      fees,
      avgHold,
      best: best === -Infinity ? 0 : best,
      worst: worst === Infinity ? 0 : worst,
      winStreak,
      lossStreak,
      byBot: groupStats(
        trips,
        (t) => (t.source.kind === 'manual' ? 'manual' : t.source.botId || sourceLabel(t.source)),
        (t) => sourceLabel(t.source),
      ),
      byAsset: groupStats(trips, (t) => t.asset, (t) => t.asset).slice(0, 10),
      bySide: groupStats(trips, (t) => t.side, (t) => (t.side === 'long' ? 'Long' : 'Short')),
    }
  }, [trips])

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-3 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-brand" />
          <span className="text-xs font-semibold text-text">Trade analytics</span>
          <span className="hidden sm:block text-[11px] text-dim">How well you're trading — quality, edge, and where it comes from.</span>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer ${
                r.id === range ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-panel-2 text-dim hover:text-text'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => fetchTrips(range)}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-dim hover:text-text disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="card border border-loss/30 bg-loss/5 p-3 text-xs text-loss">{error}</div>}

      {!a ? (
        <div className="card p-8 text-center text-sm text-dim">
          {loading ? 'Loading…' : 'No closed trades in this range yet.'}
        </div>
      ) : (
        <>
          {/* Trade-quality stat grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile title="Net realized" value={money(a.net, true)} tone={a.net >= 0 ? 'gain' : 'loss'} sub={`${a.n} closed trades`} />
            <StatTile title="Profit factor" value={fmtPf(a.pf)} tone={a.pf >= 1 ? 'gain' : 'loss'} sub="gross win ÷ gross loss" />
            <StatTile title="Expectancy" value={money(a.expectancy, true)} tone={a.expectancy >= 0 ? 'gain' : 'loss'} sub="avg $ per trade" />
            <StatTile title="Win rate" value={pct(a.winRate)} sub={`${a.wins}W / ${a.losses}L`} tone="neutral" />
            <StatTile title="Avg win" value={money(a.avgWin)} tone="gain" sub={`vs avg loss ${money(-a.avgLoss)}`} />
            <StatTile title="Payoff" value={a.avgLoss > 0 ? (a.avgWin / a.avgLoss).toFixed(2) : '—'} sub="avg win ÷ avg loss" tone="neutral" />
            <StatTile title="Avg hold" value={fmtHold(a.avgHold)} tone="neutral" />
            <StatTile title="Fees paid" value={money(-a.fees)} tone="loss" sub="total in range" />
            <StatTile title="Best trade" value={money(a.best, true)} tone="gain" />
            <StatTile title="Worst trade" value={money(a.worst, true)} tone="loss" />
            <StatTile title="Win streak" value={`${a.winStreak}`} tone="gain" sub="longest run" />
            <StatTile title="Loss streak" value={`${a.lossStreak}`} tone="loss" sub="longest run" />
          </div>

          {/* Where the edge comes from */}
          <div className="grid gap-3 lg:grid-cols-2">
            <QualityTable title="Long vs Short" rows={a.bySide} />
            <QualityTable title="By bot" rows={a.byBot} />
          </div>
          <QualityTable title="By asset · top 10" rows={a.byAsset} />
        </>
      )}
    </main>
  )
}
