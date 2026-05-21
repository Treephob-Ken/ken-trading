import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, Info } from 'lucide-react'
import type { Candle } from '@/types'
import { fetchKlines, type SymbolInfo } from '@/lib/binance'
import {
  buildCenteredGrid,
  classifyLines,
  optimizeGrid,
  type GridMode,
  type GridParams,
  type GridType,
} from '@/lib/grid'
import { fmtPrice, fmtUsd } from '@/lib/format'
import { analyzeRegime, isGoodForGrid } from '@/lib/markov'
import { getMultiTFConfluence } from '@/lib/multiTF'
import GridChart from '@/components/GridChart'
import GridControls from '@/components/GridControls'
import GridStats from '@/components/GridStats'
import NumberInput from '@/components/NumberInput'

interface Props {
  symbol: string
  timeframe: string
  symbols: SymbolInfo[]
  onSymbol: (v: string) => void
  onTimeframe: (v: string) => void
}

export default function GridPage({
  symbol,
  timeframe,
  symbols,
  onSymbol,
  onTimeframe,
}: Props) {
  const [lookback, setLookback] = useState(() => +(localStorage.getItem('gd_lookback') || '150'))
  const [mode, setMode] = useState<GridMode>(() => (localStorage.getItem('gd_mode') as GridMode) || 'arithmetic')
  const [gridType, setGridType] = useState<GridType>(() => (localStorage.getItem('gd_gridType') as GridType) || 'neutral')
  const [minGrids, setMinGrids] = useState(() => +(localStorage.getItem('gd_minGrids') || '3'))
  const [maxGrids, setMaxGrids] = useState(() => +(localStorage.getItem('gd_maxGrids') || '50'))
  const [feePct, setFeePct] = useState(() => +(localStorage.getItem('gd_feePct') || '0.05'))
  const [investment, setInvestment] = useState(() => +(localStorage.getItem('gd_investment') || '500'))
  const [reanchor, setReanchor] = useState(() => localStorage.getItem('gd_reanchor') !== 'false')

  // Deploy-only settings (used by Export to Bot)
  const [botName, setBotName] = useState(() => localStorage.getItem('gd_botName') || '')
  const [leverage, setLeverage] = useState(() => +(localStorage.getItem('gd_leverage') || '1'))
  const [slPct, setSlPct] = useState(() => +(localStorage.getItem('gd_slPct') || '2'))
  const [tpPct, setTpPct] = useState(() => +(localStorage.getItem('gd_tpPct') || '2'))
  const [useTrigger, setUseTrigger] = useState(() => localStorage.getItem('gd_useTrigger') === 'true')
  const [useManualSize, setUseManualSize] = useState(() => localStorage.getItem('gd_useManualSize') === 'true')
  const [manualSize, setManualSize] = useState(() => +(localStorage.getItem('gd_manualSize') || '0.01'))

  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    localStorage.setItem('gd_lookback', String(lookback))
  }, [lookback])
  useEffect(() => {
    localStorage.setItem('gd_mode', mode)
  }, [mode])
  useEffect(() => {
    localStorage.setItem('gd_gridType', gridType)
  }, [gridType])
  useEffect(() => {
    localStorage.setItem('gd_minGrids', String(minGrids))
  }, [minGrids])
  useEffect(() => {
    localStorage.setItem('gd_maxGrids', String(maxGrids))
  }, [maxGrids])
  useEffect(() => {
    localStorage.setItem('gd_feePct', String(feePct))
  }, [feePct])
  useEffect(() => {
    localStorage.setItem('gd_investment', String(investment))
  }, [investment])
  useEffect(() => {
    localStorage.setItem('gd_reanchor', String(reanchor))
  }, [reanchor])
  useEffect(() => {
    localStorage.setItem('gd_botName', botName)
  }, [botName])
  useEffect(() => {
    localStorage.setItem('gd_leverage', String(leverage))
  }, [leverage])
  useEffect(() => {
    localStorage.setItem('gd_slPct', String(slPct))
  }, [slPct])
  useEffect(() => {
    localStorage.setItem('gd_tpPct', String(tpPct))
  }, [tpPct])
  useEffect(() => {
    localStorage.setItem('gd_useTrigger', String(useTrigger))
  }, [useTrigger])
  useEffect(() => {
    localStorage.setItem('gd_useManualSize', String(useManualSize))
  }, [useManualSize])
  useEffect(() => {
    localStorage.setItem('gd_manualSize', String(manualSize))
  }, [manualSize])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchKlines({ symbol, interval: timeframe })
      .then((data) => {
        if (cancelled) return
        setCandles(data)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setCandles([])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [symbol, timeframe, reloadKey])

  // Auto-suggest grid type based on higher timeframe confluence when symbol/timeframe changes
  useEffect(() => {
    if (candles.length < 30) return
    getMultiTFConfluence(symbol, timeframe, candles)
      .then((res) => {
        if (res && res.suggestedGridType) {
          setGridType(res.suggestedGridType)
        }
      })
      .catch(() => {})
  }, [symbol, timeframe, candles.length])

  const bars = useMemo(
    () => candles.slice(-lookback),
    [candles, lookback],
  )

  const result = useMemo(() => {
    if (bars.length < 20) return null
    const params: GridParams = {
      lookback,
      minGrids,
      maxGrids,
      mode,
      type: gridType,
      investment,
      feeRate: feePct / 100,
    }
    return optimizeGrid(bars, params)
  }, [bars, lookback, minGrids, maxGrids, mode, gridType, investment, feePct])

  const displayLines = useMemo(() => {
    if (!result) return []
    const lines = reanchor
      ? buildCenteredGrid(
          result.anchor,
          result.best.spacing,
          result.best.gridCount,
          mode,
        )
      : result.best.lines
    return classifyLines(lines, result.anchor)
  }, [result, reanchor, mode])

  const chartCandles = useMemo(
    () => candles.slice(-Math.max(lookback + 60, 220)),
    [candles, lookback],
  )

  const pairLabel = symbol.replace(/USDT$/, '/USDT')
  const lastPrice = candles[candles.length - 1]?.close ?? 0

  // Run the Markov regime check over the same lookback window as the optimizer.
  // Grids are mean-reversion bets — only safe in a sideways regime.
  const regimeFit = useMemo(() => {
    if (bars.length < 30) return null
    const a = analyzeRegime(bars)
    return { analysis: a, ...isGoodForGrid(a.currentLabel) }
  }, [bars])

  function exportConfig() {
    if (!result || displayLines.length < 2) return
    const asset = symbol.replace(/USDT$/, '')
    const lower = +displayLines[0].price.toFixed(2)
    const upper = +displayLines[displayLines.length - 1].price.toFixed(2)
    const gridCount = displayLines.length - 1
    // SL/TP are always exported now — every live bot should have safety triggers.
    const cfg: Record<string, unknown> = {
      name: botName || `${asset} ${gridType} grid`,
      asset, lower, upper, gridCount, mode,
      investment, leverage,
      stopLossPrice:   +(lower * (1 - slPct / 100)).toFixed(2),
      takeProfitPrice: +(upper * (1 + tpPct / 100)).toFixed(2),
    }
    if (useManualSize) cfg.orderSize = manualSize
    if (useTrigger) cfg.triggerPrice = lower
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `grid.${asset.toLowerCase()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <main className="mx-auto flex w-full max-w-[2200px] flex-1 flex-col gap-4 px-6 py-5 lg:flex-row">
      <aside className="card relative z-30 h-fit w-full shrink-0 p-4 lg:sticky lg:top-[97px] lg:w-[300px]">
        <GridControls
          symbol={symbol}
          symbols={symbols}
          timeframe={timeframe}
          lookback={lookback}
          mode={mode}
          gridType={gridType}
          minGrids={minGrids}
          maxGrids={maxGrids}
          feePct={feePct}
          investment={investment}
          reanchor={reanchor}
          loading={loading}
          canExport={!!result && displayLines.length >= 2}
          onSymbol={onSymbol}
          onTimeframe={onTimeframe}
          onLookback={setLookback}
          onMode={setMode}
          onGridType={setGridType}
          onMinGrids={setMinGrids}
          onMaxGrids={setMaxGrids}
          onFee={setFeePct}
          onInvestment={setInvestment}
          onReanchor={setReanchor}
          onReload={() => setReloadKey((k) => k + 1)}
          onExport={exportConfig}
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        {regimeFit && (
          <div
            className={`card flex items-center gap-3 border-l-4 p-3 ${
              regimeFit.suitable
                ? 'border-l-gain bg-gain/5'
                : 'border-l-warn bg-warn/5'
            }`}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full font-mono text-sm font-bold ${
                regimeFit.suitable ? 'bg-gain/20 text-gain' : 'bg-warn/20 text-warn'
              }`}
              title={`Markov regime: ${regimeFit.analysis.currentLabel}`}
            >
              {regimeFit.analysis.currentLabel?.[0] ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-text">
                {regimeFit.suitable ? 'Good for grids' : 'Regime mismatch'}{' '}
                <span className="text-xs font-normal text-dim">
                  ({regimeFit.analysis.currentLabel}, {(regimeFit.analysis.persistence * 100).toFixed(0)}% persistence)
                </span>
              </div>
              <p className="text-[11px] text-dim leading-snug">{regimeFit.reason}</p>
            </div>
          </div>
        )}

        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text font-display">
              Grid Optimizer
              <span className="ml-2 text-xs text-dim font-sans font-normal">
                {pairLabel} · {timeframe}
              </span>
            </h2>
            <span className="font-mono text-sm tabular-nums text-text">
              {lastPrice ? fmtPrice(lastPrice) : '—'}
            </span>
          </div>

          {error ? (
            <div className="flex h-[480px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-loss">
                Could not load market data
              </p>
              <p className="max-w-sm text-xs text-dim">{error}</p>
            </div>
          ) : loading && candles.length === 0 ? (
            <div className="flex h-[480px] items-center justify-center text-sm text-dim">
              Loading market data…
            </div>
          ) : (
            <GridChart candles={chartCandles} lines={displayLines} />
          )}
        </div>

        {result ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex flex-col gap-4">
              <SweepChart result={result} />
              <DeployCard
                result={result}
                displayLines={displayLines}
                symbol={symbol}
                mode={mode}
                botName={botName}
                onBotName={setBotName}
                investment={investment}
                onInvestment={setInvestment}
                leverage={leverage}
                onLeverage={setLeverage}
                slPct={slPct}
                onSlPct={setSlPct}
                tpPct={tpPct}
                onTpPct={setTpPct}
                useTrigger={useTrigger}
                onUseTrigger={setUseTrigger}
                useManualSize={useManualSize}
                onUseManualSize={setUseManualSize}
                manualSize={manualSize}
                onManualSize={setManualSize}
                feePct={feePct}
                onExport={exportConfig}
              />
              <HowToAnalyze />
            </div>
            <GridStats
              result={result}
              windowBars={bars.length}
              timeframe={timeframe}
              candles={bars}
            />
          </div>
        ) : (
          !loading &&
          !error && (
            <div className="card p-8 text-center text-sm text-dim">
              Not enough candles to optimize a grid. Try a longer lookback.
            </div>
          )
        )}
      </section>
    </main>
  )
}

