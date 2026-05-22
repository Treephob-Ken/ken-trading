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

function fmt(n: number, dp = 1) {
  return n.toFixed(dp)
}

function sign(n: number) {
  return n >= 0 ? '+' : ''
}

export default function SummaryPanel({ result, regime, strategyName, direction, symbol }: Props) {
  const m = result.metrics
  const label = regime?.currentLabel ?? null
  const conviction = regime?.conviction ?? null
  const grid = isGoodForGrid(label)

  // ── Strategy verdict ──────────────────────────────────────────────────────
  const returnColour =
    m.totalReturnPct > 0 ? 'text-gain' : m.totalReturnPct < 0 ? 'text-loss' : 'text-dim'
  const vsMarket = m.totalReturnPct - m.buyHoldReturnPct
  const vsMarketColour = vsMarket >= 0 ? 'text-gain' : 'text-loss'

  // ── Regime ────────────────────────────────────────────────────────────────
  const regimeColour =
    label === 'Bull'
      ? 'text-gain'
      : label === 'Bear'
        ? 'text-loss'
        : label === 'Sideways'
          ? 'text-warn'
          : 'text-dim'

  const convictionPct = conviction != null && !Number.isNaN(conviction) ? Math.abs(conviction) * 100 : null

  // ── Plain-English recommendation ──────────────────────────────────────────
  function buildRec(): string {
    const parts: string[] = []

    // Is the strategy profitable?
    if (m.numTrades === 0) {
      parts.push(`${strategyName} produced no trades in this window.`)
    } else if (m.totalReturnPct > 5 && m.winRate >= 50) {
      parts.push(`${strategyName} looks strong here (${sign(m.totalReturnPct)}${fmt(m.totalReturnPct)}%, ${fmt(m.winRate)}% win rate).`)
    } else if (m.totalReturnPct < -5) {
      parts.push(`${strategyName} underperformed in this window (${sign(m.totalReturnPct)}${fmt(m.totalReturnPct)}%) — consider a different strategy.`)
    } else {
      parts.push(`${strategyName} was roughly flat in this window (${sign(m.totalReturnPct)}${fmt(m.totalReturnPct)}%).`)
    }

    // Direction advice
    if (label === 'Bear' && direction === 'long') {
      parts.push('Current Bear regime suggests adding Short signals could help.')
    } else if (label === 'Bull' && direction === 'short') {
      parts.push('Current Bull regime suggests Longs may perform better.')
    }

    // Grid suitability
    if (grid.suitable) {
      parts.push(`Grid bots are a good fit — ${grid.reason}.`)
    } else {
      parts.push(`Grid bots carry more risk right now — ${grid.reason}.`)
    }

    return parts.join(' ')
  }

  return (
    <div className="card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-dim font-display">
        Summary — {symbol}
      </h3>

      <div className="flex flex-col gap-3">
        {/* Strategy row */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border bg-panel-2 px-3 py-2.5">
          <span className="text-xs text-dim font-display uppercase tracking-wide">Strategy</span>
          <span className="font-semibold text-text text-sm">{strategyName}</span>
          <span className={`font-mono text-sm font-semibold ${returnColour}`}>
            {sign(m.totalReturnPct)}{fmt(m.totalReturnPct)}%
          </span>
          <span className="text-xs text-dim">
            {m.numTrades} trade{m.numTrades !== 1 ? 's' : ''} · {fmt(m.winRate)}% win rate
          </span>
          {m.numTrades > 0 && (
            <span className={`text-xs ${vsMarketColour}`}>
              {sign(vsMarket)}{fmt(vsMarket)}% vs buy &amp; hold
            </span>
          )}
        </div>

        {/* Regime row */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border bg-panel-2 px-3 py-2.5">
          <span className="text-xs text-dim font-display uppercase tracking-wide">Regime</span>
          {label ? (
            <>
              <span className={`font-semibold text-sm ${regimeColour}`}>{label}</span>
              {convictionPct != null && (
                <span className="text-xs text-dim">{fmt(convictionPct, 0)}% conviction</span>
              )}
            </>
          ) : (
            <span className="text-sm text-dim">Not enough data</span>
          )}

          <span className="ml-auto flex items-center gap-1.5 text-xs">
            <span className={grid.suitable ? 'text-gain' : 'text-warn'}>
              {grid.suitable ? '✓' : '⚠'}
            </span>
            <span className="text-dim">Grid fit:</span>
            <span className={grid.suitable ? 'text-gain' : 'text-warn'}>
              {grid.suitable ? 'Good' : 'Risky'}
            </span>
          </span>
        </div>

        {/* Plain-English recommendation */}
        <p className="text-[13px] leading-relaxed text-muted">
          {buildRec()}
        </p>
      </div>
    </div>
  )
}
