// Portfolio page — "how am I doing overall?" dashboard.
//
// Two honest data layers:
//   1. Account layer  — true account value over time from Hyperliquid's
//      portfolio endpoint (/api/portfolio/equity). Includes unrealized PnL,
//      funding, and transfers. Powers the hero + trend chart.
//   2. Realized layer — closed round-trips (/api/portfolio/trips), derived
//      client-side in src/lib/portfolio.ts. Powers the bot leaderboard, daily
//      PnL, calendar, by-asset, and closed-trades — and cross-filters instantly
//      when a bot is selected (no server round-trip).
//
// The two layers won't reconcile (account value includes unrealized/funding;
// realized is closed-trade only) — labels make the distinction explicit.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AreaSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { Briefcase, RefreshCw, X } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'
import { money, pct, sourceLabel } from '@/lib/journal'
import type {
  DailyBucket,
  EquityPeriod,
  EquitySeriesResponse,
  PortfolioRange,
  RoundTrip,
} from '@/lib/journal'
import { botKey, botPerformance, dedupeByTime, realizedView, type BotPerf } from '@/lib/portfolio'

const RANGES: { id: PortfolioRange; label: string }[] = [
  { id: '24h', label: 'Today' },
  { id: '7d',  label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: '1y',  label: '1y' },
  { id: 'all', label: 'All' },
]

const EQUITY_PERIODS: { id: EquityPeriod; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
]

function dateToTs(d: string): UTCTimestamp {
  return Math.floor(new Date(d + 'T00:00:00Z').getTime() / 1000) as UTCTimestamp
}

function toneForPnl(v: number): 'gain' | 'loss' | 'neutral' {
  if (v > 0) return 'gain'
  if (v < 0) return 'loss'
  return 'neutral'
}

