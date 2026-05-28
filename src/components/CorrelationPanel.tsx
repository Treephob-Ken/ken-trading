import { useState, useEffect, useMemo } from 'react'
import type { Candle, Direction, StrategyId } from '@/types'
import { STRATEGIES, strategyMeta } from '@/lib/strategies'
import { computeCorrelationMatrix, type CorrelationResult } from '@/lib/correlation'
import InfoTip from '@/components/InfoTip'
import { Check, BarChart3, Shuffle, ArrowRight } from 'lucide-react'

interface Props {
  candles: Candle[]
  currentStrategyId: StrategyId
  initialCapital: number
  feePct: number
  direction: Direction
  positionMode: 'fixed' | 'compounding' | 'volatility'
  targetRiskPct: number
  atrMultiplier: number
  onApplyStrategy: (id: StrategyId) => void
  ensembleActive?: boolean
  ensembleStrategies?: StrategyId[]
}

const SHORT_NAMES: Record<StrategyId, string> = {
  macd: 'MACD',
  ema: 'EMA',
  sma: 'SMA',
  supertrend: 'SUP',
  psar: 'PSAR',
  donchian: 'DON',
  rsi: 'RSI',
  stochastic: 'STOCH',
  stochrsi: 'S-RSI',
  cci: 'CCI',
  williamsr: 'W%R',
  bollinger: 'BB',
  elliott: 'EW',
  traderxo: 'TXO',
  adx: 'ADX',
  ichimoku: 'ICHI',
}

