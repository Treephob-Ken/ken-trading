import type { BotRollup } from '@/lib/journal'
import { money, pct, sourceLabel } from '@/lib/journal'
import InfoTip from '@/components/InfoTip'

interface Props {
  rows: BotRollup[]
  loading: boolean
}

export default function BotLeaderboard({ rows, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-panel px-4 py-5 text-sm text-dim animate-pulse">
        Loading leaderboard…
      </div>
    )
  }

  if (rows.length === 0) return null

  return (
    <div className="rounded-2xl border border-border bg-panel p-4">
      <header className="mb-3 flex items-center gap-1">
        <h3 className="text-sm font-semibold text-text">Top performers</h3>
        <InfoTip term="Each bot's contribution to PnL in this window. 'Manual' is everything you placed by hand." />
      </header>

      <div className="flex flex-col gap-1.5">
        {rows.slice(0, 6).map((row, i) => {
          const tone = row.pnl > 0 ? 'text-gain' : row.pnl < 0 ? 'text-loss' : 'text-text'
          return (
            <div
              key={`${row.source.kind}-${row.source.botId ?? 'manual'}`}
              className="grid grid-cols-[24px_1fr_70px_90px_70px] items-center gap-2 rounded-lg border border-border bg-panel-2 px-3 py-2 text-xs tabular-nums"
            >
              <span className="text-dim">#{i + 1}</span>
              <span className="truncate text-text">{sourceLabel(row.source)}</span>
              <span className="text-right text-dim">{row.trades} {row.trades === 1 ? 'trade' : 'trades'}</span>
              <span className={`text-right font-semibold ${tone}`}>{money(row.pnl, true)}</span>
              <span className="text-right text-dim">{pct(row.winRate)} win</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
