import { useMemo } from 'react'
import type { Candle, Direction, StrategyId } from '@/types'
import type { SizingMode } from '@/components/Controls'
import { stabilityCheck, type StabilityPoint } from '@/lib/walkforward'
import InfoTip from '@/components/InfoTip'

interface Props {
  candles: Candle[]
  strategyId: StrategyId
  params: Record<string, number>
  initialCapital: number
  feePct: number
  direction: Direction
  sizingMode: SizingMode
}

// Map a Sharpe value to a Tailwind background class for the heat cell.
// Diverging green/amber/red palette so flat = uniformly green = stable.
function sharpeBg(s: number): string {
  if (s >= 1.5) return 'bg-gain text-bg'
  if (s >= 0.7) return 'bg-gain/70 text-bg'
  if (s >= 0) return 'bg-warn/60 text-bg'
  if (s >= -0.5) return 'bg-loss/60 text-white'
  return 'bg-loss text-white'
}

function verdictLine(points: StabilityPoint[], score: number): string {
  const center = points.find((p) => p.percent === 0)?.sharpe ?? 0
  const sharpes = points.map((p) => p.sharpe)
  const min = Math.min(...sharpes)
  const max = Math.max(...sharpes)
  if (center <= 0) {
    return 'Strategy is unprofitable even at baseline — fix the edge before worrying about stability.'
  }
  if (score >= 75) {
    return `Robust — Sharpe stays in the ${min.toFixed(2)}–${max.toFixed(2)} band across ±20% param wiggles. Safe to deploy.`
  }
  if (score >= 50) {
    return `Moderately stable — Sharpe drifts between ${min.toFixed(2)} and ${max.toFixed(2)}. Re-test if you change the params more than 10%.`
  }
  return `Fragile — Sharpe collapses from ${max.toFixed(2)} to ${min.toFixed(2)} under small param changes. Likely overfit to this exact window.`
}

export default function ParamStabilityCard({
  candles,
  strategyId,
  params,
  initialCapital,
  feePct,
  direction,
  sizingMode,
}: Props) {
  // Run on every relevant change. ~25-50 ms total (5× one backtest).
  const stab = useMemo(
    () =>
      stabilityCheck(
        candles,
        strategyId,
        params,
        initialCapital,
        feePct / 100,
        direction,
        sizingMode === 'volatility' ? 'volatility' : 'fixed',
      ),
    [candles, strategyId, params, initialCapital, feePct, direction, sizingMode],
  )

  if (!stab) return null

  const scoreTone =
    stab.stabilityScore >= 75 ? 'text-gain' : stab.stabilityScore >= 50 ? 'text-warn' : 'text-loss'

  return (
    <div className="card defer-render p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text font-display">
          How robust is this to parameter tweaks?
        </h3>
        <InfoTip term="Parameter Stability" />
        <span className="ml-auto flex items-center gap-1.5 text-[11px]">
          <span className="text-dim">Stability score:</span>
          <span className={`font-mono font-bold tabular-nums ${scoreTone}`}>
            {stab.stabilityScore.toFixed(0)} / 100
          </span>
        </span>
      </div>

      <div className="flex gap-1.5">
        {stab.points.map((p) => {
          const isBase = p.percent === 0
          return (
            <div
              key={p.percent}
              className={`relative flex-1 rounded-lg border ${
                isBase ? 'border-brand' : 'border-border'
              } ${sharpeBg(p.sharpe)} px-2 py-2.5 text-center transition-transform hover:scale-[1.03]`}
              title={`Params at ${p.percent >= 0 ? '+' : ''}${p.percent}% · Sharpe ${p.sharpe.toFixed(2)} · Return ${p.totalReturnPct.toFixed(1)}% · ${p.numTrades} trades`}
            >
              <div className="text-[10px] font-mono opacity-80">
                {p.percent >= 0 ? '+' : ''}{p.percent}%
              </div>
              <div className="font-mono text-base font-bold tabular-nums">
                {p.sharpe.toFixed(2)}
              </div>
              <div className="text-[9px] opacity-75">
                {p.totalReturnPct >= 0 ? '+' : ''}{p.totalReturnPct.toFixed(0)}%
              </div>
              {isBase && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-brand bg-bg px-1.5 py-0.5 text-[8px] font-bold uppercase text-brand">
                  base
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-3.5 text-[12px] leading-relaxed text-muted">
        <span className="font-semibold text-text">Insight:</span> {verdictLine(stab.points, stab.stabilityScore)}
      </p>
      <p className="mt-1 text-[10px] text-dim">
        Each tile shows the Sharpe ratio when every strategy parameter is wiggled by the labeled amount. Flat green = robust. Spiky = overfit to this exact window.
      </p>
    </div>
  )
}
