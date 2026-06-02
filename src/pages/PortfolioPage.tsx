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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AreaSeries,
  ColorType,
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

// Closed-trades table is paginated so it doesn't become an endless scroll.
const TRADES_PER_PAGE = 12

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

interface PortfolioPageProps {
  // Inside the Performance hub the hub header already shows the page title, so
  // we hide this page's own title block and keep only the range/period toolbar.
  embedded?: boolean
}

export default function PortfolioPage({ embedded = false }: PortfolioPageProps = {}) {
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
  const [tradesPage, setTradesPage] = useState(0)

  useEffect(() => { localStorage.setItem('portfolio_range', range) }, [range])
  useEffect(() => { localStorage.setItem('portfolio_eq_period', period) }, [period])
  // Jump back to page 1 whenever the closed-trades set changes (range switch,
  // bot cross-filter, or a refresh) so we never land on an empty page.
  useEffect(() => { setTradesPage(0) }, [range, selectedBot, trips])

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

  // Closed-trades pagination (clamp the page in case the set shrank).
  const totalTradePages = Math.max(1, Math.ceil(visibleTrips.length / TRADES_PER_PAGE))
  const tradePage = Math.min(tradesPage, totalTradePages - 1)
  const tradeStart = tradePage * TRADES_PER_PAGE
  const pageTrips = visibleTrips.slice(tradeStart, tradeStart + TRADES_PER_PAGE)

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

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-3 py-4 sm:px-6 sm:py-5">
      {/* ── Header — title hidden when embedded in the Performance hub ──── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {embedded ? (
          <span className="text-xs font-semibold text-text">Account overview</span>
        ) : (
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-brand" />
            <h1 className="text-lg font-semibold text-text font-display">Portfolio</h1>
            <p className="hidden sm:block text-xs text-dim">
              Account trend, max drawdown, and per-bot performance.
            </p>
          </div>
        )}
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
              <StatCard big title="Net PnL" value={equity ? money(equity.periodPnl, true) : '—'}
                sub={equity ? `${pct(equity.returnPct, true)} on avg capital` : ' '}
                tone={equity ? toneForPnl(equity.periodPnl) : 'neutral'} />
              <StatCard title="Max drawdown" value={equity ? `−${money(equity.maxDrawdown)}` : '—'}
                sub={equity && equity.maxDrawdownPct > 0 ? `−${equity.maxDrawdownPct.toFixed(1)}% of capital` : ' '} tone="loss" />
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

      {/* ── Monthly PnL calendar + insights (realized, cross-filtered) ───── */}
      <MonthlyPnlCalendar
        daily={view.daily}
        label={selectedBot ? sourceLabel(selectedPerf!.source) : 'All bots'}
      />

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
                {pageTrips.map((t) => (
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
            {/* Pager — only when there's more than one page. */}
            {totalTradePages > 1 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
                <span className="text-[10px] text-dim tabular-nums">
                  Showing {tradeStart + 1}–{tradeStart + pageTrips.length} of {visibleTrips.length}
                </span>
                <div className="flex items-center gap-1">
                  <PagerButton
                    onClick={() => setTradesPage(tradePage - 1)}
                    disabled={tradePage === 0}
                    label="Previous page"
                  >‹</PagerButton>
                  {buildPageWindow(tradePage, totalTradePages).map((p, i) =>
                    p === -1 ? (
                      <span key={`gap-${i}`} className="px-1 text-[11px] text-dim">…</span>
                    ) : (
                      <PagerButton
                        key={p}
                        onClick={() => setTradesPage(p)}
                        active={p === tradePage}
                        label={`Page ${p + 1}`}
                      >{p + 1}</PagerButton>
                    ),
                  )}
                  <PagerButton
                    onClick={() => setTradesPage(tradePage + 1)}
                    disabled={tradePage === totalTradePages - 1}
                    label="Next page"
                  >›</PagerButton>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

// Compact numeric pager button. `active` marks the current page; `label` is the
// accessible name (the visible glyph is too terse for a screen reader).
function PagerButton({ children, onClick, disabled, active, label }: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`min-w-[28px] rounded-md border px-2 py-1 text-[11px] tabular-nums transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? 'border-brand bg-brand/10 text-brand font-semibold'
          : 'border-border bg-panel-2 text-dim hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

// Page-number window: shows every page when there are few, otherwise first +
// last + a window around the current page, with -1 standing in for an ellipsis.
function buildPageWindow(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i)
  const wanted = new Set<number>([0, total - 1, current, current - 1, current + 1])
  const sorted = [...wanted].filter((p) => p >= 0 && p < total).sort((a, b) => a - b)
  const out: number[] = []
  let prev = -2
  for (const p of sorted) {
    if (p - prev > 1) out.push(-1)
    out.push(p)
    prev = p
  }
  return out
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
        <div className="overflow-x-auto">
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
        </div>
      )}
    </div>
  )
}

// Compact money for tight calendar cells: "$1.2k" / "-$340" / "$0".
function fmtCellMoney(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  const a = Math.abs(v)
  const body = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `$${a.toFixed(a < 100 ? 1 : 0)}`
  return `${sign}${body}`
}

// One insight chip in the summary strip.
function Insight({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  const c = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-text'
  return (
    <div className="rounded-md border border-border bg-panel-2/40 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`mt-0.5 font-mono text-xs font-bold tabular-nums ${c}`}>{value}</div>
    </div>
  )
}

// Monthly trading-journal calendar: a real month grid (Sun–Sat) where each day
// shows its realized $ PnL + trade count, color-coded, with a weekly-total
// column and a month total. Below it, a PnL insights strip. Navigates between
// the months present in `daily`. Cross-filtered upstream via `view.daily`.
function MonthlyPnlCalendar({ daily, label }: { daily: DailyBucket[]; label: string }) {
  const byDate = useMemo(() => {
    const m = new Map<string, DailyBucket>()
    for (const d of daily) m.set(d.date, d)
    return m
  }, [daily])

  // Distinct YYYY-MM present in the data, ascending.
  const months = useMemo(() => {
    const s = new Set<string>()
    for (const d of daily) s.add(d.date.slice(0, 7))
    return [...s].sort()
  }, [daily])

  const [monthIdx, setMonthIdx] = useState(0)
  // Jump to the latest month whenever the available months change (e.g. the
  // user switches bot filter or range).
  useEffect(() => { setMonthIdx(Math.max(0, months.length - 1)) }, [months.length])

  if (daily.length === 0 || months.length === 0) {
    return (
      <div className="card p-3">
        <div className="mb-2 text-xs font-semibold text-text">PnL calendar · {label}</div>
        <div className="text-[11px] text-dim italic">No closed trades in this selection.</div>
      </div>
    )
  }

  const idx = Math.min(monthIdx, months.length - 1)
  const ym = months[idx]
  const [year, month] = ym.split('-').map(Number) // month is 1-based here
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  // Build the day cells for this month, padded to whole Sun–Sat weeks.
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  type Cell = { day: number; date: string; pnl: number; trades: number; has: boolean } | null
  const cells: Cell[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${ym}-${String(day).padStart(2, '0')}`
    const b = byDate.get(date)
    cells.push({ day, date, pnl: b?.pnl ?? 0, trades: b?.trades ?? 0, has: !!b })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: Cell[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  // This month's trading days (days that actually had trades).
  const monthDays = cells.filter((c): c is NonNullable<Cell> => !!c && c.has)
  const monthNet = monthDays.reduce((s, c) => s + c.pnl, 0)
  const greenDays = monthDays.filter((c) => c.pnl > 0).length
  const redDays = monthDays.filter((c) => c.pnl < 0).length
  const best = monthDays.reduce((b, c) => (c.pnl > (b?.pnl ?? -Infinity) ? c : b), null as NonNullable<Cell> | null)
  const worst = monthDays.reduce((w, c) => (c.pnl < (w?.pnl ?? Infinity) ? c : w), null as NonNullable<Cell> | null)
  const avgPerDay = monthDays.length ? monthNet / monthDays.length : 0
  const dayWinRate = greenDays + redDays > 0 ? (greenDays / (greenDays + redDays)) * 100 : 0

  // Longest green / red streaks across trading days (in date order).
  let bestGreen = 0, bestRed = 0, runG = 0, runR = 0
  for (const c of monthDays) {
    if (c.pnl > 0) { runG++; runR = 0 } else if (c.pnl < 0) { runR++; runG = 0 } else { runG = 0; runR = 0 }
    bestGreen = Math.max(bestGreen, runG)
    bestRed = Math.max(bestRed, runR)
  }

  const maxAbs = Math.max(1, ...monthDays.map((c) => Math.abs(c.pnl)))
  const cellTone = (c: NonNullable<Cell>) => {
    if (!c.has || c.pnl === 0) return 'border-border/40 bg-panel-2/30 text-dim'
    const strong = Math.abs(c.pnl) / maxAbs > 0.5
    if (c.pnl > 0) return strong ? 'border-gain/60 bg-gain/25 text-gain' : 'border-gain/40 bg-gain/10 text-gain'
    return strong ? 'border-loss/60 bg-loss/25 text-loss' : 'border-loss/40 bg-loss/10 text-loss'
  }

  return (
    <div className="card p-3">
      {/* Header: month nav + month total */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text">PnL calendar · {label}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonthIdx((i) => Math.max(0, Math.min(i, months.length - 1) - 1))}
              disabled={idx === 0}
              className="rounded border border-border bg-panel-2 px-1.5 py-0.5 text-[11px] text-dim hover:text-text disabled:opacity-30 cursor-pointer"
              aria-label="Previous month"
            >‹</button>
            <span className="min-w-[120px] text-center font-mono text-[11px] text-text">{monthName}</span>
            <button
              type="button"
              onClick={() => setMonthIdx((i) => Math.min(months.length - 1, Math.min(i, months.length - 1) + 1))}
              disabled={idx === months.length - 1}
              className="rounded border border-border bg-panel-2 px-1.5 py-0.5 text-[11px] text-dim hover:text-text disabled:opacity-30 cursor-pointer"
              aria-label="Next month"
            >›</button>
          </div>
        </div>
        <span className={`font-mono text-sm font-bold tabular-nums ${monthNet >= 0 ? 'text-gain' : 'text-loss'}`}>
          {money(monthNet, true)} <span className="text-[10px] font-normal text-dim">month</span>
        </span>
      </div>

      {/* Calendar grid: 7 weekday columns + a weekly-total column */}
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-8 gap-1 text-[9px] text-dim font-mono">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="px-1 py-0.5 text-center">{d}</div>
            ))}
            <div className="px-1 py-0.5 text-center text-brand">Week</div>
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {weeks.map((week, wi) => {
              const weekTotal = week.reduce((s, c) => s + (c?.pnl ?? 0), 0)
              const weekHasTrades = week.some((c) => c?.has)
              return (
                <div key={wi} className="grid grid-cols-8 gap-1">
                  {week.map((c, di) => {
                    if (!c) return <div key={di} className="h-14 rounded-md border border-transparent" />
                    return (
                      <div
                        key={c.date}
                        title={`${c.date} · ${c.trades} ${c.trades === 1 ? 'trade' : 'trades'} · ${money(c.pnl, true)}`}
                        className={`flex h-14 flex-col justify-between rounded-md border p-1 ${cellTone(c)}`}
                      >
                        <div className="text-[9px] leading-none text-dim">{c.day}</div>
                        {c.has ? (
                          <>
                            <div className="text-center font-mono text-[11px] font-bold leading-none tabular-nums">
                              {fmtCellMoney(c.pnl)}
                            </div>
                            <div className="text-right text-[8px] leading-none text-dim">{c.trades}t</div>
                          </>
                        ) : (
                          <div className="text-center text-[9px] leading-none text-dim/40">·</div>
                        )}
                      </div>
                    )
                  })}
                  {/* Weekly total */}
                  <div className={`flex h-14 flex-col items-center justify-center rounded-md border border-border bg-panel-2/40 ${
                    !weekHasTrades ? 'opacity-40' : ''
                  }`}>
                    <div className="text-[8px] uppercase text-dim">wk{wi + 1}</div>
                    <div className={`font-mono text-[11px] font-bold tabular-nums ${weekTotal > 0 ? 'text-gain' : weekTotal < 0 ? 'text-loss' : 'text-dim'}`}>
                      {weekHasTrades ? fmtCellMoney(weekTotal) : '—'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* PnL insights for the visible month */}
      <div className="mt-3 border-t border-border pt-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-dim">PnL insights · {monthName}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Insight label="Month net" value={money(monthNet, true)} tone={monthNet >= 0 ? 'gain' : 'loss'} />
          <Insight label="Best day" value={best ? money(best.pnl, true) : '—'} tone="gain" />
          <Insight label="Worst day" value={worst && worst.pnl < 0 ? money(worst.pnl, true) : '—'} tone="loss" />
          <Insight label="Green / Red days" value={`${greenDays} / ${redDays}`} />
          <Insight label="Day win rate" value={pct(dayWinRate)} />
          <Insight label="Avg / trading day" value={money(avgPerDay, true)} tone={avgPerDay >= 0 ? 'gain' : 'loss'} />
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-dim font-mono">
          <span>longest green streak <span className="text-gain">{bestGreen}d</span></span>
          <span>longest red streak <span className="text-loss">{bestRed}d</span></span>
          <span>trading days <span className="text-text">{monthDays.length}</span></span>
        </div>
      </div>
    </div>
  )
}
