import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import { X } from 'lucide-react'
import { fetchKlines } from '@/lib/binance'
import type { Candle } from '@/types'
import type { RoundTrip } from '@/lib/journal'
import { fmtHoldMs, money, pct, sourceLabel } from '@/lib/journal'

interface Props {
  trip: RoundTrip | null
  onClose: () => void
}

// Pick a timeframe that gives ~30-150 candles between entry and exit.
function pickInterval(holdMs: number): string {
  const m = holdMs / 60_000
  if (m < 60) return '1m'
  if (m < 240) return '5m'
  if (m < 1440) return '15m'
  if (m < 10_080) return '1h'
  return '4h'
}

// MAE/MFE from candles between entry and exit (price favorable / adverse to
// the trade direction). Returns absolute USD amounts based on `size`.
function computeMaeMfe(
  candles: Candle[],
  trip: RoundTrip,
): { mae: number; mfe: number } {
  const entryMs = trip.entryTime
  const exitMs = trip.exitTime
  let worst = trip.entryPx
  let best = trip.entryPx
  for (const c of candles) {
    const tMs = c.time * 1000
    if (tMs < entryMs || tMs > exitMs) continue
    if (trip.side === 'long') {
      if (c.low < worst) worst = c.low
      if (c.high > best) best = c.high
    } else {
      if (c.high > worst) worst = c.high
      if (c.low < best) best = c.low
    }
  }
  const dirSign = trip.side === 'long' ? 1 : -1
  const mfe = (best - trip.entryPx) * dirSign * trip.size
  const mae = (worst - trip.entryPx) * dirSign * trip.size
  return { mae, mfe }
}

