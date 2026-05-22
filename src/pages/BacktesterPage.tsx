import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import type { Candle, Direction, StrategyId, Trade } from '@/types'
import { fetchKlines, MAX_BARS, subscribeKline, type SymbolInfo } from '@/lib/binance'
import { defaultParams, generateSignals, strategyMeta, type StrategyOutput } from '@/lib/strategies'
import { runBacktest } from '@/lib/backtest'
import { fmtPrice } from '@/lib/format'
import ChartPanel from '@/components/ChartPanel'
import Controls from '@/components/Controls'
import RegimePanel from '@/components/RegimePanel'
import EnsemblePanel from '@/components/EnsemblePanel'
import WalkForwardPanel from '@/components/WalkForwardPanel'
import MultiTFPanel from '@/components/MultiTFPanel'
import CorrelationPanel from '@/components/CorrelationPanel'
import Results from '@/components/Results'
import { runEnsemble, type EnsembleConfig } from '@/lib/ensemble'
import { analyzeRegime } from '@/lib/markov'
import { walkForward } from '@/lib/walkforward'
import { getMultiTFConfluence, type MultiTFResult } from '@/lib/multiTF'
import type { Signal } from '@/types'

interface Props {
  symbol: string
  timeframe: string
  symbols: SymbolInfo[]
  onSymbol: (v: string) => void
  onTimeframe: (v: string) => void
}

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function BacktesterPage({
  symbol,
  timeframe,
  symbols,
  onSymbol,
  onTimeframe,
}: Props) {
  const [startDate, setStartDate] = useState(() => localStorage.getItem('bt_startDate') || '')
  const [endDate, setEndDate] = useState(() => localStorage.getItem('bt_endDate') || '')
  const [strategyId, setStrategyId] = useState<StrategyId>(() => (localStorage.getItem('bt_strategyId') as StrategyId) || 'macd')
  
  const [params, setParams] = useState<Record<string, number>>(() => {
    try {
      const activeId = localStorage.getItem('bt_strategyId') || 'macd'
      const saved = localStorage.getItem(`bt_params_${activeId}`)
      return saved ? JSON.parse(saved) : defaultParams(activeId as StrategyId)
    } catch {
      const activeId = localStorage.getItem('bt_strategyId') || 'macd'
      return defaultParams(activeId as StrategyId)
    }
  })
  
  const [direction, setDirection] = useState<Direction>(() => (localStorage.getItem('bt_direction') as Direction) || 'long')
  const [initialCapital, setInitialCapital] = useState(() => +(localStorage.getItem('bt_initialCapital') || '10000'))
  const [feePct, setFeePct] = useState(() => +(localStorage.getItem('bt_feePct') || '0.1'))
  const [stopLossPct, setStopLossPct] = useState(() => +(localStorage.getItem('bt_stopLossPct') || '0'))
  const [takeProfitPct, setTakeProfitPct] = useState(() => +(localStorage.getItem('bt_takeProfitPct') || '0'))
  const [positionMode, setPositionMode] = useState<'fixed' | 'compounding' | 'volatility'>(() => (localStorage.getItem('bt_positionMode') as any) || 'fixed')
  const [targetRiskPct, setTargetRiskPct] = useState(() => +(localStorage.getItem('bt_targetRiskPct') || '2'))
  const [atrMultiplier, setAtrMultiplier] = useState(() => +(localStorage.getItem('bt_atrMultiplier') || '1.5'))

  useEffect(() => {
    localStorage.setItem('bt_startDate', startDate)
  }, [startDate])
  useEffect(() => {
    localStorage.setItem('bt_endDate', endDate)
  }, [endDate])
  useEffect(() => {
    localStorage.setItem('bt_strategyId', strategyId)
  }, [strategyId])
  useEffect(() => {
    localStorage.setItem(`bt_params_${strategyId}`, JSON.stringify(params))
  }, [params, strategyId])
  useEffect(() => {
    localStorage.setItem('bt_direction', direction)
  }, [direction])
  useEffect(() => {
    localStorage.setItem('bt_initialCapital', String(initialCapital))
  }, [initialCapital])
  useEffect(() => {
    localStorage.setItem('bt_feePct', String(feePct))
  }, [feePct])
  useEffect(() => {
    localStorage.setItem('bt_stopLossPct', String(stopLossPct))
  }, [stopLossPct])
  useEffect(() => {
    localStorage.setItem('bt_takeProfitPct', String(takeProfitPct))
  }, [takeProfitPct])
  useEffect(() => {
    localStorage.setItem('bt_positionMode', positionMode)
  }, [positionMode])
  useEffect(() => {
    localStorage.setItem('bt_targetRiskPct', String(targetRiskPct))
  }, [targetRiskPct])
  useEffect(() => {
    localStorage.setItem('bt_atrMultiplier', String(atrMultiplier))
  }, [atrMultiplier])

  // Ensemble states
  const [ensembleActive, setEnsembleActive] = useState(false)
  const [ensembleStrategies, setEnsembleStrategies] = useState<StrategyId[]>(['macd', 'ema', 'supertrend', 'rsi', 'bollinger'])
  const [ensembleConfig, setEnsembleConfig] = useState<EnsembleConfig>({
    mode: 'vote',
    threshold: 3,
    regimeWeights: true,
  })

  // Confluence states
  const [confluence, setConfluence] = useState<MultiTFResult | null>(null)
  const [confluenceLoading, setConfluenceLoading] = useState(false)

  const [candles, setCandles] = useState<Candle[]>([])
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)

  const isLiveRange = endDate === '' || endDate === todayIso()

  // Reset selectedTrade when backtest parameters change
  useEffect(() => {
    setSelectedTrade(null)
  }, [
    symbol,
    timeframe,
    startDate,
    endDate,
    strategyId,
    params,
    direction,
    initialCapital,
    feePct,
    stopLossPct,
    takeProfitPct,
    positionMode,
    targetRiskPct,
    atrMultiplier,
    ensembleActive,
    ensembleStrategies,
    ensembleConfig,
  ])

  // Load candles whenever the market, timeframe or date range changes.
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
    return () => {
      cancelled = true
    }
  }, [symbol, timeframe, startDate, endDate, reloadKey])

  // Live price stream — only for ranges that include the present.
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

  // Fetch higher TF confluence
  useEffect(() => {
    if (candles.length < 30) {
      setConfluence(null)
      return
    }
    setConfluenceLoading(true)
    getMultiTFConfluence(symbol, timeframe, candles)
      .then((res) => {
        setConfluence(res)
        setConfluenceLoading(false)
      })
      .catch(() => {
        setConfluence(null)
        setConfluenceLoading(false)
      })
  }, [symbol, timeframe, candles.length])

  // Compute regime analysis once for sharing
  const regime = useMemo(() => {
    if (candles.length < 30) return null
    return analyzeRegime(candles)
  }, [candles])

  // Run the backtest whenever inputs change (instant, client-side).
  const { output, result } = useMemo(() => {
    if (candles.length < 35) return { output: null, result: null }
    
    let out: StrategyOutput
    let signals: Signal[]
    
    if (ensembleActive) {
      const ensembleRes = runEnsemble(candles, ensembleStrategies, ensembleConfig, regime)
      signals = ensembleRes.signals
      
      // For the chart, show overlays from the currently selected strategy,
      // but override the signals with ensemble signals.
      const baseOut = generateSignals(strategyId, candles, params)
      out = { ...baseOut, signals }
    } else {
      out = generateSignals(strategyId, candles, params)
      signals = out.signals
    }
    
    const res = runBacktest(
      candles,
      signals,
      initialCapital,
      feePct / 100,
      direction,
      stopLossPct,
      takeProfitPct,
      positionMode,
      targetRiskPct,
      atrMultiplier,
    )
    return { output: out, result: res }
  }, [
    candles,
    strategyId,
    params,
    initialCapital,
    feePct,
    direction,
    stopLossPct,
    takeProfitPct,
    positionMode,
    targetRiskPct,
    atrMultiplier,
    ensembleActive,
    ensembleStrategies,
    ensembleConfig,
    regime,
  ])

  // Run walk-forward validation when parameters or strategy change
  const walkForwardResult = useMemo(() => {
    if (candles.length < 50 || ensembleActive) return null
    return walkForward(
      candles,
      strategyId,
      params,
      5,
      initialCapital,
      feePct / 100,
      direction,
      positionMode,
    )
  }, [candles, strategyId, params, initialCapital, feePct, direction, positionMode, ensembleActive])

  const handleStrategy = (id: StrategyId) => {
    setStrategyId(id)
    let initialParams = defaultParams(id)
    try {
      const saved = localStorage.getItem(`bt_params_${id}`)
      if (saved) initialParams = JSON.parse(saved)
    } catch {}
    setParams(initialParams)
  }

  const pairLabel = symbol.replace(/USDT$/, '/USDT')
  const lastPrice = liveCandle?.close ?? candles[candles.length - 1]?.close ?? 0
  const dataCapped = candles.length >= MAX_BARS

  return (
    <main className="mx-auto flex w-full max-w-[2200px] flex-1 flex-col gap-4 px-6 py-5 lg:flex-row">
      <aside className="relative z-[35] flex h-fit w-full shrink-0 flex-col gap-4 lg:sticky lg:top-[97px] lg:max-h-[calc(100vh-113px)] lg:w-[300px] lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
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
            takeProfitPct={takeProfitPct}
            positionMode={positionMode}
            targetRiskPct={targetRiskPct}
            atrMultiplier={atrMultiplier}
            loading={loading}
            onSymbol={onSymbol}
            onTimeframe={onTimeframe}
            onStartDate={setStartDate}
            onEndDate={setEndDate}
            onStrategy={handleStrategy}
            onParam={(key, value) =>
              setParams((prev) => ({ ...prev, [key]: value }))
            }
            onDirection={setDirection}
            onCapital={setInitialCapital}
            onFee={setFeePct}
            onStopLoss={setStopLossPct}
            onTakeProfit={setTakeProfitPct}
            onPositionMode={setPositionMode}
            onTargetRisk={setTargetRiskPct}
            onAtrMultiplier={setAtrMultiplier}
            onReload={() => setReloadKey((k) => k + 1)}
          />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text font-display">
              {strategyMeta(strategyId).name}
              <span className="ml-2 text-xs text-dim font-sans font-normal">
                {pairLabel} · {timeframe}
              </span>
            </h2>
            <div className="flex items-center gap-3">
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
            </div>
          </div>

          {dataCapped && (
            <div className="mb-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] text-warn">
              Loaded the maximum {MAX_BARS.toLocaleString()} bars for this range.
              Earlier history was truncated — pick a coarser timeframe or a shorter date range to see the full window.
            </div>
          )}

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
            <ChartPanel
              candles={candles}
              output={output}
              trades={result?.trades ?? []}
              liveCandle={isLiveRange ? liveCandle : null}
              selectedTrade={selectedTrade}
            />
          )}
        </div>

        {candles.length >= 30 && (
          <MultiTFPanel
            confluence={confluence}
            loading={confluenceLoading}
            currentTF={timeframe}
          />
        )}

        {candles.length >= 30 && (
          <RegimePanel
            candles={candles}
            currentStrategy={strategyId}
            onApplyStrategy={handleStrategy}
          />
        )}

        {candles.length >= 30 && (
          <EnsemblePanel
            candles={candles}
            regime={regime}
            activeStrategyId={strategyId}
            ensembleActive={ensembleActive}
            onToggleEnsemble={setEnsembleActive}
            onApplyEnsembleConfig={(ids, config) => {
              setEnsembleStrategies(ids)
              setEnsembleConfig(config)
            }}
          />
        )}

         {candles.length >= 30 && (
          <CorrelationPanel
            candles={candles}
            currentStrategyId={strategyId}
            initialCapital={initialCapital}
            feePct={feePct}
            direction={direction}
            positionMode={positionMode}
            targetRiskPct={targetRiskPct}
            atrMultiplier={atrMultiplier}
            onApplyStrategy={handleStrategy}
            ensembleActive={ensembleActive}
            ensembleStrategies={ensembleStrategies}
          />
        )}

        {result ? (
          <>
            <Results
              result={result}
              candles={candles}
              stopLossPct={stopLossPct}
              takeProfitPct={takeProfitPct}
              selectedTrade={selectedTrade}
              onSelectTrade={setSelectedTrade}
            />
            {!ensembleActive && (
              <WalkForwardPanel result={walkForwardResult} loading={loading} />
            )}
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
