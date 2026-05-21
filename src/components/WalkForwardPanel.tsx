import { useState } from 'react'
import type { WalkForwardResult } from '@/lib/walkforward'
import InfoTip from '@/components/InfoTip'
import { Sparkles, ShieldAlert, BarChart3 } from 'lucide-react'

interface Props {
  result: WalkForwardResult | null
  loading: boolean
}

export default function WalkForwardPanel({ result, loading }: Props) {
  const [isOpen, setIsOpen] = useState(false)

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center text-sm text-dim">
        Running walk-forward parameter sweeps...
      </div>
    )
  }

  if (!result || result.folds.length === 0) {
    return null
  }

  const { folds, inSampleSharpe, outOfSampleSharpe, overfitScore, paramStability } = result

  // Determine overfit badge colors
  let overfitColor = 'bg-gain/20 text-gain border-gain/30'
  let overfitLabel = 'Robust'
  if (overfitScore > 60) {
    overfitColor = 'bg-loss/20 text-loss border-loss/30'
    overfitLabel = 'High Overfit Risk'
  } else if (overfitScore > 30) {
    overfitColor = 'bg-warn/20 text-warn border-warn/30'
    overfitLabel = 'Moderate Overfit'
  }

  // Draw parameter stability sparkline
  // paramStability: { percent: number; sharpe: number }[]
  const minSharpe = Math.min(...paramStability.map(s => s.sharpe), 0)
  const maxSharpe = Math.max(...paramStability.map(s => s.sharpe), 0.1)
  const range = maxSharpe - minSharpe

  // SVG dimensions
  const width = 240
  const height = 45
  const padding = 5

  const points = paramStability.map((s, i) => {
    const x = padding + (i * (width - padding * 2)) / (paramStability.length - 1)
    // Invert y because SVG y goes down
    const y = height - padding - ((s.sharpe - minSharpe) / range) * (height - padding * 2)
    return { x, y, sharpe: s.sharpe, percent: s.percent }
  })

  const pathD = points.length > 0 
    ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
    : ''

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between border-b border-border bg-panel/30 px-4 py-3 hover:bg-panel/50"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-accent" />
            Walk-Forward Validation <InfoTip term="Walk-Forward" />
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${overfitColor}`}>
            {overfitLabel} (Overfit Score: {overfitScore.toFixed(0)}%)
          </span>
        </div>
        <button className="text-xs text-dim hover:text-text">
          {isOpen ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      {/* Content */}
      {isOpen && (
        <div className="p-4 space-y-6 animate-in">
          {/* Top stats summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-panel/20 border border-border/50 p-3 flex flex-col justify-between">
              <div>
                <span className="block text-[10px] uppercase font-semibold tracking-wider text-dim flex items-center gap-1">
                  In-Sample Sharpe <InfoTip term="In-Sample" />
                </span>
                <span className="font-mono text-xl font-bold text-text mt-1 block">
                  {inSampleSharpe.toFixed(2)}
                </span>
              </div>
              <span className="text-[10px] text-dim mt-2 block">
                Optimized parameters train average
              </span>
            </div>

            <div className="rounded-lg bg-panel/20 border border-border/50 p-3 flex flex-col justify-between">
              <div>
                <span className="block text-[10px] uppercase font-semibold tracking-wider text-dim flex items-center gap-1">
                  Out-of-Sample Sharpe <InfoTip term="Out-of-Sample" />
                </span>
                <span className="font-mono text-xl font-bold text-accent mt-1 block">
                  {outOfSampleSharpe.toFixed(2)}
                </span>
              </div>
              <span className="text-[10px] text-dim mt-2 block">
                Unseen forward test average
              </span>
            </div>

            {/* Param Stability Sparkline */}
            <div className="rounded-lg bg-panel/20 border border-border/50 p-3 flex flex-col justify-between">
              <div>
                <span className="block text-[10px] uppercase font-semibold tracking-wider text-dim flex items-center gap-1">
                  Parameter Stability <InfoTip term="Parameter Stability" />
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <svg width={width} height={height} className="overflow-visible">
                    {/* Zero line if within range */}
                    {minSharpe < 0 && maxSharpe > 0 && (
                      <line
                        x1={0}
                        y1={height - padding - ((0 - minSharpe) / range) * (height - padding * 2)}
                        x2={width}
                        y2={height - padding - ((0 - minSharpe) / range) * (height - padding * 2)}
                        stroke="rgba(255,255,255,0.15)"
                        strokeDasharray="2,2"
                      />
                    )}
                    {/* Line path */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Point dots */}
                    {points.map((p, idx) => (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r="3.5"
                        className="fill-accent stroke-panel-2 stroke-1 hover:r-5 cursor-pointer"
                      >
                        <title>{`${p.percent}% wiggle: Sharpe ${p.sharpe.toFixed(2)}`}</title>
                      </circle>
                    ))}
                  </svg>
                </div>
              </div>
              <div className="flex justify-between text-[8px] font-mono text-dim mt-1">
                <span>-20% params</span>
                <span>0%</span>
                <span>+20% params</span>
              </div>
            </div>
          </div>

          {/* Warning for High Overfit */}
          {overfitScore > 60 && (
            <div className="flex items-start gap-2 rounded-lg border border-loss/30 bg-loss/5 p-3 text-xs text-loss leading-relaxed">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">High Overfitting Risk Detected!</span>
                The strategy's out-of-sample Sharpe ratio is significantly lower ({outOfSampleSharpe.toFixed(2)}) than its in-sample optimized Sharpe ({inSampleSharpe.toFixed(2)}). Wiggling parameters also causes performance degradation. This indicates the parameters might be memorizing noise. Consider widening parameter steps, reducing indicator sensitivity, or using regime-based weights.
              </div>
            </div>
          )}

          {/* Folds breakdown */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold uppercase tracking-wider text-dim flex items-center gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              Fold-by-Fold Walk-Forward Breakdown
            </span>
            <div className="overflow-x-auto rounded-lg border border-border bg-panel">
              <table className="w-full text-left font-mono text-[11px] min-w-[600px]">
                <thead>
                  <tr className="bg-panel-2 border-b border-border text-dim font-medium">
                    <th className="px-3 py-2">Fold</th>
                    <th className="px-3 py-2">In-Sample Period</th>
                    <th className="px-3 py-2">Out-of-Sample Period</th>
                    <th className="px-3 py-2">Optimized Parameters</th>
                    <th className="px-3 py-2 text-right">IS Sharpe</th>
                    <th className="px-3 py-2 text-right">OOS Sharpe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {folds.map(f => (
                    <tr key={f.foldIndex} className="hover:bg-panel-2">
                      <td className="px-3 py-2 font-semibold text-text">#{f.foldIndex}</td>
                      <td className="px-3 py-2 text-dim">{f.trainRange}</td>
                      <td className="px-3 py-2 text-dim">{f.testRange}</td>
                      <td className="px-3 py-2 text-accent truncate max-w-[160px]" title={JSON.stringify(f.trainParams)}>
                        {Object.entries(f.trainParams)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(', ')}
                      </td>
                      <td className="px-3 py-2 text-right text-text tabular-nums">
                        {f.trainSharpe.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        f.testSharpe > 0 ? 'text-gain' : f.testSharpe < 0 ? 'text-loss' : 'text-text'
                      }`}>
                        {f.testSharpe.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
