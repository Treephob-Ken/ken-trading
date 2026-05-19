import { useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
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
import GridChart from '@/components/GridChart'
import GridControls from '@/components/GridControls'
import GridStats from '@/components/GridStats'

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
  const [lookback, setLookback] = useState(150)
  const [mode, setMode] = useState<GridMode>('arithmetic')
  const [gridType, setGridType] = useState<GridType>('neutral')
  const [minGrids, setMinGrids] = useState(3)
  const [maxGrids, setMaxGrids] = useState(50)
  const [feePct, setFeePct] = useState(0.05)
  const [investment, setInvestment] = useState(10000)
  const [reanchor, setReanchor] = useState(true)

  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

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

  return (
    <main className="mx-auto flex w-full max-w-[2200px] flex-1 flex-col gap-4 px-6 py-5 lg:flex-row">
      <aside className="card h-fit w-full shrink-0 p-4 lg:sticky lg:top-[97px] lg:w-[300px]">
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
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-text">
              Grid Optimizer
              <span className="ml-2 text-xs text-dim">
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
              <HowToAnalyze />
            </div>
            <GridStats
              result={result}
              windowBars={bars.length}
              timeframe={timeframe}
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
