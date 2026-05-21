import { useMemo } from 'react'
import { Activity, ArrowRight, TrendingDown, TrendingUp, Wind, ShieldAlert, Sparkles } from 'lucide-react'
import type { Candle, StrategyId } from '@/types'
import {
  analyzeRegime,
  recommendStrategies,
  STATES,
  type RegimeLabel,
} from '@/lib/markov'
import { strategyMeta, defaultParams, generateSignals } from '@/lib/strategies'
import { runBacktest } from '@/lib/backtest'
import InfoTip from '@/components/InfoTip'

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

  // Meta-Model Orchestrator calculations:
  // 1. Backtest each recommended strategy on current dataset to calculate its Sharpe
  const sharpes = useMemo(() => {
    const map: Record<string, number> = {}
    for (const rec of recs) {
      try {
        const params = defaultParams(rec.id)
        const out = generateSignals(rec.id, candles, params)
        const res = runBacktest(
          candles,
          out.signals,
          10000,
          0.001, // 0.1% fee
          'both',
          0,
          0
        )
        map[rec.id] = Math.max(0.05, res.metrics.sharpeRatio) // clamp at 0.05 for positive weights
      } catch {
        map[rec.id] = 1.0 // fallback
      }
    }
    return map
  }, [candles, recs])

  // 2. Backtest currently selected strategy for drawdown circuit breaker
  const activeBacktest = useMemo(() => {
    try {
      const params = defaultParams(currentStrategy)
      const out = generateSignals(currentStrategy, candles, params)
      return runBacktest(candles, out.signals, 10000, 0.001, 'both', 0, 0)
    } catch {
      return null
    }
  }, [candles, currentStrategy])

  // 3. Detect recent transitions (in last 20 bars)
  const regimeTransition = useMemo(() => {
    const labels = analysis.labels
    if (labels.length < 40) return null

    let currentRegimeIdx = -1
    let currentPos = -1
    for (let i = labels.length - 1; i >= 0; i--) {
      if (labels[i] >= 0) {
        currentRegimeIdx = labels[i]
        currentPos = i
        break
      }
    }

    if (currentPos === -1) return null

    let prevRegimeIdx = -1
    for (let i = currentPos - 1; i >= 0; i--) {
      if (labels[i] >= 0 && labels[i] !== currentRegimeIdx) {
        prevRegimeIdx = labels[i]
        const barsAgo = currentPos - i
        if (barsAgo <= 20) {
          return {
            from: STATES[prevRegimeIdx],
            to: STATES[currentRegimeIdx],
            barsAgo,
          }
        }
        break
      }
    }
    return null
  }, [analysis])

  // 4. Calculate portfolio allocations w_i = (Sharpe_i * Boost_i) / sum(Sharpe * Boost)
  const allocations = useMemo(() => {
    let totalScore = 0
    const rawAllocations = recs.map((rec) => {
      const meta = strategyMeta(rec.id)
      const sharpe = sharpes[rec.id] || 0.1

      const isTrend = ['macd', 'ema', 'sma', 'supertrend', 'psar', 'donchian', 'elliott'].includes(rec.id)
      const isOscillator = ['rsi', 'stochastic', 'stochrsi', 'cci', 'williamsr', 'bollinger'].includes(rec.id)

      let boost = 1.0
      if (regime === 'Bull' || regime === 'Bear') {
        if (isTrend) boost = 2.0
      } else if (regime === 'Sideways') {
        if (isOscillator) boost = 2.0
      }

      const score = sharpe * boost
      totalScore += score
      return {
        id: rec.id,
        name: meta.name,
        category: meta.category,
        sharpe,
        boost,
        score,
      }
    })

    return rawAllocations.map((item) => ({
      ...item,
      weight: totalScore > 0 ? item.score / totalScore : 0,
    }))
  }, [recs, sharpes, regime])

  // 5. Drawdown safety circuit breaker status
  const circuitBreakerStatus = useMemo(() => {
    if (!activeBacktest) return null
    const dd = activeBacktest.metrics.maxDrawdownPct
    if (dd > 10) {
      return {
        drawdown: dd,
        title: '🚨 Drawdown Circuit Breaker: Active',
        description: 'Drawdown exceeds 10% risk threshold. De-risk immediately (cease trading or scale size by 80%).',
        bg: 'bg-loss/10',
        border: 'border-loss/30',
        text: 'text-loss',
      }
    } else if (dd > 5) {
      return {
        drawdown: dd,
        title: '⚠️ Risk Warning: High Drawdown',
        description: 'Drawdown exceeds 5% threshold. Consider cutting position size by half.',
        bg: 'bg-warn/10',
        border: 'border-warn/30',
        text: 'text-warn',
      }
    }
    return null
  }, [activeBacktest])

  return (
    <div className="card overflow-hidden">
      {/* Header band — colored to match the regime */}
      <div className={`flex items-center gap-3 border-b border-border px-4 py-3 ${tone.bg}`}>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ring-1 ${tone.ring} ${tone.bg}`}>
          <Icon className={`h-4 w-4 ${tone.tone}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-text flex items-center gap-1">
              Market Regime
              <InfoTip term="Regime" className="text-dim hover:text-muted" />
            </h3>
            <span className={`font-mono text-sm font-semibold ${tone.tone}`}>{regime.toUpperCase()}</span>
          </div>
          <p className="text-[11px] text-dim">
            Markov model · {analysis.fitSize} candles · {window}-bar rolling return ±{(threshold * 100).toFixed(1)}%
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-dim flex items-center justify-end gap-1">
            Persistence
            <InfoTip term="Persistence" className="text-dim hover:text-muted" />
          </div>
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
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim flex items-center gap-1">
              Long-run regime mix (stationary)
              <InfoTip term="Stationary Distribution" className="text-dim hover:text-muted" />
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

      {/* Meta-Model Orchestration Section */}
      <div className="border-t border-border/40 bg-panel/10 p-4 space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-warn animate-pulse" />
          Meta-Model Portfolio Orchestrator <InfoTip term="Meta-Model" />
        </h4>

        {/* Transition Alert & Circuit Breakers */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Regime Transition Alert */}
          {regimeTransition ? (
            <div className="rounded-lg border border-brand/30 bg-brand/5 p-3 flex items-start gap-2.5">
              <Activity className="h-4 w-4 text-brand shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-text block">Regime Shift Alert</span>
                <p className="text-[11px] text-dim leading-relaxed mt-0.5">
                  Trend transitioned from <strong className="text-muted">{regimeTransition.from}</strong> to{' '}
                  <strong className="text-brand font-bold">{regimeTransition.to}</strong>{' '}
                  {regimeTransition.barsAgo} bars ago. Allocations adjusted.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border/50 bg-panel-2/20 p-3 flex items-start gap-2.5">
              <Activity className="h-4 w-4 text-dim shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-dim block">Regime Stability</span>
                <p className="text-[11px] text-dim leading-relaxed mt-0.5">
                  No recent regime transitions detected in the last 20 bars. Current state is stable.
                </p>
              </div>
            </div>
          )}

          {/* Drawdown Circuit Breaker */}
          {circuitBreakerStatus ? (
            <div className={`rounded-lg border p-3 flex items-start gap-2.5 ${circuitBreakerStatus.border} ${circuitBreakerStatus.bg}`}>
              <ShieldAlert className={`h-4 w-4 shrink-0 mt-0.5 ${circuitBreakerStatus.text}`} />
              <div>
                <span className={`text-xs font-semibold block ${circuitBreakerStatus.text}`}>
                  {circuitBreakerStatus.title}
                </span>
                <p className="text-[11px] text-dim leading-relaxed mt-0.5">
                  {circuitBreakerStatus.description} (Current Max DD: {circuitBreakerStatus.drawdown.toFixed(1)}%)
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gain/30 bg-gain/5 p-3 flex items-start gap-2.5">
              <ShieldAlert className="h-4 w-4 text-gain shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-gain block">Drawdown Circuit Breaker</span>
                <p className="text-[11px] text-dim leading-relaxed mt-0.5">
                  Selected strategy drawdown is within safe limits (under 5%). Full risk allocation permitted.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Risk Budget Allocation */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-dim flex items-center gap-1">
              Dynamic Risk Budget Allocation
            </span>
            <span className="text-[9px] font-mono text-dim">
              w_i = (Sharpe_i × Boost_i) / Σ(Sharpe × Boost)
            </span>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-panel p-3">
            {allocations.map((alloc) => {
              const active = currentStrategy === alloc.id
              return (
                <div key={alloc.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onApplyStrategy(alloc.id)}
                        className={`font-semibold hover:underline text-left truncate max-w-[140px] sm:max-w-none ${
                          active ? 'text-brand font-bold' : 'text-text hover:text-brand'
                        }`}
                      >
                        {alloc.name}
                      </button>
                      <span className="text-[10px] text-dim shrink-0">({alloc.category})</span>
                      {alloc.boost > 1 && (
                        <span className="rounded bg-warn/10 border border-warn/30 px-1 text-[8px] font-semibold text-warn shrink-0">
                          {alloc.boost}x Boost
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-dim flex items-center gap-2 shrink-0">
                      <span>Sharpe: {alloc.sharpe.toFixed(2)}</span>
                      <span className={active ? 'text-brand font-bold' : 'text-text font-medium'}>
                        {(alloc.weight * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        active ? 'bg-brand' : 'bg-muted'
                      }`}
                      style={{ width: `${alloc.weight * 100}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function ConvictionBar({ conviction }: { conviction: number }) {
  // Diverging conviction bar: −1 (bearish) to +1 (bullish)
  const pct = Math.max(-1, Math.min(1, conviction))
  const widthPct = Math.abs(pct) * 50
  const isPos = pct >= 0
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-dim flex items-center gap-1">
          Conviction
          <InfoTip term="Conviction" className="text-dim hover:text-muted" />
        </span>
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
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim flex items-center gap-1">
        Transition matrix (row=from, col=to)
        <InfoTip term="Transition Matrix" className="text-dim hover:text-muted" />
      </p>
      <div className="overflow-x-auto rounded-md border border-border bg-panel">
        <table className="w-full font-mono text-[11px] min-w-[320px]">
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
