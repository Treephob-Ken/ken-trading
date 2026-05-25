import type { DailyBucket } from '@/lib/journal'
import { money } from '@/lib/journal'
import InfoTip from '@/components/InfoTip'

interface Props {
  series: DailyBucket[]
  loading: boolean
}

// Color cell by PnL magnitude relative to the largest abs PnL in the window.
function cellTone(pnl: number, maxAbs: number): { bg: string; border: string } {
  if (pnl === 0) return { bg: 'bg-panel-2', border: 'border-border/30' }
  const intensity = Math.min(1, Math.abs(pnl) / Math.max(1, maxAbs))
  if (pnl > 0) {
    if (intensity > 0.75) return { bg: 'bg-gain/70', border: 'border-gain/60' }
    if (intensity > 0.4) return { bg: 'bg-gain/45', border: 'border-gain/40' }
    return { bg: 'bg-gain/25', border: 'border-gain/30' }
  }
  if (intensity > 0.75) return { bg: 'bg-loss/70', border: 'border-loss/60' }
  if (intensity > 0.4) return { bg: 'bg-loss/45', border: 'border-loss/40' }
  return { bg: 'bg-loss/25', border: 'border-loss/30' }
}

export default function ActivityHeatmap({ series, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-panel px-4 py-5 text-sm text-dim animate-pulse">
        Loading activity…
      </div>
    )
  }

  if (series.length === 0) {
    return null
  }

  const maxAbs = Math.max(0, ...series.map((d) => Math.abs(d.pnl)))
  const totalTrades = series.reduce((s, d) => s + d.trades, 0)
  const winDays = series.filter((d) => d.pnl > 0).length
  const lossDays = series.filter((d) => d.pnl < 0).length

  return (
    <div className="rounded-2xl border border-border bg-panel p-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-text">Daily activity</h3>
          <InfoTip term="Each cell is one trading day. Green = profit, red = loss, brightness = magnitude. Hover for the number." />
        </div>
        <div className="flex items-center gap-3 text-[11px] text-dim tabular-nums">
          <span><span className="text-gain">{winDays}</span> green days</span>
          <span><span className="text-loss">{lossDays}</span> red days</span>
          <span>{totalTrades} trades</span>
        </div>
      </header>

      <div className="flex flex-wrap gap-1">
        {series.map((d) => {
          const tone = cellTone(d.pnl, maxAbs)
          const title = `${d.date} · ${d.trades} ${d.trades === 1 ? 'trade' : 'trades'} · ${money(d.pnl, true)}`
          return (
            <div
              key={d.date}
              title={title}
              className={`h-6 w-6 rounded-md border ${tone.bg} ${tone.border} transition-transform hover:scale-110`}
            />
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-2 text-[10px] text-dim">
        <span>Less</span>
        <div className="h-3 w-3 rounded-sm border border-loss/60 bg-loss/70" />
        <div className="h-3 w-3 rounded-sm border border-loss/40 bg-loss/45" />
        <div className="h-3 w-3 rounded-sm border border-loss/30 bg-loss/25" />
        <div className="h-3 w-3 rounded-sm border border-border/30 bg-panel-2" />
        <div className="h-3 w-3 rounded-sm border border-gain/30 bg-gain/25" />
        <div className="h-3 w-3 rounded-sm border border-gain/40 bg-gain/45" />
        <div className="h-3 w-3 rounded-sm border border-gain/60 bg-gain/70" />
        <span>More</span>
      </div>
    </div>
  )
}
