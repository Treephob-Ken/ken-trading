import { useMemo } from 'react'
import type { BacktestResult, Candle } from '@/types'
import type { RegimeAnalysis, RegimeLabel } from '@/lib/markov'
import { tradesByRegime, type RegimeBucketStats } from '@/lib/regimeStats'
import InfoTip from '@/components/InfoTip'

interface Props {
  result: BacktestResult
  regime: RegimeAnalysis | null
  candles: Candle[]
}

const REGIME_TONE: Record<RegimeLabel, { dot: string; text: string; bg: string }> = {
  Bull:     { dot: 'bg-gain',  text: 'text-gain',  bg: 'bg-gain/5'  },
  Sideways: { dot: 'bg-warn',  text: 'text-warn',  bg: 'bg-warn/5'  },
  Bear:     { dot: 'bg-loss',  text: 'text-loss',  bg: 'bg-loss/5'  },
}

function pct(n: number, dp = 1) {
  return (n >= 0 ? '+' : '') + n.toFixed(dp) + '%'
}

function pnlToneClass(v: number): string {
  return v > 0 ? 'text-gain' : v < 0 ? 'text-loss' : 'text-muted'
}

export default function RegimeBreakdownCard({ result, regime, candles }: Props) {
  const breakdown = useMemo(() => {
    if (!regime) return null
    return tradesByRegime(result.trades, candles, regime.labels)
  }, [result.trades, candles, regime])

  if (!regime || !breakdown || breakdown.total === 0) return null

  // Display order top → bottom: Bull, Sideways, Bear (matches the visual "up to down" mental model).
  const ordered = [breakdown.buckets[2], breakdown.buckets[1], breakdown.buckets[0]]
  const currentLabel = regime.currentLabel

  // Identify the regime where the strategy works best, for the verdict line under the table.
  const tradedBuckets = ordered.filter((b) => b.count > 0)
  let bestRegime: RegimeBucketStats | null = null
  let worstRegime: RegimeBucketStats | null = null
  for (const b of tradedBuckets) {
    if (!bestRegime || b.avgPnlPct > bestRegime.avgPnlPct) bestRegime = b
    if (!worstRegime || b.avgPnlPct < worstRegime.avgPnlPct) worstRegime = b
  }

  const verdictLine = (() => {
    if (!bestRegime || !worstRegime || tradedBuckets.length < 2) return null
    if (bestRegime.avgPnlPct > 0 && worstRegime.avgPnlPct < 0) {
      return `Edge concentrated in ${bestRegime.label} — bleeds in ${worstRegime.label}. Consider trading this strategy only when regime = ${bestRegime.label}.`
    }
    if (bestRegime.avgPnlPct > 0 && Math.abs(worstRegime.avgPnlPct) < 0.1) {
      return `Best in ${bestRegime.label}. Flat in the other regimes — safe to leave on.`
    }
    if (bestRegime.avgPnlPct < 0) {
      return `Loses money across all observed regimes — try a different strategy.`
    }
    return null
  })()

  return (
    <div className="card defer-render p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text font-display">
          Where does this strategy actually work?
        </h3>
        <InfoTip term="Regime" />
        <span className="ml-auto text-[10px] text-dim">
          {breakdown.total - breakdown.untaggedCount} of {breakdown.total} trades classified
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-panel-2 text-[10px] uppercase tracking-wider text-dim">
              <th className="px-3 py-2 text-left font-medium">Regime</th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">Trades<InfoTip term="Trades" /></span>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">Win Rate<InfoTip term="Win Rate" /></span>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">Avg / trade<InfoTip term="Expectancy" /></span>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">Total<InfoTip term="Strategy Return" /></span>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">PF<InfoTip term="Profit Factor" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((b) => {
              const tone = REGIME_TONE[b.label]
              const isCurrent = b.label === currentLabel
              return (
                <tr
                  key={b.label}
                  className={`border-b border-border/40 last:border-b-0 ${isCurrent ? tone.bg : ''}`}
                >
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                      <span className={`font-medium ${tone.text}`}>{b.label}</span>
                      {isCurrent && (
                        <span className="rounded-full border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[9px] font-semibold text-brand">
                          NOW
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-text">
                    {b.count > 0 ? b.count : <span className="text-dim">0</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {b.count > 0 ? (
                      <span className={b.winRate >= 50 ? 'text-gain' : 'text-loss'}>{b.winRate.toFixed(0)}%</span>
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${b.count > 0 ? pnlToneClass(b.avgPnlPct) : 'text-dim'}`}>
                    {b.count > 0 ? pct(b.avgPnlPct, 2) : '—'}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${b.count > 0 ? pnlToneClass(b.totalPnlPct) : 'text-dim'}`}>
                    {b.count > 0 ? pct(b.totalPnlPct) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {b.count > 0 ? (
                      Number.isFinite(b.profitFactor) ? (
                        <span className={b.profitFactor >= 1 ? 'text-gain' : 'text-loss'}>{b.profitFactor.toFixed(2)}</span>
                      ) : (
                        <span className="text-gain">∞</span>
                      )
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {verdictLine && (
        <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
          <span className="font-semibold text-text">Insight:</span> {verdictLine}
        </p>
      )}
      {breakdown.untaggedCount > 0 && (
        <p className="mt-1 text-[10px] text-dim">
          {breakdown.untaggedCount} early trade{breakdown.untaggedCount !== 1 ? 's' : ''} couldn't be classified — fell before the regime window filled.
        </p>
      )}
    </div>
  )
}