export default function TradeDetailModal({ trip, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const chartHostRef = useRef<HTMLDivElement>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Open / close the native dialog when `trip` changes
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (trip) {
      if (!d.open) d.showModal()
    } else if (d.open) {
      d.close()
    }
  }, [trip])

  // Fetch candles when a new trip is selected
  useEffect(() => {
    if (!trip) { setCandles([]); return }
    let cancelled = false
    setLoading(true); setError(null)
    const interval = pickInterval(trip.holdMs)
    // Buffer = 20% of holding window on each side, min 30 min, max 7 days
    const buffer = Math.min(7 * 86_400_000, Math.max(30 * 60_000, trip.holdMs * 0.2))
    fetchKlines({
      symbol: `${trip.asset}USDT`,
      interval,
      startTime: trip.entryTime - buffer,
      endTime: trip.exitTime + buffer,
    })
      .then((data) => { if (!cancelled) { setCandles(data); setLoading(false) } })
      .catch((e: unknown) => {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [trip])

  // Render the chart whenever candles change
  useEffect(() => {
    const host = chartHostRef.current
    if (!trip || !host || candles.length === 0) return
    const chart: IChartApi = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b93a7',
        fontFamily: "'Inter', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3142' },
      rightPriceScale: { borderColor: '#2a3142' },
    })
    const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444',
    })
    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      })),
    )

    // Entry + exit price lines
    const entryColor = trip.side === 'long' ? '#10b981' : '#ef4444'
    series.createPriceLine({
      price: trip.entryPx,
      color: entryColor,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `ENTRY ${trip.side.toUpperCase()}`,
    })
    series.createPriceLine({
      price: trip.exitPx,
      color: trip.closedPnl >= 0 ? '#10b981' : '#ef4444',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `EXIT ${trip.closedPnl >= 0 ? '+' : ''}${trip.closedPnl.toFixed(2)}`,
    })

    // Markers — snap to the nearest candle so they always land on a bar
    const candleTimes = candles.map((c) => c.time)
    const nearest = (ms: number) => {
      const t = Math.floor(ms / 1000)
      let best = candleTimes[0]
      let bestDiff = Math.abs((candleTimes[0] ?? 0) - t)
      for (const ct of candleTimes) {
        const d = Math.abs(ct - t)
        if (d < bestDiff) { best = ct; bestDiff = d }
      }
      return best as UTCTimestamp
    }
    const markers: SeriesMarker<Time>[] = [
      {
        time: nearest(trip.entryTime),
        position: trip.side === 'long' ? 'belowBar' : 'aboveBar',
        color: entryColor,
        shape: trip.side === 'long' ? 'arrowUp' : 'arrowDown',
        text: `Open ${trip.side}`,
      },
      {
        time: nearest(trip.exitTime),
        position: trip.side === 'long' ? 'aboveBar' : 'belowBar',
        color: trip.closedPnl >= 0 ? '#10b981' : '#ef4444',
        shape: trip.side === 'long' ? 'arrowDown' : 'arrowUp',
        text: `Close ${trip.closedPnl >= 0 ? '+' : ''}$${trip.closedPnl.toFixed(2)}`,
      },
    ]
    createSeriesMarkers(series, markers)
    chart.timeScale().fitContent()

    return () => { chart.remove() }
  }, [candles, trip])

  const mm = useMemo(() => (trip ? computeMaeMfe(candles, trip) : { mae: 0, mfe: 0 }), [candles, trip])
  // R-multiple = profit / |MAE|. Conservative version of risk-reward.
  const rMultiple = useMemo(() => {
    if (!trip || mm.mae >= 0) return null
    return trip.closedPnl / Math.abs(mm.mae)
  }, [mm, trip])

  return (
    <dialog
      ref={dialogRef}
      className="chart-modal"
      aria-label="Trade detail"
      onClose={onClose}
      onClick={(e) => { if (e.target === dialogRef.current) onClose() }}
    >
      {trip && (
        <div className="flex max-h-[92vh] flex-col gap-4 p-5">
          <header className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-text">
                {trip.asset} {trip.side.toUpperCase()} · {sourceLabel(trip.source)}
              </h2>
              <p className="text-xs text-dim">
                Opened {new Date(trip.entryTime).toLocaleString()} → Closed {new Date(trip.exitTime).toLocaleString()} ·{' '}
                {fmtHoldMs(trip.holdMs)} held · {trip.fillCount} fills
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md border border-border bg-panel-2 p-1.5 text-dim hover:text-text"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          {/* Stat strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Entry" value={`$${trip.entryPx.toFixed(2)}`} />
            <Stat label="Exit" value={`$${trip.exitPx.toFixed(2)}`} />
            <Stat label="Size" value={trip.size.toString()} />
            <Stat
              label="Realized PnL"
              value={money(trip.closedPnl, true)}
              tone={trip.closedPnl > 0 ? 'gain' : trip.closedPnl < 0 ? 'loss' : 'text'}
            />
            <Stat
              label="ROI"
              value={pct(trip.pnlPct, true)}
              tone={trip.pnlPct > 0 ? 'gain' : trip.pnlPct < 0 ? 'loss' : 'text'}
            />
            <Stat label="Fees" value={money(trip.fees)} />
            <Stat label="Hold" value={fmtHoldMs(trip.holdMs)} />
          </div>

          {/* Chart */}
          <div className="overflow-hidden rounded-xl border border-border bg-bg" style={{ height: '40vh' }}>
            {loading && (
              <div className="flex h-full items-center justify-center text-sm text-dim">Loading candles…</div>
            )}
            {error && (
              <div className="flex h-full items-center justify-center text-sm text-loss">{error}</div>
            )}
            {!loading && !error && <div ref={chartHostRef} className="h-full w-full" />}
          </div>

          {/* MAE / MFE / R */}
          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="Max favorable (MFE)"
              value={money(mm.mfe, true)}
              hint="Best unrealized gain during the trade. The peak you could have closed at."
              tone="gain"
            />
            <Stat
              label="Max adverse (MAE)"
              value={money(mm.mae, true)}
              hint="Worst unrealized drawdown. The deepest the trade went underwater."
              tone="loss"
            />
            <Stat
              label="R-multiple"
              value={rMultiple == null ? '—' : (rMultiple >= 0 ? '+' : '') + rMultiple.toFixed(2) + 'R'}
              hint="Profit divided by the worst drawdown you survived. Above +1R = you made more than the heat you took."
              tone={rMultiple != null && rMultiple > 0 ? 'gain' : rMultiple != null && rMultiple < 0 ? 'loss' : 'text'}
            />
          </div>
        </div>
      )}
    </dialog>
  )
}

function Stat({
  label,
  value,
  hint,
  tone = 'text',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'gain' | 'loss' | 'text'
}) {
  const cls = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-text'
  return (
    <div className="rounded-lg border border-border bg-panel-2 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-dim" title={hint}>{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  )
}
