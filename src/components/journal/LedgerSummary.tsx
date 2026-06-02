// Compact range summary shown above the ledger tables (replaces the sparse
// "Daily activity" heatmap). Big net-PnL headline + win/trades + best/worst,
// with a smooth cumulative-realized-PnL sparkline of the days in range.

import { money, pct, sourceLabel } from '@/lib/journal'
import type { JournalSummary } from '@/lib/journal'

function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null
  const w = 220, h = 48
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1
  const nx = (i: number) => (i / (values.length - 1)) * w
  const ny = (v: number) => h - ((v - min) / span) * h
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${nx(i).toFixed(1)},${ny(v).toFixed(1)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  const color = up ? 'hsl(var(--gain))' : 'hsl(var(--loss))'
  const zeroY = ny(0)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full" aria-hidden="true">
      {/* zero baseline */}
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="hsl(var(--border))" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
      <path d={area} fill={color} fillOpacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function LedgerSummary({ summary, loading }: {
  summary: JournalSummary | null
  loading: boolean
}) {
  if (!summary) {
    return <div className={`card h-[92px] ${loading ? 'animate-pulse' : ''}`} />
  }

  const net = summary.netPnl
  const up = net >= 0

  // Cumulative realized PnL across the daily buckets in range.
  const cum: number[] = []
  let run = 0
  for (const d of summary.dailySeries) { run += d.pnl; cum.push(run) }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">Net realized · this range</span>
        <span className={`font-mono text-2xl font-bold tabular-nums ${up ? 'text-gain' : 'text-loss'}`}>
          {money(net, true)}
        </span>
        <span className="text-[11px] text-dim">
          {summary.roundTripCount} round-trips · {pct(summary.winRate)} win · {summary.fillsCount} fills
        </span>
        {(summary.best || summary.worst) && (
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono">
            {summary.best && (
              <span className="text-dim">best <span className="text-gain">{money(summary.best.pnl, true)}</span> {summary.best.asset}</span>
            )}
            {summary.worst && summary.worst.pnl < 0 && (
              <span className="text-dim">worst <span className="text-loss">{money(summary.worst.pnl, true)}</span> {summary.worst.asset}</span>
            )}
            {summary.byBot?.[0] && (
              <span className="text-dim">top <span className="text-text">{sourceLabel(summary.byBot[0].source)}</span></span>
            )}
          </div>
        )}
      </div>
      <div className="min-w-[180px] flex-1 sm:max-w-[280px]">
        {cum.length >= 2 ? (
          <Sparkline values={cum} up={up} />
        ) : (
          <div className="flex h-12 items-center justify-end text-[10px] text-dim">cumulative PnL · need 2+ active days</div>
        )}
      </div>
    </div>
  )
}
