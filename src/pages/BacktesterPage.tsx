import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import type { Candle, Direction, StrategyId } from '@/types'
import { fetchKlines, subscribeKline, type SymbolInfo } from '@/lib/binance'
import { defaultParams, generateSignals, strategyMeta } from '@/lib/strategies'
import { runBacktest } from '@/lib/backtest'
import { fmtPrice } from '@/lib/format'
import ChartPanel from '@/components/ChartPanel'
import Controls from '@/components/Controls'
import Results from '@/components/Results'

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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [strategyId, setStrategyId] = useState<StrategyId>('macd')
  const [params, setParams] = useState<Record<string, number>>(defaultParams('macd'))
  const [direction, setDirection] = useState<Direction>('long')
  const [initialCapital, setInitialCapital] = useState(10000)
  const [feePct, setFeePct] = useState(0.1)

  const [candles, setCandles] = useState<Candle[]>([])
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const isLiveRange = endDate === '' || endDate === todayIso()

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

  // Run the backtest whenever inputs change (instant, client-side).
  const { output, result } = useMemo(() => {
    if (candles.length < 35) return { output: null, result: null }
    const out = generateSignals(strategyId, candles, params)
    const res = runBacktest(
      candles,
      out.signals,
      initialCapital,
      feePct / 100,
      direction,
    )
    return { output: out, result: res }
  }, [candles, strategyId, params, initialCapital, feePct, direction])

  const handleStrategy = (id: StrategyId) => {
    setStrategyId(id)
    setParams(defaultParams(id))
  }

  const pairLabel = symbol.replace(/USDT$/, '/USDT')
  const lastPrice = liveCandle?.close ?? candles[candles.length - 1]?.close ?? 0

  return (
    <main className="mx-auto flex w-full max-w-[2200px] flex-1 flex-col gap-4 px-6 py-5 lg:flex-row">
      <aside className="card h-fit w-full shrink-0 p-4 lg:sticky lg:top-[97px] lg:w-[300px]">
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
          onReload={() => setReloadKey((k) => k + 1)}
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-text">
              {strategyMeta(strategyId).name}
              <span className="ml-2 text-xs text-dim">
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
            />
          )}
        </div>

        {result ? (
          <Results result={result} candles={candles} />
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
