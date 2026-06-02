import { useEffect, useMemo, useState } from 'react'
import { Activity, Info, Rocket, LayoutGrid, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Candle, Direction, StrategyId, Trade } from '@/types'
import { fetchKlines, MAX_BARS, subscribeKline } from '@/lib/binance'
import { defaultParams, generateSignals, strategyMeta } from '@/lib/strategies'
import { runBacktest } from '@/lib/backtest'
import { fmtPrice } from '@/lib/format'
import { useHLAssets } from '@/lib/hlAssets'
import { apiFetch } from '@/contexts/AuthContext'
import ChartPanel from '@/components/ChartPanel'
import Controls, { type SizingMode } from '@/components/Controls'
import NumberInput from '@/components/NumberInput'
import PositionSizeCard from '@/components/PositionSizeCard'
import Results from '@/components/Results'
import SummaryPanel from '@/components/SummaryPanel'
import ConfidenceStrip from '@/components/ConfidenceStrip'
import RegimeBreakdownCard from '@/components/RegimeBreakdownCard'
import ParamStabilityCard from '@/components/ParamStabilityCard'
import { analyzeRegime } from '@/lib/markov'
import { TF_HIERARCHY } from '@/lib/multiTF'

// Same list Controls.tsx exposes — keep in sync.
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const

function defaultHigherTF(tf: string): string {
  // Pick the next standard tier up; fall back to the next array entry if not in the map.
  return TF_HIERARCHY[tf] ?? TIMEFRAMES[Math.min(TIMEFRAMES.indexOf(tf as typeof TIMEFRAMES[number]) + 1, TIMEFRAMES.length - 1)] ?? tf
}

interface Props {
  symbol: string
  timeframe: string
  onSymbol: (v: string) => void
  onTimeframe: (v: string) => void
}

const todayIso = () => new Date().toISOString().slice(0, 10)

// Internal default for volatility sizing — wraps stop in ~1.5× ATR.
// No longer user-tunable since the bot doesn't use ATR.
const ATR_MULTIPLIER = 1.5