export default function CorrelationPanel({
  candles,
  currentStrategyId,
  initialCapital,
  feePct,
  direction,
  positionMode,
  targetRiskPct,
  atrMultiplier,
  onApplyStrategy,
  ensembleActive = false,
  ensembleStrategies = [],
}: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [result, setResult] = useState<CorrelationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [hoveredCell, setHoveredCell] = useState<{ rowId: StrategyId; colId: StrategyId; val: number } | null>(null)

  // Reset results when inputs that change backtests are modified
  useEffect(() => {
    setResult(null)
    setHoveredCell(null)
  }, [candles.length, initialCapital, feePct, direction, positionMode, targetRiskPct, atrMultiplier])

  const highCorrPairs = useMemo(() => {
    const pairs: { s1: StrategyId; s2: StrategyId; val: number }[] = []
    if (ensembleActive && ensembleStrategies && result) {
      const activeIds = ensembleStrategies.filter((id) => result.ids.includes(id))
      for (let i = 0; i < activeIds.length; i++) {
        for (let j = i + 1; j < activeIds.length; j++) {
          const id1 = activeIds[i]
          const id2 = activeIds[j]
          const idx1 = result.ids.indexOf(id1)
          const idx2 = result.ids.indexOf(id2)
          const val = result.matrix[idx1][idx2]
          if (val > 0.50) {
            pairs.push({ s1: id1, s2: id2, val })
          }
        }
      }
    }
    return pairs
  }, [ensembleActive, ensembleStrategies, result])

  const handleCompute = () => {
    setLoading(true)
    // Run async-like via setTimeout to let loading state render
    setTimeout(() => {
      try {
        const matrixRes = computeCorrelationMatrix(candles, STRATEGIES.map((s) => s.id), {
          initialCapital,
          feeRate: feePct / 100,
          direction,
          positionMode,
          targetRiskPct,
          atrMultiplier,
        })
        setResult(matrixRes)
      } catch (err) {
        console.error('Failed to compute correlation matrix:', err)
      } finally {
        setLoading(false)
      }
    }, 50)
  }

  const getCellStyles = (val: number, isDiag: boolean) => {
    if (isDiag) {
      return {
        bg: 'rgba(255, 255, 255, 0.08)',
        text: 'text-text/80',
      }
    }

    if (val >= 0.5) {
      // High positive correlation (bad for diversification) - Reddish
      const intensity = Math.min(1, (val - 0.5) / 0.5)
      return {
        bg: `rgba(239, 68, 68, ${0.05 + intensity * 0.2})`,
        text: 'text-loss font-semibold',
      }
    } else if (val <= -0.2) {
      // Negative correlation (great for diversification) - Blueish
      const intensity = Math.min(1, Math.abs(val) / 0.8)
      return {
        bg: `rgba(59, 130, 246, ${0.05 + intensity * 0.2})`,
        text: 'text-brand font-semibold',
      }
    } else {
      // Uncorrelated (neutral to slightly negative/positive) - Greenish
      const intensity = 1 - Math.abs(val) / 0.5
      return {
        bg: `rgba(16, 185, 129, ${0.03 + intensity * 0.12})`,
        text: 'text-gain font-medium',
      }
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between border-b border-border bg-panel/30 px-4 py-3 hover:bg-panel/50"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text flex items-center gap-1.5 font-display">
            <Shuffle className="h-4 w-4 text-brand" />
            Strategy Correlation Matrix <InfoTip term="Correlation" />
          </span>
          {result && (
            <span className="rounded-full bg-gain/15 border border-gain/30 px-2 py-0.5 text-[10px] font-medium text-gain">
              Analyzed
            </span>
          )}
        </div>
        <button className="text-xs text-dim hover:text-text">
          {isOpen ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {isOpen && (
        <div className="p-4 space-y-6 animate-in">
          {/* Main call to action if no result */}
          {!result && !loading && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <p className="max-w-md text-xs text-dim mb-4">
                Compute the cross-correlation of daily returns across all 13 built-in strategies on this asset and timeframe. This will run 13 parallel backtests to find the least-correlated strategies for optimal portfolio diversification.
              </p>
              <button onClick={handleCompute} className="btn-primary flex items-center gap-1.5">
                <Shuffle className="h-3.5 w-3.5" />
                Compare All Strategies
              </button>
            </div>
          )}

          {loading && (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <p className="text-xs text-dim">Simulating all 13 strategies and computing correlation matrix...</p>
            </div>
          )}

          {result && !loading && (
            <div className="space-y-6">
              {/* Ensemble Correlation Safety Warning Alert */}
              {highCorrPairs.length > 0 && (
                <div className="rounded-lg border border-warn/30 bg-warn/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-warn font-semibold text-xs uppercase tracking-wider font-display">
                    <span>⚠️ Ensemble Correlation Alert</span>
                  </div>
                  <p className="text-[11px] text-dim leading-relaxed">
                    Your active Multi-Strategy Ensemble contains strategies with high positive correlation (&gt; 0.50). This reduces diversification and can cause simultaneous false entries:
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {highCorrPairs.map((pair: { s1: StrategyId; s2: StrategyId; val: number }, idx: number) => (
                      <span key={idx} className="rounded bg-warn/10 border border-warn/25 px-2 py-0.5 text-[10px] text-warn font-mono">
                        {SHORT_NAMES[pair.s1]} + {SHORT_NAMES[pair.s2]} ({pair.val > 0 ? `+${pair.val.toFixed(2)}` : pair.val.toFixed(2)})
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-dim leading-relaxed pt-1">
                    <em>Diversification Tip:</em> Try replacing one of them with uncorrelated options like{' '}
                    <strong>Donchian Channels (DON)</strong> or <strong>Williams %R (W%R)</strong> as suggested by the rankings below.
                  </p>
                </div>
              )}

              {/* Interactive Inspector + Heatmap Grid */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-dim font-display">
                    Correlation Heatmap
                  </span>
                  <span className="text-[10px] text-dim/60">Hover cells to inspect correlation details</span>
                </div>

                {/* Live Inspector card */}
                <div className="rounded-lg border border-border bg-panel-2/30 p-3 min-h-[64px] flex flex-col justify-center transition-all duration-200">
                  {hoveredCell ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-text">
                            {strategyMeta(hoveredCell.rowId).name}
                          </span>
                          <span className="text-[10px] text-dim">vs</span>
                          <span className="text-xs font-bold text-text">
                            {strategyMeta(hoveredCell.colId).name}
                          </span>
                        </div>
                        <span className={`font-mono text-xs font-bold ${getCellStyles(hoveredCell.val, hoveredCell.rowId === hoveredCell.colId).text}`}>
                          {hoveredCell.rowId === hoveredCell.colId ? '1.00 (Self)' : hoveredCell.val > 0 ? `+${hoveredCell.val.toFixed(2)}` : hoveredCell.val.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted leading-relaxed">
                        {hoveredCell.rowId === hoveredCell.colId ? (
                          "A strategy compared to itself is always perfectly correlated (1.00)."
                        ) : hoveredCell.val >= 0.5 ? (
                          `⚠️ High positive correlation. These two strategies trend and exit together. Combining them increases risk without providing diversification.`
                        ) : hoveredCell.val <= -0.2 ? (
                          `✨ Excellent negative correlation. These strategies tend to take opposite or complementary positions, smoothing out drawdowns.`
                        ) : (
                          `✓ Uncorrelated or weakly correlated. Excellent for portfolio diversification. Their equity peaks and troughs occur at different times.`
                        )}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-dim italic text-center py-1">
                      Hover over any matrix cell below to view detailed correlation statistics and advice.
                    </p>
                  )}
                </div>

                <div className="overflow-x-auto rounded-lg border border-border bg-panel">
                  <div className="min-w-[680px]">
                    <table className="w-full border-collapse font-mono text-[10px]">
                      <thead>
                        <tr className="sticky top-0 z-20">
                          <th className="sticky top-0 left-0 z-30 bg-panel px-3 py-2 text-left text-dim font-medium w-28 border-r border-b border-border/40">Strategy</th>
                          {result.ids.map((id) => (
                            <th
                              key={id}
                              className="sticky top-0 z-20 px-1 py-2 text-center text-dim font-medium w-10 bg-panel border-b border-border/40"
                              title={strategyMeta(id).name}
                            >
                              {SHORT_NAMES[id]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.ids.map((rowId, rowIdx) => (
                          <tr key={rowId} className="group border-b border-border/20 last:border-0 hover:bg-panel-2/40">
                            <td
                              className={`sticky left-0 z-10 bg-panel transition-colors group-hover:bg-panel-2 px-3 py-2 text-left font-sans font-medium truncate w-28 border-r border-b border-border/20 border-border/40 ${
                                rowId === currentStrategyId ? 'text-text font-bold' : 'text-dim'
                              }`}
                              title={strategyMeta(rowId).name}
                            >
                              {strategyMeta(rowId).name}
                            </td>
                            {result.ids.map((colId, colIdx) => {
                              const val = result.matrix[rowIdx][colIdx]
                              const isDiag = rowIdx === colIdx
                              const styles = getCellStyles(val, isDiag)
                              return (
                                <td
                                  key={colId}
                                  style={{ backgroundColor: styles.bg }}
                                  className={`px-1 py-2 text-center border border-border/20 tabular-nums cursor-pointer transition-all hover:brightness-125 hover:scale-105 duration-100 ${styles.text}`}
                                  onMouseEnter={() => setHoveredCell({ rowId, colId, val })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                  title={`Correlation between ${strategyMeta(rowId).name} and ${
                                    strategyMeta(colId).name
                                  }: ${val.toFixed(2)}`}
                                >
                                  {isDiag ? '1.0' : val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>


              {/* Diversified Portfolio Recommendations */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="md:col-span-1 rounded-lg border border-gain/30 bg-gain/5 p-4 space-y-3">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-gain flex items-center gap-1.5">
                    <Check className="h-4 w-4" />
                    Best Diversified Portfolio
                  </span>
                  <p className="text-[11px] text-dim leading-relaxed">
                    Greedily selected starting with the top performing strategy, adding others only if their pairwise correlation is <strong>&lt; 0.5</strong>.
                  </p>
                  <div className="space-y-2 pt-1">
                    {result.bestUncorrelated.map((id) => (
                      <button
                        key={id}
                        onClick={() => onApplyStrategy(id)}
                        className={`w-full flex items-center justify-between rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-left text-xs hover:border-brand/40 transition-all ${
                          id === currentStrategyId ? 'border-brand/60 ring-1 ring-brand/40 bg-brand/5' : ''
                        }`}
                      >
                        <span className="truncate font-medium text-text">{strategyMeta(id).name}</span>
                        <div className="flex items-center gap-1.5 shrink-0 text-dim">
                          <span className="font-mono text-[10px]">
                            Sharpe: {result.sharpes[id].toFixed(2)}
                          </span>
                          <ArrowRight className="h-3 w-3" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Strategy Rankings Table */}
                <div className="md:col-span-2 space-y-2">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-dim flex items-center gap-1">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Strategy Comparison &amp; Correlation with Active Strategy
                  </span>
                  <div className="overflow-x-auto rounded-lg border border-border bg-panel">
                    <table className="w-full text-left font-mono text-[11px] min-w-[500px]">
                      <thead>
                        <tr className="bg-panel-2 border-b border-border text-dim font-medium">
                          <th className="px-3 py-2 font-sans">Strategy</th>
                          <th className="px-3 py-2 text-right">Sharpe</th>
                          <th className="px-3 py-2 text-right">Max DD</th>
                          <th className="px-3 py-2 text-right font-sans">Correlation with Active</th>
                          <th className="px-3 py-2 text-center font-sans">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {result.ids
                          .map((id) => ({
                            id,
                            name: strategyMeta(id).name,
                            sharpe: result.sharpes[id],
                            drawdown: result.drawdowns[id],
                            correlation:
                              result.matrix[result.ids.indexOf(id)][
                                result.ids.indexOf(currentStrategyId)
                              ],
                          }))
                          .sort((a, b) => b.sharpe - a.sharpe)
                          .map((item) => {
                            const isCurrent = item.id === currentStrategyId
                            const isDiag = item.id === currentStrategyId
                            const corrStyles = getCellStyles(item.correlation, isDiag)
                            return (
                              <tr
                                key={item.id}
                                className={`hover:bg-panel-2/60 ${
                                  isCurrent ? 'bg-brand/5 border-l-2 border-l-brand' : ''
                                }`}
                              >
                                <td className="px-3 py-2 font-sans font-medium text-text truncate max-w-[140px]">
                                  {item.name}
                                </td>
                                <td className="px-3 py-2 text-right text-text tabular-nums">
                                  {item.sharpe.toFixed(2)}
                                </td>
                                <td className="px-3 py-2 text-right text-loss tabular-nums">
                                  -{item.drawdown.toFixed(1)}%
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  <span
                                    style={{
                                      backgroundColor: isDiag ? 'transparent' : corrStyles.bg,
                                      padding: isDiag ? '0' : '2px 6px',
                                      borderRadius: '4px',
                                    }}
                                    className={isDiag ? 'text-dim' : corrStyles.text}
                                  >
                                    {isDiag
                                      ? 'Active (1.0)'
                                      : item.correlation > 0
                                      ? `+${item.correlation.toFixed(2)}`
                                      : item.correlation.toFixed(2)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {isCurrent ? (
                                    <span className="text-[10px] text-brand font-medium">Selected</span>
                                  ) : (
                                    <button
                                      onClick={() => onApplyStrategy(item.id)}
                                      className="rounded bg-panel-2 border border-border px-2 py-0.5 text-[10px] text-text hover:border-brand/40 hover:bg-panel transition-all"
                                    >
                                      Select
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
