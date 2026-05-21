import type { MultiTFResult } from '@/lib/multiTF'
import InfoTip from '@/components/InfoTip'
import { CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react'

interface Props {
  confluence: MultiTFResult | null
  loading: boolean
  currentTF: string
}

export default function MultiTFPanel({ confluence, loading, currentTF }: Props) {
  if (loading) {
    return (
      <div className="card p-4 flex items-center justify-center text-xs text-dim">
        Calculating higher-timeframe confluence...
      </div>
    )
  }

  if (!confluence) {
    return null
  }

  const { higherTF, higherRegime, currentRegime, confluence: confState, filterRecommendation } = confluence

  const currentLabel = currentRegime.currentLabel ?? 'None'
  const higherLabel = higherRegime.currentLabel ?? 'None'

  // Confluence badge styles
  let badgeColor = 'bg-border/40 text-dim border-border'
  let Icon = HelpCircle

  if (confState === 'aligned') {
    badgeColor = 'bg-gain/20 text-gain border-gain/30'
    Icon = CheckCircle2
  } else if (confState === 'conflicting') {
    badgeColor = 'bg-loss/20 text-loss border-loss/30'
    Icon = AlertTriangle
  } else if (confState === 'neutral') {
    badgeColor = 'bg-warn/20 text-warn border-warn/30'
    Icon = AlertTriangle
  }

  const regimeTone = (label: string) => {
    if (label === 'Bull') return 'text-gain'
    if (label === 'Bear') return 'text-loss'
    return 'text-warn'
  }

  return (
    <div className="card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 pb-3">
        <h3 className="text-xs font-semibold text-text uppercase tracking-wider flex items-center gap-1.5">
          Multi-Timeframe Confluence <InfoTip term="Multi-Timeframe" />
        </h3>
        <div className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase ${badgeColor}`}>
          <Icon className="h-3 w-3" />
          {confState} <InfoTip term="Confluence" className="ml-1" />
        </div>
      </div>

      {/* Main Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: Regimes comparison */}
        <div className="flex items-center gap-6">
          <div className="space-y-1">
            <span className="block text-[10px] text-dim font-medium uppercase">
              Current TF ({currentTF})
            </span>
            <span className={`font-mono text-sm font-bold ${regimeTone(currentLabel)}`}>
              {currentLabel.toUpperCase()}
            </span>
          </div>

          <div className="h-8 w-px bg-border" />

          <div className="space-y-1">
            <span className="block text-[10px] text-dim font-medium uppercase">
              Higher TF ({higherTF})
            </span>
            <span className={`font-mono text-sm font-bold ${regimeTone(higherLabel)}`}>
              {higherLabel.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Right: Recommendation box */}
        <div className="rounded-lg bg-panel/30 border border-border p-3 flex-1 max-w-md sm:ml-4">
          <div className="text-[10px] font-semibold text-dim uppercase tracking-wider">
            Confluence Bias / Action Plan
          </div>
          <p className="mt-1 text-xs font-medium text-text leading-relaxed">
            {filterRecommendation}
          </p>
        </div>
      </div>
    </div>
  )
}
