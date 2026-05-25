import { useMemo } from 'react'
import { fmtTimeShort, money, sourceLabel } from '@/lib/journal'
import type { Fill } from '@/lib/journal'
import type { FilterState } from './FiltersBar'

interface Props {
  rows: Fill[]
  loading: boolean
  filter: FilterState
}

function applyFilter(rows: Fill[], f: FilterState): Fill[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.bot !== 'all') {
      const key = r.source.kind === 'manual' ? 'manual' : r.source.botId
      if (key !== f.bot) return false
    }
    if (f.asset !== 'all' && r.asset !== f.asset) return false
    // side filter on fills: map buy↔long-ish, sell↔short-ish, but really just match raw side
    if (f.side === 'long' && r.side !== 'buy') return false
    if (f.side === 'short' && r.side !== 'sell') return false
    if (q && !(r.asset.toLowerCase().includes(q) || r.dir.toLowerCase().includes(q) || sourceLabel(r.source).toLowerCase().includes(q))) return false
    return true
  })
}

const HEAD =
  'sticky top-0 z-10 grid grid-cols-[110px_1fr_60px_110px_70px_90px_90px_90px] gap-2 bg-panel/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim backdrop-blur'
const ROW =
  'grid grid-cols-[110px_1fr_60px_110px_70px_90px_90px_90px] gap-2 border-b border-border/40 px-3 py-2 text-xs tabular-nums hover:bg-panel-2/50 transition-colors'

export default function FillsTable({ rows, loading, filter }: Props) {
  const filtered = useMemo(() => applyFilter(rows, filter), [rows, filter])

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-bg px-6 py-12 text-center text-sm text-dim animate-pulse">
        Loading fills…
      </div>
    )
  }

  // Newest first
  const sorted = [...filtered].sort((a, b) => b.time - a.time)

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-bg px-6 py-12 text-center">
        <p className="text-sm text-text">No fills in this window.</p>
        <p className="text-xs text-dim">Every executed buy or sell on your account will appear here.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-bg overflow-hidden">
      <div className={HEAD}>
        <span>Time</span><span>Bot</span><span>Asset</span><span>Direction</span>
        <span>Side</span><span className="text-right">Price</span><span className="text-right">Size</span>
        <span className="text-right">PnL</span>
      </div>
      <div style={{ contentVisibility: 'auto' as const }}>
        {sorted.map((r) => {
          const tone = r.closedPnl > 0 ? 'text-gain' : r.closedPnl < 0 ? 'text-loss' : 'text-text'
          return (
            <div key={`${r.hash}-${r.oid}-${r.time}`} className={ROW}>
              <span className="text-dim">{fmtTimeShort(r.time)}</span>
              <span className="truncate text-text">{sourceLabel(r.source)}</span>
              <span className="text-text">{r.asset}</span>
              <span className="truncate text-dim">{r.dir}</span>
              <span className={r.side === 'buy' ? 'text-gain' : 'text-loss'}>
                {r.side.toUpperCase()}
              </span>
              <span className="text-right text-text">${r.price.toFixed(2)}</span>
              <span className="text-right text-text">{r.size}</span>
              <span className={`text-right ${tone}`}>{r.closedPnl !== 0 ? money(r.closedPnl, true) : '—'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
