// Scanner tab: run a saved Strategy Builder preset across the coin universe and
// rank each by Quality. Pick a preset, hit Scan, click a row to open that coin
// in the Builder.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Loader2, Hammer } from 'lucide-react'
import type { SymbolInfo } from '@/lib/binance'
import { apiFetch } from '@/contexts/AuthContext'
import { useMaxLeverage } from '@/lib/hlAssets'
import { runCustomScan, type CustomScanRow, type ScanProgress } from '@/lib/scanner/customScan'
import type { CustomStrategySpec } from '@/lib/builder/types'

interface Props {
  universe: SymbolInfo[]
  onPickSymbol: (symbol: string) => void
  onPickTimeframe: (tf: string) => void
}

interface PresetSummary { id: string; name: string }
const ALL_TFS = ['15m', '30m', '1h', '4h', '1d'] as const
const PASS_QUALITY = 50
const DEFAULT_SCAN_LIMIT = 30

export default function CustomScanTab({ universe, onPickSymbol, onPickTimeframe }: Props) {
  const navigate = useNavigate()
  const maxLev = useMaxLeverage()

  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [presetId, setPresetId] = useState<string>(() => localStorage.getItem('scn_custom_preset') ?? '')
  const [tfs, setTfs] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('scn_custom_tfs') || '') } catch { return { '1h': true } }
  })
  const [lookbackDays, setLookbackDays] = useState(() => Number(localStorage.getItem('scn_custom_lookback')) || 180)
  const [rows, setRows] = useState<CustomScanRow[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress>({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { localStorage.setItem('scn_custom_preset', presetId) }, [presetId])
  useEffect(() => { localStorage.setItem('scn_custom_tfs', JSON.stringify(tfs)) }, [tfs])
  useEffect(() => { localStorage.setItem('scn_custom_lookback', String(lookbackDays)) }, [lookbackDays])

  useEffect(() => {
    apiFetch('/api/builder/strategies')
      .then(r => r.ok ? r.json() : [])
      .then((list: PresetSummary[]) => {
        setPresets(list)
        // Reconcile the saved selection: if the stored id was deleted (stale
        // localStorage), fall back to the first preset so we never scan a
        // ghost id and 404.
        setPresetId(prev => (list.some(p => p.id === prev) ? prev : (list[0]?.id ?? '')))
      })
      .catch(() => {})
  }, [])

  const start = async () => {
    if (!presetId) { setError('Pick a saved strategy first (build & Save one in the Strategy Builder).'); return }
    if (universe.length === 0) { setError('Symbol universe is empty — refresh on the page header.'); return }
    setError(null); setRows([]); setProgress({ done: 0, total: 0 }); setScanning(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const sRes = await apiFetch(`/api/builder/strategies/${presetId}`)
      if (!sRes.ok) throw new Error(`Couldn't load the strategy (HTTP ${sRes.status})`)
      const spec = await sRes.json() as CustomStrategySpec
      const timeframes = ALL_TFS.filter(tf => tfs[tf])
      if (timeframes.length === 0) throw new Error('Pick at least one timeframe.')
      const result = await runCustomScan(spec, universe.slice(0, DEFAULT_SCAN_LIMIT), { timeframes, lookbackDays }, setProgress, ctrl.signal)
      setRows(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setScanning(false); abortRef.current = null
    }
  }

  const stop = () => { abortRef.current?.abort(); setScanning(false) }

  const openInBuilder = (r: CustomScanRow) => {
    // Seed the Builder's symbol/timeframe, then go there. The user re-loads the
    // preset from Saved presets to tune it on that coin.
    localStorage.setItem('builder_symbol', r.symbol)
    localStorage.setItem('builder_tf', r.timeframe)
    onPickSymbol(r.symbol)
    onPickTimeframe(r.timeframe)
    navigate('/builder')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="card flex flex-wrap items-end gap-4 p-4">
        <div className="flex flex-col gap-1 min-w-[200px]">
          <span className="text-[10px] uppercase tracking-wider text-dim">Saved strategy</span>
          {presets.length === 0 ? (
            <span className="text-[11px] text-dim italic">None saved yet — build one in the Strategy Builder and click Save.</span>
          ) : (
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}
              className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs text-text outline-none focus:border-brand/60">
              {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-dim">Timeframes</span>
          <div className="flex gap-1">
            {ALL_TFS.map(tf => (
              <button key={tf} type="button" onClick={() => setTfs(s => ({ ...s, [tf]: !s[tf] }))}
                className={`rounded-md border px-2 py-1 text-[11px] font-mono transition-colors ${tfs[tf] ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-panel-2 text-dim hover:text-text'}`}>
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-dim">Lookback</span>
          <select value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))}
            className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs font-mono text-text outline-none focus:border-brand/60">
            {[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d}d</option>)}
          </select>
        </div>

        <div className="flex-1" />

        {scanning ? (
          <button type="button" onClick={stop} className="flex items-center gap-2 rounded-xl border border-loss/40 bg-loss/10 px-3 py-2 text-sm font-semibold text-loss hover:bg-loss/15">
            <Loader2 className="h-4 w-4 animate-spin" /> Stop
          </button>
        ) : (
          <button type="button" onClick={start} disabled={universe.length === 0 || !presetId}
            className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            <Play className="h-4 w-4" /> Scan top {DEFAULT_SCAN_LIMIT}
          </button>
        )}
      </div>

      {error && <div className="card border border-loss/30 bg-loss/5 p-3 text-xs text-loss">{error}</div>}

      {(scanning || progress.total > 0) && (
        <div className="card p-3">
          <div className="flex items-center justify-between text-[11px] text-dim mb-2">
            <span>{scanning ? 'Scanning…' : 'Scan complete'}{progress.current && <span className="ml-2 font-mono text-text">{progress.current}</span>}</span>
            <span className="font-mono tabular-nums">{progress.done} / {progress.total}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-brand transition-all duration-200" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel-2 text-[10px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Coin</th>
                  <th className="px-3 py-2 text-right" title="Exchange max leverage — the cap, not a recommendation.">Max Lev</th>
                  <th className="px-3 py-2 text-left">TF</th>
                  <th className="px-3 py-2 text-right" title="Composite 0–100: profit factor + sample size + win-rate + drawdown.">Quality</th>
                  <th className="px-3 py-2 text-right">Return %</th>
                  <th className="px-3 py-2 text-right">Trades</th>
                  <th className="px-3 py-2 text-right">Win %</th>
                  <th className="px-3 py-2 text-right">PF</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const pass = r.quality >= PASS_QUALITY
                  return (
                    <tr key={`${r.symbol}-${r.timeframe}-${i}`} onClick={() => openInBuilder(r)}
                      className={`cursor-pointer border-t border-border hover:bg-panel-2/60 ${pass ? 'bg-gain/5' : ''}`}>
                      <td className="px-3 py-1.5 font-medium text-text">{pass && <span className="mr-1 text-gain">●</span>}{r.base}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-dim tabular-nums">{maxLev[r.base] ? `${maxLev[r.base]}x` : '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-dim">{r.timeframe}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-bold tabular-nums ${r.quality >= 75 ? 'text-gain' : r.quality >= 55 ? 'text-brand' : r.quality >= 35 ? 'text-text' : r.quality >= 15 ? 'text-warn' : 'text-loss'}`}>
                        {r.trades ? Math.round(r.quality) : '—'}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${r.returnPct > 0 ? 'text-gain' : r.returnPct < 0 ? 'text-loss' : 'text-dim'}`}>
                        {r.trades ? `${r.returnPct > 0 ? '+' : ''}${r.returnPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-dim">{r.trades}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.trades ? `${r.winRate.toFixed(0)}%` : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.trades === 0 ? '—' : r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right text-dim"><Hammer className="inline h-3 w-3" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
