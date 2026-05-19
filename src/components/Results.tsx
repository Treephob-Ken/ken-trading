import { useEffect, useRef } from 'react'
import {
  BaselineSeries,
  ColorType,
  LineSeries,
  createChart,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { BacktestResult, Candle } from '@/types'
import { fmtNum, fmtPct, fmtPrice, fmtTime, fmtUsd } from '@/lib/format'

interface Props {
  result: BacktestResult
  candles: Candle[]
}

export default function Results({ result, candles }: Props) {
  const { metrics, trades, equity, openPosition } = result
  const beatBuyHold = metrics.totalReturnPct > metrics.buyHoldReturnPct

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Strategy Return"
          value={fmtPct(metrics.totalReturnPct)}
          tone={metrics.totalReturnPct >= 0 ? 'gain' : 'loss'}
          big
        />
        <Metric
          label="Net P&L"
          value={fmtUsd(metrics.totalPnl)}
          tone={metrics.totalPnl >= 0 ? 'gain' : 'loss'}
          big
        />
        <Metric
          label="Buy & Hold"
          value={fmtPct(metrics.buyHoldReturnPct)}
          tone={metrics.buyHoldReturnPct >= 0 ? 'gain' : 'loss'}
          sub={beatBuyHold ? 'Strategy ahead' : 'Strategy behind'}
        />
        <Metric
          label="Final Equity"
          value={fmtUsd(metrics.finalEquity)}
          sub={`from ${fmtUsd(metrics.initialCapital)}`}
        />
        <Metric
          label="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          sub={`${metrics.wins}W / ${metrics.losses}L`}
        />
        <Metric
          label="Trades"
          value={String(metrics.numTrades)}
          sub={`${metrics.longTrades} long / ${metrics.shortTrades} short`}
        />
        <Metric
          label="Profit Factor"
          value={fmtNum(metrics.profitFactor)}
          tone={metrics.profitFactor >= 1 ? 'gain' : 'loss'}
        />
        <Metric
          label="Max Drawdown"
          value={`-${metrics.maxDrawdownPct.toFixed(2)}%`}
          tone="loss"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Avg Win" value={fmtPct(metrics.avgWinPct)} tone="gain" />
        <Metric label="Avg Loss" value={fmtPct(metrics.avgLossPct)} tone="loss" />
        <Metric label="Best Trade" value={fmtPct(metrics.bestTradePct)} tone="gain" />
        <Metric label="Worst Trade" value={fmtPct(metrics.worstTradePct)} tone="loss" />
      </div>

      <div className="card p-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-medium text-text">Performance</h3>
          <div className="flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-brand" /> Strategy
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-dim" /> Buy &amp; Hold
            </span>
          </div>
        </div>
        <p className="mb-3 text-xs text-dim">
          Cumulative return %, both starting at 0 — same scale, easy to compare.
        </p>
        <EquityChart
          equity={equity}
          candles={candles}
          initialCapital={metrics.initialCapital}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium text-text">
            Trade History
            <span className="ml-2 text-xs text-dim">{trades.length} closed</span>
          </h3>
          {openPosition && (
            <span className="rounded-md bg-brand/15 px-2 py-1 text-xs text-brand">
              Open {openPosition.side} since {fmtTime(openPosition.entryTime)} @{' '}
              {fmtPrice(openPosition.entryPrice)}
            </span>
          )}
        </div>
        {trades.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-dim">
            No completed trades for this strategy, direction and date range.
          </p>
        ) : (
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-panel-2 text-[11px] uppercase tracking-wider text-dim">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Side</th>
                  <th className="px-3 py-2 text-left font-medium">Entry</th>
                  <th className="px-3 py-2 text-right font-medium">Entry Price</th>
                  <th className="px-3 py-2 text-left font-medium">Exit</th>
                  <th className="px-3 py-2 text-right font-medium">Exit Price</th>
                  <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                  <th className="px-3 py-2 text-right font-medium">Return</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((tr, i) => {
                  const win = tr.pnl >= 0
                  return (
                    <tr
                      key={i}
                      className="border-t border-border/70 hover:bg-panel-2/60"
                    >
                      <td className="px-3 py-2 text-dim">{i + 1}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            tr.side === 'long'
                              ? 'bg-gain/15 text-gain'
                              : 'bg-loss/15 text-loss'
                          }`}
                        >
                          {tr.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">
                        {fmtTime(tr.entryTime)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtPrice(tr.entryPrice)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">
                        {fmtTime(tr.exitTime)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtPrice(tr.exitPrice)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono ${
                          win ? 'text-gain' : 'text-loss'
                        }`}
                      >
                        {fmtUsd(tr.pnl)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-medium ${
                          win ? 'text-gain' : 'text-loss'
                        }`}
                      >
                        {fmtPct(tr.pnlPct)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
  tone,
  big,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'gain' | 'loss'
  big?: boolean
}) {
  const toneClass =
    tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-text'
  return (
    <div className="card p-3">
      <p className="text-[11px] uppercase tracking-wider text-dim">{label}</p>
      <p
        className={`mt-1 font-semibold tabular-nums ${toneClass} ${
          big ? 'text-xl' : 'text-base'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-dim">{sub}</p>}
    </div>
  )
}

function EquityChart({
  equity,
  candles,
  initialCapital,
}: {
  equity: BacktestResult['equity']
  candles: Candle[]
  initialCapital: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || equity.length === 0) return

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a1a1a1',
        fontFamily: 'Geist, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#262626' },
      rightPriceScale: { borderColor: '#262626' },
      crosshair: { mode: 1 },
      localization: {
        priceFormatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
      },
    })

    // Strategy cumulative return %, with a baseline fill at 0%.
    const strategy = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#0a84ff',
      topFillColor1: 'rgba(10,132,255,0.28)',
      topFillColor2: 'rgba(10,132,255,0.02)',
      bottomLineColor: '#ed4b4b',
      bottomFillColor1: 'rgba(237,75,75,0.02)',
      bottomFillColor2: 'rgba(237,75,75,0.28)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    strategy.setData(
      equity.map((e) => ({
        time: e.time as UTCTimestamp,
        value: (e.value / initialCapital - 1) * 100,
      })),
    )

    const firstClose = candles[0]?.close ?? 0
    if (firstClose > 0) {
      const hold = chart.addSeries(LineSeries, {
        color: '#5b5b5b',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      hold.setData(
        candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: (c.close / firstClose - 1) * 100,
        })),
      )
    }

    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [equity, candles, initialCapital])

  return <div ref={ref} className="h-[240px] w-full" />
}
