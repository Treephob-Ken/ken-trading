import { Wallet } from 'lucide-react'

interface Props {
  notional: number | null      // position size in USD
  leverage: number | null      // for Signal Bot = max lev for the asset; for Grid = user's leverage setting
  leverageLabel?: string       // override the row label (default "Max leverage")
  slPct?: number | null        // stop-loss % (used to compute loss-if-SL)
  // Optional footnote showing the math (e.g. qty × price). Drop if not useful.
  footnote?: string | null
  title?: string
}

export default function PositionSizeCard({
  notional,
  leverage,
  leverageLabel = 'Max leverage',
  slPct,
  footnote,
  title = 'Position size',
}: Props) {
  const lev = leverage ?? 1
  const margin = notional && notional > 0 ? notional / lev : 0
  const lossAtSl = notional && notional > 0 && slPct && slPct > 0
    ? notional * (slPct / 100)
    : 0

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Wallet className="h-3.5 w-3.5 text-brand" />
        <p className="text-xs font-semibold text-text">{title}</p>
      </div>
      <div className="rounded-lg border border-border bg-panel-2 px-2.5 py-2 text-[10px] space-y-1">
        <div className="flex justify-between">
          <span className="text-dim">Position (notional)</span>
          <span className="font-mono text-text">
            {notional && notional > 0 ? `$${notional.toFixed(2)}` : '— (loading)'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-dim">{leverageLabel}</span>
          <span className="font-mono text-text">
            {leverage ? `${leverage}×` : '— (loading)'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-dim">Margin needed (at {lev}×)</span>
          <span className="font-mono text-text">
            {leverage && margin > 0 ? `$${margin.toFixed(2)}` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-dim">Loss if SL hits</span>
          <span className={`font-mono ${slPct && slPct > 0 ? 'text-loss' : 'text-dim'}`}>
            {slPct && slPct > 0 && lossAtSl > 0
              ? `-$${lossAtSl.toFixed(2)}${leverage ? ` (${((lossAtSl / Math.max(margin, 0.0001)) * 100).toFixed(0)}% of margin)` : ''}`
              : 'no SL set'}
          </span>
        </div>
        {footnote && (
          <p className="text-[9px] text-dim mt-1 leading-relaxed">{footnote}</p>
        )}
      </div>
    </div>
  )
}
