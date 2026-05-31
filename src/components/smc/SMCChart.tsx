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
  type ISeriesMarkersPluginApi,
} from 'lightweight-charts'
import type { Candle } from '@/types'
import type { SMCResult } from '@/lib/smc/types'
import { BoxPrimitive, type SMCBox } from './primitives/boxPrimitive'

const GREEN = '#089981'
const RED = '#f23645'

export default function SMCChart({ candles, result, showStructure = true, showStrongWeak = true, showEqual = true, showOrderBlocks = true, showFVG = false, showZones = false, showMTF = false }: { candles: Candle[]; result: SMCResult; showStructure?: boolean; showStrongWeak?: boolean; showEqual?: boolean; showOrderBlocks?: boolean; showFVG?: boolean; showZones?: boolean; showMTF?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const boxPrimitiveRef = useRef<BoxPrimitive | null>(null)
  // Single markers plugin, created once and updated via setMarkers — calling
  // createSeriesMarkers repeatedly would stack duplicate marker layers.
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
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
    const boxPrimitive = new BoxPrimitive()
    series.attachPrimitive(boxPrimitive)
    chartRef.current = chart
    seriesRef.current = series
    boxPrimitiveRef.current = boxPrimitive
    markersRef.current = createSeriesMarkers(series, [])
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; boxPrimitiveRef.current = null; markersRef.current = null }
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
    if (showStructure) {
      for (const s of result.structures) {
        const ls = chart.addSeries(LineSeries, {
          color: s.bias === 'bullish' ? GREEN : RED,
          lineWidth: 2,
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
      ...(showStructure ? result.structures.map(s => ({
        time: s.atTime as Time,
        position: (s.bias === 'bullish' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
        color: s.bias === 'bullish' ? GREEN : RED,
        shape: (s.bias === 'bullish' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
        text: s.kind,
      })) : []),
      ...(showEqual ? result.equalLevels.map(e => ({
        time: e.toTime as Time,
        position: (e.kind === 'EQH' ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
        color: e.kind === 'EQH' ? RED : GREEN,
        shape: 'circle' as const,
        text: e.kind,
      })) : []),
    ].sort((a, b) => (a.time as number) - (b.time as number))
    markersRef.current?.setMarkers(markers)

    // Clear previous Strong/Weak price lines, then redraw.
    for (const pl of priceLinesRef.current) series.removePriceLine(pl)
    priceLinesRef.current = []
    if (showStrongWeak && result.trailing) {
      priceLinesRef.current.push(series.createPriceLine({
        price: result.trailing.top, color: RED, lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: result.trailing.topLabel,
      }))
      priceLinesRef.current.push(series.createPriceLine({
        price: result.trailing.bottom, color: GREEN, lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: result.trailing.bottomLabel,
      }))
    }
    // Equilibrium (50%) line for the premium/discount split.
    if (showZones && result.zones) {
      priceLinesRef.current.push(series.createPriceLine({
        price: result.zones.equilibrium, color: '#878b94', lineWidth: 1, lineStyle: LineStyle.Dashed,
        axisLabelVisible: true, title: 'Equilibrium 50%',
      }))
    }
    // MTF previous-period high/low levels (PDH/PDL, PWH/PWL, PMH/PML).
    if (showMTF) {
      for (const m of result.mtfLevels) {
        priceLinesRef.current.push(series.createPriceLine({
          price: m.high, color: '#2157f3', lineWidth: 1, lineStyle: LineStyle.Solid,
          axisLabelVisible: true, title: `P${m.tf}H`,
        }))
        priceLinesRef.current.push(series.createPriceLine({
          price: m.low, color: '#2157f3', lineWidth: 1, lineStyle: LineStyle.Solid,
          axisLabelVisible: true, title: `P${m.tf}L`,
        }))
      }
    }

    // Boxes (order blocks + fair value gaps) drawn behind the candles. FVGs
    // pushed first so order blocks sit on top where they overlap.
    const FVG_EXTEND = 10 // bars a fair value gap box stretches to the right
    const firstTime = candles.length ? candles[0].time : 0
    const boxes: SMCBox[] = [
      // Premium (upper, faint red) / discount (lower, faint green) full-width bands.
      ...(showZones && result.zones ? [
        { top: result.zones.top, bottom: result.zones.equilibrium, fromTime: firstTime, fill: 'rgba(242,54,69,0.05)' },
        { top: result.zones.equilibrium, bottom: result.zones.bottom, fromTime: firstTime, fill: 'rgba(8,153,129,0.05)' },
      ] : []),
      ...(showFVG ? result.fairValueGaps.map(g => {
        const idx = candles.findIndex(c => c.time === g.fromTime)
        const toIdx = idx >= 0 ? Math.min(idx + FVG_EXTEND, candles.length - 1) : candles.length - 1
        return {
          top: g.top, bottom: g.bottom, fromTime: g.fromTime,
          toTime: candles[toIdx]?.time,
          fill: g.bias === 'bullish' ? 'rgba(0,255,104,0.12)' : 'rgba(255,0,8,0.12)',
        }
      }) : []),
      ...(showOrderBlocks ? result.orderBlocks.map(ob => ({
        top: ob.top, bottom: ob.bottom, fromTime: ob.fromTime,
        fill: ob.bias === 'bullish' ? 'rgba(49,121,245,0.18)' : 'rgba(247,124,128,0.20)',
      })) : []),
    ]
    boxPrimitiveRef.current?.setBoxes(boxes)

    chart.timeScale().fitContent()
  }, [candles, result, showStructure, showStrongWeak, showEqual, showOrderBlocks, showFVG, showZones, showMTF])

  return (
    <div className="relative">
      <div ref={containerRef} className="h-[460px] min-h-[460px] w-full" />
    </div>
  )
}
