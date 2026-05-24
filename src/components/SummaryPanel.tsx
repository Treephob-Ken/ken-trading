import type { BacktestResult, Direction } from '@/types'
import type { RegimeAnalysis } from '@/lib/markov'
import { isGoodForGrid } from '@/lib/markov'
import InfoTip from '@/components/InfoTip'
import StatTile, { type Tone } from '@/components/ui/StatTile'
import VerdictBadge, { decideVerdict } from '@/components/ui/VerdictBadge'

interface Props {
  result: BacktestResult
  regime: RegimeAnalysis | null
  strategyName: string
  direction: Direction
  symbol: string
}

function pct(n: number, dp = 1) {
  return (n >= 0 ? '+' : '') + n.toFixed(dp) + '%'
}

const returnTone = (v: number): Tone => (v > 2 ? 'gain' : v < -2 ? 'loss' : 'warn')
const ddTone = (v: number): Tone => (v < 10 ? 'gain' : v < 25 ? 'warn' : 'loss')
const wrTone = (v: number): Tone => (v >= 55 ? 'gain' : v >= 44 ? 'warn' : 'loss')
const pfTone = (v: number): Tone => (v >= 1.5 ? 'gain' : v >= 1 ? 'warn' : 'loss')
const sharpeTone = (v: number): Tone => (v >= 1 ? 'gain' : v >= 0.5 ? 'warn' : 'loss')