// One stat tile. `big` doubles the value size for the hero's lead figure.
function StatCard({ title, value, sub, tone, big }: {
  title: string
  value: string
  sub?: string
  tone: 'gain' | 'loss' | 'neutral'
  big?: boolean
}) {
  const colour = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-text'
  return (
    <div className="rounded-lg border border-border bg-panel-2/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-dim">{title}</div>
      <div className={`mt-1 font-mono font-bold tabular-nums ${big ? 'text-2xl' : 'text-lg'} ${colour}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-dim">{sub}</div>}
    </div>
  )
}

// Tiny inline-SVG cumulative-PnL sparkline for a bot card. Direction-coloured.
function Sparkline({ data, color }: { data: { t: number; value: number }[]; color: string }) {
  if (data.length < 2) return <div className="h-8 w-full" />
  const xs = data.map((d) => d.t)
  const ys = data.map((d) => d.value)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const w = 100, h = 28
  const nx = (x: number) => (maxX === minX ? 0 : ((x - minX) / (maxX - minX)) * w)
  const ny = (y: number) => (maxY === minY ? h / 2 : h - ((y - minY) / (maxY - minY)) * h)
  const d = data.map((p, i) => `${i ? 'L' : 'M'}${nx(p.t).toFixed(1)},${ny(p.value).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// A bot card doubles as the cross-filter control. Clicking selects/deselects.
function BotCard({ perf, selected, onSelect }: {
  perf: BotPerf
  selected: boolean
  onSelect: () => void
}) {
  const pos = perf.pnl >= 0
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-lg border bg-panel-2/40 p-3 text-left transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
        selected ? 'border-brand ring-1 ring-brand/40' : 'border-border hover:border-dim'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-text" title={sourceLabel(perf.source)}>
          {sourceLabel(perf.source)}
        </span>
        <span className={`font-mono text-sm font-bold tabular-nums ${pos ? 'text-gain' : 'text-loss'}`}>
          {money(perf.pnl, true)}
        </span>
      </div>
      <div className="mt-1">
        <Sparkline data={perf.equity} color={pos ? '#22c55e' : '#ef4444'} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-dim font-mono tabular-nums">
        <span>win {pct(perf.winRate)}</span>
        <span>{perf.trades} trades</span>
        <span className="text-loss">MDD −{money(perf.maxDrawdown)}</span>
      </div>
    </button>
  )
}

export default function PortfolioPage() {
  const [range, setRange] = useState<PortfolioRange>(
    () => (localStorage.getItem('portfolio_range') as PortfolioRange) || '7d',
  )
  const [period, setPeriod] = useState<EquityPeriod>(
    () => (localStorage.getItem('portfolio_eq_period') as EquityPeriod) || 'all',
  )
  const [trips, setTrips] = useState<RoundTrip[]>([])
  const [equity, setEquity] = useState<EquitySeriesResponse | null>(null)
  const [selectedBot, setSelectedBot] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { localStorage.setItem('portfolio_range', range) }, [range])
  useEffect(() => { localStorage.setItem('portfolio_eq_period', period) }, [period])

  // ── Fetches ────────────────────────────────────────────────────────────
  const fetchTrips = (r: PortfolioRange) => {
    setLoading(true)
    setError(null)
    apiFetch(`/api/portfolio/trips?range=${r}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`trips ${res.status}`))))
      .then((t) => setTrips((t as RoundTrip[]).sort((a, b) => b.exitTime - a.exitTime)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  const fetchEquity = (p: EquityPeriod) => {
    apiFetch(`/api/portfolio/equity?period=${p}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`equity ${res.status}`))))
      .then((d) => setEquity(d as EquitySeriesResponse))
      .catch(() => setEquity(null))
  }
  useEffect(() => { fetchTrips(range) }, [range])
  useEffect(() => { fetchEquity(period) }, [period])

  // ── Derived (realized layer + cross-filter) ──────────────────────────────
  const perf = useMemo(() => botPerformance(trips), [trips])
  const view = useMemo(() => realizedView(trips, selectedBot), [trips, selectedBot])
  const selectedPerf = useMemo(
    () => (selectedBot ? perf.find((p) => p.key === selectedBot) ?? null : null),
    [perf, selectedBot],
  )
  const heroIsAccount = !selectedBot
  const visibleTrips = useMemo(
    () => (selectedBot ? trips.filter((t) => botKey(t.source) === selectedBot) : trips),
    [trips, selectedBot],
  )

  // Active equity-chart data: account value (all bots) or the bot's realized
  // curve, deduped to unique ascending second-resolution timestamps (Lightweight
  // Charts throws otherwise — see dedupeByTime).
  const eqData = useMemo(() => {
    const src = heroIsAccount ? (equity?.points ?? []) : view.equity
    return dedupeByTime(src).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
  }, [heroIsAccount, equity, view])
  const hasEqData = eqData.length >= 2

  // ── Equity chart ─────────────────────────────────────────────────────────
  const eqContainerRef = useRef<HTMLDivElement>(null)
  const eqChartRef = useRef<IChartApi | null>(null)
  useEffect(() => {
    const el = eqContainerRef.current
    if (eqChartRef.current) { eqChartRef.current.remove(); eqChartRef.current = null }
    if (!el || !hasEqData) return
    const up = eqData[eqData.length - 1].value >= eqData[0].value
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 240,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: false, secondsVisible: false },
      crosshair: { mode: 0 },
    })
    const series = chart.addSeries(AreaSeries, {
      lineColor: up ? '#22c55e' : '#ef4444',
      topColor: up ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
      bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2,
    })
    series.setData(eqData)
    chart.timeScale().fitContent()
    eqChartRef.current = chart
    const onResize = () => chart.applyOptions({ width: el.clientWidth })
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.remove(); eqChartRef.current = null }
  }, [eqData, hasEqData])

  // ── Daily PnL bars (realized, cross-filtered) ─────────────────────────────
  const barContainerRef = useRef<HTMLDivElement>(null)
  const barChartRef = useRef<IChartApi | null>(null)
  useEffect(() => {
    const el = barContainerRef.current
    if (barChartRef.current) { barChartRef.current.remove(); barChartRef.current = null }
    if (!el || view.daily.length === 0) return
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 140,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: false, secondsVisible: false },
    })
    const series = chart.addSeries(HistogramSeries, { priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
    series.setData(view.daily.map((d) => ({
      time: dateToTs(d.date),
      value: d.pnl,
      color: d.pnl >= 0 ? '#22c55e' : '#ef4444',
    })))
    chart.timeScale().fitContent()
    barChartRef.current = chart
    const onResize = () => chart.applyOptions({ width: el.clientWidth })
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.remove(); barChartRef.current = null }
  }, [view])

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-6 py-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-brand" />
          <h1 className="text-lg font-semibold text-text font-display">Portfolio</h1>
          <p className="hidden sm:block text-xs text-dim">
            Account trend, max drawdown, and per-bot performance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer ${
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
            onClick={() => { fetchTrips(range); fetchEquity(period) }}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-dim hover:text-text disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="card border border-loss/30 bg-loss/5 p-3 text-xs text-loss">{error}</div>
      )}

      {/* ── Account health hero ──────────────────────────────────────────── */}
      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text">
              {heroIsAccount ? 'Account value · All bots' : `Realized equity · ${sourceLabel(selectedPerf!.source)}`}
            </span>
            {!heroIsAccount && (
              <button
                type="button"
                onClick={() => setSelectedBot(null)}
                className="flex items-center gap-1 rounded-full border border-border bg-panel-2 px-2 py-0.5 text-[10px] text-dim hover:text-text cursor-pointer"
              >
                <X className="h-3 w-3" /> Clear filter
              </button>
            )}
          </div>
          {heroIsAccount && (
            <div className="flex items-center gap-1">
              {EQUITY_PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer ${
                    p.id === period
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border bg-panel-2 text-dim hover:text-text'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {heroIsAccount ? (
            <>
              <StatCard big title="Account value" value={equity ? money(equity.currentValue) : '—'}
                sub={equity ? `${equity.period} window` : ' '} tone="neutral" />
              <StatCard big title="Return" value={equity ? pct(equity.returnPct, true) : '—'}
                sub="account value" tone={equity ? toneForPnl(equity.returnPct) : 'neutral'} />
              <StatCard title="Max drawdown" value={equity ? `−${money(equity.maxDrawdown)}` : '—'}
                sub={equity && equity.maxDrawdownPct > 0 ? `−${equity.maxDrawdownPct.toFixed(1)}%` : ' '} tone="loss" />
              <StatCard title="Realized win rate" value={pct(view.winRate)}
                sub={`${view.trades} closed trades`} tone="neutral" />
            </>
          ) : (
            <>
              <StatCard big title="Realized PnL" value={money(view.netPnl, true)} tone={toneForPnl(view.netPnl)}
                sub={`${view.trades} closed trades`} />
              <StatCard big title="Win rate" value={pct(view.winRate)}
                sub={selectedPerf ? `${selectedPerf.wins}W / ${selectedPerf.losses}L` : ' '} tone="neutral" />
              <StatCard title="Max drawdown" value={`−${money(view.maxDrawdown)}`}
                sub={view.maxDrawdownPct > 0 ? `−${view.maxDrawdownPct.toFixed(1)}%` : ' '} tone="loss" />
              <StatCard title="Best / Worst" value={view.best ? money(view.best.pnl, true) : '—'}
                sub={view.worst ? `worst ${money(view.worst.pnl, true)}` : ' '} tone="neutral" />
            </>
          )}
        </div>

        {hasEqData ? (
          <div ref={eqContainerRef} className="mt-3 w-full" style={{ height: 240 }} />
        ) : (
          <div className="mt-3 flex h-[240px] w-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-dim">
            {loading ? 'Loading…' : 'Not enough history for this period yet.'}
          </div>
        )}
      </section>

      {/* ── Bot leaderboard (cross-filter control) ───────────────────────── */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-text">Bot performance · {range}</span>
          {selectedBot && (
            <button type="button" onClick={() => setSelectedBot(null)}
              className="text-[10px] text-dim hover:text-text cursor-pointer">Show all</button>
          )}
        </div>
        {perf.length === 0 ? (
          <div className="card p-3 text-[11px] text-dim italic">No closed trades in this range.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {perf.map((p) => (
              <BotCard key={p.key} perf={p} selected={selectedBot === p.key}
                onSelect={() => setSelectedBot((cur) => (cur === p.key ? null : p.key))} />
            ))}
          </div>
        )}
      </section>

      {/* ── Daily PnL bars (realized) ────────────────────────────────────── */}
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold text-text">
          Daily realized PnL{selectedBot ? ` · ${sourceLabel(selectedPerf!.source)}` : ''}
        </div>
        {view.daily.length === 0 ? (
          <div className="text-[11px] text-dim italic">No closed trades in this selection.</div>
        ) : (
          <div ref={barContainerRef} className="w-full" style={{ height: 140 }} />
        )}
      </div>

      {/* ── PnL Calendar (realized) ──────────────────────────────────────── */}
      {view.daily.length > 0 && <PnlCalendar series={view.daily} />}

      {/* ── By Asset (realized) ──────────────────────────────────────────── */}
      <RollupTable
        title={selectedBot ? 'By Asset · this bot' : 'By Asset · top 8'}
        rows={view.byAsset.slice(0, 8)}
        rowKey={(r) => r.asset}
        name={(r) => r.asset}
        empty="No closed trades in this selection."
      />

      {/* ── Closed Trades list (cross-filtered) ──────────────────────────── */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-text">
            Closed trades{selectedBot ? ` · ${sourceLabel(selectedPerf!.source)}` : ''} · {range}
          </span>
          <span className="text-[10px] text-dim">{visibleTrips.length} round-trips</span>
        </div>
        {visibleTrips.length === 0 ? (
          <div className="text-[11px] text-dim italic">No closed trades in this selection.</div>
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
                {visibleTrips.slice(0, 50).map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-1 pr-3 text-dim font-mono">
                      {new Date(t.exitTime).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="py-1 pr-3 font-bold">{t.asset}</td>
                    <td className="py-1 pr-3">
                      <span className={t.side === 'long' ? 'text-gain' : 'text-loss'}>{t.side}</span>
                    </td>
                    <td className="py-1 pr-3 text-right font-mono tabular-nums">{t.entryPx.toFixed(4)}</td>
                    <td className="py-1 pr-3 text-right font-mono tabular-nums">{t.exitPx.toFixed(4)}</td>
                    <td className={`py-1 pr-3 text-right font-mono font-bold tabular-nums ${t.closedPnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                      {money(t.closedPnl, true)}
                    </td>
                    <td className={`py-1 pr-3 text-right font-mono tabular-nums ${t.pnlPct >= 0 ? 'text-gain' : 'text-loss'}`}>
                      {pct(t.pnlPct, true)}
                    </td>
                    <td className="py-1 pr-3 text-dim truncate max-w-[120px]" title={sourceLabel(t.source)}>
                      {sourceLabel(t.source)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleTrips.length > 50 && (
              <div className="mt-2 text-[10px] text-dim italic">
                Showing 50 of {visibleTrips.length}. Use the Logs page for full filtering.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

// Generic rollup table — used for the by-asset breakdown.
interface AssetRollupRow {
  asset: string
  pnl: number
  trades: number
  winRate: number
}
function RollupTable<T extends AssetRollupRow>({
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
                <td className={`py-1 pr-3 text-right font-mono font-bold tabular-nums ${r.pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {money(r.pnl, true)}
                </td>
                <td className="py-1 pr-3 text-right font-mono tabular-nums">{r.trades}</td>
                <td className="py-1 pr-3 text-right font-mono tabular-nums">{pct(r.winRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// PnL Calendar — github-contributions-style grid where columns are weeks and
// rows are weekdays (Mon..Sun). Cell brightness scales with the magnitude of
// PnL relative to the largest abs PnL in the window. Hover shows the exact
// figure; click does nothing (per-trade drill-down lives on the Logs page).
function PnlCalendar({ series }: { series: DailyBucket[] }) {
  if (series.length === 0) return null

  const byDate = new Map<string, DailyBucket>()
  for (const d of series) byDate.set(d.date, d)
  const dates = [...byDate.keys()].sort()
  const first = new Date(dates[0] + 'T00:00:00Z')
  const last = new Date(dates[dates.length - 1] + 'T00:00:00Z')

  const startOfWeek = new Date(first)
  const dow = startOfWeek.getUTCDay() === 0 ? 6 : startOfWeek.getUTCDay() - 1
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - dow)

  const cells: { date: string; pnl: number; trades: number; inRange: boolean }[] = []
  const cur = new Date(startOfWeek)
  while (cur <= last) {
    const key = cur.toISOString().slice(0, 10)
    const bucket = byDate.get(key)
    const inRange = cur >= first
    cells.push({ date: key, pnl: bucket?.pnl ?? 0, trades: bucket?.trades ?? 0, inRange })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  const columns: typeof cells[] = []
  for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7))

  const maxAbs = Math.max(1, ...series.map((d) => Math.abs(d.pnl)))

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

  const winDays = series.filter((d) => d.pnl > 0).length
  const lossDays = series.filter((d) => d.pnl < 0).length
  const bestDay = series.reduce((b, d) => (d.pnl > (b?.pnl ?? -Infinity) ? d : b), null as DailyBucket | null)
  const worstDay = series.reduce((w, d) => (d.pnl < (w?.pnl ?? Infinity) ? d : w), null as DailyBucket | null)

  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text">PnL calendar</span>
        <div className="flex items-center gap-3 text-[10px] text-dim font-mono tabular-nums">
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
        <div className="flex flex-col gap-1 pt-4 text-[9px] text-dim font-mono">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="h-4 leading-4">{d}</div>
          ))}
        </div>
        <div className="flex gap-1">
          {columns.map((col, ci) => {
            const monthLabel = monthLabels.find((m) => m.col === ci)
            return (
              <div key={ci} className="flex flex-col gap-1">
                <div className="h-3 text-[9px] text-dim font-mono leading-3">{monthLabel?.label ?? ''}</div>
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
