import type { BacktestResult, Direction } from '@/types'
import type { RegimeAnalysis } from '@/lib/markov'
import { isGoodForGrid } from '@/lib/markov'

interface Props {
  result: BacktestResult
  regime: RegimeAnalysis | null
  strategyName: string
  direction: Direction
  symbol: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number, dp = 1) {
  return (n >= 0 ? '+' : '') + n.toFixed(dp) + '%'
}

function clampBar(abs: number, max: number) {
  return Math.min(100, (abs / max) * 100).toFixed(0) + '%'
}

// Color thresholds — consistent "green=good, yellow=ok, red=bad" across all metrics
const returnClr = (v: number) => (v > 2 ? '#22c55e' : v < -2 ? '#ef4444' : '#f59e0b')
const ddClr = (v: number) => (v < 10 ? '#22c55e' : v < 25 ? '#f59e0b' : '#ef4444')
const wrClr = (v: number) => (v >= 55 ? '#22c55e' : v >= 44 ? '#f59e0b' : '#ef4444')
const pfClr = (v: number) => (v >= 1.5 ? '#22c55e' : v >= 1 ? '#f59e0b' : '#ef4444')
const sharpeClr = (v: number) => (v >= 1 ? '#22c55e' : v >= 0.5 ? '#f59e0b' : '#ef4444')

// ── Sub-components ────────────────────────────────────────────────────────────

/** Small ⓘ tooltip that explains a metric when hovered. */
function Info({ tip }: { tip: string }) {
  return (
    <span
      title={tip}
      className="ml-1.5 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-border text-[9px] font-bold text-dim transition-colors hover:border-text hover:text-text"
    >
      i
    </span>
  )
}

/** Horizontal bar — colour + fill represent how good/bad the value is. */
function Bar({ fill, color, bg = 'rgba(255,255,255,.06)' }: { fill: string; color: string; bg?: string }) {
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: bg }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: fill, background: color }} />
    </div>
  )
}