export default function SummaryPanel({ result, regime, strategyName, direction, symbol }: Props) {
  const m = result.metrics
  const label = regime?.currentLabel ?? null
  const conviction = regime?.conviction ?? null
  const grid = isGoodForGrid(label)
  const vsMarket = m.totalReturnPct - m.buyHoldReturnPct
  const convictionPct = conviction != null && !Number.isNaN(conviction) ? Math.abs(conviction) * 100 : null

  const verdict = decideVerdict(result, regime)

  // Regime-specific direction nudge for the verdict reasons list (kept separate from VerdictBadge logic so it stays focused).
  const directionNote =
    label === 'Bear' && direction === 'long'
      ? 'Bear regime detected: adding Short signals may help.'
      : label === 'Bull' && direction === 'short'
      ? 'Bull regime detected: Long-only may outperform.'
      : null

  const verdictWithNudge = directionNote
    ? { ...verdict, reasons: [...verdict.reasons, directionNote] }
    : verdict

  const regimeColor =
    label === 'Bull' ? 'text-gain' : label === 'Bear' ? 'text-loss' : label === 'Sideways' ? 'text-warn' : 'text-dim'

  return (
    <div className="card relative overflow-hidden p-4 ring-1 ring-brand/30 shadow-[0_0_0_4px_hsl(var(--brand)/0.05)]">
      {/* Brand accent stripe — marks this as the headline verdict card, not just another panel */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand via-accent to-brand" />

      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-brand shadow-[0_0_8px_hsl(var(--brand))]" />
        <h3 className="text-[13px] font-bold uppercase tracking-wider text-text font-display">
          Trade Summary
        </h3>
        <span className="text-xs font-medium text-dim">— {symbol}</span>
      </div>

      <div className="flex flex-col gap-2.5">

        {/* 1 ─ The verdict comes first now. Trade / Wait / Avoid with reasons. */}
        <VerdictBadge verdict={verdictWithNudge} />

        {/* 2 ─ Returns */}
        <StatTile
          question="Did this strategy make money?"
          info={`Total % return of ${strategyName} over the selected period. Green = profit. Compare to buy & hold below.`}
          value={pct(m.totalReturnPct)}
          tone={returnTone(m.totalReturnPct)}
          bar={{ fill: Math.min(100, Math.abs(m.totalReturnPct)), tone: returnTone(m.totalReturnPct) }}
          sub={
            m.numTrades > 0
              ? `Buy & Hold: ${pct(m.buyHoldReturnPct)} · ${vsMarket >= 0 ? '✓ Beat' : '✗ Lagged'} market by ${pct(vsMarket)}`
              : 'No trades executed in this window'
          }
        />

        {/* 3 ─ Drawdown */}
        <StatTile
          question="How bad was the worst losing period?"
          info="Max Drawdown"
          value={`-${m.maxDrawdownPct.toFixed(1)}%`}
          tone={ddTone(m.maxDrawdownPct)}
          bar={{ fill: Math.min(100, (m.maxDrawdownPct / 60) * 100), tone: ddTone(m.maxDrawdownPct) }}
          sub={
            m.maxDrawdownPct < 10
              ? 'Conservative drawdown — low risk'
              : m.maxDrawdownPct < 25
              ? 'Moderate drawdown — acceptable risk'
              : 'High drawdown — size positions carefully'
          }
        />

        {/* 4 ─ Consistency */}
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile
            question="How often does it win?"
            info="Win Rate"
            value={`${m.winRate.toFixed(0)}%`}
            tone={wrTone(m.winRate)}
            bar={{ fill: m.winRate, tone: wrTone(m.winRate) }}
            sub={`${m.numTrades} trade${m.numTrades !== 1 ? 's' : ''} · ${m.wins}W / ${m.losses}L`}
          />
          <StatTile
            question="Do wins outweigh losses?"
            info="Profit Factor"
            value={Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}
            tone={pfTone(Number.isFinite(m.profitFactor) ? m.profitFactor : 99)}
            bar={{ fill: Math.min(100, (Math.min(m.profitFactor, 3) / 3) * 100), tone: pfTone(m.profitFactor) }}
            sub={`Avg win ${pct(m.avgWinPct)} · Avg loss ${m.avgLossPct.toFixed(1)}%`}
          />
        </div>

        {/* 5 ─ Risk-adjusted */}
        <StatTile
          question="Was the risk worth the reward?"
          info="Sharpe Ratio"
          value={Number.isFinite(m.sharpeRatio) ? m.sharpeRatio.toFixed(2) : '—'}
          tone={Number.isFinite(m.sharpeRatio) ? sharpeTone(m.sharpeRatio) : 'neutral'}
          bar={
            Number.isFinite(m.sharpeRatio)
              ? { fill: Math.min(100, (Math.max(0, m.sharpeRatio) / 2) * 100), tone: sharpeTone(m.sharpeRatio) }
              : undefined
          }
          sub={`Avg hold: ${m.avgHoldingBars.toFixed(0)} bars · Expectancy: ${pct(m.expectancy)}/trade`}
        />

        {/* 6 ─ Regime (custom layout — keeps the grid suitability badge) */}
        <div className="rounded-lg border border-border bg-panel-2 px-3 py-2.5">
          <div className="flex items-center text-[11px] font-medium uppercase tracking-wider text-dim font-display">
            What is the current market phase?
            <InfoTip term="Regime" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {label ? (
              <>
                <span className={`font-mono text-xl font-bold tabular-nums ${regimeColor}`}>{label}</span>
                {convictionPct != null && (
                  <span className="text-sm text-dim">{convictionPct.toFixed(0)}% conviction</span>
                )}
              </>
            ) : (
              <span className="font-mono text-xl font-bold text-dim">—</span>
            )}
            <span className="ml-auto flex items-center gap-1.5 text-xs">
              <span className={grid.suitable ? 'text-gain' : 'text-warn'}>{grid.suitable ? '✓' : '⚠'}</span>
              <span className="text-dim">Grid bot:</span>
              <span className={`font-medium ${grid.suitable ? 'text-gain' : 'text-warn'}`}>
                {grid.suitable ? 'Good fit' : 'Risky'}
              </span>
            </span>
          </div>
          {label && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  label === 'Bull' ? 'bg-gain' : label === 'Bear' ? 'bg-loss' : 'bg-warn'
                }`}
                style={{ width: `${convictionPct ?? 50}%` }}
              />
            </div>
          )}
          <p className="mt-2 text-[11px] text-dim leading-snug">{grid.reason}</p>
        </div>
      </div>
    </div>
  )
}
