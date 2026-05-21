import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle } from '@/types'
import type { GridLine } from '@/lib/grid'

interface Props {
  candles: Candle[]
  lines: GridLine[]
}

const t = (n: number) => n as UTCTimestamp

const COLORS: Record<GridLine['kind'], string> = {
  long: '#16c784',
  short: '#ea3943',
  mid: '#ffd23f',
}

export default function GridChart({ candles, lines }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || candles.length === 0) return

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b93a7',
        fontFamily: "'Outfit', system-ui, sans-serif",
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

    const dense = lines.length > 16
    for (const ln of lines) {
      candleSeries.createPriceLine({
        price: ln.price,
        color: COLORS[ln.kind],
        lineWidth: ln.kind === 'mid' ? 2 : 1,
        lineStyle: ln.kind === 'mid' ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: ln.kind === 'mid' || !dense,
        title:
          ln.kind === 'mid'
            ? 'MID'
            : dense
              ? ''
              : ln.kind === 'long'
                ? 'LONG'
                : 'SHRT',
      })
    }

    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [candles, lines])

  return <div ref={ref} className="h-[480px] w-full" />
}