/** One question-titled metric card. */
function MetricCard({
  question, info, value, valueColor, sub, bar,
}: {
  question: string
  info: string
  value: string
  valueColor: string
  sub?: string
  bar?: { fill: string; color: string }
}) {
  return (
    <div className="rounded-lg border border-border bg-panel-2 px-3 py-2.5">
      <div className="flex items-center text-[11px] font-medium uppercase tracking-wider text-dim font-display">
        {question}
        <Info tip={info} />
      </div>
      <div className="mt-1 font-mono text-xl font-bold tabular-nums" style={{ color: valueColor }}>
        {value}
      </div>
      {bar && <Bar fill={bar.fill} color={bar.color} />}
      {sub && <div className="mt-1 text-[11px] text-dim leading-snug">{sub}</div>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SummaryPanel({ result, regime, strategyName, direction, symbol }: Props) {
  const m = result.metrics
  const label = regime?.currentLabel ?? null
  const conviction = regime?.conviction ?? null
  const grid = isGoodForGrid(label)

  const vsMarket = m.totalReturnPct - m.buyHoldReturnPct
  const convictionPct = conviction != null && !Number.isNaN(conviction) ? Math.abs(conviction) * 100 : null

  // ── Verdict text ──────────────────────────────────────────────────────────
  function buildVerdict(): string {
    const parts: string[] = []
    if (m.numTrades === 0) {
      parts.push(`${strategyName} produced no signals in this window — try a different date range or strategy.`)
    } else if (m.totalReturnPct > 5 && m.winRate >= 50 && vsMarket >= 0) {
      parts.push(`${strategyName} outperformed here — ${pct(m.totalReturnPct)} vs ${pct(m.buyHoldReturnPct)} buy & hold, with a ${m.winRate.toFixed(0)}% win rate.`)
    } else if (m.totalReturnPct > 0 && vsMarket < 0) {
      parts.push(`${strategyName} was profitable (+${m.totalReturnPct.toFixed(1)}%) but lagged the market by ${Math.abs(vsMarket).toFixed(1)}%. Holding may have been better.`)
    } else if (m.totalReturnPct < -5) {
      parts.push(`${strategyName} lost ${Math.abs(m.totalReturnPct).toFixed(1)}% in this window — consider a different strategy or direction.`)
    } else {
      parts.push(`${strategyName} was roughly flat (${pct(m.totalReturnPct)}) — no strong edge in this window.`)
    }
    if (label === 'Bear' && direction === 'long') parts.push('Bear regime detected: adding Short signals may help.')
    else if (label === 'Bull' && direction === 'short') parts.push('Bull regime detected: Long-only may outperform.')
    parts.push(grid.suitable ? `Grid bots suit this market — ${grid.reason}.` : `Grid bots are risky here — ${grid.reason}.`)
    return parts.join(' ')
  }

  // ── Regime colour ─────────────────────────────────────────────────────────
  const regimeColor = label === 'Bull' ? '#22c55e' : label === 'Bear' ? '#ef4444' : label === 'Sideways' ? '#f59e0b' : '#6b7280'

  return (
    <div className="card p-4">
      {/* Header */}
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim font-display">
        Strategy Report — {symbol}
      </h3>

      {/* ── Z-ORDER: most critical insight first ── */}
      <div className="flex flex-col gap-2.5">

        {/* 1. Returns — #1 question every trader asks */}
        <MetricCard
          question="Did this strategy make money?"
          info={`Total % return of ${strategyName} over the selected period. Green = profit. Compare to buy & hold below.`}
          value={pct(m.totalReturnPct)}
          valueColor={returnClr(m.totalReturnPct)}
          bar={{ fill: clampBar(Math.abs(m.totalReturnPct), 100), color: returnClr(m.totalReturnPct) }}
          sub={
            m.numTrades > 0
              ? `Buy & Hold: ${pct(m.buyHoldReturnPct)} · ${vsMarket >= 0 ? '✓ Beat' : '✗ Lagged'} market by ${pct(vsMarket)}`
              : 'No trades executed in this window'
          }
        />

        {/* 2. Drawdown — how much risk was taken */}
        <MetricCard
          question="How bad was the worst losing period?"
          info="Max Drawdown: the biggest peak-to-trough drop in equity. Under 10% = conservative, 10-25% = moderate, over 25% = aggressive."
          value={`-${m.maxDrawdownPct.toFixed(1)}%`}
          valueColor={ddClr(m.maxDrawdownPct)}
          bar={{ fill: clampBar(m.maxDrawdownPct, 60), color: ddClr(m.maxDrawdownPct) }}
          sub={
            m.maxDrawdownPct < 10 ? 'Conservative drawdown — low risk' :
            m.maxDrawdownPct < 25 ? 'Moderate drawdown — acceptable risk' :
            'High drawdown — size positions carefully'
          }
        />

        {/* 3. Consistency — win rate + profit factor side by side */}
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            question="How often does it win?"
            info="Win Rate: % of trades that were profitable. Above 50% is good, but what matters most is profit factor (do wins outweigh losses in size)."
            value={`${m.winRate.toFixed(0)}%`}
            valueColor={wrClr(m.winRate)}
            bar={{ fill: clampBar(m.winRate, 100), color: wrClr(m.winRate) }}
            sub={`${m.numTrades} trade${m.numTrades !== 1 ? 's' : ''} · ${m.wins}W / ${m.losses}L`}
          />
          <MetricCard
            question="Do wins outweigh losses?"
            info="Profit Factor: total gross profit ÷ total gross loss. Above 1.5 = solid edge, 1.0-1.5 = marginal, below 1.0 = losing strategy."
            value={Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}
            valueColor={pfClr(Number.isFinite(m.profitFactor) ? m.profitFactor : 99)}
            bar={{ fill: clampBar(Math.min(m.profitFactor, 3), 3), color: pfClr(m.profitFactor) }}
            sub={`Avg win ${pct(m.avgWinPct)} · Avg loss ${m.avgLossPct.toFixed(1)}%`}
          />
        </div>

        {/* 4. Risk-adjusted return */}
        <MetricCard
          question="Was the risk worth the reward?"
          info="Sharpe Ratio: return relative to volatility. Above 1.0 = good risk-adjusted return, 0.5-1.0 = acceptable, below 0.5 = not worth the risk."
          value={Number.isFinite(m.sharpeRatio) ? m.sharpeRatio.toFixed(2) : '—'}
          valueColor={Number.isFinite(m.sharpeRatio) ? sharpeClr(m.sharpeRatio) : '#6b7280'}
          bar={Number.isFinite(m.sharpeRatio) ? { fill: clampBar(Math.max(0, m.sharpeRatio), 2), color: sharpeClr(m.sharpeRatio) } : undefined}
          sub={`Avg hold: ${m.avgHoldingBars.toFixed(0)} bars · Expectancy: ${pct(m.expectancy)}/trade`}
        />

        {/* 5. Market regime */}
        <div className="rounded-lg border border-border bg-panel-2 px-3 py-2.5">
          <div className="flex items-center text-[11px] font-medium uppercase tracking-wider text-dim font-display">
            What is the current market phase?
            <Info tip="Market regime detected by analysing the probability of the price trending up vs down over rolling windows. Bull/Bear/Sideways guides which strategy types work best." />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {label ? (
              <>
                <span className="font-mono text-xl font-bold" style={{ color: regimeColor }}>{label}</span>
                {convictionPct != null && (
                  <span className="text-sm text-dim">{convictionPct.toFixed(0)}% conviction</span>
                )}
              </>
            ) : (
              <span className="font-mono text-xl font-bold text-dim">—</span>
            )}
            <span className="ml-auto flex items-center gap-1.5 text-xs">
              <span style={{ color: grid.suitable ? '#22c55e' : '#f59e0b' }}>{grid.suitable ? '✓' : '⚠'}</span>
              <span className="text-dim">Grid bot:</span>
              <span style={{ color: grid.suitable ? '#22c55e' : '#f59e0b' }} className="font-medium">
                {grid.suitable ? 'Good fit' : 'Risky'}
              </span>
            </span>
          </div>
          {label && (
            <Bar
              fill={convictionPct != null ? `${convictionPct.toFixed(0)}%` : '50%'}
              color={regimeColor}
            />
          )}
        </div>

        {/* 6. Plain-English verdict — bottom, synthesises everything above */}
        <div className="rounded-lg border border-border bg-panel-2 px-3 py-2.5">
          <div className="flex items-center text-[11px] font-medium uppercase tracking-wider text-dim font-display">
            What should you do?
            <Info tip="A plain-English summary combining the return, regime, and grid fit above. Use as a starting point — always do your own analysis before trading." />
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{buildVerdict()}</p>
        </div>

      </div>
    </div>
  )
}
