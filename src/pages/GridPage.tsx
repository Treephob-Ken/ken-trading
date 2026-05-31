import { useEffect, useMemo, useState } from 'react'
import { Rocket, Zap, BarChart2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Candle } from '@/types'
import { fetchKlines, type SymbolInfo } from '@/lib/binance'
import { useHLAssets } from '@/lib/hlAssets'
import { apiFetch } from '@/contexts/AuthContext'
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
import GridVerdictStrip from '@/components/GridVerdictStrip'
import NumberInput from '@/components/NumberInput'
import PositionSizeCard from '@/components/PositionSizeCard'

interface Props {
  symbol: string
  timeframe: string
  onSymbol: (v: string) => void
  onTimeframe: (v: string) => void
}

type GridPageMode = 'static' | 'auto'

export default function GridPage({
  symbol,
  timeframe,
  onSymbol,
  onTimeframe,
}: Props) {
  const { symbols } = useHLAssets()
  const navigate = useNavigate()
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
  const [leverage, setLeverage] = useState(() => +(localStorage.getItem('gd_leverage') || '1'))
  // Max leverage for the selected asset — fetched from HL meta on coin change.
  const [maxLeverage, setMaxLeverage] = useState<number | null>(null)
  const [slPct, setSlPct] = useState(() => +(localStorage.getItem('gd_slPct') || '2'))
  const [tpPct, setTpPct] = useState(() => +(localStorage.getItem('gd_tpPct') || '2'))
  const [riskUsd, setRiskUsd] = useState<number | ''>('')
  const [deploying, setDeploying] = useState(false)
  const [deployToast, setDeployToast] = useState<{ ok: boolean; msg: string } | null>(null)

  // When risk + SL% + leverage are all set, compute the budget automatically
  const riskBudget = (typeof riskUsd === 'number' && riskUsd > 0 && slPct > 0 && leverage > 0)
    ? (riskUsd / (slPct / 100)) / leverage
    : null
  // Effective investment used for deploy: risk-computed or manual
  const effectiveInvestment = riskBudget ?? investment

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
  useEffect(() => { localStorage.setItem('gd_leverage', String(leverage)) }, [leverage])
  useEffect(() => { localStorage.setItem('gd_slPct', String(slPct)) }, [slPct])
  useEffect(() => { localStorage.setItem('gd_tpPct', String(tpPct)) }, [tpPct])

  // ── fetch max leverage for selected coin ─────────────────────────────────────
  // Auto-set leverage to the coin's HL max whenever the symbol changes so the
  // user doesn't have to look it up. They can still adjust manually after.
  useEffect(() => {
    const asset = symbol.includes(':') ? symbol : symbol.replace(/USDT$/, '')
    setMaxLeverage(null)
    let cancelled = false
    apiFetch(`/api/asset-info?asset=${encodeURIComponent(asset)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { maxLeverage?: number } | null) => {
        if (cancelled || !d?.maxLeverage) return
        setMaxLeverage(d.maxLeverage)
        setLeverage(d.maxLeverage)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [symbol])

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

  const pairLabel = symbol.replace(/USDT$/, '/USDC')
  const lastPrice = candles[candles.length - 1]?.close ?? 0

  // ── regime ───────────────────────────────────────────────────────────────────
  const regimeFit = useMemo(() => {
    if (bars.length < 30) return null
    const a = analyzeRegime(bars)
    return { analysis: a, ...isGoodForGrid(a.currentLabel) }
  }, [bars])

  // ── active lines ─────────────────────────────────────────────────────────────
  const activeLines = pageMode === 'auto' ? autoDisplayLines : displayLines

  // ── deploy to bot ─────────────────────────────────────────────────────────────
  async function handleDeploy() {
    if (activeLines.length < 2) return
    const asset = symbol.replace(/USDT$/, '')
    const lower = +activeLines[0].price.toFixed(8)
    const upper = +activeLines[activeLines.length - 1].price.toFixed(8)
    const gridCount = activeLines.length - 1
    const activeMode = pageMode === 'static' ? mode : 'arithmetic'
    setDeploying(true)
    setDeployToast(null)
    try {
      const res = await apiFetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${asset}-GRID-${gridCount}`,
          asset, lower, upper, gridCount, mode: activeMode,
          investment: effectiveInvestment, leverage,
          stopLossPrice:   +(lower * (1 - slPct / 100)).toFixed(8),
          takeProfitPrice: +(upper * (1 + tpPct / 100)).toFixed(8),
        }),
      })
      const data = (await res.json()) as { id?: string; name?: string; error?: string }
      if (!res.ok) { setDeployToast({ ok: false, msg: data.error ?? 'Deploy failed' }); return }
      setDeployToast({ ok: true, msg: `Bot '${data.name ?? data.id}' created ✓` })
      setTimeout(() => navigate(`/bots?select=${data.id}`), 1200)
    } catch (e) {
      setDeployToast({ ok: false, msg: (e as Error).message })
    } finally {
      setDeploying(false)
    }
  }

  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5 lg:flex-row">

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
              onExport={() => {}}
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

        {/* Deploy — simple card, only when grid lines exist */}
        {activeLines.length >= 2 && (
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border bg-brand/5 px-4 py-3">
              <Rocket className="h-4 w-4 text-brand" />
              <h3 className="text-sm font-semibold text-text">Deploy as Grid Bot</h3>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Leverage</label>
                  <NumberInput step={1} min={1} max={50} value={leverage} onChange={setLeverage} className="field font-mono text-sm" />
                </div>
                <div>
                  <label className="label" title="SL price = Range Low × (1 − this %). Sits BELOW the grid so it only fires if the range completely breaks down.">SL % below range</label>
                  <NumberInput step={0.5} min={0.1} value={slPct} onChange={setSlPct} className="field font-mono text-sm" />
                </div>
                <div>
                  <label className="label" title="TP price = Range High × (1 + this %). Sits ABOVE the grid; closes everything if price runs away to the upside.">TP % above range</label>
                  <NumberInput step={0.5} min={0.1} value={tpPct} onChange={setTpPct} className="field font-mono text-sm" />
                </div>
                <div>
                  <label className="label">Risk USD <span className="font-normal normal-case text-dim">(opt)</span></label>
                  <NumberInput step={10} min={0} value={riskUsd === '' ? 0 : riskUsd} onChange={(v) => setRiskUsd(v > 0 ? v : '')} className="field font-mono text-sm" />
                </div>
              </div>
              {/* Risk mode: auto-compute budget from risk + SL% + leverage */}
              {riskBudget ? (
                <div className="rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-[10px] space-y-1">
                  <div className="flex justify-between"><span className="text-dim">Notional</span><span className="font-mono text-text">${(riskBudget * leverage).toFixed(0)}</span></div>
                  <div className="flex justify-between"><span className="text-dim">Budget (margin)</span><span className="font-mono text-brand font-semibold">${riskBudget.toFixed(2)}</span></div>
                </div>
              ) : (
                <div>
                  <label className="label">Budget (USDC)</label>
                  <NumberInput step={50} min={10} value={investment} onChange={setInvestment} className="field font-mono text-sm" />
                </div>
              )}
              {deployToast && (
                <div className={`rounded-xl px-3 py-2 text-xs font-medium ${deployToast.ok ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
                  {deployToast.msg}
                </div>
              )}
              <button
                type="button"
                disabled={deploying}
                onClick={handleDeploy}
                className="btn-primary w-full justify-center py-2.5 disabled:opacity-50"
              >
                <Rocket className="h-4 w-4" />
                {deploying ? 'Deploying…' : 'Deploy as Grid Bot'}
              </button>
            </div>
          </div>
        )}

        {/* ── Position Size card (consistent across pages) ── */}
        <PositionSizeCard
          notional={effectiveInvestment > 0 && leverage > 0 ? effectiveInvestment * leverage : null}
          leverage={leverage}
          leverageLabel="Leverage"
          slPct={slPct}
          footnote={`Budget $${effectiveInvestment.toFixed(2)} × ${leverage}× leverage${maxLeverage ? ` · HL max ${maxLeverage}×` : ''}`}
        />
      </aside>

      {/* ── RIGHT: Analysis + Deploy ─────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col gap-4">

        {/* 1. Verdict + Confidence Strip (only when static optimizer has a result) */}
        {pageMode === 'static' && staticResult && (
          <GridVerdictStrip
            result={staticResult}
            regime={regimeFit?.analysis ?? null}
            windowBars={bars.length}
            timeframe={timeframe}
          />
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
            <GridChart
              candles={chartCandles}
              lines={pageMode === 'auto' ? autoDisplayLines : displayLines}
              slPrice={activeLines.length >= 2 ? +(activeLines[0].price * (1 - slPct / 100)).toFixed(8) : undefined}
              tpPrice={activeLines.length >= 2 ? +(activeLines[activeLines.length - 1].price * (1 + tpPct / 100)).toFixed(8) : undefined}
            />
          )}
        </div>

        {/* 3–4. Stats / sweep / auto info */}
        {pageMode === 'static' && staticResult ? (
          <div className="flex flex-col gap-4">
            <GridStats result={staticResult} windowBars={bars.length} timeframe={timeframe} candles={bars} />
            <SweepChart result={staticResult} />
          </div>
        ) : pageMode === 'auto' && autoResult ? (
          <div className="flex flex-col gap-4">
            <AutoGridInfo result={autoResult} symbol={symbol} params={autoParams} />
            <AutoSignalLog result={autoResult} candles={candles} />
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
