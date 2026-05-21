import { Zap } from 'lucide-react'
import { fmtNum, fmtPct, fmtPrice, fmtUsd } from '@/lib/format'
import { TF_MS, annualize, type GridOptimizeResult } from '@/lib/grid'
import InfoTip from '@/components/InfoTip'

interface Props {
  result: GridOptimizeResult
  windowBars: number
  timeframe: string
  candles?: Candle[]
}

type Tone = 'gain' | 'loss' | 'warn' | 'neutral'

function toneClass(tone: Tone): string {
  return tone === 'gain'
    ? 'text-gain'
    : tone === 'loss'
      ? 'text-loss'
      : tone === 'warn'
        ? 'text-warn'
        : 'text-text'
}

interface Candle {
  high: number
  low: number
  close: number
}

function Row({
  label,
  value,
  tone = 'neutral',
  hint,
  tooltipTerm,
}: {
  label: string
  value: string
  tone?: Tone
  hint?: string
  tooltipTerm?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <span className="text-xs text-dim flex items-center gap-1">
        {label}
        {tooltipTerm && <InfoTip term={tooltipTerm} className="text-dim hover:text-muted" />}
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

export default function GridStats({ result, windowBars, timeframe, candles }: Props) {
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

  // Adaptive Grid spacing calculations
  let currentAtrVal = 0
  let averageAtrVal = 0
  let scaleFactor = 1.0
  let suggestedSpacing = best.spacing

  if (candles && candles.length >= 15) {
    const atrValues: number[] = []
    let trSum = 0
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]
      let tr = c.high - c.low
      if (i > 0) {
        const prevC = candles[i - 1]
        tr = Math.max(
          c.high - c.low,
          Math.abs(c.high - prevC.close),
          Math.abs(c.low - prevC.close),
        )
      }
      trSum += tr
      if (i >= 14) {
        let sum = 0
        for (let j = i - 13; j <= i; j++) {
          let t = candles[j].high - candles[j].low
          if (j > 0) {
            t = Math.max(t, Math.abs(candles[j].high - candles[j - 1].close), Math.abs(candles[j].low - candles[j - 1].close))
          }
          sum += t
        }
        atrValues.push(sum / 14)
      } else {
        atrValues.push(trSum / (i + 1))
      }
    }

    currentAtrVal = atrValues[atrValues.length - 1] || 0
    const sumAtr = atrValues.reduce((s, x) => s + x, 0)
    averageAtrVal = sumAtr / atrValues.length
    
    if (averageAtrVal > 0) {
      scaleFactor = currentAtrVal / averageAtrVal
      suggestedSpacing = best.spacing * scaleFactor
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Zap className="h-3.5 w-3.5 text-warn" />
        <h3 className="text-sm font-medium text-text">Grid Optimizer</h3>
        <span className="ml-auto rounded bg-brand/15 px-2 py-0.5 text-[11px] text-brand">
          {best.gridCount} grids optimal
        </span>
      </div>

      <SectionHead>Grid Setup</SectionHead>
      <Row label="Lookback" value={`${windowBars} bars`} tooltipTerm="Lookback" />
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
        tooltipTerm="Realized APR"
      />
      <Row label="Fees Paid" value={fmtUsd(best.feesPaid)} tone="loss" />
      <Row
        label="Max Drawdown"
        value={`-${best.maxDrawdownPct.toFixed(2)}%`}
        tone="loss"
        tooltipTerm="Max Drawdown"
      />
      <Row label="Roundtrips / Day" value={fmtNum(tradesPerDay, 1)} />

      <SectionHead>Edge Check</SectionHead>
      <Row
        label="Breakeven Spacing"
        value={`${fmtPrice(result.breakevenAbs)} (${result.breakevenPct.toFixed(3)}%)`}
        hint="covers fees"
        tooltipTerm="Breakeven Spacing"
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
        tooltipTerm="Kaufman ER"
      />
      <Row label="Volatility (ATR)" value={`${market.atrPct.toFixed(2)}% / bar`} tooltipTerm="ATR" />
      <Row
        label="Grid Suitability"
        value={`${market.verdict} (${market.score}/100)`}
        tone={verdictTone}
        tooltipTerm="Grid Suitability"
      />

      {candles && candles.length >= 15 && (
        <>
          <SectionHead>Adaptive Grid Stats</SectionHead>
          <Row label="Current ATR(14)" value={fmtPrice(currentAtrVal)} />
          <Row label="Reference ATR (Avg)" value={fmtPrice(averageAtrVal)} />
          <Row
            label="Spacing Scale Factor"
            value={`${scaleFactor.toFixed(2)}x`}
            tone={scaleFactor > 1.25 ? 'warn' : scaleFactor < 0.75 ? 'gain' : 'neutral'}
          />
          <Row
            label="Suggested Spacing"
            value={`${fmtPrice(suggestedSpacing)} (${(best.spacingPct * scaleFactor).toFixed(2)}%)`}
          />
        </>
      )}
    </div>
  )
}
