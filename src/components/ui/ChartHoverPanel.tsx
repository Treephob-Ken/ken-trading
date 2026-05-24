import type { Candle } from '@/types'

const REGIME_NAMES = ['Bear', 'Sideways', 'Bull'] as const
const REGIME_COLOR = ['text-loss', 'text-warn', 'text-gain'] as const

export interface ChartHoverState {
  /** Unix-second time of the hovered bar. */
  time: number
  /** Index into the candles array. */
  barIdx: number
}

export interface HoverTradeInfo {
  /** Short label: "BUY", "SELL", "EXIT", etc. */
  label: string
  /** Optional pnl % to show alongside the label (typically on exits). */
  pnlPct?: number | null
  /** Visual tone for the chip. */
  tone: 'gain' | 'loss' | 'neutral'
}

interface Props {
  hover: ChartHoverState | null
  candles: Candle[]
  /** Optional regime label per candle (-1 / 0 Bear / 1 Sideways / 2 Bull). */
  regimeLabels?: number[]
  /** Optional trade-at-bar resolver. Return null when no trade lands on the bar. */
  tradeAtBar?: (candle: Candle) => HoverTradeInfo | null
  /** Anchor corner — defaults to top-left. */
  position?: 'top-left' | 'top-right'
}

/**
 * Floating overlay rendered on top of a LightweightCharts chart.
 * Pure render — the parent owns the hover state, computed from
 * subscribeCrosshairMove + binary-search on the candles array.
 *
 * Sized small (max-w-260) and pointer-events-none so it never blocks the
 * crosshair. Auto-hides when hover is null.
 */
export default function ChartHoverPanel({
  hover,
  candles,
  regimeLabels,
  tradeAtBar,
  position = 'top-left',
}: Props) {
  if (!hover) return null
  const c = candles[hover.barIdx]
  if (!c) return null

  const regimeIdx = regimeLabels?.[hover.barIdx]
  const regime = typeof regimeIdx === 'number' && regimeIdx >= 0 && regimeIdx <= 2 ? regimeIdx : null
  const trade = tradeAtBar?.(c) ?? null

  const anchor = position === 'top-right' ? 'right-3' : 'left-3'
  const tradeChipCls =
    trade?.tone === 'gain'
      ? 'border-gain/40 bg-gain/10 text-gain'
      : trade?.tone === 'loss'
      ? 'border-loss/40 bg-loss/10 text-loss'
      : 'border-border bg-panel-2 text-muted'

  return (
    <div className={`pointer-events-none absolute top-3 ${anchor} z-10 max-w-[260px] rounded-lg border border-border bg-panel/95 px-3 py-2 backdrop-blur-md shadow-lg shadow-black/40`}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-dim">
        {new Date(c.time * 1000).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
        <span className="text-dim">O</span><span className="text-text text-right">{c.open.toFixed(4)}</span>
        <span className="text-dim">H</span><span className="text-gain text-right">{c.high.toFixed(4)}</span>
        <span className="text-dim">L</span><span className="text-loss text-right">{c.low.toFixed(4)}</span>
        <span className="text-dim">C</span>
        <span className={`text-right ${c.close >= c.open ? 'text-gain' : 'text-loss'}`}>
          {c.close.toFixed(4)}
        </span>
      </div>
      {(regime != null || trade) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 border-t border-border/60 pt-1.5 text-[10px]">
          {regime != null && (
            <span className={`inline-flex items-center gap-1 rounded-md border border-border bg-panel-2 px-1.5 py-0.5 ${REGIME_COLOR[regime]}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {REGIME_NAMES[regime]}
            </span>
          )}
          {trade && (
            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold ${tradeChipCls}`}>
              {trade.label}
              {trade.pnlPct != null && (
                <span className="ml-1 font-mono">
                  {trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(2)}%
                </span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Shared helper: binary-search a candles array by time (unix seconds).
 * Returns the index of the closest preceding candle. Used by the
 * subscribeCrosshairMove handler in both ChartPanel and SignalChart.
 */
export function findCandleIndexByTime(candles: Candle[], time: number): number {
  let lo = 0
  let hi = candles.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const ct = candles[mid].time
    if (ct === time) return mid
    if (ct < time) lo = mid + 1
    else hi = mid - 1
  }
  return Math.min(candles.length - 1, Math.max(0, lo))
}
