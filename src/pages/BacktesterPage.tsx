import { useEffect, useMemo, useState } from 'react'
import { Activity, Info, Rocket } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Candle, Direction, StrategyId, Trade } from '@/types'
import { fetchKlines, MAX_BARS, subscribeKline } from '@/lib/binance'
import { defaultParams, generateSignals, strategyMeta } from '@/lib/strategies'
import { runBacktest } from '@/lib/backtest'
import { fmtPrice } from '@/lib/format'
import { useHLAssets } from '@/lib/hlAssets'
import ChartPanel from '@/components/ChartPanel'
import Controls from '@/components/Controls'
import NumberInput from '@/components/NumberInput'
import Results from '@/components/Results'
import SummaryPanel from '@/components/SummaryPanel'
import { analyzeRegime } from '@/lib/markov'

interface Props {
  symbol: string
  timeframe: string
  onSymbol: (v: string) => void
  onTimeframe: (v: string) => void
}

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function BacktesterPage({
  symbol,
  timeframe,
  onSymbol,
  onTimeframe,
}: Props) {
  const { symbols } = useHLAssets()
  const navigate = useNavigate()
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
  const [takeProfitPct, setTakeProfitPct] = useState(
    () => +(localStorage.getItem('bt_takeProfitPct') || '0'),
  )
  const [positionMode, setPositionMode] = useState<'fixed' | 'compounding' | 'volatility'>(
    () => (localStorage.getItem('bt_positionMode') as 'fixed' | 'compounding' | 'volatility') || 'fixed',
  )
  const [targetRiskPct, setTargetRiskPct] = useState(
    () => +(localStorage.getItem('bt_targetRiskPct') || '2'),
  )
  const [atrMultiplier, setAtrMultiplier] = useState(
    () => +(localStorage.getItem('bt_atrMultiplier') || '1.5'),
  )

  // Deploy card state
  const [deploySize, setDeploySize] = useState(
    () => +(localStorage.getItem('bt_deploySize') || '0.01'),
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
  useEffect(() => {
    localStorage.setItem('bt_deploySize', String(deploySize))
  }, [deploySize])

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
    initialCapital, feePct, stopLossPct, takeProfitPct, positionMode,
    targetRiskPct, atrMultiplier,
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
      takeProfitPct,
      positionMode,
      targetRiskPct,
      atrMultiplier,
    )
    return { output: out, result: res }
  }, [
    candles, strategyId, params, initialCapital, feePct, direction,
    stopLossPct, takeProfitPct, positionMode, targetRiskPct, atrMultiplier,
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

  // What gets passed to the Signal Bot on deploy.
  // Volatility mode → translate to Risk USD + SL% so Signal Bot's sizing calculator is pre-filled.
  const deployPayload = useMemo(() => {
    const base = {
      asset: symbol.replace(/USDT$/, ''),
      strategy: strategyId,
      timeframe,
      params,
      direction,
      slPct: stopLossPct > 0 ? stopLossPct : undefined,
      tpPct: takeProfitPct > 0 ? takeProfitPct : undefined,
    }
    if (positionMode === 'volatility') {
      // Risk USD = targetRiskPct% of capital; SL% already set in risk controls.
      return {
        ...base,
        riskUsd: parseFloat((initialCapital * targetRiskPct / 100).toFixed(2)),
        sizingSlPct: stopLossPct > 0 ? stopLossPct : undefined,
      }
    }
    return { ...base, size: deploySize }
  }, [
    symbol, strategyId, timeframe, params, direction,
    stopLossPct, takeProfitPct, positionMode, initialCapital, targetRiskPct, deploySize,
  ])

  const pairLabel = symbol.replace(/USDT$/, '/USDT')
  const lastPrice = liveCandle?.close ?? candles[candles.length - 1]?.close ?? 0
  const dataCapped = candles.length >= MAX_BARS

  return (
    <main className="mx-auto flex w-full max-w-[2200px] flex-1 flex-col gap-4 px-6 py-5 lg:flex-row">
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
            onParam={(key, value) => setParams((prev) => ({ ...prev, [key]: value }))}
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

        {/* ── Deploy card — only shown once there are backtest results ── */}
        {result && (
          <div className="card p-4">
            <div className="mb-3 flex items-center gap-1.5">
              <Rocket className="h-3.5 w-3.5 text-brand" />
              <p className="text-xs font-semibold text-text">Deploy as Signal Bot</p>
            </div>

            {/* What gets deployed */}
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
                <span className="text-dim">SL / TP</span>
                <span className={`font-mono ${stopLossPct > 0 || takeProfitPct > 0 ? 'text-text' : 'text-dim'}`}>
                  {stopLossPct > 0 ? `${stopLossPct}%` : 'off'} / {takeProfitPct > 0 ? `${takeProfitPct}%` : 'off'}
                </span>
              </div>
            </div>

            {/* Order sizing — translates from backtest positionMode */}
            {positionMode === 'volatility' ? (
              <div className="mb-3 rounded-lg border border-brand/20 bg-brand/5 px-2.5 py-2 text-[10px] space-y-1">
                <div className="flex items-center gap-1 text-brand font-semibold mb-1">
                  <Info className="h-3 w-3" />
                  Risk mode will be pre-filled
                </div>
                <div className="flex justify-between">
                  <span className="text-dim">Risk USD</span>
                  <span className="font-mono text-text">
                    ${(initialCapital * targetRiskPct / 100).toFixed(2)}
                    <span className="text-dim ml-1">({targetRiskPct}% of ${initialCapital.toLocaleString()})</span>
                  </span>
                </div>
                {stopLossPct > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dim">SL % (sizing)</span>
                    <span className="font-mono text-text">{stopLossPct}%</span>
                  </div>
                )}
                <p className="text-[9px] text-dim mt-1 leading-relaxed">
                  Signal Bot will auto-compute qty from these values.
                </p>
              </div>
            ) : (
              <div className="mb-3">
                {positionMode === 'compounding' && (
                  <p className="mb-2 rounded-md border border-warn/30 bg-warn/5 px-2 py-1 text-[10px] text-warn">
                    Compounding isn't supported by the bot — will run as fixed size.
                  </p>
                )}
                <label className="mb-1 block text-[11px] text-dim">Order Size (qty per trade)</label>
                <NumberInput
                  className="field"
                  value={deploySize}
                  min={0.0001}
                  step={0.001}
                  onChange={setDeploySize}
                />
                <p className="mt-1 text-[10px] text-dim">
                  Number of contracts the bot places on each signal.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem(
                  'pending_signal_bot_config',
                  JSON.stringify(deployPayload),
                )
                navigate('/signal')
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            >
              <Rocket className="h-4 w-4" />
              Deploy to Signal Bot
            </button>
          </div>
        )}
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
            />
          )}
        </div>

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
            <SummaryPanel
              result={result}
              regime={regime}
              strategyName={strategyMeta(strategyId).name}
              direction={direction}
              symbol={symbol.replace(/USDT$/, '/USDT')}
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
