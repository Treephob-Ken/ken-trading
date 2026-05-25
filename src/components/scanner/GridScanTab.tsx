import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, ArrowRight, LayoutGrid } from 'lucide-react'
import type { SymbolInfo } from '@/lib/binance'
import { runGridScan, type GridScanRow } from '@/lib/scanner/gridScan'
import type { ScanProgress } from '@/lib/scanner/indicatorScan'

interface Props {
  universe: SymbolInfo[]
  onPickSymbol: (symbol: string) => void
  onPickTimeframe: (tf: string) => void
}

type SortKey =
  | 'score'
  | 'totalReturnPct'
  | 'tradesPerDay'
  | 'rangePct'
  | 'atrPct'
  | 'spacingMultiple'

const GRID_TF = '4h'

export default function GridScanTab({
  universe,
  onPickSymbol,
  onPickTimeframe,
}: Props) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<GridScanRow[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress>({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [sidewaysOnly, setSidewaysOnly] = useState(true)
  const [minSpacingX, setMinSpacingX] = useState(3)
  const [minTradesPerDay, setMinTradesPerDay] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const start = async () => {
    if (universe.length === 0) {
      setError('Symbol universe is empty — refresh on the page header.')
      return
    }
    setError(null)
    setRows([])
    setProgress({ done: 0, total: universe.length })
    setScanning(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const result = await runGridScan(
        universe,
        { timeframe: GRID_TF, lookbackDays: 30 },
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

  const visible = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        (!sidewaysOnly || r.regime === 'Sideways') &&
        r.spacingMultiple >= minSpacingX &&
        r.tradesPerDay >= minTradesPerDay,
    )
    const dir = sortDir === 'desc' ? -1 : 1
    filtered.sort((a, b) => (a[sortKey] - b[sortKey]) * dir)
    return filtered
  }, [rows, sidewaysOnly, minSpacingX, minTradesPerDay, sortKey, sortDir])

  const goToGrid = (r: GridScanRow) => {
    onPickSymbol(r.symbol)
    onPickTimeframe(r.timeframe)
    navigate('/grid')
  }

  const headerClick = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const sortArrow = (k: SortKey) => (k === sortKey ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '')

  const verdictColor = (v: GridScanRow['verdict']): string => {
    if (v === 'Excellent') return 'text-gain'
    if (v === 'Good') return 'text-brand'
    if (v === 'Marginal') return 'text-warn'
    return 'text-loss'
  }

  const regimeColor = (r: GridScanRow['regime']): string => {
    if (r === 'Sideways') return 'text-gain'
    if (r === 'Bull') return 'text-brand'
    if (r === 'Bear') return 'text-loss'
    return 'text-dim'
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter / action bar ─────────────────────────────────────────── */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-dim uppercase tracking-wider">Regime</span>
          <button
            type="button"
            onClick={() => setSidewaysOnly((s) => !s)}
            className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
              sidewaysOnly
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-panel-2 text-dim hover:text-text'
            }`}
          >
            {sidewaysOnly ? 'Sideways only' : 'All regimes'}
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-dim uppercase tracking-wider">Min Spacing ×</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={minSpacingX}
            onChange={(e) => setMinSpacingX(Math.max(0, Number(e.target.value) || 0))}
            className="w-20 rounded-md border border-border bg-panel-2 px-2 py-1 text-xs text-text outline-none focus:border-brand/60"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-dim uppercase tracking-wider">Min Trades/day</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={minTradesPerDay}
            onChange={(e) => setMinTradesPerDay(Math.max(0, Number(e.target.value) || 0))}
            className="w-20 rounded-md border border-border bg-panel-2 px-2 py-1 text-xs text-text outline-none focus:border-brand/60"
          />
        </div>

        <div className="flex-1" />

        <div className="text-[10px] text-dim font-mono">
          Lookback 30d · TF {GRID_TF}
        </div>

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
      {visible.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5 text-brand" />
            <span className="text-xs font-semibold text-text">Top 3 grid candidates</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {visible.slice(0, 3).map((r, i) => (
              <button
                key={r.symbol}
                type="button"
                onClick={() => goToGrid(r)}
                className="flex flex-col gap-1 rounded-lg border border-border bg-panel-2 p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
              >
                <span className="text-[10px] text-dim">
                  {['🥇', '🥈', '🥉'][i]} #{i + 1}
                </span>
                <span className="font-mono text-sm text-text">{r.base} · {r.timeframe}</span>
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className={`font-semibold ${verdictColor(r.verdict)}`}>
                    {r.verdict} · {r.score}
                  </span>
                  <span className={`font-mono ${regimeColor(r.regime)}`}>{r.regime ?? '—'}</span>
                </div>
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
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('score')}
                  >
                    Score{sortArrow('score')}
                  </th>
                  <th className="px-3 py-2 text-left">Verdict</th>
                  <th className="px-3 py-2 text-left">Regime</th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('tradesPerDay')}
                  >
                    Trades/day{sortArrow('tradesPerDay')}
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('rangePct')}
                  >
                    Range %{sortArrow('rangePct')}
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('atrPct')}
                  >
                    ATR %{sortArrow('atrPct')}
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('spacingMultiple')}
                  >
                    Spacing ×{sortArrow('spacingMultiple')}
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('totalReturnPct')}
                  >
                    Sim Return{sortArrow('totalReturnPct')}
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr key={r.symbol} className="border-t border-border hover:bg-panel-2/60">
                    <td className="px-3 py-2 text-dim font-mono tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-text">{r.base}</td>
                    <td className="px-3 py-2 text-right font-mono text-text tabular-nums">
                      {r.score}
                    </td>
                    <td className={`px-3 py-2 font-semibold ${verdictColor(r.verdict)}`}>
                      {r.verdict}
                    </td>
                    <td className={`px-3 py-2 font-mono ${regimeColor(r.regime)}`}>
                      {r.regime ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text tabular-nums">
                      {r.tradesPerDay.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text tabular-nums">
                      {r.rangePct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text tabular-nums">
                      {r.atrPct.toFixed(2)}%
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        r.spacingMultiple >= 3
                          ? 'text-gain'
                          : r.spacingMultiple >= 1.5
                            ? 'text-warn'
                            : 'text-loss'
                      }`}
                    >
                      {r.spacingMultiple.toFixed(2)}×
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        r.totalReturnPct >= 0 ? 'text-gain' : 'text-loss'
                      }`}
                    >
                      {r.totalReturnPct >= 0 ? '+' : ''}
                      {r.totalReturnPct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => goToGrid(r)}
                        className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[10px] text-dim hover:border-brand/40 hover:text-brand"
                        title="Open in Grid Optimizer"
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
          No symbols match the current filters. Try relaxing the regime or spacing filter.
        </div>
      )}
    </div>
  )
}
