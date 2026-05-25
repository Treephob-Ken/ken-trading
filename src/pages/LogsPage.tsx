import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'
import { downloadCsv, toCsv } from '@/lib/csv'
import type { AuditLine, Fill, JournalSummary, RoundTrip } from '@/lib/journal'
import { sourceLabel } from '@/lib/journal'
import KpiHero from '@/components/journal/KpiHero'
import FiltersBar, { type FilterState } from '@/components/journal/FiltersBar'
import RoundTripsTable from '@/components/journal/RoundTripsTable'
import FillsTable from '@/components/journal/FillsTable'
import AuditTable from '@/components/journal/AuditTable'
import EventsStream from '@/components/journal/EventsStream'
import TradeDetailModal from '@/components/journal/TradeDetailModal'
import ActivityHeatmap from '@/components/journal/ActivityHeatmap'
import BotLeaderboard from '@/components/journal/BotLeaderboard'

type TabId = 'roundtrips' | 'fills' | 'audit' | 'events'

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'roundtrips', label: 'Round-Trips', hint: 'Completed trades, entry → exit' },
  { id: 'fills', label: 'Fills', hint: 'Every execution from Hyperliquid' },
  { id: 'audit', label: 'Audit', hint: 'Local order attempts, filled or not' },
  { id: 'events', label: 'Events', hint: 'Live bot log stream' },
]

// View Transitions API for crossfade between tabs. No-op in unsupported browsers.
function transition(setter: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (typeof d.startViewTransition === 'function') d.startViewTransition(setter)
  else setter()
}