export default function BacktesterPage({
  symbol,
  timeframe,
  onSymbol,
  onTimeframe,
}: Props) {
  const { symbols } = useHLAssets()
  const navigate = useNavigate()
  const location = useLocation()
  const [startDate, setStartDate] = useState(() => localStorage.getItem('bt_startDate') || '')
  const [endDate, setEndDate] = useState(() => localStorage.getItem('bt_endDate') || '')
  const [strategyId, setStrategyId] = useState<StrategyId>(
    () => (localStorage.getItem('bt_strategyId') as StrategyId) || 'macd',
  )

  const [params, setParams] = useState<Record<string, number>>(() => {
    try {
      const activeId = localStorage.getItem('bt_strategyId') || 'macd'
      const saved = localStorage.getItem(`bt_params_${activeId}`)
      return saved ? JSON.parse(saved) : defaultParams(activeId as StrategyId)
    } catch {
      return defaultParams((localStorage.getItem('bt_strategyId') || 'macd') as StrategyId)
    }
  })

  const [direction, setDirection] = useState<Direction>(
    () => (localStorage.getItem('bt_direction') as Direction) || 'long',
  )
  const [initialCapital, setInitialCapital] = useState(
    () => +(localStorage.getItem('bt_initialCapital') || '10000'),
  )
  const [feePct, setFeePct] = useState(() => +(localStorage.getItem('bt_feePct') || '0.1'))
  const [stopLossPct, setStopLossPct] = useState(
    () => +(localStorage.getItem('bt_stopLossPct') || '0'),
  )
  // Sizing mode — only Fixed and Volatility (Compounding removed; no bot equivalent).
  // Migrate any stored "compounding" value to "fixed" on load.
  const [sizingMode, setSizingMode] = useState<SizingMode>(() => {
    const saved = localStorage.getItem('bt_positionMode')
    return saved === 'volatility' ? 'volatility' : 'fixed'
  })
  const [targetRiskPct, setTargetRiskPct] = useState(
    () => +(localStorage.getItem('bt_targetRiskPct') || '2'),
  )

  // Deploy card — position notional in USD (only used when sizingMode='fixed').
  // Bot's "budget mode" maps this to: notional = investment × leverage.
  const [deployUsd, setDeployUsd] = useState(
    () => +(localStorage.getItem('bt_deployUsd') || '100'),
  )
  // Max leverage for the selected asset — fetched from HL meta. Display-only;
  // HL leverage is actually set per-asset on the user's account.
  const [maxLeverage, setMaxLeverage] = useState<number | null>(null)
  const [assetMidPx, setAssetMidPx] = useState<number | null>(null)

  // ─── MTF state ──────────────────────────────────────────────────────────────
  // Visual side-by-side toggle. Stored separately from the filter flag because
  // a user may want to SEE the HTF without enforcing it on the strategy.
  const [mtfView, setMtfView] = useState(
    () => localStorage.getItem('bt_mtfView') === 'true',
  )
  // The HTF used by both the visual chart and the deploy filter. Defaults to
  // the next standard tier above the current TF.
  const [mtfTimeframe, setMtfTimeframe] = useState(
    () => localStorage.getItem('bt_mtfTimeframe') || defaultHigherTF(timeframe),
  )
  // When true, the Signal Bot will skip trades whose direction conflicts with
  // the last HTF signal. Carried through the deploy payload.
  const [mtfFilter, setMtfFilter] = useState(
    () => localStorage.getItem('bt_mtfFilter') === 'true',
  )

  useEffect(() => { localStorage.setItem('bt_startDate', startDate) }, [startDate])
  useEffect(() => { localStorage.setItem('bt_endDate', endDate) }, [endDate])
  useEffect(() => { localStorage.setItem('bt_strategyId', strategyId) }, [strategyId])
  useEffect(() => {
    localStorage.setItem(`bt_params_${strategyId}`, JSON.stringify(params))
  }, [params, strategyId])
  useEffect(() => { localStorage.setItem('bt_direction', direction) }, [direction])
  useEffect(() => {
    localStorage.setItem('bt_initialCapital', String(initialCapital))
  }, [initialCapital])
  useEffect(() => { localStorage.setItem('bt_feePct', String(feePct)) }, [feePct])
  useEffect(() => {
    localStorage.setItem('bt_stopLossPct', String(stopLossPct))
  }, [stopLossPct])
  useEffect(() => {
    localStorage.setItem('bt_positionMode', sizingMode)
  }, [sizingMode])
  useEffect(() => {
    localStorage.setItem('bt_targetRiskPct', String(targetRiskPct))
  }, [targetRiskPct])
  useEffect(() => {
    localStorage.setItem('bt_deployUsd', String(deployUsd))
  }, [deployUsd])

  // Fetch max leverage + mid price for the selected asset whenever it changes.
  useEffect(() => {
    const asset = symbol.replace(/USDT$/, '')
    setMaxLeverage(null); setAssetMidPx(null)
    let cancelled = false
    apiFetch(`/api/asset-info?asset=${encodeURIComponent(asset)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { midPx?: number; maxLeverage?: number } | null) => {
        if (cancelled || !d) return
        if (d.maxLeverage) setMaxLeverage(d.maxLeverage)
        if (d.midPx) setAssetMidPx(d.midPx)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [symbol])
  useEffect(() => { localStorage.setItem('bt_mtfView', String(mtfView)) }, [mtfView])
  useEffect(() => { localStorage.setItem('bt_mtfTimeframe', mtfTimeframe) }, [mtfTimeframe])
  useEffect(() => { localStorage.setItem('bt_mtfFilter', String(mtfFilter)) }, [mtfFilter])

  // Re-pin the HTF default when the user changes the base TF so the dropdown
  // doesn't get stuck on a lower TF (which is nonsensical).
  useEffect(() => {
    const desired = defaultHigherTF(timeframe)
    const lowerOrEqual = TIMEFRAMES.indexOf(mtfTimeframe as typeof TIMEFRAMES[number]) <=
                         TIMEFRAMES.indexOf(timeframe as typeof TIMEFRAMES[number])
    if (lowerOrEqual) setMtfTimeframe(desired)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe])

  // Scanner deep-link: when navigated here from the Scanner row's "Open"
  // button, copy across the exact inputs the scanner used (strategy, params,
  // direction, lookback window) so the Backtester's numbers match the row
  // the user clicked. Without this, the Backtester would re-use its own
  // saved params/dates and show a different result.
  useEffect(() => {
    const state = location.state as {
      presetStrategy?: StrategyId
      presetParams?: Record<string, number>
      presetDirection?: Direction
      presetLookbackDays?: number
    } | null
    if (!state?.presetStrategy) return

    setStrategyId(state.presetStrategy)
    // Apply scanner's params (defaults, currently). Falls back to whatever
    // the user had saved if the scanner didn't include them.
    if (state.presetParams) {
      setParams(state.presetParams)
    } else {
      let next = defaultParams(state.presetStrategy)
      try {
        const saved = localStorage.getItem(`bt_params_${state.presetStrategy}`)
        if (saved) next = JSON.parse(saved)
      } catch {}
      setParams(next)
    }
    if (state.presetDirection) setDirection(state.presetDirection)
    if (state.presetLookbackDays) {
      const now = new Date()
      const past = new Date(now.getTime() - state.presetLookbackDays * 86_400_000)
      setStartDate(past.toISOString().slice(0, 10))
      setEndDate(now.toISOString().slice(0, 10))
    }
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const [candles, setCandles] = useState<Candle[]>([])
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)

  const isLiveRange = endDate === '' || endDate === todayIso()

  useEffect(() => {
    setSelectedTrade(null)
  }, [
    symbol, timeframe, startDate, endDate, strategyId, params, direction,
    initialCapital, feePct, stopLossPct, sizingMode, targetRiskPct,
  ])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const startTime = startDate ? Date.parse(startDate) : undefined
    const endTime = endDate ? Date.parse(endDate) + 86_400_000 : undefined
    fetchKlines({ symbol, interval: timeframe, startTime, endTime })
      .then((data) => {
        if (cancelled) return
        setCandles(data)
        setLiveCandle(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setCandles([])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [symbol, timeframe, startDate, endDate, reloadKey])

  useEffect(() => {
    if (!isLiveRange) {
      setConnected(false)
      return
    }
    const unsubscribe = subscribeKline(
      symbol,
      timeframe,
      ({ candle, closed }) => {
        if (closed) {
          setCandles((prev) => {
            if (prev.length === 0) return prev
            const last = prev[prev.length - 1]
            if (candle.time > last.time) return [...prev, candle].slice(-6000)
            const copy = prev.slice()
            copy[copy.length - 1] = candle
            return copy
          })
          setLiveCandle(null)
        } else {
          setLiveCandle(candle)
        }
      },
      setConnected,
    )
    return unsubscribe
  }, [symbol, timeframe, isLiveRange])

  const regime = useMemo(() => {
    if (candles.length < 30) return null
    return analyzeRegime(candles)
  }, [candles])

  // ─── HTF (higher-timeframe) data — only fetched when MTF view or filter is on ──
  const mtfActive = mtfView || mtfFilter
  const [htfCandles, setHtfCandles] = useState<Candle[]>([])
  const [htfLoading, setHtfLoading] = useState(false)
  const [htfError, setHtfError] = useState<string | null>(null)

  useEffect(() => {
    if (!mtfActive) { setHtfCandles([]); return }
    let cancelled = false
    setHtfLoading(true)
    setHtfError(null)
    const startTime = startDate ? Date.parse(startDate) : undefined
    const endTime = endDate ? Date.parse(endDate) + 86_400_000 : undefined
    fetchKlines({ symbol, interval: mtfTimeframe, startTime, endTime })
      .then((data) => {
        if (cancelled) return
        setHtfCandles(data)
        setHtfLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setHtfError(e instanceof Error ? e.message : String(e))
        setHtfCandles([])
        setHtfLoading(false)
      })
    return () => { cancelled = true }
  }, [mtfActive, symbol, mtfTimeframe, startDate, endDate, reloadKey])

  // Run the same strategy with the same params on the HTF candles. Reuses the
  // exact same generator so signals match the bot's MTF filter.
  const htfOutput = useMemo(() => {
    if (htfCandles.length < 35) return null
    try { return generateSignals(strategyId, htfCandles, params) } catch { return null }
  }, [htfCandles, strategyId, params])

  const htfRegime = useMemo(() => {
    if (htfCandles.length < 30) return null
    return analyzeRegime(htfCandles)
  }, [htfCandles])

  // Confluence: compare current vs HTF regime to surface ALIGNED / CONFLICT / NEUTRAL.
  // Same logic as multiTF.getMultiTFConfluence but kept here to avoid the second
  // network fetch (we already have htfCandles in state).
  const confluence = useMemo(() => {
    const c = regime?.currentLabel
    const h = htfRegime?.currentLabel
    if (!c || !h) return null
    if (c === h) return { kind: 'aligned' as const, text: `${c} on both — strong ${c.toLowerCase()} bias` }
    if ((c === 'Bull' && h === 'Bear') || (c === 'Bear' && h === 'Bull')) {
      return { kind: 'conflict' as const, text: `${c} now vs ${h} on ${mtfTimeframe} — fade or stay flat` }
    }
    return { kind: 'neutral' as const, text: `${c} now, ${h} on ${mtfTimeframe} — mixed` }
  }, [regime, htfRegime, mtfTimeframe])

  const { output, result } = useMemo(() => {
    if (candles.length < 35) return { output: null, result: null }
    const out = generateSignals(strategyId, candles, params)
    const res = runBacktest(
      candles,
      out.signals,
      initialCapital,
      feePct / 100,
      direction,
      stopLossPct,
      0, // Take Profit removed — opposite signal closes the position naturally
      sizingMode,
      targetRiskPct,
      ATR_MULTIPLIER,
    )
    return { output: out, result: res }
  }, [
    candles, strategyId, params, initialCapital, feePct, direction,
    stopLossPct, sizingMode, targetRiskPct,
  ])

  const handleStrategy = (id: StrategyId) => {
    setStrategyId(id)
    let initialParams = defaultParams(id)
    try {
      const saved = localStorage.getItem(`bt_params_${id}`)
      if (saved) initialParams = JSON.parse(saved)
    } catch {}
    setParams(initialParams)
  }

  const lastPrice = liveCandle?.close ?? candles[candles.length - 1]?.close ?? 0

  // Kelly fraction nudge — derived from the backtest result. Surfaced under the
  // "Risk per Trade %" input so the user has a math-backed sizing recommendation
  // instead of guessing. Half-Kelly is the safer default (Thorp, Aronson).
  const kellyHint = useMemo(() => {
    if (!result || result.metrics.numTrades < 5) return null
    const m = result.metrics
    const wr = m.winRate / 100
    const avgWin = m.avgWinPct
    const avgLoss = Math.abs(m.avgLossPct)
    if (avgLoss <= 0 || avgWin <= 0) return null
    const rr = avgWin / avgLoss
    // Standard Kelly fraction (of capital to risk). f* = (p*b - q) / b
    const fullPct = (wr - (1 - wr) / rr) * 100
    const halfPct = Math.max(0, fullPct / 2)
    return {
      fullPct,
      halfPct,
      // Apply button only useful when Kelly says "risk something" (positive edge).
      edgeOk: fullPct > 0,
    }
  }, [result])

  // Deploy payload — translates sizing mode into what the Signal Bot expects.
  const deployPayload = useMemo(() => {
    const base = {
      asset: symbol.replace(/USDT$/, ''),
      strategy: strategyId,
      timeframe,
      params,
      direction,
      slPct: stopLossPct > 0 ? stopLossPct : undefined,
      // MTF filter — bot will reject trades that conflict with the HTF signal.
      ...(mtfFilter ? { mtfEnabled: true, mtfTimeframe } : {}),
    }
    if (sizingMode === 'volatility') {
      return {
        ...base,
        riskUsd: parseFloat((initialCapital * targetRiskPct / 100).toFixed(2)),
        sizingSlPct: stopLossPct > 0 ? stopLossPct : undefined,
      }
    }
    // Fixed mode: user enters notional in $. Convert to qty using the latest
    // price so the SignalBotsPage form receives a concrete `size` it can
    // display and the bot can trade with. Falls back to mid price if Binance
    // candles haven't loaded yet.
    const priceForQty = lastPrice > 0 ? lastPrice : (assetMidPx ?? 0)
    const qty = priceForQty > 0 ? deployUsd / priceForQty : 0
    return {
      ...base,
      size: parseFloat(qty.toFixed(6)),
    }
  }, [
    symbol, strategyId, timeframe, params, direction,
    stopLossPct, sizingMode, initialCapital, targetRiskPct, deployUsd,
    lastPrice, assetMidPx, mtfFilter, mtfTimeframe,
  ])

  const canDeploy = sizingMode === 'fixed' ? deployUsd > 0 : stopLossPct > 0
  const pairLabel = symbol.replace(/USDT$/, '/USDC')
  const dataCapped = candles.length >= MAX_BARS

  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5 lg:flex-row">
      <aside className="relative z-[35] flex h-fit w-full shrink-0 flex-col gap-4 lg:sticky lg:top-5 lg:max-h-[calc(100vh-40px)] lg:w-[300px] lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
        <div className="card p-4">
          <Controls
            symbol={symbol}
            symbols={symbols}
            timeframe={timeframe}
            startDate={startDate}
            endDate={endDate}
            strategyId={strategyId}
            params={params}
            direction={direction}
            initialCapital={initialCapital}
            feePct={feePct}
            stopLossPct={stopLossPct}
            sizingMode={sizingMode}
            targetRiskPct={targetRiskPct}
            loading={loading}
            onSymbol={onSymbol}
            onTimeframe={onTimeframe}
            onStartDate={setStartDate}
            onEndDate={setEndDate}
            onStrategy={handleStrategy}
            onParam={(key, value) => setParams((prev) => ({ ...prev, [key]: value }))}
            onDirection={setDirection}
            onCapital={setInitialCapital}
            onFee={setFeePct}
            onStopLoss={setStopLossPct}
            onSizingMode={setSizingMode}
            onTargetRisk={setTargetRiskPct}
            onReload={() => setReloadKey((k) => k + 1)}
            kellyHint={kellyHint}
            mtfFilter={mtfFilter}
            mtfTimeframe={mtfTimeframe}
            mtfHigherChoices={TIMEFRAMES.filter(
              (tf) => TIMEFRAMES.indexOf(tf) > TIMEFRAMES.indexOf(timeframe as typeof TIMEFRAMES[number]),
            )}
            onMtfFilter={setMtfFilter}
            onMtfTimeframe={setMtfTimeframe}
          />
        </div>

        {/* ── Deploy card — appears once a backtest has run ── */}
        {result && (
          <div className="card p-4">
            <div className="mb-3 flex items-center gap-1.5">
              <Rocket className="h-3.5 w-3.5 text-brand" />
              <p className="text-xs font-semibold text-text">Deploy as Signal Bot</p>
            </div>

            {/* What will be deployed */}
            <div className="mb-3 rounded-lg border border-border bg-panel-2 px-2.5 py-2 text-[10px] space-y-1">
              <div className="flex justify-between">
                <span className="text-dim">Asset</span>
                <span className="font-mono text-text">{pairLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Strategy</span>
                <span className="font-mono text-text">{strategyMeta(strategyId).name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Timeframe</span>
                <span className="font-mono text-text">{timeframe}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Direction</span>
                <span className="font-mono text-text capitalize">{direction}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Stop Loss</span>
                <span className={`font-mono ${stopLossPct > 0 ? 'text-text' : 'text-dim'}`}>
                  {stopLossPct > 0 ? `${stopLossPct}%` : 'off'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Exit</span>
                <span className="font-mono text-text text-[9px]">opposite signal</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">MTF filter</span>
                <span className={`font-mono ${mtfFilter ? 'text-brand' : 'text-dim'}`}>
                  {mtfFilter ? `ON · ${mtfTimeframe}` : 'off'}
                </span>
              </div>
            </div>

            {/* Sizing — matches the Risk & Sizing section above */}
            {sizingMode === 'volatility' ? (
              <div className="mb-3 rounded-lg border border-brand/20 bg-brand/5 px-2.5 py-2 text-[10px] space-y-1">
                <div className="flex items-center gap-1 text-brand font-semibold mb-1">
                  <Info className="h-3 w-3" />
                  Risk Mode will be pre-filled
                </div>
                <div className="flex justify-between">
                  <span className="text-dim">Risk USD</span>
                  <span className="font-mono text-text">
                    ${(initialCapital * targetRiskPct / 100).toFixed(2)}
                    <span className="text-dim ml-1">({targetRiskPct}% × ${initialCapital.toLocaleString()})</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dim">SL %</span>
                  <span className={`font-mono ${stopLossPct > 0 ? 'text-text' : 'text-loss'}`}>
                    {stopLossPct > 0 ? `${stopLossPct}%` : 'not set — required!'}
                  </span>
                </div>
                <p className="text-[9px] text-dim mt-1 leading-relaxed">
                  Signal Bot auto-computes qty from these two values.
                </p>
              </div>
            ) : (
              <div className="mb-3">
                <label className="mb-1 block text-[11px] text-dim">Position Size ($)</label>
                <NumberInput
                  className="field"
                  value={deployUsd}
                  min={1}
                  step={10}
                  onChange={setDeployUsd}
                />
                <p className="mt-1 text-[10px] text-dim">
                  Dollar notional per trade. Bot opens this position size at max leverage.
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={!canDeploy}
              onClick={() => {
                sessionStorage.setItem(
                  'pending_signal_bot_config',
                  JSON.stringify(deployPayload),
                )
                navigate('/signal')
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-bg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              title={canDeploy ? undefined : 'Set Stop Loss % above before deploying'}
            >
              <Rocket className="h-4 w-4" />
              Deploy to Signal Bot
            </button>
          </div>
        )}

        {/* ── Position Size card (consistent across pages) ── */}
        {(() => {
          const priceForCalc = lastPrice > 0 ? lastPrice : (assetMidPx ?? 0)
          const notional = sizingMode === 'volatility'
            ? (stopLossPct > 0 ? (initialCapital * targetRiskPct / 100) / (stopLossPct / 100) : 0)
            : deployUsd
          const qty = priceForCalc > 0 && notional > 0 ? notional / priceForCalc : 0
          return (
            <PositionSizeCard
              notional={notional}
              leverage={maxLeverage}
              slPct={stopLossPct}
              footnote={qty > 0 ? `≈ ${qty.toFixed(6)} ${symbol.replace(/USDT$/, '')} at $${priceForCalc.toFixed(2)}` : null}
            />
          )
        })()}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        {result && (
          <ConfidenceStrip result={result} regime={regime} direction={direction} />
        )}

        {result && (
          // Honesty line — keeps the headline numbers from being read as a promise.
          <p className="rounded-lg border border-border bg-panel-2/40 px-3 py-2 text-[11px] leading-relaxed text-dim">
            <span className="font-semibold text-muted">How to read this:</span>{' '}
            backtest fills at each bar's close on <span className="text-muted">Binance</span> candles and
            charges <span className="text-muted">{feePct}%</span> fee per side. It does <span className="text-muted">not</span>{' '}
            model slippage, spread, or perp funding, and the live bot trades on Hyperliquid — so real results
            run <span className="text-muted">lower</span> than shown. Trust the edge and the ranking, not the exact %.
          </p>
        )}

        <div className={`flex flex-col gap-4 ${mtfView ? 'xl:flex-row' : ''}`}>
          {/* ── Current TF chart ── */}
          <div className={`card p-4 ${mtfView ? 'xl:flex-1 xl:min-w-0' : ''}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-text font-display">
                {strategyMeta(strategyId).name}
                <span className="ml-2 text-xs text-dim font-sans font-normal">
                  {pairLabel} · {timeframe}
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm tabular-nums text-text">
                  {lastPrice ? fmtPrice(lastPrice) : '—'}
                </span>
                <span
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                    connected
                      ? 'border-gain/30 bg-gain/10 text-gain'
                      : 'border-border bg-panel text-dim'
                  }`}
                >
                  <Activity className="h-3 w-3" />
                  {connected ? 'Live' : isLiveRange ? 'Connecting' : 'Historical'}
                </span>
                <button
                  type="button"
                  onClick={() => setMtfView((v) => !v)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                    mtfView
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border bg-panel-2 text-muted hover:text-text'
                  }`}
                  title={mtfView ? 'Hide higher-timeframe chart' : 'Show higher-timeframe chart side by side'}
                >
                  <LayoutGrid className="h-3 w-3" />
                  MTF
                </button>
              </div>
            </div>

            {dataCapped && (
              <div className="mb-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] text-warn">
                Loaded the maximum {MAX_BARS.toLocaleString()} bars for this range. Earlier history
                was truncated — pick a coarser timeframe or a shorter date range to see the full
                window.
              </div>
            )}

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
              <ChartPanel
                candles={candles}
                output={output}
                trades={result?.trades ?? []}
                liveCandle={isLiveRange ? liveCandle : null}
                selectedTrade={selectedTrade}
                regimeLabels={regime?.labels}
              />
            )}
          </div>

          {/* ── HTF chart (only when MTF view is on) ── */}
          {mtfView && (
            <div className="card p-4 xl:flex-1 xl:min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text font-display">
                  Higher TF
                  <select
                    className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs font-mono text-text outline-none focus:border-brand/60"
                    value={mtfTimeframe}
                    onChange={(e) => setMtfTimeframe(e.target.value)}
                    title="Pick the higher timeframe to compare against"
                  >
                    {TIMEFRAMES.filter((tf) => TIMEFRAMES.indexOf(tf) > TIMEFRAMES.indexOf(timeframe as typeof TIMEFRAMES[number])).map((tf) => (
                      <option key={tf} value={tf}>{tf}</option>
                    ))}
                  </select>
                  <span className="text-xs text-dim font-sans font-normal">{pairLabel}</span>
                </h2>
                <div className="flex items-center gap-2">
                  {confluence && (
                    <span
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${
                        confluence.kind === 'aligned'
                          ? 'border-gain/40 bg-gain/10 text-gain'
                          : confluence.kind === 'conflict'
                          ? 'border-loss/40 bg-loss/10 text-loss'
                          : 'border-warn/40 bg-warn/10 text-warn'
                      }`}
                      title={confluence.text}
                    >
                      {confluence.kind === 'aligned' ? '✓ ALIGNED' : confluence.kind === 'conflict' ? '✗ CONFLICT' : '~ NEUTRAL'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setMtfView(false)}
                    className="flex items-center justify-center rounded-md border border-border bg-panel-2 p-1 text-dim transition-colors hover:text-text"
                    title="Close MTF view"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {confluence && (
                <p className="mb-3 text-[11px] text-dim leading-snug">{confluence.text}.</p>
              )}

              {htfError ? (
                <div className="flex h-[480px] flex-col items-center justify-center gap-2 text-center">
                  <p className="text-sm font-medium text-loss">Could not load {mtfTimeframe} data</p>
                  <p className="max-w-sm text-xs text-dim">{htfError}</p>
                </div>
              ) : htfLoading && htfCandles.length === 0 ? (
                <div className="flex h-[480px] items-center justify-center text-sm text-dim">
                  Loading {mtfTimeframe}…
                </div>
              ) : (
                <ChartPanel
                  candles={htfCandles}
                  output={htfOutput}
                  trades={[]}
                  liveCandle={null}
                  regimeLabels={htfRegime?.labels}
                />
              )}
            </div>
          )}
        </div>

        {result ? (
          <>
            <SummaryPanel
              result={result}
              regime={regime}
              strategyName={strategyMeta(strategyId).name}
              direction={direction}
              symbol={symbol.replace(/USDT$/, '/USDC')}
            />
            <RegimeBreakdownCard
              result={result}
              regime={regime}
              candles={candles}
            />
            <ParamStabilityCard
              candles={candles}
              strategyId={strategyId}
              params={params}
              initialCapital={initialCapital}
              feePct={feePct}
              direction={direction}
              sizingMode={sizingMode}
            />
            <Results
              result={result}
              candles={candles}
              stopLossPct={stopLossPct}
              takeProfitPct={0}
              selectedTrade={selectedTrade}
              onSelectTrade={setSelectedTrade}
            />
          </>
        ) : (
          !loading &&
          !error && (
            <div className="card p-8 text-center text-sm text-dim">
              Not enough candles in this range to run a backtest.
            </div>
          )
        )}
      </section>
    </main>
  )
}
