import { useMemo } from 'react'
import { Activity, ArrowRight, TrendingDown, TrendingUp, Wind } from 'lucide-react'
import type { Candle, StrategyId } from '@/types'
import {
  analyzeRegime,
  recommendStrategies,
  STATES,
  type RegimeLabel,
} from '@/lib/markov'
import { strategyMeta } from '@/lib/strategies'

interface Props {
  candles: Candle[]
  currentStrategy: StrategyId
  onApplyStrategy: (id: StrategyId) => void
  window?: number
  threshold?: number
}

const REGIME_TONE: Record<RegimeLabel, { tone: string; bg: string; ring: string; icon: typeof TrendingUp }> = {
  Bull:     { tone: 'text-gain',  bg: 'bg-gain/10',  ring: 'ring-gain/40',  icon: TrendingUp },
  Bear:     { tone: 'text-loss',  bg: 'bg-loss/10',  ring: 'ring-loss/40',  icon: TrendingDown },
  Sideways: { tone: 'text-warn',  bg: 'bg-warn/10',  ring: 'ring-warn/40',  icon: Wind },
}

export default function RegimePanel({
  candles,
  currentStrategy,
  onApplyStrategy,
  window = 20,
  threshold = 0.02,
}: Props) {
  const analysis = useMemo(
    () => analyzeRegime(candles, window, threshold),
    [candles, window, threshold],
  )

  if (analysis.currentLabel === null) {
    return (
      <div className="card p-4 text-xs text-dim">
        Need at least {window} candles to detect the market regime.
      </div>
    )
  }

  const regime = analysis.currentLabel
  const tone = REGIME_TONE[regime]
  const Icon = tone.icon
  const recs = recommendStrategies(regime)

  return (
    <div className="card overflow-hidden">
      {/* Header band — colored to match the regime */}
      <div className={`flex items-center gap-3 border-b border-border px-4 py-3 ${tone.bg}`}>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ring-1 ${tone.ring} ${tone.bg}`}>
          <Icon className={`h-4 w-4 ${tone.tone}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-text">Market Regime</h3>
            <span className={`font-mono text-sm font-semibold ${tone.tone}`}>{regime.toUpperCase()}</span>
          </div>
          <p className="text-[11px] text-dim">
            Markov model · {analysis.fitSize} candles · {window}-bar rolling return ±{(threshold * 100).toFixed(1)}%
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-dim">Persistence</div>
          <div className={`font-mono text-base font-semibold ${tone.tone}`}>
            {(analysis.persistence * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
        {/* Left: numbers + matrix */}
        <div className="space-y-4">
          <ConvictionBar conviction={analysis.conviction} />

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim">
              Next-candle probability
            </p>
            <ProbBar probs={analysis.nextStateProbs} />
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim">
              Long-run regime mix (stationary)
            </p>
            <ProbBar probs={analysis.stationary} />
          </div>

          <TransitionMatrix P={analysis.transitionMatrix} currentState={analysis.currentState} />
        </div>

        {/* Right: recommended strategies */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-dim">
            Suggested for {regime.toLowerCase()} regime
          </p>
          <div className="flex flex-col gap-1.5">
            {recs.map((rec) => {
              const meta = strategyMeta(rec.id)
              const active = currentStrategy === rec.id
              return (
                <button
                  key={rec.id}
                  onClick={() => onApplyStrategy(rec.id)}
                  className={`group flex items-center gap-2 rounded-md border px-3 py-2 text-left transition ${
                    active
                      ? 'border-brand bg-brand/10'
                      : 'border-border bg-panel-2 hover:border-border-strong'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${active ? 'text-brand' : 'text-text'}`}>
                        {meta.name}
                      </span>
                      {rec.priority === 'primary' && (
                        <span className={`rounded-sm px-1 py-px text-[9px] font-semibold uppercase ${
                          active
                            ? 'bg-brand/20 text-brand'
                            : 'bg-border/60 text-dim'
                        }`}>
                          Primary
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-dim leading-snug">{rec.reason}</p>
                  </div>
                  {!active && (
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-dim opacity-0 transition group-hover:opacity-100" />
                  )}
                  {active && (
                    <span className="shrink-0 text-[10px] font-semibold uppercase text-brand">Active</span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-dim">
            <Activity className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              The Markov matrix tells you which playbook fits the regime — not the exact entry.
              Click a strategy to apply it to the backtester above.
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}

function ConvictionBar({ conviction }: { conviction: number }) {
  // Conviction range: −1 (certain bear) ... +1 (certain bull). Render as a
  // diverging bar centered at zero.
  const pct = Math.max(-1, Math.min(1, conviction))
  const widthPct = Math.abs(pct) * 50
  const isPos = pct >= 0
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-dim">Conviction</span>
        <span className={`font-mono font-semibold ${isPos ? 'text-gain' : 'text-loss'}`}>
          {pct >= 0 ? '+' : ''}{(pct * 100).toFixed(0)}%
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-sm bg-bg">
        <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
        <div
          className={`absolute top-0 h-full ${isPos ? 'bg-gain' : 'bg-loss'}`}
          style={{
            width: `${widthPct}%`,
            left: isPos ? '50%' : `${50 - widthPct}%`,
          }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-dim">
        <span>bear</span>
        <span>neutral</span>
        <span>bull</span>
      </div>
    </div>
  )
}

function ProbBar({ probs }: { probs: number[] }) {
  // Three segments: Bear / Sideways / Bull
  return (
    <div className="flex gap-px overflow-hidden rounded-sm">
      {STATES.map((state, i) => {
        const pct = probs[i] * 100
        const color =
          state === 'Bull' ? 'bg-gain' : state === 'Bear' ? 'bg-loss' : 'bg-warn'
        return (
          <div
            key={state}
            className={`flex h-7 items-center justify-center text-[10px] font-medium text-bg ${color}`}
            style={{ width: `${Math.max(2, pct)}%` }}
            title={`${state}: ${pct.toFixed(1)}%`}
          >
            {pct >= 12 && `${state} ${pct.toFixed(0)}%`}
          </div>
        )
      })}
    </div>
  )
}

function TransitionMatrix({ P, currentState }: { P: number[][]; currentState: number }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim">
        Transition matrix (row=from, col=to)
      </p>
      <div className="overflow-hidden rounded-md border border-border bg-bg">
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="bg-panel-2">
              <th className="w-14 px-2 py-1 text-left font-medium text-dim"></th>
              {STATES.map((s) => (
                <th key={s} className="px-2 py-1 text-right font-medium text-dim">{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATES.map((from, i) => (
              <tr
                key={from}
                className={i === currentState ? 'bg-brand/10' : ''}
              >
                <td className="px-2 py-1 text-dim">{from}</td>
                {STATES.map((_, j) => {
                  const v = P[i][j]
                  const persist = i === j
                  return (
                    <td
                      key={j}
                      className={`px-2 py-1 text-right tabular-nums ${
                        persist ? 'font-semibold text-text' : 'text-muted'
                      } ${i === currentState ? 'text-text' : ''}`}
                    >
                      {v > 0 ? `${(v * 100).toFixed(1)}%` : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
