import { useEffect, useRef, useState } from 'react'
import { ChevronsRight, Eye, EyeOff } from 'lucide-react'
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
  type ISeriesMarkersPluginApi,
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

export default function ChartPanel({ candles, output, trades, liveCandle, selectedTrade }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const tradePriceLinesRef = useRef<IPriceLine[]>([])

  // Marker plugin + the two marker groups, kept in refs so the visibility
  // toggle can re-apply them without rebuilding the whole chart.
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const waveMarkersRef = useRef<SeriesMarker<Time>[]>([])
  const tradeMarkersRef = useRef<SeriesMarker<Time>[]>([])

  const [showSignals, setShowSignals] = useState(true)

  // Chart structural build — rebuilds on backtest input changes (infrequent).
  useEffect(() => {
    const el = containerRef.current
    if (!el || candles.length === 0) return

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b93a7',
        fontFamily: "'Inter', system-ui, sans-serif",
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

    waveMarkersRef.current = (output?.waveMarkers ?? []).map((wm) => ({
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
    tradeMarkersRef.current = tradeMarkerList
    markersApiRef.current = createSeriesMarkers(candleSeries, [])

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
      markersApiRef.current = null
      tradePriceLinesRef.current = []
    }
  }, [candles, output, trades])

  // Apply markers — wave markers always show; trade BUY/SELL markers obey
  // the visibility toggle. Runs after the build effect repopulates the refs.
  useEffect(() => {
    const api = markersApiRef.current
    if (!api) return
    const list = [
      ...waveMarkersRef.current,
      ...(showSignals ? tradeMarkersRef.current : []),
    ]
    list.sort((a, b) => (a.time as number) - (b.time as number))
    api.setMarkers(list)
  }, [showSignals, candles, output, trades])

  // Zoom to selected trade and add entry/exit price lines
  useEffect(() => {
    const series = candleSeriesRef.current
    const chart = chartRef.current

    for (const pl of tradePriceLinesRef.current) {
      try {
        series?.removePriceLine(pl)
      } catch {}
    }
    tradePriceLinesRef.current = []

    if (!series || !chart || !selectedTrade) return

    const candleDiff = candles.length > 1 ? (candles[1].time - candles[0].time) : 60
    chart.timeScale().setVisibleRange({
      from: (selectedTrade.entryTime - candleDiff * 12) as UTCTimestamp,
      to: (selectedTrade.exitTime + candleDiff * 25) as UTCTimestamp,
    })

    const entryLine = series.createPriceLine({
      price: selectedTrade.entryPrice,
      color: '#10b981',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `ENTRY (${selectedTrade.side.toUpperCase()})`,
    })

    const exitLine = series.createPriceLine({
      price: selectedTrade.exitPrice,
      color: '#ef4444',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'EXIT',
    })

    tradePriceLinesRef.current = [entryLine, exitLine]
  }, [selectedTrade, candles])

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

  const goToLatest = () => {
    chartRef.current?.timeScale().scrollToRealTime()
  }

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <button
          onClick={() => setShowSignals((v) => !v)}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 transition ${
            showSignals
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border bg-panel-2 text-muted hover:border-border-strong hover:text-text'
          }`}
          title="Show or hide BUY/SELL trade markers on the chart"
        >
          {showSignals ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {showSignals ? 'Hide Buy/Sell' : 'Show Buy/Sell'}
        </button>
        <button
          onClick={goToLatest}
          className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-muted transition hover:border-border-strong hover:text-text"
          title="Jump to the most recent price"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
          Latest Price
        </button>
      </div>
      <div ref={containerRef} className="h-[480px] w-full" />
    </div>
  )
}