import type { GridLine } from '@/lib/grid'

function DeployCard({
  result,
  displayLines,
  symbol,
  mode,
  botName,
  onBotName,
  investment,
  onInvestment,
  leverage,
  onLeverage,
  slPct,
  onSlPct,
  tpPct,
  onTpPct,
  useTrigger,
  onUseTrigger,
  useManualSize,
  onUseManualSize,
  manualSize,
  onManualSize,
  feePct,
  onExport,
}: {
  result: NonNullable<ReturnType<typeof optimizeGrid>>
  displayLines: GridLine[]
  symbol: string
  mode: GridMode
  botName: string
  onBotName: (v: string) => void
  investment: number
  onInvestment: (v: number) => void
  leverage: number
  onLeverage: (v: number) => void
  slPct: number
  onSlPct: (v: number) => void
  tpPct: number
  onTpPct: (v: number) => void
  useTrigger: boolean
  onUseTrigger: (v: boolean) => void
  useManualSize: boolean
  onUseManualSize: (v: boolean) => void
  manualSize: number
  onManualSize: (v: number) => void
  feePct: number
  onExport: () => void
}) {
  if (displayLines.length < 2) return null
  const asset = symbol.replace(/USDT$/, '')
  const lower = displayLines[0].price
  const upper = displayLines[displayLines.length - 1].price
  const gridCount = displayLines.length - 1
  const safety = 0.5
  const derivedSize = (investment * leverage * safety) / (gridCount * upper)
  const orderSize = useManualSize ? manualSize : derivedSize
  const maxNotional = gridCount * orderSize * upper
  const requiredMargin = maxNotional / leverage
  const spacingPct = result.best.spacingPct
  const profitPerGridPct = spacingPct - 2 * feePct
  const slPrice = lower * (1 - slPct / 100)
  const tpPrice = upper * (1 + tpPct / 100)
  const maxRiskPct = (((lower - slPrice) * gridCount * orderSize) / investment) * 100

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-brand/5 px-4 py-3">
        <Download className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-text">Deploy to Bot</h3>
        <span className="ml-auto text-xs text-dim">Step 1 of 2 — export the config</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Bot name */}
        <div>
          <label className="label">Bot name <span className="text-dim font-normal normal-case">(optional)</span></label>
          <input
            type="text"
            value={botName}
            onChange={(e) => onBotName(e.target.value)}
            placeholder={`${asset} ${mode} grid`}
            className="field text-sm"
          />
        </div>

        {/* Range summary */}
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-bg p-3 font-mono text-xs sm:grid-cols-3">
          <div>
            <div className="mb-0.5 text-[10px] text-dim">Asset</div>
            <div className="font-semibold text-text">{asset}</div>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] text-dim">Lower</div>
            <div className="text-text">{lower.toFixed(2)}</div>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] text-dim">Upper</div>
            <div className="text-text">{upper.toFixed(2)}</div>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] text-dim">Grid Count</div>
            <div className="font-semibold text-brand">{gridCount}</div>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] text-dim">Mode</div>
            <div className="text-text capitalize">{mode}</div>
          </div>
          <div>
            <div className="mb-0.5 text-[10px] text-dim">Spacing</div>
            <div className="text-text">{spacingPct.toFixed(2)}%</div>
          </div>
        </div>

        {/* Budget + Leverage */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-dim">Position Sizing</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Budget (USDC)</label>
              <NumberInput
                step={50}
                min={10}
                value={investment}
                onChange={onInvestment}
                className="field font-mono text-sm"
              />
            </div>
            <div>
              <label className="label">Leverage</label>
              <NumberInput
                step={1}
                min={1}
                max={50}
                value={leverage}
                onChange={onLeverage}
                className="field font-mono text-sm"
              />
            </div>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-bg p-2.5">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand"
              checked={useManualSize}
              onChange={(e) => onUseManualSize(e.target.checked)}
            />
            <span className="text-xs font-medium text-text">Override order size</span>
            <NumberInput
              step={0.001}
              min={0.001}
              disabled={!useManualSize}
              value={manualSize}
              onChange={onManualSize}
              className="field ml-auto w-24 font-mono text-xs disabled:opacity-40"
            />
            <span className="text-[11px] text-dim">{asset}</span>
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-border bg-bg p-3 font-mono text-xs">
            <div>
              <div className="mb-0.5 text-[10px] text-dim">Order size / grid</div>
              <div className="text-text">{orderSize.toFixed(5)} {asset}</div>
            </div>
            <div>
              <div className="mb-0.5 text-[10px] text-dim">Margin needed</div>
              <div className="text-text">${requiredMargin.toFixed(0)} USDC</div>
            </div>
            <div>
              <div className="mb-0.5 text-[10px] text-dim">Max notional</div>
              <div className="text-text">${maxNotional.toFixed(0)}</div>
            </div>
            <div>
              <div className="mb-0.5 text-[10px] text-dim">Est profit / grid</div>
              <div className={profitPerGridPct > 0 ? 'text-gain' : 'text-loss'}>
                {profitPerGridPct >= 0 ? '+' : ''}{profitPerGridPct.toFixed(3)}%
              </div>
            </div>
          </div>
        </div>

        {/* Safety triggers */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-dim">
            Safety Triggers <span className="font-normal normal-case text-dim/70">(always included in export)</span>
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-3 rounded-lg border border-loss/30 bg-loss/5 p-2.5">
              <span className="text-xs font-semibold text-loss">Stop Loss</span>
              <NumberInput
                step={0.5}
                min={0.1}
                value={slPct}
                onChange={onSlPct}
                className="field w-20 font-mono text-xs"
              />
              <span className="text-[11px] text-dim">% below lower</span>
              <span className="ml-auto font-mono text-xs text-loss">@ ${slPrice.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-gain/30 bg-gain/5 p-2.5">
              <span className="text-xs font-semibold text-gain">Take Profit</span>
              <NumberInput
                step={0.5}
                min={0.1}
                value={tpPct}
                onChange={onTpPct}
                className="field w-20 font-mono text-xs"
              />
              <span className="text-[11px] text-dim">% above upper</span>
              <span className="ml-auto font-mono text-xs text-gain">@ ${tpPrice.toFixed(2)}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-dim">
            If SL hits with all grids long, max loss ≈{' '}
            <span className="font-mono text-loss">{maxRiskPct.toFixed(1)}%</span> of budget.
          </p>
          <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-bg p-2.5">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-warn"
              checked={useTrigger}
              onChange={(e) => onUseTrigger(e.target.checked)}
            />
            <div className="flex-1">
              <div className="text-xs font-medium text-text">Wait for price to enter range</div>
              <div className="text-[10px] text-dim">Bot stays idle until price crosses into [{lower.toFixed(2)}, {upper.toFixed(2)}]</div>
            </div>
          </label>
        </div>

        <button
          onClick={onExport}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[.98]"
        >
          <Download className="h-4 w-4" />
          Download grid.config.json
        </button>

        <p className="mt-3 text-center text-xs text-dim">
          Then open the{' '}
          <a
            href="http://localhost:3001"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-brand hover:underline"
          >
            Bot Dashboard <ExternalLink className="h-3 w-3" />
          </a>
          {' '}and drop the file there to start the bot.
        </p>
      </div>
    </div>
  )
}

function SweepChart({
  result,
}: {
  result: NonNullable<ReturnType<typeof optimizeGrid>>
}) {
  const { sweep, best } = result
  const values = sweep.map((s) => s.totalPnl)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1

  return (
    <div className="card p-4">
      <h3 className="text-sm font-medium text-text">Grid Count Sweep</h3>
      <p className="mb-3 mt-0.5 text-xs text-dim">
        Total PnL for every tested grid count. More grids trade more often but
        earn less per roundtrip — the peak is the sweet spot.
      </p>
      <div className="flex max-h-[260px] flex-col gap-0.5 overflow-auto pr-1">
        {sweep.map((s) => {
          const isBest = s.gridCount === best.gridCount
          const width = Math.max(2, ((s.totalPnl - min) / span) * 100)
          return (
            <div key={s.gridCount} className="flex items-center gap-2">
              <span className="w-7 shrink-0 text-right font-mono text-[10px] text-dim">
                {s.gridCount}
              </span>
              <div className="h-3.5 flex-1 rounded-sm bg-bg">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${width}%`,
                    background: isBest
                      ? 'hsl(var(--brand))'
                      : s.totalPnl >= 0
                        ? 'hsl(var(--gain) / 0.45)'
                        : 'hsl(var(--loss) / 0.45)',
                  }}
                />
              </div>
              <span
                className={`w-20 shrink-0 text-right font-mono text-[10px] tabular-nums ${
                  s.totalPnl >= 0 ? 'text-gain' : 'text-loss'
                }`}
              >
                {fmtUsd(s.totalPnl)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HowToAnalyze() {
  const points: { title: string; body: string }[] = [
    {
      title: 'Check Grid Suitability first',
      body: 'Grids harvest sideways chop. If the verdict is "Poor" or Trend Efficiency is above 0.5, the market is trending — skip it.',
    },
    {
      title: 'Spacing ÷ Breakeven is make-or-break',
      body: 'Every roundtrip earns the grid spacing minus round-trip fees. Want this at 3× or more. Below 1×, fees eat the profit.',
    },
    {
      title: 'Trust Realized profit over Total PnL',
      body: 'Realized Grid Profit is the repeatable edge. Unrealized PnL is just directional luck on leftover inventory.',
    },
    {
      title: 'Watch the range and drawdown',
      body: 'A neutral grid stalls and you hold a bag if price breaks out. Max Drawdown shows the worst-case pain.',
    },
    {
      title: 'Deploy the optimal count, re-anchored',
      body: 'Use the optimal grid count and spacing, centered on the current price (the re-anchor toggle).',
    },
  ]
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Info className="h-3.5 w-3.5 text-brand" />
        <h3 className="text-sm font-medium text-text">How to analyze</h3>
      </div>
      <ul className="flex flex-col gap-2.5">
        {points.map((p) => (
          <li key={p.title} className="text-xs leading-relaxed">
            <span className="font-medium text-text">{p.title}.</span>{' '}
            <span className="text-dim">{p.body}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
