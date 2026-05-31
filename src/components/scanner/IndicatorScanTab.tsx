import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Play, Square, ArrowRight, Medal, Search, Trophy, X } from 'lucide-react'
import type { Direction, StrategyId } from '@/types'
import type { SymbolInfo } from '@/lib/binance'
import { defaultParams, STRATEGIES } from '@/lib/strategies'
import {
  runIndicatorScan,
  type IndicatorScanRow,
  type ScanProgress,
} from '@/lib/scanner/indicatorScan'
import {
  gradeBg,
  gradeIndicatorRow,
  realismWarning,
  realisticEstimatePct,
  timeAgo,
} from '@/lib/scanner/verdict'
import MarketPulse from '@/components/scanner/MarketPulse'

interface Props {
  universe: SymbolInfo[]
  onPickSymbol: (symbol: string) => void
  onPickTimeframe: (tf: string) => void
}

type SortKey =
  | 'qualityScore'
  | 'totalReturnPct'
  | 'calmar'
  | 'numTrades'
  | 'winRate'
  | 'maxDrawdownPct'
  | 'sharpeRatio'

const ALL_TFS = ['15m', '30m', '1h', '4h', '1d', '1w'] as const
const LOOKBACK_OPTIONS = [30, 60, 90, 180, 365] as const
type LookbackDays = typeof LOOKBACK_OPTIONS[number]

// Format YYYY-MM-DD from a Date (UTC).
const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
// Returns "from → to" given a lookback in days.
function lookbackRange(days: number): { from: string; to: string } {
  const now = new Date()
  const past = new Date(now.getTime() - days * 86_400_000)
  return { from: fmtDate(past), to: fmtDate(now) }
}
const ALL_STRATS: StrategyId[] = STRATEGIES.map((s) => s.id)

const STORAGE_KEY = 'scanner_indicator_results_v1'

interface PersistedState {
  rows: IndicatorScanRow[]
  progress: ScanProgress
  scannedAt: number
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistedState) : null
  } catch {
    return null
  }
}

