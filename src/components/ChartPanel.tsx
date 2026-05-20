import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
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
}

const t = (n: number) => n as UTCTimestamp

export default function ChartPanel({ candles, output, trades, liveCandle }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  // Structural rebuild — runs when the backtest inputs change (infrequent).
  useEffect(() => {
    const el = containerRef.current
    if (!el || candles.length === 0) return

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b93a7',
        fontFamily: 'Inter, system-ui, sans-serif',
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
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
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

    // Wave labels (Elliott Wave markers)
    const waveMarkerList: SeriesMarker<Time>[] = (output?.waveMarkers ?? []).map((wm) => ({
      time: t(wm.time),
      position: wm.position,
      color: '#a78bfa',
      shape: 'circle' as const,
      text: wm.label,
      size: 0.5,
    }))

    // Trade markers
    const tradeMarkerList: SeriesMarker<Time>[] = []
    for (const tr of trades) {
      tradeMarkerList.push({
        time: t(tr.entryTime),
        position: 'belowBar',
        color: '#26a69a',
        shape: 'arrowUp',
        text: 'BUY',
      })
      tradeMarkerList.push({
        time: t(tr.exitTime),
        position: 'aboveBar',
        color: '#ef5350',
        shape: 'arrowDown',
        text: 'SELL',
      })
    }

    const allMarkers = [...waveMarkerList, ...tradeMarkerList]
    if (allMarkers.length > 0) {
      allMarkers.sort((a, b) => (a.time as number) - (b.time as number))
      createSeriesMarkers(candleSeries, allMarkers)
    }

    // Fibonacci / price lines on the candlestick series
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
      candleSeriesRef.current = null
    }
  }, [candles, output, trades])

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

  return <div ref={containerRef} className="h-[480px] w-full" />
}