export default function LogsPage() {
  const [tab, setTab] = useState<TabId>('roundtrips')
  const [filter, setFilter] = useState<FilterState>({
    range: '24h',
    bot: 'all',
    asset: 'all',
    side: 'all',
    result: 'all',
    search: '',
  })

  const [summary, setSummary] = useState<JournalSummary | null>(null)
  const [trips, setTrips] = useState<RoundTrip[]>([])
  const [fills, setFills] = useState<Fill[]>([])
  const [audit, setAudit] = useState<AuditLine[]>([])

  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingTrips, setLoadingTrips] = useState(true)
  const [loadingFills, setLoadingFills] = useState(true)
  const [loadingAudit, setLoadingAudit] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [detailTrip, setDetailTrip] = useState<RoundTrip | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoadingSummary(true)
    setLoadingTrips(true)
    setLoadingFills(true)
    setLoadingAudit(true)

    const q = `?range=${filter.range}`

    Promise.all([
      apiFetch(`/api/journal/summary${q}`).then((r) => r.ok ? r.json() : Promise.reject(new Error(`summary ${r.status}`))),
      apiFetch(`/api/journal/roundtrips${q}`).then((r) => r.ok ? r.json() : Promise.reject(new Error(`roundtrips ${r.status}`))),
      apiFetch(`/api/journal/fills${q}`).then((r) => r.ok ? r.json() : Promise.reject(new Error(`fills ${r.status}`))),
      apiFetch(`/api/journal/audit${q}`).then((r) => r.ok ? r.json() : Promise.reject(new Error(`audit ${r.status}`))),
    ])
      .then(([s, t, f, a]) => {
        if (cancelled) return
        setSummary(s as JournalSummary)
        setTrips(t as RoundTrip[])
        setFills(f as Fill[])
        setAudit(a as AuditLine[])
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
      })
      .finally(() => {
        if (cancelled) return
        setLoadingSummary(false)
        setLoadingTrips(false)
        setLoadingFills(false)
        setLoadingAudit(false)
      })

    return () => { cancelled = true }
  }, [filter.range])

  const botOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of trips) {
      const k = r.source.kind === 'manual' ? 'manual' : r.source.botId
      if (k) map.set(k, r.source.kind === 'manual' ? 'Manual' : r.source.botName || k)
    }
    for (const r of fills) {
      const k = r.source.kind === 'manual' ? 'manual' : r.source.botId
      if (k && !map.has(k)) map.set(k, r.source.kind === 'manual' ? 'Manual' : r.source.botName || k)
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [trips, fills])

  const assetOptions = useMemo(() => {
    const s = new Set<string>()
    for (const r of trips) s.add(r.asset)
    for (const r of fills) s.add(r.asset)
    for (const r of audit) s.add(r.asset)
    return [...s].sort()
  }, [trips, fills, audit])

  const showResult = tab === 'roundtrips' || tab === 'audit'

  const handleExport = () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    if (tab === 'roundtrips') {
      const csv = toCsv(
        trips.map((r) => ({
          exitTime: new Date(r.exitTime).toISOString(),
          entryTime: new Date(r.entryTime).toISOString(),
          asset: r.asset,
          side: r.side,
          source: sourceLabel(r.source),
          entryPx: r.entryPx,
          exitPx: r.exitPx,
          size: r.size,
          closedPnl: r.closedPnl,
          pnlPct: r.pnlPct,
          fees: r.fees,
          holdMs: r.holdMs,
          fillCount: r.fillCount,
        })),
        [
          { key: 'exitTime', label: 'Exit Time' },
          { key: 'entryTime', label: 'Entry Time' },
          { key: 'asset', label: 'Asset' },
          { key: 'side', label: 'Side' },
          { key: 'source', label: 'Source' },
          { key: 'entryPx', label: 'Entry Price' },
          { key: 'exitPx', label: 'Exit Price' },
          { key: 'size', label: 'Size' },
          { key: 'closedPnl', label: 'PnL (USD)' },
          { key: 'pnlPct', label: 'PnL %' },
          { key: 'fees', label: 'Fees' },
          { key: 'holdMs', label: 'Hold (ms)' },
          { key: 'fillCount', label: 'Fills' },
        ],
      )
      downloadCsv(`roundtrips-${filter.range}-${stamp}.csv`, csv)
    } else if (tab === 'fills') {
      const csv = toCsv(
        fills.map((f) => ({
          time: new Date(f.time).toISOString(),
          asset: f.asset,
          source: sourceLabel(f.source),
          direction: f.dir,
          side: f.side,
          price: f.price,
          size: f.size,
          closedPnl: f.closedPnl,
          fee: f.fee,
          oid: f.oid,
          hash: f.hash,
        })),
        [
          { key: 'time', label: 'Time' },
          { key: 'asset', label: 'Asset' },
          { key: 'source', label: 'Source' },
          { key: 'direction', label: 'Direction' },
          { key: 'side', label: 'Side' },
          { key: 'price', label: 'Price' },
          { key: 'size', label: 'Size' },
          { key: 'closedPnl', label: 'Closed PnL' },
          { key: 'fee', label: 'Fee' },
          { key: 'oid', label: 'Order ID' },
          { key: 'hash', label: 'Tx Hash' },
        ],
      )
      downloadCsv(`fills-${filter.range}-${stamp}.csv`, csv)
    } else if (tab === 'audit') {
      const csv = toCsv(
        audit.map((a) => ({
          ts: a.ts,
          asset: a.asset,
          side: a.side,
          filled: a.filled,
          requestedSize: a.requestedSize,
          filledSize: a.filledSize,
          avgPx: a.avgPx ?? '',
          notionalUsd: a.notionalUsd,
        })),
        [
          { key: 'ts', label: 'Time' },
          { key: 'asset', label: 'Asset' },
          { key: 'side', label: 'Side' },
          { key: 'filled', label: 'Filled' },
          { key: 'requestedSize', label: 'Requested Size' },
          { key: 'filledSize', label: 'Filled Size' },
          { key: 'avgPx', label: 'Avg Price' },
          { key: 'notionalUsd', label: 'Notional (USD)' },
        ],
      )
      downloadCsv(`audit-${filter.range}-${stamp}.csv`, csv)
    }
  }

  const canExport = tab !== 'events' && (
    (tab === 'roundtrips' && trips.length > 0) ||
    (tab === 'fills' && fills.length > 0) ||
    (tab === 'audit' && audit.length > 0)
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-text">Trade Log</h1>
          <p className="text-[11px] text-dim">Every fill, every attempt, every event — your trading journal.</p>
        </div>
      </div>

      {/* KPI Hero */}
      <KpiHero summary={summary} loading={loadingSummary} />

      {/* Activity heatmap + leaderboard */}
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <ActivityHeatmap series={summary?.dailySeries ?? []} loading={loadingSummary} />
        <BotLeaderboard rows={summary?.byBot ?? []} loading={loadingSummary} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">
          Couldn't load journal data: {error}. The Events tab still works.
        </div>
      )}

      {/* Tabs + export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center rounded-xl border border-border bg-panel-2 p-0.5 w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.hint}
              onClick={() => transition(() => setTab(t.id))}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id ? 'bg-brand text-white' : 'text-dim hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {canExport && (
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-xs text-dim hover:text-text"
            title="Download the current view as CSV"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export CSV
          </button>
        )}
      </div>

      {/* Filters */}
      {tab !== 'events' && (
        <FiltersBar
          state={filter}
          onChange={setFilter}
          bots={botOptions}
          assets={assetOptions}
          showResult={showResult}
        />
      )}

      {/* Active tab */}
      {tab === 'roundtrips' && (
        <RoundTripsTable rows={trips} loading={loadingTrips} filter={filter} onSelect={setDetailTrip} />
      )}
      {tab === 'fills' && <FillsTable rows={fills} loading={loadingFills} filter={filter} />}
      {tab === 'audit' && <AuditTable rows={audit} loading={loadingAudit} filter={filter} />}
      {tab === 'events' && <EventsStream />}

      {/* Detail modal */}
      <TradeDetailModal trip={detailTrip} onClose={() => setDetailTrip(null)} />
    </div>
  )
}
