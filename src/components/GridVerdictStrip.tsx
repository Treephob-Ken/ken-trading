import type { GridOptimizeResult } from '@/lib/grid'
import { TF_MS } from '@/lib/grid'
import type { RegimeAnalysis } from '@/lib/markov'
import { isGoodForGrid } from '@/lib/markov'
import StatTile, { type Tone } from '@/components/ui/StatTile'
import VerdictBadge, { type VerdictResult, type VerdictKind } from '@/components/ui/VerdictBadge'
import { fmtUsd } from '@/lib/format'

interface Props {
  result: GridOptimizeResult
  regime: RegimeAnalysis | null
  windowBars: number
  timeframe: string
}

/**
 * Combined verdict + 4-tile confidence strip for the Grid Optimizer page.
 * Mirrors the Backtester pattern (VerdictBadge + ConfidenceStrip) but uses
 * grid-specific signals: regime suitability, total PnL on window, roundtrip
 * frequency, spacing vs breakeven safety multiple.
 */
export default function GridVerdictStrip({ result, regime, windowBars, timeframe }: Props) {
  const { best, market, breakevenPct } = result
  const spacingMultiple = breakevenPct > 0 ? best.spacingPct / breakevenPct : 0
  const durationDays = (windowBars * (TF_MS[timeframe] ?? TF_MS['1h'])) / 86_400_000
  const tradesPerDay = durationDays > 0 ? best.completedTrades / durationDays : 0
  const gridFit = isGoodForGrid(regime?.currentLabel ?? null)

  // ── Verdict logic ──────────────────────────────────────────────────────────
  let kind: VerdictKind
  const reasons: string[] = []

  const pnlOk = best.totalPnl > 0
  const spacingOk = spacingMultiple >= 3
  const spacingTight = spacingMultiple >= 1.5 && spacingMultiple < 3
  const enoughTrades = best.completedTrades >= 5
  const regimeOk = gridFit.suitable

  if (pnlOk) reasons.push(`Best grid earned ${fmtUsd(best.totalPnl)} (${best.totalReturnPct.toFixed(1)}%) on this window.`)
  else reasons.push(`Best grid lost ${fmtUsd(Math.abs(best.totalPnl))} (${best.totalReturnPct.toFixed(1)}%) on this window.`)

  if (spacingOk) reasons.push(`Spacing is ${spacingMultiple.toFixed(1)}× breakeven — safe profit margin per cell.`)
  else if (spacingTight) reasons.push(`Spacing only ${spacingMultiple.toFixed(1)}× breakeven — fees eat into profit per cell.`)
  else reasons.push(`Spacing is ${spacingMultiple.toFixed(1)}× breakeven — most fills can't even pay their own fees.`)

  if (!enoughTrades) reasons.push(`Only ${best.completedTrades} roundtrip${best.completedTrades === 1 ? '' : 's'} — too few to trust the projection.`)
  if (regime?.currentLabel) reasons.push(`${regime.currentLabel} regime — ${gridFit.reason.replace(/\.$/, '')}.`)

  if (pnlOk && spacingOk && regimeOk && enoughTrades) {
    kind = 'trade'
  } else if (!pnlOk || spacingMultiple < 1 || (!regimeOk && best.totalReturnPct < 0)) {
    kind = 'avoid'
  } else {
    kind = 'wait'
  }

  const headline =
    kind === 'trade'
      ? 'Grid setup looks deployable — fees covered, regime supports it'
      : kind === 'avoid'
      ? "Don't deploy — fees, regime, or PnL don't support it"
      : 'Borderline — tighten range or wait for the regime to flip'

  const verdict: VerdictResult = { kind, headline, reasons }

  // ── 4 tiles ────────────────────────────────────────────────────────────────
  const regimeTone: Tone = regimeOk ? 'gain' : 'warn'
  const pnlTone: Tone = best.totalPnl >= 0 ? (best.totalReturnPct >= 5 ? 'gain' : 'warn') : 'loss'
  const tradesTone: Tone = tradesPerDay >= 2 ? 'gain' : tradesPerDay >= 0.5 ? 'warn' : 'loss'
  const spacingTone: Tone = spacingOk ? 'gain' : spacingTight ? 'warn' : 'loss'

  return (
    <div className="flex flex-col gap-3">
      <VerdictBadge verdict={verdict} />

      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-dim font-display">
            Grid Confidence Strip
          </h3>
          <span className="text-[10px] text-dim">
            {market.verdict} fit · suitability {market.score.toFixed(0)}/100
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile
            compact
            question="Does the regime support grids?"
            info="Grids harvest oscillation in Sideways markets and bleed against trends. A trending regime (Bull or Bear) accumulates inventory against the move."
            value={regime?.currentLabel ?? '—'}
            tone={regimeTone}
            sub={gridFit.reason}
          />
          <StatTile
            compact
            question="How much would the best grid have earned?"
            info="Strategy Return"
            value={`${best.totalReturnPct >= 0 ? '+' : ''}${best.totalReturnPct.toFixed(1)}%`}
            tone={pnlTone}
            bar={{
              fill: Math.min(100, Math.abs(best.totalReturnPct) * 5),
              tone: pnlTone,
            }}
            sub={`${best.gridCount} grids · ${fmtUsd(best.totalPnl)} on this window`}
          />
          <StatTile
            compact
            question="How often would it trade?"
            info="The number of completed buy→sell roundtrips per day on this window. Higher = more frequent compounding, but also more fee burn if spacing is tight."
            value={`${tradesPerDay.toFixed(1)}/day`}
            tone={tradesTone}
            sub={`${best.completedTrades} roundtrip${best.completedTrades === 1 ? '' : 's'} across ${durationDays.toFixed(0)} day${durationDays === 1 ? '' : 's'}`}
          />
          <StatTile
            compact
            question="Are fees covered per cell?"
            info="Spacing ÷ Breakeven"
            value={`${spacingMultiple.toFixed(1)}×`}
            tone={spacingTone}
            bar={{ fill: Math.min(100, (spacingMultiple / 5) * 100), tone: spacingTone }}
            sub={`Spacing ${best.spacingPct.toFixed(2)}% vs ${breakevenPct.toFixed(2)}% breakeven`}
          />
        </div>
      </div>
    </div>
  )
}
