import { useEffect, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type IPriceLine,
} from 'lightweight-charts'
import type { Candle } from '@/types'
import type { SMCResult } from '@/lib/smc/types'

const GREEN = '#089981'
const RED = '#f23645'

export default function SMCChart({ candles, result }: { candles: Candle[]; result: SMCResult }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8b93a7', fontFamily: "'Inter', system-ui, sans-serif" },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3142' },
      rightPriceScale: { borderColor: '#2a3142' },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })
    chartRef.current = chart
    seriesRef.current = series
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [])

  // Push candles + SMC overlays whenever data changes.
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return

    series.setData(
      candles.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })),
    )

    // BOS/CHoCH labels as series markers at the breaking bar.
    const markers: SeriesMarker<Time>[] = result.structures.map(s => ({
      time: s.atTime as Time,
      position: s.bias === 'bullish' ? 'belowBar' : 'aboveBar',
      color: s.bias === 'bullish' ? GREEN : RED,
      shape: s.bias === 'bullish' ? 'arrowUp' : 'arrowDown',
      text: s.kind,
    }))
    createSeriesMarkers(series, markers)

    // Clear previous Strong/Weak price lines, then redraw.
    for (const pl of priceLinesRef.current) series.removePriceLine(pl)
    priceLinesRef.current = []
    if (result.trailing) {
      priceLinesRef.current.push(series.createPriceLine({
        price: result.trailing.top, color: RED, lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: result.trailing.topLabel,
      }))
      priceLinesRef.current.push(series.createPriceLine({
        price: result.trailing.bottom, color: GREEN, lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: result.trailing.bottomLabel,
      }))
    }

    chart.timeScale().fitContent()
  }, [candles, result])

  return (
    <div className="relative">
      <div ref={containerRef} className="h-[460px] min-h-[460px] w-full" />
    </div>
  )
}
