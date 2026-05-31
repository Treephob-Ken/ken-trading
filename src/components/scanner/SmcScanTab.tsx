import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Loader2 } from 'lucide-react'
import type { SymbolInfo } from '@/lib/binance'
import { runSmcScan, type SmcScanRow, type ScanProgress } from '@/lib/scanner/smcScan'
import { useMaxLeverage } from '@/lib/hlAssets'

interface Props {
  universe: SymbolInfo[]
  onPickSymbol: (v: string) => void
  onPickTimeframe: (v: string) => void
}

const TF_OPTIONS = ['15m', '1h', '4h', '1d']
// A row "passes" (green) when its best rule's quality score clears this bar.
const PASS_QUALITY = 50

export default function SmcScanTab({ universe, onPickSymbol, onPickTimeframe }: Props) {
  const navigate = useNavigate()
  const maxLev = useMaxLeverage()
  const [timeframes, setTimeframes] = useState<string[]>(['1h', '4h'])
  // SL% and lookback are shared with the Market Structure page (localStorage)
  // so a coin's scan numbers match its Strategy test there.
  const [slPct, setSlPct] = useState(() => +(localStorage.getItem('smc_sl_pct') || '1.5'))
  const [lookbackDays, setLookbackDays] = useState(() => +(localStorage.getItem('smc_lookback_days') || '150'))
  const [rows, setRows] = useState<SmcScanRow[]>([])
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { localStorage.setItem('smc_sl_pct', String(slPct)) }, [slPct])
  useEffect(() => { localStorage.setItem('smc_lookback_days', String(lookbackDays)) }, [lookbackDays])

  const toggleTf = (tf: string) =>
    setTimeframes(t => (t.includes(tf) ? t.filter(x => x !== tf) : [...t, tf]))

  const run = async () => {
    if (running) { abortRef.current?.abort(); setRunning(false); return }
    if (universe.length === 0 || timeframes.length === 0) return
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setRows([])
    setProgress({ done: 0, total: universe.length * timeframes.length })
    try {
      const out = await runSmcScan(
        universe,
        { timeframes, lookbackDays, slPct, swingLength: 50 },
        p => setProgress(p),
        ac.signal,
      )
      if (!ac.signal.aborted) setRows(out)
    } finally {
      setRunning(false)
    }
  }

  const openRow = (r: SmcScanRow) => {
    onPickSymbol(r.symbol)
    onPickTimeframe(r.timeframe)
    navigate('/structure')
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Timeframes</div>
          <div className="flex gap-1">
            {TF_OPTIONS.map(tf => (
              <button
                key={tf}
                type="button"
                onClick={() => toggleTf(tf)}
                className={`rounded-md border px-2 py-1 text-[11px] ${timeframes.includes(tf) ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-panel-2 text-dim hover:text-text'}`}
              >{tf}</button>
            ))}
          </div>
        </div>
        <label className="text-[11px] text-dim">
          <span className="mb-1 block">SL %</span>
          <input type="number" min={0.1} step={0.1} value={slPct}
            onChange={e => setSlPct(Math.max(0.1, +e.target.value || 1.5))} className="field w-[72px]" />
        </label>
        <label className="text-[11px] text-dim">
          <span className="mb-1 block">Lookback (days)</span>
          <input type="number" min={30} step={10} value={lookbackDays}
            onChange={e => setLookbackDays(Math.max(30, +e.target.value || 120))} className="field w-[90px]" />
        </label>
        <button type="button" onClick={run} disabled={universe.length === 0} className="btn-primary">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Stop' : 'Run scan'}
        </button>
      </div>

      <p className="text-[11px] text-dim">
        Ranks coins by their best rule's <b>Quality score</b> (0-100): profit factor + enough closed trades + a non-lottery win rate + low drawdown. Return% barely counts (an open position can inflate it).
        <span className="text-gain"> Green</span> = quality ≥ {PASS_QUALITY}. This is a backtest, not a guarantee.
      </p>

      {progress && running && (
        <div className="text-[11px] text-dim">
          Scanning… {progress.done}/{progress.total} {progress.current ? `· ${progress.current}` : ''}
        </div>
      )}

      {/* Results */}
      {rows.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border text-left text-dim">
                <th className="px-3 py-2">Coin</th>
                <th
                  className="px-3 py-2 text-right"
                  title="Exchange maximum leverage for this coin. This is the cap, NOT a recommendation — high leverage liquidates fast on a small account. Your bot still sets its own leverage."
                >
                  Max Lev
                </th>
                <th className="px-3 py-2">TF</th>
                <th className="px-3 py-2">Best rule</th>
                <th className="px-3 py-2 text-right">Quality</th>
                <th className="px-3 py-2 text-right">Return %</th>
                <th className="px-3 py-2 text-right">Trades</th>
                <th className="px-3 py-2 text-right">Win %</th>
                <th className="px-3 py-2 text-right">PF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pass = r.best.quality >= PASS_QUALITY
                return (
                  <tr
                    key={`${r.symbol}-${r.timeframe}-${i}`}
                    onClick={() => openRow(r)}
                    className={`cursor-pointer border-t border-border hover:bg-panel-2 ${pass ? 'bg-gain/5' : ''}`}
                  >
                    <td className="px-3 py-1.5 font-medium text-text">
                      {pass && <span className="mr-1 text-gain">●</span>}
                      {r.base}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-dim tabular-nums">
                      {maxLev[r.base] ? `${maxLev[r.base]}x` : '—'}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-dim">{r.timeframe}</td>
                    <td className="px-3 py-1.5">{r.best.name}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold ${r.best.quality >= PASS_QUALITY ? 'text-gain' : r.best.quality >= 30 ? 'text-warn' : 'text-dim'}`}>
                      {r.best.trades ? r.best.quality : '—'}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${r.best.returnPct > 0 ? 'text-gain' : r.best.returnPct < 0 ? 'text-loss' : 'text-dim'}`}>
                      {r.best.trades ? `${r.best.returnPct > 0 ? '+' : ''}${r.best.returnPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.best.trades}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.best.trades ? `${r.best.winRate.toFixed(0)}%` : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.best.trades === 0 ? '—' : r.best.profitFactor === Infinity ? '∞' : r.best.profitFactor.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
