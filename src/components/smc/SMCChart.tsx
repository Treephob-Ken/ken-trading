import { useEffect, useRef } from 'react'
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
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

export default function SMCChart({ candles, result, showEqual = true }: { candles: Candle[]; result: SMCResult; showEqual?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])
  // One thin line series per structure break (pivot → break, drawn at the
  // pivot level). Kept in a ref so we can remove them when data changes.
  const structureLinesRef = useRef<ISeriesApi<'Line'>[]>([])
  // One dotted line series per EQH/EQL (connecting the two equal pivots).
  const equalLinesRef = useRef<ISeriesApi<'Line'>[]>([])

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

    // Structure lines: a horizontal segment from the broken pivot to the bar
    // that broke it, at the pivot level. One 2-point line series per break.
    for (const ls of structureLinesRef.current) chart.removeSeries(ls)
    structureLinesRef.current = []
    for (const s of result.structures) {
      const ls = chart.addSeries(LineSeries, {
        color: s.bias === 'bullish' ? GREEN : RED,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      })
      ls.setData([
        { time: s.fromTime as Time, value: s.level },
        { time: s.atTime as Time, value: s.level },
      ])
      structureLinesRef.current.push(ls)
    }

    // EQH/EQL: dotted line connecting the two equal pivots.
    for (const ls of equalLinesRef.current) chart.removeSeries(ls)
    equalLinesRef.current = []
    if (showEqual) {
      for (const e of result.equalLevels) {
        const ls = chart.addSeries(LineSeries, {
          color: e.kind === 'EQH' ? RED : GREEN,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        })
        ls.setData([
          { time: e.fromTime as Time, value: e.level },
          { time: e.toTime as Time, value: e.level },
        ])
        equalLinesRef.current.push(ls)
      }
    }

    // Markers: BOS/CHoCH at the break bar + EQH/EQL at the confirming pivot.
    // Combined into one sorted array (Lightweight Charts needs ascending time).
    const markers: SeriesMarker<Time>[] = [
      ...result.structures.map(s => ({
        time: s.atTime as Time,
        position: (s.bias === 'bullish' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
        color: s.bias === 'bullish' ? GREEN : RED,
        shape: (s.bias === 'bullish' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
        text: s.kind,
      })),
      ...(showEqual ? result.equalLevels.map(e => ({
        time: e.toTime as Time,
        position: (e.kind === 'EQH' ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
        color: e.kind === 'EQH' ? RED : GREEN,
        shape: 'circle' as const,
        text: e.kind,
      })) : []),
    ].sort((a, b) => (a.time as number) - (b.time as number))
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
  }, [candles, result, showEqual])

  return (
    <div className="relative">
      <div ref={containerRef} className="h-[460px] min-h-[460px] w-full" />
    </div>
  )
}
