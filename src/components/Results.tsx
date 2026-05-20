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
  stopLossPct: number
  takeProfitPct: number
}

export default function Results({ result, candles, stopLossPct, takeProfitPct }: Props) {
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

      <RiskManager metrics={metrics} stopLossPct={stopLossPct} takeProfitPct={takeProfitPct} />

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

function RiskManager({
  metrics,
  stopLossPct,
  takeProfitPct,
}: {
  metrics: BacktestResult['metrics']
  stopLossPct: number
  takeProfitPct: number
}) {
  if (metrics.numTrades < 3) return null

  const wr = metrics.winRate / 100
  const avgWin = metrics.avgWinPct
  const avgLoss = Math.abs(metrics.avgLossPct)
  const impliedRR = avgLoss > 0 ? avgWin / avgLoss : 0
  const expectancyPct = wr * avgWin + (1 - wr) * -avgLoss
  const breakevenWR = impliedRR > 0 ? (1 / (1 + impliedRR)) * 100 : 50
  const kelly = impliedRR > 0 ? (wr - (1 - wr) / impliedRR) * 100 : 0
  const halfKelly = Math.max(0, kelly / 2)

  // Suggested SL = avg loss of losing trades; TP suggestions at various R:R
  const suggestedSL = avgLoss
  const tp = (rr: number) => +(suggestedSL * rr).toFixed(2)

  const rrTone = impliedRR >= 2 ? 'gain' : impliedRR >= 1 ? 'warn' : 'loss'
  const expTone = expectancyPct > 0 ? 'gain' : 'loss'
  const rrToneClass = rrTone === 'gain' ? 'text-gain' : rrTone === 'warn' ? 'text-[#f5a623]' : 'text-loss'

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-base">⚖️</span>
        <h3 className="text-sm font-semibold text-text">Risk Manager</h3>
        <span className="ml-auto text-xs text-dim">Based on {metrics.numTrades} closed trades</span>
      </div>

      <div className="grid gap-0 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">

        {/* Column 1: Historical edge */}
        <div className="p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-dim">Historical Edge</p>
          <div className="flex flex-col gap-2">
            <RiskRow label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} />
            <RiskRow label="Avg Win" value={`+${avgWin.toFixed(2)}%`} tone="gain" />
            <RiskRow label="Avg Loss" value={`-${avgLoss.toFixed(2)}%`} tone="loss" />
            <RiskRow label="Implied R:R" value={`${impliedRR.toFixed(2)}:1`} tone={rrTone} />
            <RiskRow label="Expectancy / trade" value={`${expectancyPct >= 0 ? '+' : ''}${expectancyPct.toFixed(2)}%`} tone={expTone} />
          </div>
        </div>

        {/* Column 2: Breakeven analysis */}
        <div className="p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-dim">Breakeven Analysis</p>
          <div className="flex flex-col gap-2">
            {[1, 1.5, 2, 3].map((rr) => {
              const need = (1 / (1 + rr)) * 100
              const beats = metrics.winRate >= need
              return (
                <div key={rr} className="flex items-center justify-between text-xs">
                  <span className="text-dim">{rr}:1 R:R needs</span>
                  <span className={beats ? 'text-gain font-medium' : 'text-loss'}>
                    ≥{need.toFixed(0)}% WR {beats ? '✓' : '✗'}
                  </span>
                </div>
              )
            })}
            <div className="mt-1 h-px bg-border" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-dim">Your implied R:R</span>
              <span className={rrToneClass}>{impliedRR.toFixed(2)}:1</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-dim">Need WR ≥</span>
              <span className={metrics.winRate >= breakevenWR ? 'text-gain font-medium' : 'text-loss font-medium'}>
                {breakevenWR.toFixed(1)}% {metrics.winRate >= breakevenWR ? '✓' : '✗'}
              </span>
            </div>
          </div>
        </div>

        {/* Column 3: Suggested levels */}
        <div className="p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-dim">Suggested Levels</p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-dim">Stop Loss (avg risk)</span>
              <span className="font-mono text-loss font-medium">-{suggestedSL.toFixed(2)}%</span>
            </div>
            {[1.5, 2, 3].map((rr) => (
              <div key={rr} className="flex items-center justify-between text-xs">
                <span className="text-dim">TP at {rr}:1 R:R {rr === 2 ? '★' : ''}</span>
                <span className="font-mono text-gain">+{tp(rr)}%</span>
              </div>
            ))}
            {stopLossPct > 0 && (
              <>
                <div className="mt-1 h-px bg-border" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-dim mt-1">Your Settings</p>
                <RiskRow label="SL set" value={`-${stopLossPct.toFixed(2)}%`} tone="loss" />
                {takeProfitPct > 0 && (
                  <RiskRow label="TP set" value={`+${takeProfitPct.toFixed(2)}%`} tone="gain" />
                )}
                {takeProfitPct > 0 && stopLossPct > 0 && (
                  <RiskRow label="Your R:R" value={`${(takeProfitPct / stopLossPct).toFixed(2)}:1`}
                    tone={takeProfitPct / stopLossPct >= 2 ? 'gain' : takeProfitPct / stopLossPct >= 1 ? 'warn' : 'loss'} />
                )}
              </>
            )}
            <div className="mt-1 h-px bg-border" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-dim">½ Kelly size</span>
              <span className={`font-mono font-medium ${halfKelly > 0 ? 'text-text' : 'text-loss'}`}>
                {halfKelly > 0 ? `${halfKelly.toFixed(1)}% of capital` : 'Negative edge'}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

function RiskRow({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' | 'warn' }) {
  const cls = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : tone === 'warn' ? 'text-[#f5a623]' : 'text-text'
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-dim">{label}</span>
      <span className={`font-mono font-medium ${cls}`}>{value}</span>
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
