import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, ArrowRight, Medal } from 'lucide-react'
import type { Direction, StrategyId } from '@/types'
import type { SymbolInfo } from '@/lib/binance'
import { STRATEGIES } from '@/lib/strategies'
import {
  runIndicatorScan,
  type IndicatorScanRow,
  type ScanProgress,
} from '@/lib/scanner/indicatorScan'

interface Props {
  universe: SymbolInfo[]
  onPickSymbol: (symbol: string) => void
  onPickTimeframe: (tf: string) => void
}

type SortKey =
  | 'totalReturnPct'
  | 'numTrades'
  | 'winRate'
  | 'maxDrawdownPct'
  | 'sharpeRatio'

const ALL_TFS = ['1h', '4h'] as const
const ALL_STRATS: StrategyId[] = STRATEGIES.map((s) => s.id)

export default function IndicatorScanTab({
  universe,
  onPickSymbol,
  onPickTimeframe,
}: Props) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<IndicatorScanRow[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress>({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Filters
  const [minTrades, setMinTrades] = useState(5)
  const [direction, setDirection] = useState<Direction>('both')
  const [tfFilter, setTfFilter] = useState<Record<string, boolean>>({ '1h': true, '4h': true })
  const [stratFilter, setStratFilter] = useState<Record<StrategyId, boolean>>(
    () => Object.fromEntries(ALL_STRATS.map((s) => [s, true])) as Record<StrategyId, boolean>,
  )
  const [sortKey, setSortKey] = useState<SortKey>('totalReturnPct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const start = async () => {
    if (universe.length === 0) {
      setError('Symbol universe is empty — refresh on the page header.')
      return
    }
    setError(null)
    setRows([])
    setProgress({ done: 0, total: 0 })
    setScanning(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const result = await runIndicatorScan(
        universe,
        {
          timeframes: ALL_TFS.filter((tf) => tfFilter[tf]),
          lookbackDays: 90,
          direction,
        },
        setProgress,
        ctrl.signal,
      )
      setRows(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setScanning(false)
      abortRef.current = null
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    setScanning(false)
  }

  // Filter + sort
  const visible = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        r.numTrades >= minTrades &&
        tfFilter[r.timeframe] &&
        stratFilter[r.strategyId],
    )
    const dir = sortDir === 'desc' ? -1 : 1
    filtered.sort((a, b) => (a[sortKey] - b[sortKey]) * dir)
    return filtered
  }, [rows, minTrades, tfFilter, stratFilter, sortKey, sortDir])

  const top3 = visible.slice(0, 3)

  const goToBacktest = (r: IndicatorScanRow) => {
    onPickSymbol(r.symbol)
    onPickTimeframe(r.timeframe)
    navigate('/backtest', { state: { presetStrategy: r.strategyId } })
  }

  const headerClick = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const sortArrow = (k: SortKey) => (k === sortKey ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '')

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter / action bar ─────────────────────────────────────────── */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-dim uppercase tracking-wider">Direction</span>
          <div className="flex gap-1">
            {(['long', 'short', 'both'] as Direction[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                  direction === d
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border bg-panel-2 text-dim hover:text-text'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-dim uppercase tracking-wider">Timeframes</span>
          <div className="flex gap-1">
            {ALL_TFS.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTfFilter((s) => ({ ...s, [tf]: !s[tf] }))}
                className={`rounded-md border px-2 py-1 text-[11px] font-mono transition-colors ${
                  tfFilter[tf]
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border bg-panel-2 text-dim hover:text-text'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-dim uppercase tracking-wider">Min Trades</span>
          <input
            type="number"
            min={0}
            value={minTrades}
            onChange={(e) => setMinTrades(Math.max(0, Number(e.target.value) || 0))}
            className="w-20 rounded-md border border-border bg-panel-2 px-2 py-1 text-xs text-text outline-none focus:border-brand/60"
          />
        </div>

        <div className="flex-1" />

        {scanning ? (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-2 rounded-xl border border-loss/40 bg-loss/10 px-3 py-2 text-sm font-semibold text-loss hover:bg-loss/15"
          >
            <Square className="h-4 w-4" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={universe.length === 0}
            className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="h-4 w-4" />
            Scan
          </button>
        )}
      </div>

      {/* ── Strategy chips ──────────────────────────────────────────────── */}
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-dim uppercase tracking-wider">Strategies</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() =>
                setStratFilter(Object.fromEntries(ALL_STRATS.map((s) => [s, true])) as Record<StrategyId, boolean>)
              }
              className="text-[10px] text-dim hover:text-text"
            >
              all
            </button>
            <span className="text-[10px] text-dim">·</span>
            <button
              type="button"
              onClick={() =>
                setStratFilter(Object.fromEntries(ALL_STRATS.map((s) => [s, false])) as Record<StrategyId, boolean>)
              }
              className="text-[10px] text-dim hover:text-text"
            >
              none
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStratFilter((p) => ({ ...p, [s.id]: !p[s.id] }))}
              className={`rounded-md border px-2 py-1 text-[10px] font-mono transition-colors ${
                stratFilter[s.id]
                  ? 'border-brand/40 bg-brand/5 text-text'
                  : 'border-border bg-panel-2 text-dim hover:text-text'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Progress / errors ───────────────────────────────────────────── */}
      {(scanning || progress.total > 0) && (
        <div className="card p-3">
          <div className="flex items-center justify-between text-[11px] text-dim mb-2">
            <span>
              {scanning ? 'Scanning…' : 'Scan complete'}
              {progress.current && (
                <span className="ml-2 font-mono text-text">{progress.current}</span>
              )}
            </span>
            <span className="font-mono tabular-nums">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full bg-brand transition-all duration-200"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-loss/30 bg-loss/5 p-3 text-xs text-loss">
          {error}
        </div>
      )}

      {/* ── Top 3 highlight ─────────────────────────────────────────────── */}
      {top3.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Medal className="h-3.5 w-3.5 text-brand" />
            <span className="text-xs font-semibold text-text">Top 3</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {top3.map((r, i) => (
              <button
                key={`${r.symbol}-${r.timeframe}-${r.strategyId}`}
                type="button"
                onClick={() => goToBacktest(r)}
                className="flex flex-col gap-1 rounded-lg border border-border bg-panel-2 p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
              >
                <span className="text-[10px] text-dim">
                  {['🥇', '🥈', '🥉'][i]} #{i + 1}
                </span>
                <span className="font-mono text-sm text-text">
                  {r.base} · {r.timeframe} · {r.strategyName}
                </span>
                <span
                  className={`font-mono text-xs font-semibold ${
                    r.totalReturnPct >= 0 ? 'text-gain' : 'text-loss'
                  }`}
                >
                  {r.totalReturnPct >= 0 ? '+' : ''}
                  {r.totalReturnPct.toFixed(2)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Full results table ──────────────────────────────────────────── */}
      {visible.length > 0 && (
        <div className="card overflow-hidden">
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel-2 text-[10px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-left">TF</th>
                  <th className="px-3 py-2 text-left">Strategy</th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('totalReturnPct')}
                  >
                    Return %{sortArrow('totalReturnPct')}
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('numTrades')}
                  >
                    Trades{sortArrow('numTrades')}
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('winRate')}
                  >
                    Win %{sortArrow('winRate')}
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('maxDrawdownPct')}
                  >
                    Max DD{sortArrow('maxDrawdownPct')}
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('sharpeRatio')}
                  >
                    Sharpe{sortArrow('sharpeRatio')}
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr
                    key={`${r.symbol}-${r.timeframe}-${r.strategyId}`}
                    className="border-t border-border hover:bg-panel-2/60"
                  >
                    <td className="px-3 py-2 text-dim font-mono tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-text">{r.base}</td>
                    <td className="px-3 py-2 font-mono text-text">{r.timeframe}</td>
                    <td className="px-3 py-2 text-text">{r.strategyName}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        r.totalReturnPct >= 0 ? 'text-gain' : 'text-loss'
                      }`}
                    >
                      {r.totalReturnPct >= 0 ? '+' : ''}
                      {r.totalReturnPct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-dim tabular-nums">
                      {r.numTrades}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text tabular-nums">
                      {r.winRate.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-loss tabular-nums">
                      -{r.maxDrawdownPct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text tabular-nums">
                      {r.sharpeRatio.toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => goToBacktest(r)}
                        className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[10px] text-dim hover:border-brand/40 hover:text-brand"
                        title="Open in Backtester"
                      >
                        Open <ArrowRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!scanning && progress.total > 0 && visible.length === 0 && (
        <div className="card p-6 text-center text-xs text-dim">
          No combos match the current filters.
        </div>
      )}
    </div>
  )
}
