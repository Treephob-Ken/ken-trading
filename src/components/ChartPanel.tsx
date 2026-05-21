import { useEffect, useRef, useState } from 'react'
import { Minus, Trash2 } from 'lucide-react'
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle, Trade } from '@/types'
import type { StrategyOutput } from '@/lib/strategies'

interface Props {
  candles: Candle[]
  output: StrategyOutput | null
  trades: Trade[]
  liveCandle: Candle | null
  selectedTrade?: Trade | null
}

const t = (n: number) => n as UTCTimestamp

type Tool = null | 'hline'

export default function ChartPanel({ candles, output, trades, liveCandle, selectedTrade }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const userPriceLineRefs = useRef<IPriceLine[]>([])
  const tradePriceLinesRef = useRef<IPriceLine[]>([])

  // User-placed horizontal lines — persist across chart rebuilds.
  const [hLines, setHLines] = useState<number[]>([])
  const [tool, setTool] = useState<Tool>(null)

  // Chart structural build — rebuilds on backtest input changes (infrequent).
  useEffect(() => {
    const el = containerRef.current
    if (!el || candles.length === 0) return

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b93a7',
        fontFamily: "'Outfit', system-ui, sans-serif",
        panes: { separatorColor: '#222838', separatorHoverColor: '#2f3650' },
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3142' },
      rightPriceScale: { borderColor: '#2a3142' },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    })
    candleSeries.setData(
      candles.map((c) => ({
        time: t(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )
    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    userPriceLineRefs.current = []

    for (const ln of output?.mainLines ?? []) {
      const s = chart.addSeries(LineSeries, {
        color: ln.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      s.setData(ln.data.map((d) => ({ time: t(d.time), value: d.value })))
    }

    const waveMarkerList: SeriesMarker<Time>[] = (output?.waveMarkers ?? []).map((wm) => ({
      time: t(wm.time),
      position: wm.position,
      color: '#a78bfa',
      shape: 'circle' as const,
      text: wm.label,
      size: 0.5,
    }))

    const tradeMarkerList: SeriesMarker<Time>[] = []
    for (const tr of trades) {
      tradeMarkerList.push({
        time: t(tr.entryTime),
        position: 'belowBar',
        color: '#10b981',
        shape: 'arrowUp',
        text: 'BUY',
      })
      tradeMarkerList.push({
        time: t(tr.exitTime),
        position: 'aboveBar',
        color: '#ef4444',
        shape: 'arrowDown',
        text: 'SELL',
      })
    }

    const allMarkers = [...waveMarkerList, ...tradeMarkerList]
    if (allMarkers.length > 0) {
      allMarkers.sort((a, b) => (a.time as number) - (b.time as number))
      createSeriesMarkers(candleSeries, allMarkers)
    }

    for (const pl of output?.priceLines ?? []) {
      candleSeries.createPriceLine({
        price: pl.price,
        color: pl.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: pl.label,
      })
    }

    const sub = output?.subPane
    if (sub) {
      if (sub.hist && sub.hist.length > 0) {
        const h = chart.addSeries(
          HistogramSeries,
          { priceLineVisible: false, lastValueVisible: false },
          1,
        )
        h.setData(
          sub.hist.map((d) => ({ time: t(d.time), value: d.value, color: d.color })),
        )
      }
      sub.lines.forEach((ln, idx) => {
        const s = chart.addSeries(
          LineSeries,
          {
            color: ln.color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          1,
        )
        s.setData(ln.data.map((d) => ({ time: t(d.time), value: d.value })))
        if (idx === 0 && sub.refLines) {
          for (const level of sub.refLines) {
            s.createPriceLine({
              price: level,
              color: '#5b6478',
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: '',
            })
          }
        }
      })
      const panes = chart.panes()
      if (panes[1]) panes[1].setHeight(150)
    }

    chart.timeScale().fitContent()

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      userPriceLineRefs.current = []
      tradePriceLinesRef.current = []
    }
  }, [candles, output, trades])

  // Zoom to selected trade and add entry/exit price lines
  useEffect(() => {
    const series = candleSeriesRef.current
    const chart = chartRef.current

    // Clean up any existing trade price lines
    for (const pl of tradePriceLinesRef.current) {
      try {
        series?.removePriceLine(pl)
      } catch {}
    }
    tradePriceLinesRef.current = []

    if (!series || !chart || !selectedTrade) return

    // Zoom to the trade
    const candleDiff = candles.length > 1 ? (candles[1].time - candles[0].time) : 60
    chart.timeScale().setVisibleRange({
      from: (selectedTrade.entryTime - candleDiff * 12) as UTCTimestamp,
      to: (selectedTrade.exitTime + candleDiff * 25) as UTCTimestamp,
    })

    // Create entry price line (green)
    const entryLine = series.createPriceLine({
      price: selectedTrade.entryPrice,
      color: '#10b981', // green
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `ENTRY (${selectedTrade.side.toUpperCase()})`,
    })

    // Create exit price line (red)
    const exitLine = series.createPriceLine({
      price: selectedTrade.exitPrice,
      color: '#ef4444', // red
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'EXIT',
    })

    tradePriceLinesRef.current = [entryLine, exitLine]
  }, [selectedTrade, candles])

  // Apply user horizontal lines whenever they change OR the chart is rebuilt.
  // We diff old refs against new prices so unchanged lines aren't recreated.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return
    for (const ref of userPriceLineRefs.current) {
      try { series.removePriceLine(ref) } catch { /* series may be gone */ }
    }
    userPriceLineRefs.current = hLines.map((price) =>
      series.createPriceLine({
        price,
        color: '#3b82f6',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: '',
      }),
    )
  }, [hLines, candles])

  // Click subscription depends on the active tool and the chart instance.
  useEffect(() => {
    const chart = chartRef.current
    const series = candleSeriesRef.current
    if (!chart || !series || !tool) return
    const handler = (param: { point?: { x: number; y: number } }) => {
      if (!param.point) return
      const price = series.coordinateToPrice(param.point.y)
      if (price === null) return
      if (tool === 'hline') {
        setHLines((prev) => [...prev, +price.toFixed(8)])
        setTool(null)
      }
    }
    chart.subscribeClick(handler)
    return () => chart.unsubscribeClick(handler)
  }, [tool, candles])

  // Live tick — updates the forming candle without rebuilding the chart.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (series && liveCandle) {
      series.update({
        time: t(liveCandle.time),
        open: liveCandle.open,
        high: liveCandle.high,
        low: liveCandle.low,
        close: liveCandle.close,
      })
    }
  }, [liveCandle])

  const cursorClass = tool === 'hline' ? 'cursor-crosshair' : ''

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 text-[11px] text-dim">Drawings:</span>
        <button
          onClick={() => setTool((t) => (t === 'hline' ? null : 'hline'))}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 transition ${
            tool === 'hline'
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border bg-panel-2 text-muted hover:border-border-strong hover:text-text'
          }`}
          title="Click on chart to place a horizontal price line"
        >
          <Minus className="h-3.5 w-3.5" />
          Horizontal line
        </button>
        <button
          disabled
          className="flex cursor-not-allowed items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-dim opacity-50"
          title="Coming soon"
        >
          ↗ Trend line
        </button>
        <button
          disabled
          className="flex cursor-not-allowed items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-dim opacity-50"
          title="Coming soon"
        >
          Fib
        </button>
        <div className="ml-1 h-4 w-px bg-border" />
        <button
          onClick={() => { setHLines([]); setTool(null) }}
          disabled={hLines.length === 0}
          className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-muted transition hover:border-loss/40 hover:text-loss disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear ({hLines.length})
        </button>
        {tool === 'hline' && (
          <span className="ml-2 text-[11px] text-brand">Click anywhere on the chart to place a line</span>
        )}
      </div>
      <div ref={containerRef} className={`h-[480px] w-full ${cursorClass}`} />
    </div>
  )
}
