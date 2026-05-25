// Warns when two or more bots are configured for the same asset on
// Hyperliquid. HL runs one-way mode — there's a single position per asset
// per account, so the bots fight over the same inventory and bleed fees.

import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Bot, Grid3x3 } from 'lucide-react'

interface ConflictSource {
  kind: 'signal' | 'grid'
  botId: string
  botName: string
  running: boolean
  strategyId?: string
  gridCount?: number
}

interface Props {
  asset: string
  sources: ConflictSource[]
  // Hide one source from the list — used on a bot detail page so the bot
  // looking at the warning doesn't see itself in the "stop one" list.
  hideBotId?: string
}

export default function MultiBotConflictBanner({ asset, sources, hideBotId }: Props) {
  const navigate = useNavigate()
  if (sources.length < 2) return null

  const others = hideBotId ? sources.filter((s) => s.botId !== hideBotId) : sources

  const label = (s: ConflictSource): string =>
    s.kind === 'signal'
      ? `Signal · ${s.strategyId?.toUpperCase() ?? '?'}`
      : `Grid · ${s.gridCount ?? '?'}`

  return (
    <div className="card border border-loss/40 bg-loss/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-loss" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-loss">
          Multiple bots on same asset
        </span>
      </div>

      <p className="mb-3 text-xs text-text leading-relaxed">
        {sources.length} bots are configured for{' '}
        <span className="font-mono font-bold">{asset}</span>. Hyperliquid keeps only{' '}
        <span className="font-semibold">one position per asset</span>, so these bots are sharing
        inventory and will fight each other — fee bleed and unexpected closes are likely.{' '}
        <span className="font-semibold">Stop all but one.</span>
      </p>

      <div className="flex flex-wrap gap-2">
        {others.map((s) => {
          const Icon = s.kind === 'signal' ? Bot : Grid3x3
          const dest = s.kind === 'signal' ? '/signal' : '/bots'
          return (
            <button
              key={s.botId}
              type="button"
              onClick={() => navigate(dest)}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                s.running
                  ? 'border-gain/40 bg-gain/10 text-gain hover:bg-gain/15'
                  : 'border-border bg-panel-2 text-muted hover:text-text'
              }`}
              title={`${s.botName} (${s.running ? 'running' : 'stopped'}) — click to open in ${s.kind === 'signal' ? 'Signal Bots' : 'Grid Bots'}`}
            >
              <Icon className="h-3 w-3" />
              <span>{label(s)}</span>
              <span className="font-mono text-[10px] opacity-70">· {s.botName}</span>
              <ArrowRight className="h-3 w-3 opacity-60" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
