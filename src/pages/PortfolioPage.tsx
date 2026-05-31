// Portfolio page — visual dashboard for "how am I doing overall?"
//
// Distinct from the Logs/Trade Log page (which is per-trade detail + filters).
// This page is a higher-level rollup with multi-range stat cards, an equity
// curve, daily PnL bars, and by-asset / by-bot breakdowns.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AreaSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { Briefcase, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'
import { money, pct, sourceLabel } from '@/lib/journal'
import type {
  AssetRollup,
  BotRollup,
  DailyBucket,
  PortfolioRange,
  PortfolioSummary,
  RoundTrip,
} from '@/lib/journal'

const RANGES: { id: PortfolioRange; label: string }[] = [
  { id: '24h', label: 'Today' },
  { id: '7d',  label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: '1y',  label: '1y' },
  { id: 'all', label: 'All' },
]

// One stat tile in the top row.
function StatCard({ title, value, sub, tone }: {
  title: string
  value: string
  sub?: string
  tone: 'gain' | 'loss' | 'neutral'
}) {
  const colour = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-text'
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wider text-dim">{title}</div>
      <div className={`mt-1 font-mono text-lg font-bold ${colour}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-dim">{sub}</div>}
    </div>
  )
}

// Helper — turn a YYYY-MM-DD string into a UTCTimestamp (seconds at UTC midnight).
function dateToTs(d: string): UTCTimestamp {
  return Math.floor(new Date(d + 'T00:00:00Z').getTime() / 1000) as UTCTimestamp
}

function toneForPnl(v: number): 'gain' | 'loss' | 'neutral' {
  if (v > 0) return 'gain'
  if (v < 0) return 'loss'
  return 'neutral'
}

export default function PortfolioPage() {
  const [range, setRange] = useState<PortfolioRange>(
    () => (localStorage.getItem('portfolio_range') as PortfolioRange) || '7d',
  )
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [trips, setTrips] = useState<RoundTrip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Range-specific stat cards live above the main chart and never change as
  // the user toggles the chart's range — they're a fixed snapshot. Cached
  // server-side for 60 s so flipping ranges feels instant.
  const [snap24h, setSnap24h] = useState<PortfolioSummary | null>(null)
  const [snap7d, setSnap7d] = useState<PortfolioSummary | null>(null)
  const [snap30d, setSnap30d] = useState<PortfolioSummary | null>(null)
  const [snapAll, setSnapAll] = useState<PortfolioSummary | null>(null)

  useEffect(() => { localStorage.setItem('portfolio_range', range) }, [range])

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchAll = (r: PortfolioRange) => {
    setLoading(true)
    setError(null)
    Promise.all([
      apiFetch(`/api/portfolio?range=${r}`).then((res) => res.ok ? res.json() : Promise.reject(new Error(`portfolio ${res.status}`))),
      apiFetch(`/api/portfolio/trips?range=${r}`).then((res) => res.ok ? res.json() : Promise.reject(new Error(`trips ${res.status}`))),
    ]).then(([s, t]) => {
      setSummary(s as PortfolioSummary)
      setTrips((t as RoundTrip[]).sort((a, b) => b.exitTime - a.exitTime))
    }).catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll(range) }, [range])

  // Snapshot fetches — Today / 7d / 30d / All run once on mount and re-run on
  // refresh. They power the four stat cards at the top.
  const fetchSnapshots = () => {
    apiFetch('/api/portfolio?range=24h').then((r) => r.json()).then((d) => setSnap24h(d)).catch(() => {})
    apiFetch('/api/portfolio?range=7d').then((r) => r.json()).then((d) => setSnap7d(d)).catch(() => {})
    apiFetch('/api/portfolio?range=30d').then((r) => r.json()).then((d) => setSnap30d(d)).catch(() => {})
    apiFetch('/api/portfolio?range=all').then((r) => r.json()).then((d) => setSnapAll(d)).catch(() => {})
  }
  useEffect(() => { fetchSnapshots() }, [])

  // ── Equity chart ─────────────────────────────────────────────────────────
  const eqContainerRef = useRef<HTMLDivElement>(null)
  const eqChartRef = useRef<IChartApi | null>(null)
  useEffect(() => {
    const el = eqContainerRef.current
    if (!el || !summary) return
    if (eqChartRef.current) { eqChartRef.current.remove(); eqChartRef.current = null }
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 200,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: false, secondsVisible: false },
      crosshair: { mode: 0 },
    })
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#22c55e',
      topColor: 'rgba(34, 197, 94, 0.35)',
      bottomColor: 'rgba(34, 197, 94, 0.0)',
      lineWidth: 2,
    })
    series.setData(summary.equitySeries.map((p) => ({ time: dateToTs(p.date), value: p.equity })))
    chart.timeScale().fitContent()
    eqChartRef.current = chart

    const onResize = () => chart.applyOptions({ width: el.clientWidth })
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.remove(); eqChartRef.current = null }
  }, [summary])

  // ── Daily PnL bars ───────────────────────────────────────────────────────
  const barContainerRef = useRef<HTMLDivElement>(null)
  const barChartRef = useRef<IChartApi | null>(null)
  useEffect(() => {
    const el = barContainerRef.current
    if (!el || !summary) return
    if (barChartRef.current) { barChartRef.current.remove(); barChartRef.current = null }
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 140,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: false, secondsVisible: false },
    })
    const series = chart.addSeries(HistogramSeries, { priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
    series.setData(summary.dailySeries.map((d) => ({
      time: dateToTs(d.date),
      value: d.pnl,
      color: d.pnl >= 0 ? '#22c55e' : '#ef4444',
    })))
    chart.timeScale().fitContent()
    barChartRef.current = chart

    const onResize = () => chart.applyOptions({ width: el.clientWidth })
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.remove(); barChartRef.current = null }
  }, [summary])

  // ── Derived ──────────────────────────────────────────────────────────────
  const topAssets = useMemo(() => (summary?.byAsset ?? []).slice(0, 5), [summary])
  const topBots = useMemo(() => (summary?.byBot ?? []).slice(0, 5), [summary])

  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-6 py-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-brand" />
          <h1 className="text-lg font-semibold text-text font-display">Portfolio</h1>
          <p className="hidden sm:block text-xs text-dim">
            Track realized PnL, equity curve, and per-bot performance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`rounded-md border px-2 py-1 text-[11px] ${
                r.id === range
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border bg-panel-2 text-dim hover:text-text'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { fetchAll(range); fetchSnapshots() }}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-dim hover:text-text disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="card border border-loss/30 bg-loss/5 p-3 text-xs text-loss">
          {error}
        </div>
      )}

      {/* ── Fixed snapshot stat cards — Today / 7d / 30d / All ──────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Today"
          value={snap24h ? money(snap24h.netPnl, true) : '—'}
          sub={snap24h ? `${snap24h.roundTripCount} trades · win ${pct(snap24h.winRate)}` : ' '}
          tone={snap24h ? toneForPnl(snap24h.netPnl) : 'neutral'}
        />
        <StatCard
          title="7 days"
          value={snap7d ? money(snap7d.netPnl, true) : '—'}
          sub={snap7d ? `${snap7d.roundTripCount} trades · win ${pct(snap7d.winRate)}` : ' '}
          tone={snap7d ? toneForPnl(snap7d.netPnl) : 'neutral'}
        />
        <StatCard
          title="30 days"
          value={snap30d ? money(snap30d.netPnl, true) : '—'}
          sub={snap30d ? `${snap30d.roundTripCount} trades · win ${pct(snap30d.winRate)}` : ' '}
          tone={snap30d ? toneForPnl(snap30d.netPnl) : 'neutral'}
        />
        <StatCard
          title="All-time"
          value={snapAll ? money(snapAll.netPnl, true) : '—'}
          sub={snapAll ? `${snapAll.roundTripCount} trades · win ${pct(snapAll.winRate)}` : ' '}
          tone={snapAll ? toneForPnl(snapAll.netPnl) : 'neutral'}
        />
      </div>

      {/* ── Equity curve ────────────────────────────────────────────────── */}
      <div className="card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-text">Equity curve · {range}</span>
          {summary && (
            <div className="flex items-center gap-3 font-mono text-xs">
              <span className={summary.netPnl >= 0 ? 'text-gain' : 'text-loss'}>
                {money(summary.netPnl, true)} net
              </span>
              <span
                className="text-loss"
                title="Max drawdown — worst peak-to-trough drop on the equity curve in this period"
              >
                MDD −{money(summary.maxDrawdown)}
                {summary.maxDrawdownPct > 0 && ` (−${summary.maxDrawdownPct.toFixed(1)}%)`}
              </span>
            </div>
          )}
        </div>
        <div ref={eqContainerRef} className="w-full" style={{ height: 200 }} />
      </div>

      {/* ── Daily PnL bars ──────────────────────────────────────────────── */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold text-text">Daily PnL · {range}</div>
        <div ref={barContainerRef} className="w-full" style={{ height: 140 }} />
      </div>

      {/* ── PnL Calendar (week × weekday grid) ──────────────────────────── */}
      {summary && <PnlCalendar series={summary.dailySeries} />}

      {/* ── By Asset + By Bot tables ────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RollupTable<AssetRollup>
          title="By Asset (top 5)"
          rows={topAssets}
          rowKey={(r) => r.asset}
          name={(r) => r.asset}
          empty="No closed trades in this range."
        />
        <RollupTable<BotRollup>
          title="By Bot (top 5)"
          rows={topBots}
          rowKey={(r) => `${r.source.kind}:${r.source.botId ?? 'manual'}`}
          name={(r) => sourceLabel(r.source)}
          empty="No closed trades in this range."
        />
      </div>

      {/* ── Closed Trades list ──────────────────────────────────────────── */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-text">Closed trades · {range}</span>
          <span className="text-[10px] text-dim">{trips.length} round-trips</span>
        </div>
        {trips.length === 0 ? (
          <div className="text-[11px] text-dim italic">No closed trades in this range.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-dim">
                  <th className="py-1 pr-3">Exit</th>
                  <th className="py-1 pr-3">Asset</th>
                  <th className="py-1 pr-3">Side</th>
                  <th className="py-1 pr-3 text-right">Entry</th>
                  <th className="py-1 pr-3 text-right">Exit Px</th>
                  <th className="py-1 pr-3 text-right">PnL</th>
                  <th className="py-1 pr-3 text-right">PnL %</th>
                  <th className="py-1 pr-3">Bot</th>
                </tr>
              </thead>
              <tbody>
                {trips.slice(0, 50).map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-1 pr-3 text-dim font-mono">
                      {new Date(t.exitTime).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="py-1 pr-3 font-bold">{t.asset}</td>
                    <td className="py-1 pr-3">
                      <span className={t.side === 'long' ? 'text-gain' : 'text-loss'}>{t.side}</span>
                    </td>
                    <td className="py-1 pr-3 text-right font-mono">{t.entryPx.toFixed(4)}</td>
                    <td className="py-1 pr-3 text-right font-mono">{t.exitPx.toFixed(4)}</td>
                    <td className={`py-1 pr-3 text-right font-mono font-bold ${t.closedPnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                      {money(t.closedPnl, true)}
                    </td>
                    <td className={`py-1 pr-3 text-right font-mono ${t.pnlPct >= 0 ? 'text-gain' : 'text-loss'}`}>
                      {pct(t.pnlPct, true)}
                    </td>
                    <td className="py-1 pr-3 text-dim truncate max-w-[120px]" title={sourceLabel(t.source)}>
                      {sourceLabel(t.source)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trips.length > 50 && (
              <div className="mt-2 text-[10px] text-dim italic">
                Showing 50 of {trips.length}. Use the Logs page for full filtering.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

// Generic rollup table — by-asset and by-bot share the same shape, just
// differ in the key/name extractor.
interface CommonRollupRow {
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number
}
function RollupTable<T extends CommonRollupRow>({
  title,
  rows,
  rowKey,
  name,
  empty,
}: {
  title: string
  rows: T[]
  rowKey: (r: T) => string
  name: (r: T) => string
  empty: string
}) {
  return (
    <div className="card p-3">
      <div className="mb-2 text-xs font-semibold text-text">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-dim italic">{empty}</div>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-dim">
              <th className="py-1 pr-3">Name</th>
              <th className="py-1 pr-3 text-right">PnL</th>
              <th className="py-1 pr-3 text-right">Trades</th>
              <th className="py-1 pr-3 text-right">Win</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="border-t border-border">
                <td className="py-1 pr-3 font-bold truncate max-w-[140px]" title={name(r)}>{name(r)}</td>
                <td className={`py-1 pr-3 text-right font-mono font-bold ${r.pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {money(r.pnl, true)}
                </td>
                <td className="py-1 pr-3 text-right font-mono">{r.trades}</td>
                <td className="py-1 pr-3 text-right font-mono">{pct(r.winRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// PnL Calendar — github-contributions-style grid where columns are weeks
// and rows are weekdays (Mon..Sun). Cell brightness scales with the
// magnitude of PnL relative to the largest abs PnL in the window. Hover
// shows the exact figure; click does nothing (the Logs page is where the
// per-trade drill-down lives).
function PnlCalendar({ series }: { series: DailyBucket[] }) {
  if (series.length === 0) return null

  // Group buckets by ISO date for O(1) lookup, then walk every day from the
  // first to the last in the window so empty days still get a slot.
  const byDate = new Map<string, DailyBucket>()
  for (const d of series) byDate.set(d.date, d)
  const dates = [...byDate.keys()].sort()
  const first = new Date(dates[0] + 'T00:00:00Z')
  const last = new Date(dates[dates.length - 1] + 'T00:00:00Z')

  // Align the first column to the Monday-of-week containing the start date,
  // so every column is a full Mon..Sun stack. JS getUTCDay() returns 0=Sun.
  const startOfWeek = new Date(first)
  const dow = startOfWeek.getUTCDay() === 0 ? 6 : startOfWeek.getUTCDay() - 1
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - dow)

  const cells: { date: string; pnl: number; trades: number; inRange: boolean }[] = []
  const cur = new Date(startOfWeek)
  while (cur <= last) {
    const key = cur.toISOString().slice(0, 10)
    const bucket = byDate.get(key)
    const inRange = cur >= first
    cells.push({
      date: key,
      pnl: bucket?.pnl ?? 0,
      trades: bucket?.trades ?? 0,
      inRange,
    })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  // Bucket cells into columns of 7 (Mon..Sun, top to bottom).
  const columns: typeof cells[] = []
  for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7))

  const maxAbs = Math.max(1, ...series.map((d) => Math.abs(d.pnl)))

  // Color rule mirrors ActivityHeatmap — three buckets of intensity per side.
  const cellTone = (pnl: number) => {
    if (pnl === 0) return 'bg-panel-2 border-border/30'
    const intensity = Math.min(1, Math.abs(pnl) / maxAbs)
    if (pnl > 0) {
      if (intensity > 0.75) return 'bg-gain/70 border-gain/60'
      if (intensity > 0.4)  return 'bg-gain/45 border-gain/40'
      return 'bg-gain/25 border-gain/30'
    }
    if (intensity > 0.75) return 'bg-loss/70 border-loss/60'
    if (intensity > 0.4)  return 'bg-loss/45 border-loss/40'
    return 'bg-loss/25 border-loss/30'
  }

  // Month labels above the first column where a new month starts.
  const monthLabels: { col: number; label: string }[] = []
  let lastMonth = -1
  columns.forEach((col, idx) => {
    const firstInCol = col.find((c) => c.inRange)
    if (!firstInCol) return
    const m = new Date(firstInCol.date + 'T00:00:00Z').getUTCMonth()
    if (m !== lastMonth) {
      monthLabels.push({ col: idx, label: new Date(firstInCol.date).toLocaleString('en-US', { month: 'short' }) })
      lastMonth = m
    }
  })

  // Stats footer
  const winDays = series.filter((d) => d.pnl > 0).length
  const lossDays = series.filter((d) => d.pnl < 0).length
  const bestDay = series.reduce((b, d) => (d.pnl > (b?.pnl ?? -Infinity) ? d : b), null as DailyBucket | null)
  const worstDay = series.reduce((w, d) => (d.pnl < (w?.pnl ?? Infinity) ? d : w), null as DailyBucket | null)

  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text">PnL calendar</span>
        <div className="flex items-center gap-3 text-[10px] text-dim font-mono">
          <span><span className="text-gain">{winDays}</span> green</span>
          <span><span className="text-loss">{lossDays}</span> red</span>
          {bestDay && bestDay.pnl > 0 && (
            <span>best <span className="text-gain">{money(bestDay.pnl, true)}</span></span>
          )}
          {worstDay && worstDay.pnl < 0 && (
            <span>worst <span className="text-loss">{money(worstDay.pnl, true)}</span></span>
          )}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {/* Weekday labels column */}
        <div className="flex flex-col gap-1 pt-4 text-[9px] text-dim font-mono">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="h-4 leading-4">{d}</div>
          ))}
        </div>
        {/* Week columns */}
        <div className="flex gap-1">
          {columns.map((col, ci) => {
            const monthLabel = monthLabels.find((m) => m.col === ci)
            return (
              <div key={ci} className="flex flex-col gap-1">
                <div className="h-3 text-[9px] text-dim font-mono leading-3">
                  {monthLabel?.label ?? ''}
                </div>
                {col.map((cell) => {
                  if (!cell.inRange) return <div key={cell.date} className="h-4 w-4" />
                  const tone = cellTone(cell.pnl)
                  const tradesTxt = cell.trades === 0 ? 'no trades' : `${cell.trades} ${cell.trades === 1 ? 'trade' : 'trades'}`
                  return (
                    <div
                      key={cell.date}
                      title={`${cell.date} · ${tradesTxt} · ${money(cell.pnl, true)}`}
                      className={`h-4 w-4 rounded-sm border ${tone}`}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center gap-1.5 text-[9px] text-dim">
        <span>Less</span>
        <div className="h-2.5 w-2.5 rounded-sm border border-loss/60 bg-loss/70" />
        <div className="h-2.5 w-2.5 rounded-sm border border-loss/40 bg-loss/45" />
        <div className="h-2.5 w-2.5 rounded-sm border border-loss/30 bg-loss/25" />
        <div className="h-2.5 w-2.5 rounded-sm border border-border/30 bg-panel-2" />
        <div className="h-2.5 w-2.5 rounded-sm border border-gain/30 bg-gain/25" />
        <div className="h-2.5 w-2.5 rounded-sm border border-gain/40 bg-gain/45" />
        <div className="h-2.5 w-2.5 rounded-sm border border-gain/60 bg-gain/70" />
        <span>More</span>
      </div>
    </div>
  )
}
