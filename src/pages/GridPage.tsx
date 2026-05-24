import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, Zap, BarChart2, FileJson } from 'lucide-react'
import type { Candle } from '@/types'
import { fetchKlines, type SymbolInfo } from '@/lib/binance'
import {
  buildCenteredGrid,
  classifyLines,
  optimizeGrid,
  type GridLine,
  type GridMode,
  type GridParams,
  type GridType,
} from '@/lib/grid'
import { fmtPrice, fmtUsd } from '@/lib/format'
import { analyzeRegime, isGoodForGrid } from '@/lib/markov'
import { computeGridBotAuto, DEFAULT_AUTO_PARAMS, type GridBotAutoParams } from '@/lib/gridBotAuto'
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

type GridPageMode = 'static' | 'auto'

export default function GridPage({
  symbol,
  timeframe,
  symbols,
  onSymbol,
  onTimeframe,
}: Props) {
  // ── mode ────────────────────────────────────────────────────────────────────
  const [pageMode, setPageMode] = useState<GridPageMode>(
    () => (localStorage.getItem('gd_pageMode') as GridPageMode) || 'static',
  )

  // ── static optimizer params ──────────────────────────────────────────────────
  const [lookback, setLookback] = useState(() => +(localStorage.getItem('gd_lookback') || '150'))
  const [mode, setMode] = useState<GridMode>(() => (localStorage.getItem('gd_mode') as GridMode) || 'arithmetic')
  const [gridType, setGridType] = useState<GridType>(() => (localStorage.getItem('gd_gridType') as GridType) || 'neutral')
  const [minGrids, setMinGrids] = useState(() => +(localStorage.getItem('gd_minGrids') || '3'))
  const [maxGrids, setMaxGrids] = useState(() => +(localStorage.getItem('gd_maxGrids') || '50'))
  const [feePct, setFeePct] = useState(() => +(localStorage.getItem('gd_feePct') || '0.05'))
  const [investment, setInvestment] = useState(() => +(localStorage.getItem('gd_investment') || '500'))
  const [reanchor, setReanchor] = useState(() => localStorage.getItem('gd_reanchor') !== 'false')

  // ── auto grid params ─────────────────────────────────────────────────────────
  const [autoParams, setAutoParams] = useState<GridBotAutoParams>(() => {
    try {
      const saved = localStorage.getItem('gd_autoParams')
      return saved ? { ...DEFAULT_AUTO_PARAMS, ...JSON.parse(saved) } : DEFAULT_AUTO_PARAMS
    } catch {
      return DEFAULT_AUTO_PARAMS
    }
  })

  // ── deploy settings ──────────────────────────────────────────────────────────
  const [botName, setBotName] = useState(() => localStorage.getItem('gd_botName') || '')
  const [leverage, setLeverage] = useState(() => +(localStorage.getItem('gd_leverage') || '1'))
  const [slPct, setSlPct] = useState(() => +(localStorage.getItem('gd_slPct') || '2'))
  const [tpPct, setTpPct] = useState(() => +(localStorage.getItem('gd_tpPct') || '2'))
  const [useTrigger, setUseTrigger] = useState(() => localStorage.getItem('gd_useTrigger') === 'true')
  const [useManualSize, setUseManualSize] = useState(() => localStorage.getItem('gd_useManualSize') === 'true')
  const [manualSize, setManualSize] = useState(() => +(localStorage.getItem('gd_manualSize') || '0.01'))

  // ── data ─────────────────────────────────────────────────────────────────────
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // ── persist ──────────────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem('gd_pageMode', pageMode) }, [pageMode])
  useEffect(() => { localStorage.setItem('gd_lookback', String(lookback)) }, [lookback])
  useEffect(() => { localStorage.setItem('gd_mode', mode) }, [mode])
  useEffect(() => { localStorage.setItem('gd_gridType', gridType) }, [gridType])
  useEffect(() => { localStorage.setItem('gd_minGrids', String(minGrids)) }, [minGrids])
  useEffect(() => { localStorage.setItem('gd_maxGrids', String(maxGrids)) }, [maxGrids])
  useEffect(() => { localStorage.setItem('gd_feePct', String(feePct)) }, [feePct])
  useEffect(() => { localStorage.setItem('gd_investment', String(investment)) }, [investment])
  useEffect(() => { localStorage.setItem('gd_reanchor', String(reanchor)) }, [reanchor])
  useEffect(() => { localStorage.setItem('gd_autoParams', JSON.stringify(autoParams)) }, [autoParams])
  useEffect(() => { localStorage.setItem('gd_botName', botName) }, [botName])
  useEffect(() => { localStorage.setItem('gd_leverage', String(leverage)) }, [leverage])
  useEffect(() => { localStorage.setItem('gd_slPct', String(slPct)) }, [slPct])
  useEffect(() => { localStorage.setItem('gd_tpPct', String(tpPct)) }, [tpPct])
  useEffect(() => { localStorage.setItem('gd_useTrigger', String(useTrigger)) }, [useTrigger])
  useEffect(() => { localStorage.setItem('gd_useManualSize', String(useManualSize)) }, [useManualSize])
  useEffect(() => { localStorage.setItem('gd_manualSize', String(manualSize)) }, [manualSize])

  // ── fetch candles ─────────────────────────────────────────────────────────────
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
    return () => { cancelled = true }
  }, [symbol, timeframe, reloadKey])

  // ── static optimizer ──────────────────────────────────────────────────────────
  const bars = useMemo(() => candles.slice(-lookback), [candles, lookback])

  const staticResult = useMemo(() => {
    if (bars.length < 20) return null
    const params: GridParams = { lookback, minGrids, maxGrids, mode, type: gridType, investment, feeRate: feePct / 100 }
    return optimizeGrid(bars, params)
  }, [bars, lookback, minGrids, maxGrids, mode, gridType, investment, feePct])

  const displayLines = useMemo(() => {
    if (!staticResult) return []
    const lines = reanchor
      ? buildCenteredGrid(staticResult.anchor, staticResult.best.spacing, staticResult.best.gridCount, mode)
      : staticResult.best.lines
    return classifyLines(lines, staticResult.anchor)
  }, [staticResult, reanchor, mode])

  // ── auto grid ─────────────────────────────────────────────────────────────────
  const autoResult = useMemo(() => {
    if (candles.length < autoParams.smoothingLen + 5) return null
    return computeGridBotAuto(candles, autoParams)
  }, [candles, autoParams])

  const autoDisplayLines = useMemo((): GridLine[] => {
    if (!autoResult || autoResult.currentLines.length === 0) return []
    const ap = autoResult.currentAP
    return classifyLines(autoResult.currentLines, ap)
  }, [autoResult])

  // ── chart candles (always show a bit more context than the window) ────────────
  const chartCandles = useMemo(
    () => candles.slice(-Math.max(lookback + 60, 220)),
    [candles, lookback],
  )

  const pairLabel = symbol.replace(/USDT$/, '/USDT')
  const lastPrice = candles[candles.length - 1]?.close ?? 0

  // ── regime ───────────────────────────────────────────────────────────────────
  const regimeFit = useMemo(() => {
    if (bars.length < 30) return null
    const a = analyzeRegime(bars)
    return { analysis: a, ...isGoodForGrid(a.currentLabel) }
  }, [bars])

  // ── active lines ─────────────────────────────────────────────────────────────
  const activeLines = pageMode === 'auto' ? autoDisplayLines : displayLines

  // ── export: bot config ───────────────────────────────────────────────────────
  function exportConfig() {
    if (activeLines.length < 2) return
    const asset = symbol.replace(/USDT$/, '')
    const lower = +activeLines[0].price.toFixed(2)
    const upper = +activeLines[activeLines.length - 1].price.toFixed(2)
    const gridCount = activeLines.length - 1
    const activeFeePct = pageMode === 'static' ? feePct : 0.05
    const activeMode = pageMode === 'static' ? mode : 'arithmetic'
    const cfg: Record<string, unknown> = {
      name: botName || `${asset} ${pageMode === 'auto' ? 'auto' : gridType} grid`,
      asset, lower, upper, gridCount, mode: activeMode, investment, leverage,
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
    void activeFeePct
  }

  // ── export: raw grid lines ───────────────────────────────────────────────────
  function exportLines() {
    if (activeLines.length < 2) return
    const asset = symbol.replace(/USDT$/, '')
    const spacingPct =
      pageMode === 'static'
        ? staticResult?.best.spacingPct ?? 0
        : autoResult && autoResult.currentLines.length >= 2
          ? ((autoResult.currentLines[1] - autoResult.currentLines[0]) / autoResult.currentLines[0]) * 100
          : 0
    const data = {
      symbol,
      asset,
      timeframe,
      generatedAt: new Date().toISOString(),
      mode: pageMode === 'static' ? mode : 'arithmetic',
      gridType: pageMode === 'static' ? gridType : 'neutral',
      anchor: pageMode === 'static' ? staticResult?.anchor : autoResult?.currentAP,
      gridCount: activeLines.length - 1,
      spacingPct: +spacingPct.toFixed(4),
      lower: +activeLines[0].price.toFixed(6),
      upper: +activeLines[activeLines.length - 1].price.toFixed(6),
      lines: activeLines.map((l, i) => ({
        index: i,
        price: +l.price.toFixed(6),
        kind: l.kind,
      })),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `grid-lines.${asset.toLowerCase()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <main className="mx-auto flex w-full max-w-[2200px] flex-1 flex-col gap-4 px-6 py-5 lg:flex-row">

      {/* ── LEFT: Controls sidebar — mirrors Backtester aside exactly ───────── */}
      <aside className="relative z-[35] flex h-fit w-full shrink-0 flex-col gap-4 lg:sticky lg:top-5 lg:max-h-[calc(100vh-40px)] lg:w-[300px] lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">

        {/* Mode toggle */}
        <div className="card p-4">
          <p className="label mb-2">Grid Mode</p>
          <div className="flex rounded-xl border border-border bg-bg p-1 gap-1">
            <button
              onClick={() => setPageMode('static')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                pageMode === 'static' ? 'bg-brand/15 text-brand' : 'text-dim hover:text-text'
              }`}
            >
              <BarChart2 className="h-3.5 w-3.5" />
              Optimizer
            </button>
            <button
              onClick={() => setPageMode('auto')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                pageMode === 'auto' ? 'bg-brand/15 text-brand' : 'text-dim hover:text-text'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              Auto (Dynamic)
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="card p-4">
          {pageMode === 'static' ? (
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
              canExport={false}
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
          ) : (
            <AutoControls
              symbol={symbol}
              symbols={symbols}
              timeframe={timeframe}
              params={autoParams}
              onSymbol={onSymbol}
              onTimeframe={onTimeframe}
              onParam={(k, v) => setAutoParams((p) => ({ ...p, [k]: v }))}
              onReload={() => setReloadKey((k) => k + 1)}
            />
          )}
        </div>
      </aside>

      {/* ── RIGHT: Analysis + Deploy ─────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col gap-4">

        {/* 1. Regime banner */}
        {regimeFit && (
          <div
            className={`card flex items-center gap-3 border-l-4 p-3 ${
              regimeFit.suitable ? 'border-l-gain bg-gain/5' : 'border-l-warn bg-warn/5'
            }`}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-bold ${
                regimeFit.suitable ? 'bg-gain/20 text-gain' : 'bg-warn/20 text-warn'
              }`}
              title={`Markov regime: ${regimeFit.analysis.currentLabel}`}
            >
              {regimeFit.analysis.currentLabel?.[0] ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-text">
                {regimeFit.suitable ? 'Good conditions for grid trading' : 'Market may not suit grids right now'}{' '}
                <span className="text-xs font-normal text-dim">
                  ({regimeFit.analysis.currentLabel}, {(regimeFit.analysis.persistence * 100).toFixed(0)}% persistence)
                </span>
              </div>
              <p className="text-[11px] text-dim leading-snug">{regimeFit.reason}</p>
            </div>
          </div>
        )}

        {/* 2. Chart */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text">
              {pageMode === 'auto' ? 'Dynamic Grid' : 'Grid Optimizer'}
              <span className="ml-2 text-xs font-normal text-dim">
                {pairLabel} · {timeframe}
              </span>
            </h2>
            <span className="font-mono text-sm tabular-nums text-text">
              {lastPrice ? fmtPrice(lastPrice) : '—'}
            </span>
          </div>

          {error ? (
            <div className="flex h-[480px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-loss">Could not load market data</p>
              <p className="max-w-sm text-xs text-dim">{error}</p>
            </div>
          ) : loading && candles.length === 0 ? (
            <div className="flex h-[480px] items-center justify-center text-sm text-dim">
              Loading market data…
            </div>
          ) : (
            <GridChart candles={chartCandles} lines={pageMode === 'auto' ? autoDisplayLines : displayLines} />
          )}
        </div>

        {/* 3–4. Stats / sweep / auto info + Deploy card side-by-side */}
        {pageMode === 'static' && staticResult ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex flex-col gap-4">
              <GridStats result={staticResult} windowBars={bars.length} timeframe={timeframe} candles={bars} />
              <SweepChart result={staticResult} />
            </div>
            <DeployCard
              lines={displayLines}
              symbol={symbol}
              mode={mode}
              gridType={gridType}
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
              spacingPct={staticResult.best.spacingPct}
              onExport={exportConfig}
              onExportLines={exportLines}
            />
          </div>
        ) : pageMode === 'auto' && autoResult ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex flex-col gap-4">
              <AutoGridInfo result={autoResult} symbol={symbol} params={autoParams} />
              <AutoSignalLog result={autoResult} candles={candles} />
            </div>
            <DeployCard
              lines={autoDisplayLines}
              symbol={symbol}
              mode="arithmetic"
              gridType="neutral"
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
              feePct={0.05}
              spacingPct={
                autoResult.currentLines.length >= 2
                  ? ((autoResult.currentLines[1] - autoResult.currentLines[0]) / autoResult.currentLines[0]) * 100
                  : 0
              }
              onExport={exportConfig}
              onExportLines={exportLines}
            />
          </div>
        ) : (
          !loading && !error && (
            <div className="card p-8 text-center text-sm text-dim">
              {pageMode === 'static'
                ? 'Not enough candles to optimize a grid. Try a longer lookback.'
                : 'Not enough candles for the auto grid. Reduce smoothing length.'}
            </div>
          )
        )}
      </section>
    </main>
  )
}

// ── Auto mode sidebar controls ─────────────────────────────────────────────────

function AutoControls({
  symbol, symbols, timeframe, params, onSymbol, onTimeframe, onParam, onReload,
}: {
  symbol: string
  symbols: SymbolInfo[]
  timeframe: string
  params: GridBotAutoParams
  onSymbol: (v: string) => void
  onTimeframe: (v: string) => void
  onParam: (k: keyof GridBotAutoParams, v: number | string) => void
  onReload: () => void
}) {
  const TIMEFRAMES = ['1m','5m','15m','30m','1h','4h','1d','1w']
  return (
    <div className="flex flex-col gap-3">
      {/* Symbol */}
      <div>
        <label className="label">Symbol</label>
        <select value={symbol} onChange={(e) => onSymbol(e.target.value)} className="field text-sm">
          {symbols.map((s) => (
            <option key={s.symbol} value={s.symbol}>{s.symbol}</option>
          ))}
        </select>
      </div>
      {/* Timeframe */}
      <div>
        <label className="label">Timeframe</label>
        <select value={timeframe} onChange={(e) => onTimeframe(e.target.value)} className="field text-sm">
          {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
        </select>
      </div>

      <hr className="border-border" />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-dim">Auto Grid Parameters</p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">MA Length</label>
          <NumberInput step={1} min={2} max={100} value={params.smoothingLen}
            onChange={(v) => onParam('smoothingLen', v)} className="field font-mono text-sm" />
        </div>
        <div>
          <label className="label">Laziness %</label>
          <NumberInput step={0.5} min={0.5} max={20} value={params.laziness}
            onChange={(v) => onParam('laziness', v)} className="field font-mono text-sm" />
        </div>
        <div>
          <label className="label">Elasticity</label>
          <NumberInput step={5} min={1} max={500} value={params.elasticity}
            onChange={(v) => onParam('elasticity', v)} className="field font-mono text-sm" />
        </div>
        <div>
          <label className="label">Grid Interval %</label>
          <NumberInput step={0.1} min={0.1} max={20} value={params.gridIntervalPct}
            onChange={(v) => onParam('gridIntervalPct', v)} className="field font-mono text-sm" />
        </div>
        <div>
          <label className="label">Grid Count</label>
          <NumberInput step={1} min={1} max={8} value={params.gridCount}
            onChange={(v) => onParam('gridCount', v)} className="field font-mono text-sm" />
        </div>
        <div>
          <label className="label">Cooldown (bars)</label>
          <NumberInput step={1} min={0} max={20} value={params.cooldown}
            onChange={(v) => onParam('cooldown', v)} className="field font-mono text-sm" />
        </div>
      </div>

      <div>
        <label className="label">Direction filter</label>
        <select
          value={params.direction}
          onChange={(e) => onParam('direction', e.target.value as GridBotAutoParams['direction'])}
          className="field text-sm"
        >
          <option value="neutral">Neutral (both)</option>
          <option value="long">Long only (buy dips)</option>
          <option value="short">Short only (sell rallies)</option>
        </select>
      </div>

      <button onClick={onReload} className="btn-ghost w-full text-xs">
        ↺ Refresh data
      </button>

      <div className="rounded-xl border border-brand/20 bg-brand/5 p-3 text-[11px] text-dim leading-relaxed">
        <span className="font-semibold text-brand">Dynamic mode</span> — the grid anchor follows a lazy MA and steps
        one interval at a time. Lines stay stable during chop, re-center after a regime shift.
      </div>
    </div>
  )
}

// ── Auto grid info card ────────────────────────────────────────────────────────

function AutoGridInfo({
  result, symbol, params,
}: {
  result: NonNullable<ReturnType<typeof computeGridBotAuto>>
  symbol: string
  params: GridBotAutoParams
}) {
  const asset = symbol.replace(/USDT$/, '')
  const gi = result.currentAP * params.gridIntervalPct / 100
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">Current Grid State</h3>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Anchor Point" value={fmtPrice(result.currentAP)} />
        <Stat label="Lazy MA" value={fmtPrice(result.currentLMA)} />
        <Stat label="Grid Interval" value={`${params.gridIntervalPct}% / ${fmtPrice(gi)}`} />
        <Stat label="Total Lines" value={String(result.currentLines.length)} />
        <Stat label="Total Signals" value={String(result.signals.length)} />
        <Stat label="Buy / Sell" value={`${result.signals.filter(s => s.type === 'buy').length} / ${result.signals.filter(s => s.type === 'sell').length}`} />
      </div>

      {result.currentLines.length > 0 && (
        <div className="mt-3">
          <p className="label mb-2">Active Grid Lines ({asset})</p>
          <div className="flex flex-wrap gap-1.5">
            {[...result.currentLines].reverse().map((line, i) => {
              const isAP = Math.abs(line - result.currentAP) < gi * 0.01
              return (
                <span
                  key={i}
                  className={`rounded-lg border px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                    isAP
                      ? 'border-brand/40 bg-brand/10 text-brand'
                      : 'border-border bg-panel-2 text-text'
                  }`}
                >
                  {fmtPrice(line)}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg p-2.5">
      <div className="mb-0.5 text-[10px] text-dim">{label}</div>
      <div className="font-mono text-sm font-semibold tabular-nums text-text">{value}</div>
    </div>
  )
}

// ── Auto signal log ────────────────────────────────────────────────────────────

function AutoSignalLog({
  result, candles,
}: {
  result: NonNullable<ReturnType<typeof computeGridBotAuto>>
  candles: Candle[]
}) {
  const recent = [...result.signals].reverse().slice(0, 15)
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">
        Recent Grid Signals
        <span className="ml-2 text-xs font-normal text-dim">(last {recent.length} of {result.signals.length})</span>
      </h3>
      {recent.length === 0 ? (
        <p className="text-sm text-dim">No signals detected yet — adjust grid interval or cooldown.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {recent.map((sig, i) => {
            const dt = new Date(sig.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            const candle = candles[sig.bar]
            return (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border px-3 py-1.5">
                <span className={`min-w-[40px] rounded-md px-1.5 py-0.5 text-center text-[11px] font-bold ${
                  sig.type === 'buy' ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss'
                }`}>
                  {sig.type.toUpperCase()}
                </span>
                <span className="font-mono text-xs tabular-nums text-text">{fmtPrice(sig.price)}</span>
                <span className="text-[11px] text-dim">{dt}</span>
                {candle && (
                  <span className="ml-auto font-mono text-[11px] text-dim">
                    H {fmtPrice(candle.high)} · L {fmtPrice(candle.low)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Sweep chart ────────────────────────────────────────────────────────────────

function SweepChart({ result }: { result: NonNullable<ReturnType<typeof optimizeGrid>> }) {
  const { sweep, best } = result
  const values = sweep.map((s) => s.totalPnl)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1

  return (
    <div className="card p-4">
      <h3 className="mb-0.5 text-sm font-semibold text-text">Which grid count is the sweet spot?</h3>
      <p className="mb-3 text-[11px] text-dim">
        More grids trade more often but earn less per roundtrip — the peak is the optimal count.
      </p>
      <div className="flex max-h-[240px] flex-col gap-0.5 overflow-auto pr-1">
        {sweep.map((s) => {
          const isBest = s.gridCount === best.gridCount
          const width = Math.max(2, ((s.totalPnl - min) / span) * 100)
          return (
            <div key={s.gridCount} className="flex items-center gap-2">
              <span className="w-7 shrink-0 text-right font-mono text-[10px] text-dim">{s.gridCount}</span>
              <div className="h-3.5 flex-1 rounded-md bg-bg">
                <div
                  className="h-full rounded-md transition-all"
                  style={{
                    width: `${width}%`,
                    background: isBest ? 'hsl(var(--brand))' : s.totalPnl >= 0 ? 'hsl(var(--gain) / 0.45)' : 'hsl(var(--loss) / 0.45)',
                  }}
                />
              </div>
              <span className={`w-20 shrink-0 text-right font-mono text-[10px] tabular-nums ${s.totalPnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                {fmtUsd(s.totalPnl)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Deploy card ────────────────────────────────────────────────────────────────

function DeployCard({
  lines, symbol, mode, gridType,
  botName, onBotName, investment, onInvestment, leverage, onLeverage,
  slPct, onSlPct, tpPct, onTpPct, useTrigger, onUseTrigger,
  useManualSize, onUseManualSize, manualSize, onManualSize,
  feePct, spacingPct, onExport, onExportLines,
}: {
  lines: GridLine[]
  symbol: string
  mode: GridMode
  gridType: GridType
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
  spacingPct: number
  onExport: () => void
  onExportLines: () => void
}) {
  if (lines.length < 2) return null
  const asset = symbol.replace(/USDT$/, '')
  const lower = lines[0].price
  const upper = lines[lines.length - 1].price
  const gridCount = lines.length - 1
  const safety = 0.5
  const derivedSize = (investment * leverage * safety) / (gridCount * upper)
  const orderSize = useManualSize ? manualSize : derivedSize
  const maxNotional = gridCount * orderSize * upper
  const requiredMargin = maxNotional / leverage
  const profitPerGridPct = spacingPct - 2 * feePct
  const slPrice = lower * (1 - slPct / 100)
  const tpPrice = upper * (1 + tpPct / 100)
  const maxRiskPct = (((lower - slPrice) * gridCount * orderSize) / investment) * 100

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-brand/5 px-4 py-3">
        <Download className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-text">Deploy to Bot</h3>
        <span className="ml-auto text-xs text-dim">export config → run bot</span>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className="label">Bot name <span className="font-normal normal-case text-dim">(optional)</span></label>
          <input
            type="text"
            value={botName}
            onChange={(e) => onBotName(e.target.value)}
            placeholder={`${asset} ${gridType} grid`}
            className="field text-sm"
          />
        </div>

        {/* Range summary */}
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-bg p-3 font-mono text-xs">
          <div><div className="mb-0.5 text-[10px] text-dim">Asset</div><div className="font-semibold text-text">{asset}</div></div>
          <div><div className="mb-0.5 text-[10px] text-dim">Lower</div><div className="text-text">{lower.toFixed(2)}</div></div>
          <div><div className="mb-0.5 text-[10px] text-dim">Upper</div><div className="text-text">{upper.toFixed(2)}</div></div>
          <div><div className="mb-0.5 text-[10px] text-dim">Grid Count</div><div className="font-semibold text-brand">{gridCount}</div></div>
          <div><div className="mb-0.5 text-[10px] text-dim">Mode</div><div className="text-text capitalize">{mode}</div></div>
          <div><div className="mb-0.5 text-[10px] text-dim">Spacing</div><div className="text-text">{spacingPct.toFixed(2)}%</div></div>
        </div>

        {/* Position sizing */}
        <div>
          <p className="label mb-2">Position Sizing</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Budget (USDC)</label>
              <NumberInput step={50} min={10} value={investment} onChange={onInvestment} className="field font-mono text-sm" />
            </div>
            <div>
              <label className="label">Leverage</label>
              <NumberInput step={1} min={1} max={50} value={leverage} onChange={onLeverage} className="field font-mono text-sm" />
            </div>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-bg p-2.5">
            <input type="checkbox" className="h-3.5 w-3.5 accent-brand" checked={useManualSize} onChange={(e) => onUseManualSize(e.target.checked)} />
            <span className="text-xs font-medium text-text">Override order size</span>
            <NumberInput step={0.001} min={0.001} disabled={!useManualSize} value={manualSize} onChange={onManualSize} className="field ml-auto w-24 font-mono text-xs disabled:opacity-40" />
            <span className="text-[11px] text-dim">{asset}</span>
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-border bg-bg p-3 font-mono text-xs">
            <div><div className="mb-0.5 text-[10px] text-dim">Order size / grid</div><div className="text-text">{orderSize.toFixed(5)} {asset}</div></div>
            <div><div className="mb-0.5 text-[10px] text-dim">Margin needed</div><div className="text-text">${requiredMargin.toFixed(0)} USDC</div></div>
            <div><div className="mb-0.5 text-[10px] text-dim">Max notional</div><div className="text-text">${maxNotional.toFixed(0)}</div></div>
            <div><div className="mb-0.5 text-[10px] text-dim">Est profit / grid</div><div className={profitPerGridPct > 0 ? 'text-gain' : 'text-loss'}>{profitPerGridPct >= 0 ? '+' : ''}{profitPerGridPct.toFixed(3)}%</div></div>
          </div>
        </div>

        {/* Safety triggers */}
        <div>
          <p className="label mb-2">Safety Triggers <span className="font-normal normal-case text-dim/70">(always included)</span></p>
          <div className="space-y-2">
            <div className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/5 p-2.5">
              <span className="text-xs font-semibold text-loss">Stop Loss</span>
              <NumberInput step={0.5} min={0.1} value={slPct} onChange={onSlPct} className="field w-20 font-mono text-xs" />
              <span className="text-[11px] text-dim">% below lower</span>
              <span className="ml-auto font-mono text-xs text-loss">@ ${slPrice.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-gain/30 bg-gain/5 p-2.5">
              <span className="text-xs font-semibold text-gain">Take Profit</span>
              <NumberInput step={0.5} min={0.1} value={tpPct} onChange={onTpPct} className="field w-20 font-mono text-xs" />
              <span className="text-[11px] text-dim">% above upper</span>
              <span className="ml-auto font-mono text-xs text-gain">@ ${tpPrice.toFixed(2)}</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-dim">
            Max loss if all grids fill and SL hits ≈{' '}
            <span className="font-mono text-loss">{maxRiskPct.toFixed(1)}%</span> of budget.
          </p>
          <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-bg p-2.5">
            <input type="checkbox" className="h-3.5 w-3.5 accent-warn" checked={useTrigger} onChange={(e) => onUseTrigger(e.target.checked)} />
            <div className="flex-1">
              <div className="text-xs font-medium text-text">Wait for price to enter range</div>
              <div className="text-[10px] text-dim">Bot stays idle until price crosses [{lower.toFixed(2)}, {upper.toFixed(2)}]</div>
            </div>
          </label>
        </div>

        {/* Two download buttons */}
        <div className="flex flex-col gap-2">
          {/* PRIMARY — the file the bot dashboard accepts */}
          <div>
            <button
              onClick={onExport}
              className="btn-primary w-full justify-center py-2.5"
            >
              <Download className="h-4 w-4" />
              Download for Bot (grid.config.json)
            </button>
            <p className="mt-1 text-center text-[11px] text-dim">
              Drop this in the{' '}
              <a href="https://bot.garlic-trading.net" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                Bot Dashboard <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>

          {/* SECONDARY — reference only, not for the bot */}
          <div>
            <button
              onClick={onExportLines}
              className="btn-ghost w-full justify-center py-2 gap-2 text-xs"
            >
              <FileJson className="h-3.5 w-3.5" />
              Export Line Prices (grid-lines.json)
            </button>
            <p className="text-center text-[11px] text-dim">
              All grid prices — for TradingView / manual reference only
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