export default function IndicatorScanTab({
  universe,
  onPickSymbol,
  onPickTimeframe,
}: Props) {
  const navigate = useNavigate()
  const persisted = loadPersisted()
  const [rows, setRows] = useState<IndicatorScanRow[]>(persisted?.rows ?? [])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress>(
    persisted?.progress ?? { done: 0, total: 0 },
  )
  const [scannedAt, setScannedAt] = useState<number | null>(
    persisted?.scannedAt ?? null,
  )
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Forces a re-render every 30s so "5 min ago" stays current.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // Filters — persisted in localStorage so they survive across sessions.
  const [minTrades, setMinTrades] = useState(
    () => Number(localStorage.getItem('scn_ind_minTrades') ?? 5),
  )
  const [direction, setDirection] = useState<Direction>(
    () => (localStorage.getItem('scn_ind_direction') as Direction) ?? 'both',
  )
  const [tfFilter, setTfFilter] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('scn_ind_tfFilter')
      return saved ? JSON.parse(saved) : { '1h': true, '4h': true }
    } catch {
      return { '1h': true, '4h': true }
    }
  })
  const [lookback, setLookback] = useState<LookbackDays>(() => {
    const saved = Number(localStorage.getItem('scn_ind_lookback') ?? 90) as LookbackDays
    return (LOOKBACK_OPTIONS as readonly number[]).includes(saved) ? saved : 90
  })
  const [stratFilter, setStratFilter] = useState<Record<StrategyId, boolean>>(() => {
    try {
      const saved = localStorage.getItem('scn_ind_stratFilter')
      if (saved) return JSON.parse(saved)
    } catch {}
    return Object.fromEntries(ALL_STRATS.map((s) => [s, true])) as Record<StrategyId, boolean>
  })
  const [sortKey, setSortKey] = useState<SortKey>('qualityScore')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // Free-text search across base coin symbol. Persisted so the user doesn't
  // re-type "BTC" every time they navigate away and back.
  const [search, setSearch] = useState<string>(
    () => localStorage.getItem('scn_ind_search') ?? '',
  )

  useEffect(() => { localStorage.setItem('scn_ind_minTrades', String(minTrades)) }, [minTrades])
  useEffect(() => { localStorage.setItem('scn_ind_direction', direction) }, [direction])
  useEffect(() => { localStorage.setItem('scn_ind_tfFilter', JSON.stringify(tfFilter)) }, [tfFilter])
  useEffect(() => { localStorage.setItem('scn_ind_stratFilter', JSON.stringify(stratFilter)) }, [stratFilter])
  useEffect(() => { localStorage.setItem('scn_ind_lookback', String(lookback)) }, [lookback])
  useEffect(() => { localStorage.setItem('scn_ind_search', search) }, [search])

  const start = async () => {
    if (universe.length === 0) {
      setError('Symbol universe is empty — refresh on the page header.')
      return
    }
    setError(null)
    setRows([])
    setProgress({ done: 0, total: 0 })
    setScannedAt(null)
    setScanning(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const result = await runIndicatorScan(
        universe,
        {
          timeframes: ALL_TFS.filter((tf) => tfFilter[tf]),
          lookbackDays: lookback,
          direction,
        },
        setProgress,
        ctrl.signal,
      )
      const completedAt = Date.now()
      setRows(result)
      setScannedAt(completedAt)
      // Persist so navigating away and back keeps the results.
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          rows: result,
          progress: { done: result.length, total: result.length },
          scannedAt: completedAt,
        }),
      )
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

  const clearResults = () => {
    sessionStorage.removeItem(STORAGE_KEY)
    setRows([])
    setProgress({ done: 0, total: 0 })
    setScannedAt(null)
  }

  // Filter + sort + grade
  const visible = useMemo(() => {
    const q = search.trim().toUpperCase()
    const filtered = rows.filter(
      (r) =>
        r.numTrades >= minTrades &&
        tfFilter[r.timeframe] &&
        stratFilter[r.strategyId] &&
        (q === '' || r.base.toUpperCase().includes(q) || r.symbol.toUpperCase().includes(q)),
    )
    const dir = sortDir === 'desc' ? -1 : 1
    filtered.sort((a, b) => {
      const av = (a[sortKey] ?? -Infinity) as number
      const bv = (b[sortKey] ?? -Infinity) as number
      return (av - bv) * dir
    })
    return filtered.map((r) => ({ row: r, verdict: gradeIndicatorRow(r) }))
  }, [rows, minTrades, tfFilter, stratFilter, sortKey, sortDir, search])

  const top3 = visible.slice(0, 3)
  const bestPick = visible[0]

  // Unique base coins present in the current scan results. Powers the coin
  // dropdown so the user only sees options that will actually match a row.
  const uniqueBases = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) set.add(r.base.toUpperCase())
    return [...set].sort()
  }, [rows])

  const goToBacktest = (r: IndicatorScanRow) => {
    onPickSymbol(r.symbol)
    onPickTimeframe(r.timeframe)
    // Pass through the exact inputs the scanner used so the Backtester's
    // numbers match the row the user clicked. Otherwise the Backtester
    // would reload its own saved params/date/direction and show different
    // results from the row's reported return.
    navigate('/backtest', {
      state: {
        presetStrategy: r.strategyId,
        presetParams: defaultParams(r.strategyId),
        presetDirection: direction,
        presetLookbackDays: lookback,
      },
    })
  }

  const headerClick = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const sortArrow = (k: SortKey) => (k === sortKey ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '')

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter / action bar ─────────────────────────────────────────── */}
      {/* relative + isolate creates a stacking context so the CoinPicker
          popover layers above the sibling Strategies / Best Pick cards. */}
      <div className="card relative z-20 isolate p-4 flex flex-wrap items-end gap-4">
        {/* Coin picker — combobox of bases in the current scan results. */}
        <div className="flex flex-col gap-1 min-w-[200px]">
          <span className="text-[10px] text-dim uppercase tracking-wider">Coin</span>
          <CoinPicker
            value={search}
            onChange={setSearch}
            options={uniqueBases}
          />
        </div>

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

        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-dim uppercase tracking-wider">Lookback</span>
          <select
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value) as LookbackDays)}
            className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs font-mono text-text outline-none focus:border-brand/60"
            title="How many days of past candles each backtest covers"
          >
            {LOOKBACK_OPTIONS.map((d) => (
              <option key={d} value={d}>{d}d</option>
            ))}
          </select>
          <span className="font-mono text-[9px] text-dim">
            {(() => { const r = lookbackRange(lookback); return `${r.from} → ${r.to}` })()}
          </span>
        </div>

        <div className="flex-1" />

        {scannedAt && !scanning && (
          <div className="text-[10px] text-dim font-mono">
            Scanned {timeAgo(scannedAt)}
            <button
              type="button"
              onClick={clearResults}
              className="ml-2 text-dim hover:text-loss underline"
            >
              clear
            </button>
          </div>
        )}

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
            {rows.length > 0 ? 'Re-scan' : 'Scan'}
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
      {(scanning || (progress.total > 0 && !scannedAt)) && (
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

      {/* ── Market Pulse — current regime + recommended strategy type ───── */}
      <MarketPulse rows={rows} onPick={goToBacktest} />

      {/* ── Best pick hero ──────────────────────────────────────────────── */}
      {bestPick && (
        <button
          type="button"
          onClick={() => goToBacktest(bestPick.row)}
          className={`card flex flex-col gap-2 p-4 text-left transition-colors hover:border-brand/40 ${gradeBg(bestPick.verdict.grade)}`}
        >
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Best Pick · {bestPick.verdict.label}
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-lg font-bold">
              {bestPick.row.base} · {bestPick.row.timeframe} · {bestPick.row.strategyName}
            </span>
            {typeof bestPick.row.qualityScore === 'number' && (
              <span
                className="font-mono text-base font-bold"
                title="Composite Quality Score (0–100). Combines risk-adjusted return, beats buy-hold, sensible trade count, multi-TF agreement, and funding penalty."
              >
                Q: {Math.round(bestPick.row.qualityScore)}/100
              </span>
            )}
            <span
              className={`font-mono text-sm ${
                bestPick.row.totalReturnPct >= 0 ? 'text-gain' : 'text-loss'
              }`}
            >
              {bestPick.row.totalReturnPct >= 0 ? '+' : ''}
              {bestPick.row.totalReturnPct.toFixed(2)}% test
            </span>
            {!bestPick.row.looksAhead && (
              <span className="font-mono text-xs text-dim">
                · real-money guess {realisticEstimatePct(bestPick.row.totalReturnPct) >= 0 ? '+' : ''}
                {realisticEstimatePct(bestPick.row.totalReturnPct).toFixed(1)}%
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed opacity-90">
            {bestPick.verdict.reason}
            <span className="ml-2 text-[10px] opacity-70">→ click to open in Backtester</span>
          </p>
          {(() => {
            const w = realismWarning({
              totalReturnPct: bestPick.row.totalReturnPct,
              lookbackDays: bestPick.row.lookbackDays,
              sharpeRatio: bestPick.row.sharpeRatio,
              looksAhead: bestPick.row.looksAhead,
            })
            return w ? (
              <p className="rounded-md border border-warn/30 bg-warn/5 px-2 py-1.5 text-[11px] text-warn">
                ⚠ {w}
              </p>
            ) : null
          })()}
        </button>
      )}

      {/* ── Top 3 highlight ─────────────────────────────────────────────── */}
      {top3.length > 1 && (
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Medal className="h-3.5 w-3.5 text-brand" />
            <span className="text-xs font-semibold text-text">Top 3</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {top3.map(({ row: r, verdict: v }, i) => (
              <button
                key={`${r.symbol}-${r.timeframe}-${r.strategyId}`}
                type="button"
                onClick={() => goToBacktest(r)}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-panel-2 p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-dim">
                    {['🥇', '🥈', '🥉'][i]} #{i + 1}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${gradeBg(v.grade)}`}>
                    {v.label}
                  </span>
                </div>
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
                <span className="text-[10px] text-dim leading-snug line-clamp-2">
                  {v.reason}
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
                  <th className="px-3 py-2 text-left">Pick</th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('qualityScore')}
                    title="Composite 0–100 score: risk-adjusted return + beats buy-hold + sensible trade count + multi-TF agreement + funding penalty. Higher is better."
                  >
                    Quality{sortArrow('qualityScore')}
                  </th>
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-left">TF</th>
                  <th
                    className="px-3 py-2 text-left"
                    title="Current market regime for this (symbol, timeframe). Bull = trending up, Sideways = chop, Bear = trending down. Conviction near +1 means strong bullish bias."
                  >
                    Regime
                  </th>
                  <th className="px-3 py-2 text-left">Strategy</th>
                  <th
                    className="px-3 py-2 text-left"
                    title="Does the next-higher timeframe agree with the current one? Aligned = good. Conflict = wait or skip."
                  >
                    HTF
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('totalReturnPct')}
                  >
                    Test return{sortArrow('totalReturnPct')}
                  </th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Backtest result minus a 50% haircut for slippage, fees, and bad luck. Rough guess of what you'd actually make if you ran the bot."
                  >
                    Real-money guess
                  </th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Annualised funding rate on Binance perp. Red if > +50% (crowded longs paying shorts) — strategy will bleed funding even if backtest looks good."
                  >
                    Funding
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('calmar')}
                    title="Calmar ratio = annualised return ÷ max drawdown. Higher = more return per unit of pain. >1 is good, >2 is strong."
                  >
                    Calmar{sortArrow('calmar')}
                  </th>
                  <th
                    className="px-3 py-2 text-right cursor-pointer hover:text-text"
                    onClick={() => headerClick('numTrades')}
                  >
                    Trades{sortArrow('numTrades')}
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
                {visible.map(({ row: r, verdict: v }, i) => (
                  <tr
                    key={`${r.symbol}-${r.timeframe}-${r.strategyId}`}
                    className="border-t border-border hover:bg-panel-2/60"
                    title={v.reason}
                  >
                    <td className="px-3 py-2 text-dim font-mono tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${gradeBg(v.grade)}`}>
                        {v.label}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums font-bold ${
                        (r.qualityScore ?? 0) >= 75 ? 'text-gain'
                          : (r.qualityScore ?? 0) >= 55 ? 'text-brand'
                          : (r.qualityScore ?? 0) >= 35 ? 'text-text'
                          : (r.qualityScore ?? 0) >= 15 ? 'text-warn'
                          : 'text-loss'
                      }`}
                    >
                      {typeof r.qualityScore === 'number' ? Math.round(r.qualityScore) : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-text">{r.base}</td>
                    <td className="px-3 py-2 font-mono text-text">{r.timeframe}</td>
                    <td className="px-3 py-2">
                      {r.regimeLabel ? (
                        <span
                          className={`font-mono text-[11px] ${
                            r.regimeLabel === 'Bull' ? 'text-gain'
                              : r.regimeLabel === 'Bear' ? 'text-loss'
                              : 'text-dim'
                          }`}
                          title={`Markov regime label · conviction ${(r.regimeConviction ?? 0).toFixed(2)} (range −1…+1)`}
                        >
                          {r.regimeLabel} {typeof r.regimeConviction === 'number'
                            ? `${r.regimeConviction >= 0 ? '+' : ''}${r.regimeConviction.toFixed(1)}`
                            : ''}
                        </span>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text">
                      {r.strategyName}
                      {r.looksAhead && (
                        <span
                          className="ml-1.5 rounded border border-loss/40 bg-loss/10 px-1 py-0.5 text-[8px] font-bold uppercase text-loss"
                          title="This strategy uses future info to predict the past. Backtest result is not realistic — don't trust it."
                        >
                          ⚠ Looks fake
                        </span>
                      )}
                      {!r.looksAhead && r.totalReturnPct > r.buyHoldReturnPct && (
                        <span
                          className="ml-1.5 rounded border border-gain/40 bg-gain/10 px-1 py-0.5 text-[8px] font-bold uppercase text-gain"
                          title={`Strategy +${r.totalReturnPct.toFixed(1)}% vs Buy & Hold +${r.buyHoldReturnPct.toFixed(1)}% — strategy is adding value.`}
                        >
                          ✓ Beats BH
                        </span>
                      )}
                      {!r.looksAhead && r.totalReturnPct <= r.buyHoldReturnPct && r.totalReturnPct > 0 && (
                        <span
                          className="ml-1.5 rounded border border-warn/40 bg-warn/5 px-1 py-0.5 text-[8px] font-bold uppercase text-warn"
                          title={`Strategy +${r.totalReturnPct.toFixed(1)}% vs Buy & Hold +${r.buyHoldReturnPct.toFixed(1)}% — you'd have made more by just holding.`}
                        >
                          ✗ Lost to BH
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.confluence === 'aligned' && (
                        <span
                          className="rounded border border-gain/40 bg-gain/10 px-1 py-0.5 text-[9px] font-bold uppercase text-gain"
                          title={`Higher TF (${r.higherTimeframe ?? ''}) regime agrees`}
                        >
                          ✓ Aligned
                        </span>
                      )}
                      {r.confluence === 'conflicting' && (
                        <span
                          className="rounded border border-loss/40 bg-loss/10 px-1 py-0.5 text-[9px] font-bold uppercase text-loss"
                          title={`Higher TF (${r.higherTimeframe ?? ''}) regime conflicts`}
                        >
                          ✗ Conflict
                        </span>
                      )}
                      {r.confluence === 'neutral' && (
                        <span
                          className="rounded border border-border bg-panel-2 px-1 py-0.5 text-[9px] font-bold uppercase text-dim"
                          title={`Higher TF (${r.higherTimeframe ?? ''}) is mixed`}
                        >
                          ~ Mixed
                        </span>
                      )}
                      {r.confluence == null && (
                        <span className="text-dim text-[10px]">—</span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        r.totalReturnPct >= 0 ? 'text-gain' : 'text-loss'
                      }`}
                    >
                      {r.totalReturnPct >= 0 ? '+' : ''}
                      {r.totalReturnPct.toFixed(2)}%
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        r.looksAhead ? 'text-dim' : realisticEstimatePct(r.totalReturnPct) > 0 ? 'text-gain' : 'text-loss'
                      }`}
                      title={r.looksAhead
                        ? 'Cannot trust — strategy peeks into the future.'
                        : 'Backtest result minus a 50% haircut for slippage, fees, and bad luck.'}
                    >
                      {r.looksAhead
                        ? '—'
                        : `${realisticEstimatePct(r.totalReturnPct) >= 0 ? '+' : ''}${realisticEstimatePct(r.totalReturnPct).toFixed(1)}%`}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        typeof r.fundingApr !== 'number' || Number.isNaN(r.fundingApr) ? 'text-dim'
                          : Math.abs(r.fundingApr) >= 50 ? 'text-loss'
                          : Math.abs(r.fundingApr) >= 15 ? 'text-warn'
                          : 'text-text'
                      }`}
                      title={typeof r.fundingApr === 'number' && Number.isFinite(r.fundingApr)
                        ? `Annualised Binance perp funding rate. |APR| > 50% means perps are crowded and the bot will pay funding every 8h.`
                        : 'Funding rate unavailable for this symbol.'}
                    >
                      {typeof r.fundingApr === 'number' && Number.isFinite(r.fundingApr)
                        ? `${r.fundingApr >= 0 ? '+' : ''}${r.fundingApr.toFixed(0)}%`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text tabular-nums">
                      {typeof r.calmar === 'number' && Number.isFinite(r.calmar)
                        ? r.calmar.toFixed(2)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-dim tabular-nums">
                      {r.numTrades}
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

      {!scanning && rows.length > 0 && visible.length === 0 && (
        <div className="card p-6 text-center text-xs text-dim">
          No combos match the current filters.
        </div>
      )}
    </div>
  )
}

// CoinPicker — searchable dropdown for filtering rows by base coin. Mirrors
// the SymbolSearch combobox pattern from other pages (input + popover list)
// but is scoped to the bases that exist in the current scan results, so the
// user never sees a coin that wouldn't match any row.
function CoinPicker({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const q = query.trim().toUpperCase()
  const filtered = q ? options.filter((o) => o.includes(q)) : options

  const select = (v: string) => {
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  // Show the selected value when closed; while open, show typed query.
  const displayValue = open ? query : (value || '')

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dim" />
        <input
          type="text"
          value={displayValue}
          placeholder={options.length ? 'All coins · type or pick…' : 'Run a scan first'}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          className="w-full rounded-md border border-border bg-panel-2 pl-7 pr-8 py-1 text-xs font-mono text-text outline-none focus:border-brand/60 placeholder:text-dim/60"
        />
        {value ? (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); select('') }}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-dim hover:bg-panel hover:text-text"
            aria-label="Clear coin filter"
          >
            <X className="h-3 w-3" />
          </button>
        ) : (
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dim" />
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-panel shadow-2xl">
          <div className="max-h-72 overflow-auto py-1">
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select('') }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-bg ${
                value === '' ? 'text-brand' : 'text-text'
              }`}
            >
              <span className="font-medium">All coins</span>
              <span className="text-[10px] text-dim">{options.length} available</span>
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-dim italic">No coins match</p>
            ) : (
              filtered.map((base) => (
                <button
                  key={base}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); select(base) }}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-xs font-mono hover:bg-bg ${
                    base.toUpperCase() === value.toUpperCase() ? 'text-brand' : 'text-text'
                  }`}
                >
                  {base}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
