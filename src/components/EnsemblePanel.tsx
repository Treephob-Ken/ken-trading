import { useState, useMemo } from 'react'
import type { Candle, StrategyId } from '@/types'
import { STRATEGIES, strategyMeta } from '@/lib/strategies'
import { runEnsemble, type EnsembleConfig } from '@/lib/ensemble'
import type { RegimeAnalysis } from '@/lib/markov'
import InfoTip from '@/components/InfoTip'
import { Check, ShieldAlert } from 'lucide-react'

interface Props {
  candles: Candle[]
  regime: RegimeAnalysis | null
  activeStrategyId: StrategyId
  ensembleActive: boolean
  onToggleEnsemble: (active: boolean) => void
  onApplyEnsembleConfig: (strategies: StrategyId[], config: EnsembleConfig) => void
}

export default function EnsemblePanel({
  candles,
  regime,
  activeStrategyId: _activeStrategyId,
  ensembleActive,
  onToggleEnsemble,
  onApplyEnsembleConfig,
}: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [selectedIds, setSelectedIds] = useState<StrategyId[]>(['macd', 'ema', 'supertrend', 'rsi', 'bollinger'])
  const [mode, setMode] = useState<'vote' | 'weighted'>('vote')
  const [threshold, setThreshold] = useState(3)
  const [useRegimeWeights, setUseRegimeWeights] = useState(true)

  // Compute ensemble signals for the last 100 candles for heatmap preview
  const previewData = useMemo(() => {
    if (candles.length < 10) return null
    const config: EnsembleConfig = {
      mode,
      threshold,
      regimeWeights: useRegimeWeights,
    }
    const { signals, strategyOutputs } = runEnsemble(candles, selectedIds, config, regime)
    
    // Slice last 80 candles for preview
    const len = candles.length
    const previewLen = Math.min(len, 80)
    const indices = Array.from({ length: previewLen }, (_, i) => len - previewLen + i)
    
    const strategiesPreview = selectedIds.map(id => {
      const out = strategyOutputs.get(id)
      const sigs = out ? indices.map(i => out.signals[i]) : Array(previewLen).fill(null)
      return { id, name: strategyMeta(id).name, sigs }
    })

    const combinedSigs = indices.map(i => signals[i])

    return {
      strategies: strategiesPreview,
      combined: combinedSigs,
      timestamps: indices.map(i => candles[i].time),
    }
  }, [candles, selectedIds, mode, threshold, useRegimeWeights, regime])

  const handleToggleStrategy = (id: StrategyId) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id)
      } else {
        return [...prev, id]
      }
    })
  }

  const handleApply = () => {
    const config: EnsembleConfig = {
      mode,
      threshold,
      regimeWeights: useRegimeWeights,
    }
    onApplyEnsembleConfig(selectedIds, config)
    onToggleEnsemble(true)
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div 
        className="flex cursor-pointer items-center justify-between border-b border-border bg-panel/30 px-4 py-3 hover:bg-panel/50"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text">
            Multi-Strategy Ensemble <InfoTip term="Ensemble" />
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
            ensembleActive 
              ? 'bg-gain/20 text-gain border border-gain/30' 
              : 'bg-panel-2 text-dim border border-border'
          }`}>
            {ensembleActive ? 'Active' : 'Disabled'}
          </span>
        </div>
        <button className="text-xs text-dim hover:text-text">
          {isOpen ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {isOpen && (
        <div className="p-4 space-y-5 animate-in">
          {/* Controls */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {/* Strategy Selector */}
            <div className="space-y-2 md:col-span-2">
              <span className="text-xs font-medium text-dim">
                Include Strategies ({selectedIds.length} selected)
              </span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {STRATEGIES.map(s => {
                  const active = selectedIds.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleToggleStrategy(s.id)}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                        active
                          ? 'border-accent/40 bg-accent/5 text-text'
                          : 'border-border bg-panel/20 text-dim hover:border-border-2 hover:bg-panel/40'
                      }`}
                    >
                      <span className="truncate">{s.name}</span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Voting Config */}
            <div className="space-y-4 rounded-lg bg-panel/20 p-3 border border-border/50">
              <div className="space-y-2">
                <span className="flex items-center justify-between text-xs font-medium text-dim">
                  <span>Ensemble Mode <InfoTip term="Vote Mode" /></span>
                </span>
                <div className="grid grid-cols-2 gap-1 rounded-md bg-panel p-0.5">
                  <button
                    onClick={() => setMode('vote')}
                    className={`rounded py-1 text-center text-xs font-medium transition-all ${
                      mode === 'vote'
                        ? 'bg-panel-2 text-text shadow-sm'
                        : 'text-dim hover:text-text'
                    }`}
                  >
                    Vote
                  </button>
                  <button
                    onClick={() => setMode('weighted')}
                    className={`rounded py-1 text-center text-xs font-medium transition-all ${
                      mode === 'weighted'
                        ? 'bg-panel-2 text-text shadow-sm'
                        : 'text-dim hover:text-text'
                    }`}
                  >
                    Weighted
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs font-medium text-dim">
                  <span>Consensus Threshold <InfoTip term="Threshold" /></span>
                  <span className="font-mono text-text">{threshold}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max={Math.max(1, selectedIds.length)}
                  step="1"
                  value={threshold}
                  onChange={e => setThreshold(Number(e.target.value))}
                  className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-border accent-accent"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs font-medium text-dim">
                  <span>Regime Weights <InfoTip term="Regime Weights" /></span>
                </span>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={useRegimeWeights}
                    onChange={e => setUseRegimeWeights(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="peer h-5 w-9 rounded-full bg-border after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-text after:transition-all after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-full peer-focus:outline-none" />
                </label>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-4">
            <button
              onClick={handleApply}
              disabled={selectedIds.length === 0}
              className={`rounded-lg px-4 py-2 text-xs font-semibold shadow-sm transition-all ${
                selectedIds.length === 0
                  ? 'bg-panel-2 text-dim cursor-not-allowed border border-border'
                  : 'bg-accent text-white hover:bg-accent-2'
              }`}
            >
              Apply Ensemble to Backtester
            </button>
            {ensembleActive && (
              <button
                onClick={() => onToggleEnsemble(false)}
                className="rounded-lg border border-border bg-panel-2 px-4 py-2 text-xs font-semibold text-text hover:bg-panel hover:border-border-2 transition-all"
              >
                Disable Ensemble
              </button>
            )}
            {selectedIds.length === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-loss">
                <ShieldAlert className="h-4 w-4" />
                Select at least one strategy to build the ensemble.
              </div>
            )}
          </div>

          {/* Heatmap Preview */}
          {previewData && previewData.strategies.length > 0 && (
            <div className="border-t border-border/40 pt-4 space-y-3">
              <span className="block text-xs font-medium text-dim">
                Real-Time Consensus Heatmap (Last {previewData.combined.length} bars)
              </span>
              
              <div className="overflow-x-auto rounded-lg border border-border bg-panel/10 p-3">
                <div className="min-w-[640px] space-y-2">
                  {previewData.strategies.map(s => (
                    <div key={s.id} className="flex items-center text-[10px]">
                      <div className="w-32 font-mono text-dim truncate pr-2">{s.name}</div>
                      <div className="flex flex-1 gap-1">
                        {s.sigs.map((sig, idx) => (
                          <div
                            key={idx}
                            className={`h-3 flex-1 rounded-[1px] transition-colors ${
                              sig === 'buy'
                                ? 'bg-gain/60'
                                : sig === 'sell'
                                ? 'bg-loss/60'
                                : 'bg-border/20'
                            }`}
                            title={`${s.name} at bar ${idx}: ${sig ?? 'no signal'}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Combined row */}
                  <div className="flex items-center text-[10px] border-t border-border/50 pt-2 font-semibold">
                    <div className="w-32 font-mono text-text truncate pr-2">Ensemble Signal</div>
                    <div className="flex flex-1 gap-1">
                      {previewData.combined.map((sig, idx) => (
                        <div
                          key={idx}
                          className={`h-4 flex-1 rounded-[1px] transition-all ${
                            sig === 'buy'
                              ? 'bg-gain animate-pulse shadow-sm shadow-gain/35'
                              : sig === 'sell'
                              ? 'bg-loss animate-pulse shadow-sm shadow-loss/35'
                              : 'bg-border/40'
                          }`}
                          title={`Ensemble Signal at bar ${idx}: ${sig ?? 'no signal'}`}
                        />
                      ))}
                    </div>
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
