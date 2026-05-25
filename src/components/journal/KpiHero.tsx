import StatTile, { type Tone } from '@/components/ui/StatTile'
import { money, pct, sourceLabel } from '@/lib/journal'
import type { JournalSummary } from '@/lib/journal'

interface Props {
  summary: JournalSummary | null
  loading: boolean
}

function toneForPnl(v: number): Tone {
  if (v > 0) return 'gain'
  if (v < 0) return 'loss'
  return 'neutral'
}

function toneForWinRate(v: number, samples: number): Tone {
  if (samples < 5) return 'neutral'
  if (v >= 60) return 'gain'
  if (v < 40) return 'loss'
  return 'warn'
}

export default function KpiHero({ summary, loading }: Props) {
  const placeholder = loading || !summary

  const net = summary?.netPnl ?? 0
  const wr = summary?.winRate ?? 0
  const trips = summary?.roundTripCount ?? 0

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          question="Net realized PnL"
          info="Net PnL"
          value={placeholder ? '—' : money(net, true)}
          tone={placeholder ? 'neutral' : toneForPnl(net)}
          sub={summary ? `${summary.roundTripCount} round-trips` : ' '}
        />
        <StatTile
          question="Win rate"
          info="Win Rate"
          value={placeholder ? '—' : pct(wr)}
          tone={placeholder ? 'neutral' : toneForWinRate(wr, trips)}
          sub={summary ? `${trips} closed trades` : ' '}
          bar={summary ? { fill: Math.min(100, wr), tone: toneForWinRate(wr, trips) } : undefined}
        />
        <StatTile
          question="Fills executed"
          info="Fills"
          value={placeholder ? '—' : String(summary!.fillsCount)}
          tone="brand"
          sub={summary ? 'opens + closes combined' : ' '}
        />
        <StatTile
          question="Best round-trip"
          info="Best Round-Trip"
          value={placeholder || !summary?.best ? '—' : money(summary.best.pnl, true)}
          tone={summary?.best ? 'gain' : 'neutral'}
          sub={summary?.best ? `${summary.best.asset} · ${sourceLabel(summary.best.source)}` : ' '}
        />
        <StatTile
          question="Worst round-trip"
          info="Worst Round-Trip"
          value={placeholder || !summary?.worst ? '—' : money(summary.worst.pnl, true)}
          tone={summary?.worst ? 'loss' : 'neutral'}
          sub={summary?.worst ? `${summary.worst.asset} · ${sourceLabel(summary.worst.source)}` : ' '}
        />
        <StatTile
          question="Open notional"
          info="Open Notional"
          value={placeholder ? '—' : money(summary!.openValue)}
          tone="neutral"
          sub={summary?.openValue ? 'positions still on' : 'no open positions'}
        />
      </div>
    </div>
  )
}
