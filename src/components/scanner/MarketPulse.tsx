// Market Pulse — the "what's the market doing right now + which kind of
// strategy fits" panel that sits at the top of the Scanner Indicator tab.
//
// Reads from a finished scan via `recommendForMarket(rows)`. Renders nothing
// until at least a few rows are available, so it doesn't flash empty state
// during a fresh scan.

import { Activity, ArrowRight, Sparkles, TrendingDown, TrendingUp, Waves } from 'lucide-react'
import type { IndicatorScanRow } from '@/lib/scanner/indicatorScan'
import { recommendForMarket, type RecommendedType } from '@/lib/scanner/marketRecommendation'
import { gradeBg, gradeIndicatorRow } from '@/lib/scanner/verdict'

interface Props {
  rows: IndicatorScanRow[]
  onPick: (row: IndicatorScanRow) => void
}

const TYPE_LABELS: Record<RecommendedType, { title: string; icon: React.ReactNode; tone: string }> = {
  trend:           { title: 'Trend-following',     icon: <TrendingUp className="h-4 w-4" />,   tone: 'text-gain' },
  'mean-reversion':{ title: 'Mean-reversion',      icon: <Waves className="h-4 w-4" />,        tone: 'text-brand' },
  mixed:           { title: 'Confluence-only',     icon: <Sparkles className="h-4 w-4" />,     tone: 'text-warn' },
  defensive:       { title: 'Defensive (or wait)', icon: <TrendingDown className="h-4 w-4" />, tone: 'text-loss' },
}

export default function MarketPulse({ rows, onPick }: Props) {
  // Hide until the scan has surfaced enough data to be meaningful.
  if (rows.length < 5) return null

  const rec = recommendForMarket(rows)
  const known = rec.universe.bull + rec.universe.sideways + rec.universe.bear
  if (known === 0) return null

  const bullPct = (rec.universe.bull / known) * 100
  const sidewaysPct = (rec.universe.sideways / known) * 100
  const bearPct = (rec.universe.bear / known) * 100

  const meta = TYPE_LABELS[rec.recommendedType]

  return (
    <div className="card p-4 flex flex-col gap-3">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-brand" />
        <span className="text-xs font-semibold text-text">Market Pulse</span>
        <span className="text-[10px] text-dim">
          · {known} pairs analysed
        </span>
      </div>

      {/* ── BTC headline + universe breakdown ───────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        {rec.btcRegime && (
          <div className="rounded-lg border border-border bg-panel-2 p-3">
            <div className="text-[10px] uppercase tracking-wider text-dim mb-1">
              BTC {rec.btcTimeframe}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-base font-bold font-mono ${
                  rec.btcRegime === 'Bull' ? 'text-gain'
                  : rec.btcRegime === 'Bear' ? 'text-loss'
                  : 'text-warn'
                }`}
              >
                {rec.btcRegime}
              </span>
              <span className="text-[11px] text-dim">
                conviction {Math.round(rec.btcConviction * 100)}%
              </span>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-panel-2 p-3">
          <div className="text-[10px] uppercase tracking-wider text-dim mb-1.5">
            Universe regime
          </div>
          {/* Stacked bar */}
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-panel">
            {bullPct > 0 && <div className="bg-gain" style={{ width: `${bullPct}%` }} />}
            {sidewaysPct > 0 && <div className="bg-warn" style={{ width: `${sidewaysPct}%` }} />}
            {bearPct > 0 && <div className="bg-loss" style={{ width: `${bearPct}%` }} />}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] font-mono">
            <span className="text-gain">{bullPct.toFixed(0)}% bull</span>
            <span className="text-warn">{sidewaysPct.toFixed(0)}% range</span>
            <span className="text-loss">{bearPct.toFixed(0)}% bear</span>
          </div>
        </div>
      </div>

      {/* ── Recommendation banner ───────────────────────────────────────── */}
      <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className={meta.tone}>{meta.icon}</span>
          <span className="text-[10px] uppercase tracking-wider text-dim">Recommended type</span>
          <span className={`text-xs font-bold ${meta.tone}`}>{meta.title}</span>
        </div>
        <p className="text-[11px] text-text leading-relaxed">{rec.reason}</p>
      </div>

      {/* ── Top 3 picks (regime-filtered) ───────────────────────────────── */}
      {rec.topPicks.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-dim mb-2">
            Top picks for now (filtered to fit regime)
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {rec.topPicks.map((r, i) => {
              const v = gradeIndicatorRow(r)
              return (
                <button
                  key={`${r.symbol}-${r.timeframe}-${r.strategyId}`}
                  type="button"
                  onClick={() => onPick(r)}
                  className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-colors hover:border-brand/60 ${gradeBg(v.grade)}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold">#{i + 1}</span>
                    <ArrowRight className="h-3 w-3" />
                  </div>
                  <div className="font-mono text-xs font-bold">
                    {r.base} · {r.timeframe}
                  </div>
                  <div className="text-[10px] text-dim truncate">{r.strategyName}</div>
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    {typeof r.qualityScore === 'number' && (
                      <span className="font-bold">Score {r.qualityScore.toFixed(0)}</span>
                    )}
                    <span className={r.totalReturnPct >= 0 ? 'text-gain' : 'text-loss'}>
                      {r.totalReturnPct >= 0 ? '+' : ''}{r.totalReturnPct.toFixed(1)}%
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
