import { useMemo } from 'react'
import { fmtHoldMs, fmtTimeShort, money, pct, sourceLabel } from '@/lib/journal'
import type { RoundTrip } from '@/lib/journal'
import type { FilterState } from './FiltersBar'

interface Props {
  rows: RoundTrip[]
  loading: boolean
  filter: FilterState
  onSelect?: (trip: RoundTrip) => void
}

function applyFilter(rows: RoundTrip[], f: FilterState): RoundTrip[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.bot !== 'all') {
      const key = r.source.kind === 'manual' ? 'manual' : r.source.botId
      if (key !== f.bot) return false
    }
    if (f.asset !== 'all' && r.asset !== f.asset) return false
    if (f.side !== 'all' && r.side !== f.side) return false
    if (f.result === 'win' && r.closedPnl <= 0) return false
    if (f.result === 'loss' && r.closedPnl >= 0) return false
    if (q && !(r.asset.toLowerCase().includes(q) || sourceLabel(r.source).toLowerCase().includes(q))) return false
    return true
  })
}

const HEAD =
  'sticky top-0 z-10 grid grid-cols-[110px_1fr_60px_70px_90px_90px_100px_70px_90px] gap-2 bg-panel/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim backdrop-blur'
const ROW =
  'grid grid-cols-[110px_1fr_60px_70px_90px_90px_100px_70px_90px] gap-2 border-b border-border/40 px-3 py-2 text-xs tabular-nums hover:bg-panel-2/50 transition-colors text-left'

export default function RoundTripsTable({ rows, loading, filter, onSelect }: Props) {
  const filtered = useMemo(() => applyFilter(rows, filter), [rows, filter])

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-bg overflow-hidden">
        <div className={HEAD}>
          <span>Exit</span><span>Bot</span><span>Asset</span><span>Side</span>
          <span className="text-right">Entry</span><span className="text-right">Exit Px</span>
          <span className="text-right">PnL</span><span className="text-right">%</span><span className="text-right">Hold</span>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={ROW + ' animate-pulse'}>
            <span className="h-3 rounded bg-panel-2" />
            <span className="h-3 rounded bg-panel-2" />
            <span className="h-3 rounded bg-panel-2" />
            <span className="h-3 rounded bg-panel-2" />
            <span className="h-3 rounded bg-panel-2" />
            <span className="h-3 rounded bg-panel-2" />
            <span className="h-3 rounded bg-panel-2" />
            <span className="h-3 rounded bg-panel-2" />
            <span className="h-3 rounded bg-panel-2" />
          </div>
        ))}
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-bg px-6 py-12 text-center">
        <p className="text-sm text-text">No closed round-trips in this window.</p>
        <p className="text-xs text-dim">Round-trips appear here once a position opens and closes back to zero.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-bg overflow-hidden">
      <div className={HEAD}>
        <span>Exit</span><span>Bot</span><span>Asset</span><span>Side</span>
        <span className="text-right">Entry</span><span className="text-right">Exit Px</span>
        <span className="text-right">PnL</span><span className="text-right">%</span><span className="text-right">Hold</span>
      </div>
      <div style={{ contentVisibility: 'auto' as const }}>
        {filtered.map((r) => {
          const tone = r.closedPnl > 0 ? 'text-gain' : r.closedPnl < 0 ? 'text-loss' : 'text-text'
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect?.(r)}
              className={ROW + ' cursor-pointer w-full'}
            >
              <span className="text-dim">{fmtTimeShort(r.exitTime)}</span>
              <span className="truncate text-text">{sourceLabel(r.source)}</span>
              <span className="text-text">{r.asset}</span>
              <span className={r.side === 'long' ? 'text-gain' : 'text-loss'}>
                {r.side.toUpperCase()}
              </span>
              <span className="text-right text-text">${r.entryPx.toFixed(2)}</span>
              <span className="text-right text-text">${r.exitPx.toFixed(2)}</span>
              <span className={`text-right font-semibold ${tone}`}>{money(r.closedPnl, true)}</span>
              <span className={`text-right ${tone}`}>{pct(r.pnlPct, true)}</span>
              <span className="text-right text-dim">{fmtHoldMs(r.holdMs)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
