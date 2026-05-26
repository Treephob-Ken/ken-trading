import { useMemo } from 'react'
import type { AuditLine } from '@/lib/journal'
import { humanizeReason } from '@/lib/journal'
import type { FilterState } from './FiltersBar'

interface Props {
  rows: AuditLine[]
  loading: boolean
  filter: FilterState
}

function applyFilter(rows: AuditLine[], f: FilterState): AuditLine[] {
  const q = f.search.trim().toLowerCase()
  // Rejected-only: filled orders OR resting limits are NOT rejections.
  return rows.filter((r) => {
    if (r.filled) return false
    if (r.resting) return false
    if (f.asset !== 'all' && r.asset !== f.asset) return false
    if (f.side === 'long' && r.side !== 'buy') return false
    if (f.side === 'short' && r.side !== 'sell') return false
    if (q) {
      const reason = humanizeReason(r.reason).toLowerCase()
      if (!r.asset.toLowerCase().includes(q) && !reason.includes(q)) return false
    }
    return true
  })
}

const HEAD =
  'sticky top-0 z-10 grid grid-cols-[140px_60px_60px_1fr_100px] gap-2 bg-panel/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim backdrop-blur'
const ROW =
  'grid grid-cols-[140px_60px_60px_1fr_100px] gap-2 border-b border-border/40 px-3 py-2 text-xs tabular-nums hover:bg-panel-2/50 transition-colors'

export default function AuditTable({ rows, loading, filter }: Props) {
  const filtered = useMemo(() => applyFilter(rows, filter), [rows, filter])

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-bg px-6 py-12 text-center text-sm text-dim animate-pulse">
        Loading rejected orders…
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-bg px-6 py-12 text-center">
        <p className="text-sm text-text">No rejected orders 🎉</p>
        <p className="text-xs text-dim">Every order in this window either filled or is still resting. Rejections show up here with the reason.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-bg overflow-hidden">
      <div className={HEAD}>
        <span>When</span><span>Asset</span><span>Side</span>
        <span>Why it failed</span>
        <span className="text-right">Notional</span>
      </div>
      <div style={{ contentVisibility: 'auto' as const }}>
        {filtered.map((r, i) => {
          const ts = new Date(r.ts)
          const when = `${String(ts.getDate()).padStart(2, '0')} ${ts.toLocaleString('en-US', { month: 'short' })} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}`
          const reason = humanizeReason(r.reason)
          return (
            <div key={`${r.ts}-${i}`} className={ROW}>
              <span className="text-dim">{when}</span>
              <span className="text-text">{r.asset}</span>
              <span className={r.side === 'buy' ? 'text-gain' : 'text-loss'}>{r.side.toUpperCase()}</span>
              <span className="text-warn" title={r.reason}>{reason}</span>
              <span className="text-right text-text">${r.notionalUsd.toFixed(2)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
