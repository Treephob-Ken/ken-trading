import { Zap } from 'lucide-react'
import { fmtNum, fmtPct, fmtPrice, fmtUsd } from '@/lib/format'
import { TF_MS, annualize, type GridOptimizeResult } from '@/lib/grid'

interface Props {
  result: GridOptimizeResult
  windowBars: number
  timeframe: string
}

type Tone = 'gain' | 'loss' | 'warn' | 'neutral'

function toneClass(tone: Tone): string {
  return tone === 'gain'
    ? 'text-gain'
    : tone === 'loss'
      ? 'text-loss'
      : tone === 'warn'
        ? 'text-[#f5a623]'
        : 'text-text'
}

function Row({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string
  value: string
  tone?: Tone
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <span className="text-xs text-dim">
        {label}
        {hint && <span className="ml-1 text-[10px] text-border-strong">· {hint}</span>}
      </span>
      <span className={`font-mono text-xs tabular-nums ${toneClass(tone)}`}>
        {value}
      </span>
    </div>
  )
}

function SectionHead({ children }: { children: string }) {
  return (
    <div className="bg-panel-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
      {children}
    </div>
  )
}

export default function GridStats({ result, windowBars, timeframe }: Props) {
  const { best, market } = result

  const spacingMultiple =
    result.breakevenPct > 0 ? best.spacingPct / result.breakevenPct : 0
  const profitPerRoundtripPct = best.spacingPct - result.breakevenPct
  const apr = annualize(best.realizedPct, windowBars, timeframe)
  const durationDays =
    (windowBars * (TF_MS[timeframe] ?? TF_MS['1h'])) / 86_400_000
  const tradesPerDay = durationDays > 0 ? best.completedTrades / durationDays : 0

  const pnlTone: Tone = best.totalPnl >= 0 ? 'gain' : 'loss'
  const spacingTone: Tone =
    spacingMultiple >= 3 ? 'gain' : spacingMultiple >= 1.5 ? 'warn' : 'loss'
  const verdictTone: Tone =
    market.verdict === 'Excellent' || market.verdict === 'Good'
      ? 'gain'
      : market.verdict === 'Marginal'
        ? 'warn'
        : 'loss'

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Zap className="h-3.5 w-3.5 text-[#f5a623]" />
        <h3 className="text-sm font-medium text-text">Grid Optimizer</h3>
        <span className="ml-auto rounded bg-brand/15 px-2 py-0.5 text-[11px] text-brand">
          {best.gridCount} grids optimal
        </span>
      </div>

      <SectionHead>Grid Setup</SectionHead>
      <Row label="Lookback" value={`${windowBars} bars`} />
      <Row label="Range High" value={fmtPrice(result.upper)} />
      <Row label="Range Low" value={fmtPrice(result.lower)} />
      <Row
        label="Range Size"
        value={`${fmtPrice(result.upper - result.lower)} (${market.rangePct.toFixed(1)}%)`}
      />
      <Row label="Optimal Grid Count" value={String(best.gridCount)} tone="neutral" />
      <Row
        label="Grid Spacing"
        value={`${fmtPrice(best.spacing)} (${best.spacingPct.toFixed(2)}%)`}
      />

      <SectionHead>Simulated Performance</SectionHead>
      <Row
        label="Completed Roundtrips"
        value={String(best.completedTrades)}
        hint="buy→sell pairs"
      />
      <Row label="Order Fills" value={String(best.fills)} />
      <Row
        label="Realized Grid Profit"
        value={`${fmtUsd(best.realizedPnl)} (${fmtPct(best.realizedPct)})`}
        tone={best.realizedPnl >= 0 ? 'gain' : 'loss'}
      />
      <Row
        label="Unrealized PnL"
        value={`${fmtUsd(best.unrealizedPnl)} (${fmtPct(best.unrealizedPct)})`}
        tone={best.unrealizedPnl >= 0 ? 'gain' : 'loss'}
        hint="open inventory"
      />
      <Row
        label="Total PnL"
        value={`${fmtUsd(best.totalPnl)} (${fmtPct(best.totalReturnPct)})`}
        tone={pnlTone}
      />
      <Row
        label="Realized APR"
        value={fmtPct(apr)}
        tone={apr >= 0 ? 'gain' : 'loss'}
        hint="annualized"
      />
      <Row label="Fees Paid" value={fmtUsd(best.feesPaid)} tone="loss" />
      <Row
        label="Max Drawdown"
        value={`-${best.maxDrawdownPct.toFixed(2)}%`}
        tone="loss"
      />
      <Row label="Roundtrips / Day" value={fmtNum(tradesPerDay, 1)} />

      <SectionHead>Edge Check</SectionHead>
      <Row
        label="Breakeven Spacing"
        value={`${fmtPrice(result.breakevenAbs)} (${result.breakevenPct.toFixed(3)}%)`}
        hint="covers fees"
      />
      <Row
        label="Spacing ÷ Breakeven"
        value={`${fmtNum(spacingMultiple, 1)}×`}
        tone={spacingTone}
        hint="want ≥ 3×"
      />
      <Row
        label="Net Profit / Roundtrip"
        value={fmtPct(profitPerRoundtripPct)}
        tone={profitPerRoundtripPct > 0 ? 'gain' : 'loss'}
      />

      <SectionHead>Market Fit</SectionHead>
      <Row
        label="Trend Efficiency"
        value={market.efficiencyRatio.toFixed(2)}
        tone={market.efficiencyRatio < 0.3 ? 'gain' : market.efficiencyRatio < 0.5 ? 'warn' : 'loss'}
        hint="lower = choppier"
      />
      <Row label="Volatility (ATR)" value={`${market.atrPct.toFixed(2)}% / bar`} />
      <Row
        label="Grid Suitability"
        value={`${market.verdict} (${market.score}/100)`}
        tone={verdictTone}
      />
    </div>
  )
}
