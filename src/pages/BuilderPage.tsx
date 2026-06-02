// Strategy Builder — combine indicator conditions with AND/OR to build a
// custom strategy spec. Backtest in place, save as preset, deploy as bot.
//
// Phase 2 of the SMC + multi-indicator strategy work. The data model lives
// in lib/builder/types.ts; the evaluator that turns a spec into per-bar
// signals lives in lib/builder/evaluate.ts. This page is the UI shell — it
// owns the spec state and wires user actions into those modules.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Hammer, Plus, Play, Save, Trash2, X, Rocket, Folder } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'
import { fetchKlines } from '@/lib/binance'
import { useHLAssets } from '@/lib/hlAssets'
import SymbolSearch from '@/components/SymbolSearch'
import { runBacktest } from '@/lib/backtest'
import { evaluateCustomStrategy } from '@/lib/builder/evaluate'
import type {
  Combinator,
  CompareOp,
  ConditionBlock,
  ConditionGroup,
  CrossOp,
  CustomStrategySpec,
  SeriesId,
  SeriesRef,
  SignalEventKind,
  StateOp,
} from '@/lib/builder/types'
import type { BacktestResult, Candle } from '@/types'

const TIMEFRAMES = ['15m', '30m', '1h', '4h', '1d'] as const

type GroupKey = 'entryLong' | 'exitLong' | 'entryShort' | 'exitShort'

// ── Catalogues — what the user can pick from ─────────────────────────────────

interface SeriesMeta {
  id: SeriesId
  label: string          // human-readable
  defaultParams: Record<string, number>
  paramFields: { key: string; label: string; min: number; max: number; default: number }[]
}
const SERIES_CATALOGUE: SeriesMeta[] = [
  { id: 'price',      label: 'Price (close)',     defaultParams: {}, paramFields: [] },
  { id: 'rsi',        label: 'RSI',               defaultParams: { length: 14 }, paramFields: [{ key: 'length', label: 'Length', min: 2, max: 100, default: 14 }] },
  { id: 'ema',        label: 'EMA',               defaultParams: { length: 50 }, paramFields: [{ key: 'length', label: 'Length', min: 2, max: 500, default: 50 }] },
  { id: 'sma',        label: 'SMA',               defaultParams: { length: 50 }, paramFields: [{ key: 'length', label: 'Length', min: 2, max: 500, default: 50 }] },
  { id: 'macd_line',  label: 'MACD line',         defaultParams: { fast: 12, slow: 26, signal: 9 }, paramFields: [{ key: 'fast', label: 'Fast', min: 2, max: 50, default: 12 }, { key: 'slow', label: 'Slow', min: 5, max: 100, default: 26 }, { key: 'signal', label: 'Signal', min: 2, max: 50, default: 9 }] },
  { id: 'macd_signal',label: 'MACD signal',       defaultParams: { fast: 12, slow: 26, signal: 9 }, paramFields: [{ key: 'fast', label: 'Fast', min: 2, max: 50, default: 12 }, { key: 'slow', label: 'Slow', min: 5, max: 100, default: 26 }, { key: 'signal', label: 'Signal', min: 2, max: 50, default: 9 }] },
  { id: 'macd_hist',  label: 'MACD histogram',    defaultParams: { fast: 12, slow: 26, signal: 9 }, paramFields: [{ key: 'fast', label: 'Fast', min: 2, max: 50, default: 12 }, { key: 'slow', label: 'Slow', min: 5, max: 100, default: 26 }, { key: 'signal', label: 'Signal', min: 2, max: 50, default: 9 }] },
  { id: 'bb_upper',   label: 'Bollinger upper',   defaultParams: { length: 20, mult: 2 }, paramFields: [{ key: 'length', label: 'Length', min: 5, max: 100, default: 20 }, { key: 'mult', label: 'Mult', min: 1, max: 4, default: 2 }] },
  { id: 'bb_mid',     label: 'Bollinger mid',     defaultParams: { length: 20, mult: 2 }, paramFields: [{ key: 'length', label: 'Length', min: 5, max: 100, default: 20 }, { key: 'mult', label: 'Mult', min: 1, max: 4, default: 2 }] },
  { id: 'bb_lower',   label: 'Bollinger lower',   defaultParams: { length: 20, mult: 2 }, paramFields: [{ key: 'length', label: 'Length', min: 5, max: 100, default: 20 }, { key: 'mult', label: 'Mult', min: 1, max: 4, default: 2 }] },
  { id: 'adx',        label: 'ADX',               defaultParams: { length: 14 }, paramFields: [{ key: 'length', label: 'Length', min: 5, max: 50, default: 14 }] },
  { id: 'plus_di',    label: '+DI',               defaultParams: { length: 14 }, paramFields: [{ key: 'length', label: 'Length', min: 5, max: 50, default: 14 }] },
  { id: 'minus_di',   label: '-DI',               defaultParams: { length: 14 }, paramFields: [{ key: 'length', label: 'Length', min: 5, max: 50, default: 14 }] },
  { id: 'stoch_k',    label: 'Stochastic %K',     defaultParams: { kLen: 14, kSmooth: 3, dLen: 3 }, paramFields: [{ key: 'kLen', label: 'K Len', min: 2, max: 50, default: 14 }, { key: 'kSmooth', label: 'K Smooth', min: 1, max: 10, default: 3 }, { key: 'dLen', label: 'D Len', min: 2, max: 50, default: 3 }] },
  { id: 'stoch_d',    label: 'Stochastic %D',     defaultParams: { kLen: 14, kSmooth: 3, dLen: 3 }, paramFields: [{ key: 'kLen', label: 'K Len', min: 2, max: 50, default: 14 }, { key: 'kSmooth', label: 'K Smooth', min: 1, max: 10, default: 3 }, { key: 'dLen', label: 'D Len', min: 2, max: 50, default: 3 }] },
  { id: 'volume',     label: 'Volume',            defaultParams: {}, paramFields: [] },
  { id: 'volume_ma',  label: 'Volume MA',         defaultParams: { length: 20 }, paramFields: [{ key: 'length', label: 'Length', min: 2, max: 200, default: 20 }] },
  { id: 'atr',        label: 'ATR',               defaultParams: { length: 14 }, paramFields: [{ key: 'length', label: 'Length', min: 2, max: 100, default: 14 }] },
]
const SERIES_BY_ID = new Map(SERIES_CATALOGUE.map((s) => [s.id, s]))

const EVENT_CATALOGUE: { kind: SignalEventKind; label: string }[] = [
  { kind: 'smc_bullish_choch', label: 'SMC Bullish CHoCH' },
  { kind: 'smc_bearish_choch', label: 'SMC Bearish CHoCH' },
  { kind: 'smc_bullish_bos',   label: 'SMC Bullish BOS' },
  { kind: 'smc_bearish_bos',   label: 'SMC Bearish BOS' },
]

// ── Factory helpers ──────────────────────────────────────────────────────────

function nextId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function newSeriesRef(id: SeriesId): SeriesRef {
  return { id, params: { ...SERIES_BY_ID.get(id)!.defaultParams } }
}

function newBlock(kind: ConditionBlock['kind']): ConditionBlock {
  const id = nextId()
  switch (kind) {
    case 'compare': return { kind, id, series: newSeriesRef('rsi'), op: '<', value: 30 }
    case 'cross':   return { kind, id, a: newSeriesRef('ema'), op: 'crossUp', b: newSeriesRef('sma') }
    case 'state':   return { kind, id, a: newSeriesRef('price'), op: 'above', b: newSeriesRef('ema') }
    case 'event':   return { kind, id, event: { kind: 'smc_bullish_choch', params: { swingLength: 50 } } }
  }
}

function newEmptySpec(): CustomStrategySpec {
  return {
    id: nextId(),
    name: 'My custom strategy',
    direction: 'long',
    entryLong: { combinator: 'ALL', conditions: [] },
    exitLong:  { combinator: 'ANY', conditions: [] },
    tpPct: 4,
    slPct: 2,
    stopMode: 'pct',
    riskPct: 1,
  }
}

// Ready-made "Breakout + Volume Filter, follow-trend" strategy (the YouTube
// setup), two-sided: above EMA-200 go long on an upper-band breakout with a
// volume spike; below EMA-200 go short on a lower-band breakdown with a volume
// spike. Stop = ATR(14)×2, take-profit at 2R. Long & Short = always-in-market
// (the opposite breakout flips the position), exits handled by the stops.
function breakoutVolumeTemplate(): CustomStrategySpec {
  const s = (id: SeriesId, params: Record<string, number> = {}): SeriesRef => ({ id, params })
  return {
    id: nextId(),
    name: 'Breakout + Volume Filter',
    direction: 'both',
    entryLong: {
      combinator: 'ALL',
      conditions: [
        { kind: 'state', id: nextId(), a: s('price'), op: 'above', b: s('ema', { length: 200 }) },
        { kind: 'cross', id: nextId(), a: s('price'), op: 'crossUp', b: s('bb_upper', { length: 20, mult: 2 }) },
        { kind: 'state', id: nextId(), a: s('volume'), op: 'above', b: s('volume_ma', { length: 20 }) },
      ],
    },
    exitLong: { combinator: 'ANY', conditions: [] }, // exit via ATR stop / take-profit only
    entryShort: {
      combinator: 'ALL',
      conditions: [
        { kind: 'state', id: nextId(), a: s('price'), op: 'below', b: s('ema', { length: 200 }) },
        { kind: 'cross', id: nextId(), a: s('price'), op: 'crossDown', b: s('bb_lower', { length: 20, mult: 2 }) },
        { kind: 'state', id: nextId(), a: s('volume'), op: 'above', b: s('volume_ma', { length: 20 }) },
      ],
    },
    exitShort: { combinator: 'ANY', conditions: [] },
    stopMode: 'atr',
    atrLength: 14,
    atrMult: 2,
    rr: 2,
    riskPct: 3,
  }
}

// ── Persistence key for the in-progress spec ─────────────────────────────────
const DRAFT_KEY = 'builder_draft_v1'

interface PresetSummary { id: string; name: string; updatedAt: number }

export default function BuilderPage() {
  const navigate = useNavigate()
  const [spec, setSpec] = useState<CustomStrategySpec>(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)
      if (raw) return JSON.parse(raw) as CustomStrategySpec
    } catch {}
    return newEmptySpec()
  })
  useEffect(() => { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(spec)) }, [spec])

  const [symbol, setSymbol] = useState(() => localStorage.getItem('builder_symbol') || 'BTCUSDT')
  const [timeframe, setTimeframe] = useState<string>(() => localStorage.getItem('builder_tf') || '1h')
  const [lookbackDays, setLookbackDays] = useState(90)
  useEffect(() => { localStorage.setItem('builder_symbol', symbol) }, [symbol])
  useEffect(() => { localStorage.setItem('builder_tf', timeframe) }, [timeframe])

  const hlSymbols = useHLAssets()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)

  // ── Preset library ─────────────────────────────────────────────────────────
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const refreshPresets = () => {
    apiFetch('/api/builder/strategies')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: PresetSummary[]) => setPresets(list))
      .catch(() => {})
  }
  useEffect(() => { refreshPresets() }, [])

  // ── Mutators ───────────────────────────────────────────────────────────────
  // Short groups are optional on the spec; default to an empty group so the
  // user can build them without a separate "init" step.
  const emptyGroup = (which: GroupKey): ConditionGroup =>
    ({ combinator: which.startsWith('exit') ? 'ANY' : 'ALL', conditions: [] })
  const updateGroup = (which: GroupKey, mut: (g: ConditionGroup) => ConditionGroup) => {
    setSpec((s) => ({ ...s, [which]: mut(s[which] ?? emptyGroup(which)) }))
  }
  const addBlock = (which: GroupKey, kind: ConditionBlock['kind']) => {
    updateGroup(which, (g) => ({ ...g, conditions: [...g.conditions, newBlock(kind)] }))
  }
  const removeBlock = (which: GroupKey, id: string) => {
    updateGroup(which, (g) => ({ ...g, conditions: g.conditions.filter((b) => b.id !== id) }))
  }
  const replaceBlock = (which: GroupKey, updated: ConditionBlock) => {
    updateGroup(which, (g) => ({ ...g, conditions: g.conditions.map((b) => (b.id === updated.id ? updated : b)) }))
  }
  const setCombinator = (which: GroupKey, c: Combinator) => {
    updateGroup(which, (g) => ({ ...g, combinator: c }))
  }

  // ── Backtest ───────────────────────────────────────────────────────────────
  const runBacktestNow = async () => {
    setError(null); setNotice(null); setBusy(true); setResult(null)
    try {
      const to = Date.now()
      const from = to - lookbackDays * 86_400_000
      const candles: Candle[] = await fetchKlines({ symbol, interval: timeframe, startTime: from })
      if (candles.length < 30) throw new Error('Not enough candles in this window — try a longer lookback.')
      const signals = evaluateCustomStrategy(spec, candles)
      const dir = spec.direction ?? 'long'
      const r = spec.stopMode === 'atr'
        // ATR stops: SL = ATR(14)×atrMult, TP at rr×stop distance, risking riskPct of capital.
        ? runBacktest(candles, signals, 10_000, 0.001, dir, 0, 0, 'volatility', spec.riskPct ?? 1, spec.atrMult ?? 2, spec.rr ?? 2)
        : runBacktest(candles, signals, 10_000, 0.001, dir, spec.slPct ?? 0, spec.tpPct ?? 0)
      setResult(r)
      if (r.trades.length === 0) {
        setNotice('Strategy produced 0 trades. Try loosening conditions or different symbol/timeframe.')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  // ── Save / load / delete preset ────────────────────────────────────────────
  const savePreset = async () => {
    setError(null); setNotice(null); setBusy(true)
    try {
      const res = await apiFetch('/api/builder/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      })
      if (!res.ok) throw new Error(`Save failed (HTTP ${res.status})`)
      const saved = await res.json() as CustomStrategySpec
      setSpec(saved)
      setNotice(`Saved "${saved.name}"`)
      refreshPresets()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const loadPreset = async (id: string) => {
    setError(null); setNotice(null); setBusy(true)
    try {
      const res = await apiFetch(`/api/builder/strategies/${id}`)
      if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`)
      setSpec(await res.json())
      setResult(null)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const deletePreset = async (id: string, name: string) => {
    if (!confirm(`Delete preset "${name}"?`)) return
    try {
      const res = await apiFetch(`/api/builder/strategies/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Delete failed (HTTP ${res.status})`)
      refreshPresets()
    } catch (e) { setError((e as Error).message) }
  }
  const newStrategy = () => { setSpec(newEmptySpec()); setResult(null); setNotice('Started a fresh strategy.') }

  // ── Deploy as signal bot ───────────────────────────────────────────────────
  const deployAsBot = async () => {
    setError(null); setNotice(null); setBusy(true)
    try {
      // Make sure the spec is saved first so the bot can reference its id.
      const saveRes = await apiFetch('/api/builder/strategies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      })
      if (!saveRes.ok) throw new Error(`Save failed (HTTP ${saveRes.status})`)
      const savedSpec = await saveRes.json() as CustomStrategySpec

      // Create the signal bot but don't auto-start — per the user's pref.
      const asset = symbol.replace(/USDT$/i, '').replace(/USDC$/i, '').toUpperCase()
      const dir = savedSpec.direction ?? 'long'
      const tradeSide = dir === 'short' ? 'sell' : dir === 'both' ? 'both' : 'buy'
      const isAtr = savedSpec.stopMode === 'atr'
      const body = {
        name: savedSpec.name,
        symbol,
        timeframe,
        strategyId: 'custom',
        customStrategyId: savedSpec.id,
        params: {},
        asset,
        size: 0,
        // No riskUsd: custom strategies size from a % of live equity (Risk %),
        // read from the spec by the bot per trade — so deploy matches backtest.
        slippagePct: 1,
        cooldownSec: 60,
        tradeSide,
        // ATR mode: leave fixed stops at 0 — the bot computes them from ATR.
        tpPct: isAtr ? 0 : (savedSpec.tpPct ?? 0),
        slPct: isAtr ? 0 : (savedSpec.slPct ?? 0),
      }
      const res = await apiFetch('/api/signal/bots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const created = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok) {
        throw new Error(created.error || `HTTP ${res.status}`)
      }
      setNotice(`Created bot "${savedSpec.name}" — opening it on the Signal Bots page…`)
      // Route straight to the new bot (?select) so the user lands on it with the
      // "created — press Start" guide, not on some unrelated first bot.
      const dest = created.id ? `/signal?select=${created.id}` : '/signal'
      setTimeout(() => navigate(dest), 1000)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!result) return null
    const m = result.metrics
    return {
      net: m.totalPnl, netPct: m.totalReturnPct, trades: m.numTrades,
      win: m.winRate, calmar: m.calmarRatio, mdd: m.maxDrawdownPct,
    }
  }, [result])

  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Hammer className="h-5 w-5 text-brand" />
          <h1 className="text-lg font-semibold text-text font-display">Strategy Builder</h1>
          <p className="hidden md:block text-xs text-dim">Combine indicators with AND/OR. Backtest, save, deploy.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={newStrategy} disabled={busy} className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-dim hover:text-text disabled:opacity-50">
            <Plus className="h-3 w-3" /> New
          </button>
          <button type="button" onClick={() => { setSpec(breakoutVolumeTemplate()); setResult(null); setNotice('Loaded Breakout + Volume Filter (Long & Short): long above EMA-200 on upper-band breakout, short below on lower-band breakdown, both with a volume spike · ATR×2 stop · 2R.') }} disabled={busy} className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-dim hover:text-text disabled:opacity-50" title="Load the Breakout + Volume Filter strategy (long & short)">
            <Hammer className="h-3 w-3" /> Breakout+Vol
          </button>
          <button type="button" onClick={savePreset} disabled={busy} className="flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] text-brand hover:bg-brand/15 disabled:opacity-50">
            <Save className="h-3 w-3" /> Save
          </button>
          <button type="button" onClick={runBacktestNow} disabled={busy} className="flex items-center gap-1 rounded-md bg-brand px-3 py-1 text-[11px] font-semibold text-bg hover:opacity-90 disabled:opacity-50">
            <Play className="h-3 w-3" /> Backtest
          </button>
          <button type="button" onClick={deployAsBot} disabled={busy} className="flex items-center gap-1 rounded-md border border-gain/40 bg-gain/10 px-2 py-1 text-[11px] text-gain hover:bg-gain/15 disabled:opacity-50">
            <Rocket className="h-3 w-3" /> Deploy as Bot
          </button>
        </div>
      </div>

      {error && <div className="card border border-loss/30 bg-loss/5 p-2 text-xs text-loss">{error}</div>}
      {notice && <div className="card border border-brand/30 bg-brand/5 p-2 text-xs text-brand">{notice}</div>}

      {/* Top row — settings + preset library */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-3 lg:col-span-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-[10px] text-dim uppercase">Name</span>
              <input value={spec.name} onChange={(e) => setSpec((s) => ({ ...s, name: e.target.value }))}
                className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs text-text outline-none focus:border-brand/60" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-dim uppercase">Symbol</span>
              <SymbolSearch value={symbol} symbols={hlSymbols.symbols} onChange={setSymbol} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-dim uppercase">Timeframe</span>
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}
                className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs font-mono text-text outline-none focus:border-brand/60">
                {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-dim uppercase">Direction</span>
              <select value={spec.direction ?? 'long'} onChange={(e) => setSpec((s) => ({ ...s, direction: e.target.value as 'long' | 'short' | 'both' }))}
                className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs text-text outline-none focus:border-brand/60">
                <option value="long">Long only</option>
                <option value="short">Short only</option>
                <option value="both">Long &amp; Short</option>
              </select>
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <NumberField label="Lookback (days)" value={lookbackDays} onChange={setLookbackDays} min={7} max={365} />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-dim uppercase">Stop mode</span>
              <select value={spec.stopMode ?? 'pct'} onChange={(e) => setSpec((s) => ({ ...s, stopMode: e.target.value as 'pct' | 'atr' }))}
                className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs text-text outline-none focus:border-brand/60">
                <option value="pct">Fixed %</option>
                <option value="atr">ATR × / RR</option>
              </select>
            </label>
            {spec.stopMode === 'atr' ? (
              <>
                <NumberField label="ATR ×" value={spec.atrMult ?? 2} onChange={(v) => setSpec((s) => ({ ...s, atrMult: v }))} min={0.5} max={10} step={0.1} />
                <NumberField label="R:R" value={spec.rr ?? 2} onChange={(v) => setSpec((s) => ({ ...s, rr: v }))} min={0.5} max={10} step={0.1} />
              </>
            ) : (
              <>
                <NumberField label="TP %" value={spec.tpPct ?? 0} onChange={(v) => setSpec((s) => ({ ...s, tpPct: v || undefined }))} min={0} max={100} step={0.1} />
                <NumberField label="SL %" value={spec.slPct ?? 0} onChange={(v) => setSpec((s) => ({ ...s, slPct: v || undefined }))} min={0} max={100} step={0.1} />
              </>
            )}
            {/* The one risk number — % of capital risked per trade. Drives the
                backtest AND the live bot (it risks this % of your real account),
                so what you test is what deploys. */}
            <NumberField label="Risk % / trade" value={spec.riskPct ?? 1} onChange={(v) => setSpec((s) => ({ ...s, riskPct: v > 0 ? v : undefined }))} min={0.1} max={20} step={0.1} />
            {summary && (
              <div className="rounded-md border border-border bg-panel-2 p-2">
                <div className="text-[10px] text-dim uppercase">Backtest</div>
                <div className={`font-mono text-sm font-bold ${summary.net >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {summary.net >= 0 ? '+' : ''}{summary.netPct.toFixed(1)}%
                </div>
                <div className="text-[10px] text-dim font-mono">
                  {summary.trades} trades · win {summary.win.toFixed(0)}% · calmar {summary.calmar.toFixed(1)} · MDD {summary.mdd.toFixed(1)}%
                </div>
              </div>
            )}
          </div>

          {/* Per-trade risk/reward — what you lose on a stop vs gain on target. */}
          {(() => {
            const risk = spec.riskPct ?? 1
            const R = spec.stopMode === 'atr'
              ? (spec.rr ?? 2)
              : (spec.slPct && spec.tpPct ? spec.tpPct / spec.slPct : null)
            return (
              <p className="mt-2 text-[11px] leading-relaxed text-dim">
                Per trade: lose <span className="font-semibold text-loss">−{risk}%</span> of account on a stop
                {R != null && <> · win <span className="font-semibold text-gain">+{(risk * R).toFixed(2)}%</span> on target (R:R {R.toFixed(2)})</>}.
                <span className="text-dim/70"> e.g. on a $150 account ≈ <span className="text-loss">−${(150 * risk / 100).toFixed(2)}</span>{R != null && <> / <span className="text-gain">+${(150 * risk * R / 100).toFixed(2)}</span></>} per trade.</span>
              </p>
            )
          })()}
        </div>

        {/* Preset library */}
        <div className="card p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-text">
            <Folder className="h-3 w-3 text-brand" /> Saved presets
          </div>
          {presets.length === 0 ? (
            <p className="text-[11px] text-dim italic">None yet — Save a strategy to keep it here.</p>
          ) : (
            <div className="space-y-1 text-[11px] max-h-48 overflow-y-auto">
              {presets.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-panel-2 px-2 py-1">
                  <button type="button" onClick={() => loadPreset(p.id)}
                    className="flex-1 text-left text-text hover:text-brand truncate">{p.name}</button>
                  <button type="button" onClick={() => deletePreset(p.id, p.name)}
                    className="text-dim hover:text-loss" aria-label="Delete">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Entry / Exit groups — shown per direction. In 'both', exits are
          ignored (opposite entry flips), so we hide them. */}
      {(() => {
        const dir = spec.direction ?? 'long'
        const showLong = dir === 'long' || dir === 'both'
        const showShort = dir === 'short' || dir === 'both'
        const showExits = dir !== 'both'
        const eg = (k: GroupKey): ConditionGroup => spec[k] ?? { combinator: k.startsWith('exit') ? 'ANY' : 'ALL', conditions: [] }
        const card = (k: GroupKey, title: string, subtitle: string) => (
          <GroupCard title={title} subtitle={subtitle} group={eg(k)}
            onCombinator={(c) => setCombinator(k, c)}
            onAdd={(kind) => addBlock(k, kind)}
            onRemove={(id) => removeBlock(k, id)}
            onUpdate={(b) => replaceBlock(k, b)} />
        )
        return (
          <>
            {showLong && card('entryLong', 'Entry Long', 'Open a long position when…')}
            {showLong && showExits && card('exitLong', 'Exit Long', 'Close the long when…')}
            {showShort && card('entryShort', 'Entry Short', 'Open a short position when…')}
            {showShort && showExits && card('exitShort', 'Exit Short', 'Close the short when…')}
            {dir === 'both' && (
              <p className="text-[11px] text-dim italic px-1">
                Long &amp; Short mode is always-in-market: a long signal flips any short (and vice-versa),
                and stops close trades — so exit-condition groups are hidden.
              </p>
            )}
          </>
        )
      })()}
    </main>
  )
}

// ── GroupCard ────────────────────────────────────────────────────────────────
function GroupCard({
  title, subtitle, group, onCombinator, onAdd, onRemove, onUpdate,
}: {
  title: string
  subtitle: string
  group: ConditionGroup
  onCombinator: (c: Combinator) => void
  onAdd: (kind: ConditionBlock['kind']) => void
  onRemove: (id: string) => void
  onUpdate: (b: ConditionBlock) => void
}) {
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text">{title}</div>
          <div className="text-[11px] text-dim">{subtitle}</div>
        </div>
        <select value={group.combinator} onChange={(e) => onCombinator(e.target.value as Combinator)}
          className="rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-text outline-none focus:border-brand/60">
          <option value="ALL">ALL must be true (AND)</option>
          <option value="ANY">ANY can trigger (OR)</option>
        </select>
      </div>
      <div className="space-y-1.5">
        {group.conditions.map((b) => (
          <BlockRow key={b.id} block={b} onUpdate={onUpdate} onRemove={() => onRemove(b.id)} />
        ))}
        {group.conditions.length === 0 && (
          <p className="text-[11px] text-dim italic px-2 py-1">No conditions yet — add one below.</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <AddBtn label="+ Compare (e.g. RSI < 30)" onClick={() => onAdd('compare')} />
        <AddBtn label="+ Cross (e.g. EMA crossUp EMA)" onClick={() => onAdd('cross')} />
        <AddBtn label="+ State (Price above EMA)" onClick={() => onAdd('state')} />
        <AddBtn label="+ Event (SMC CHoCH/BOS)" onClick={() => onAdd('event')} />
      </div>
    </div>
  )
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-md border border-border bg-panel-2 px-2 py-1 text-[10px] text-dim hover:text-text hover:border-brand/40">
      {label}
    </button>
  )
}

// ── BlockRow — renders one condition block as an editable row ────────────────
function BlockRow({ block, onUpdate, onRemove }: {
  block: ConditionBlock
  onUpdate: (b: ConditionBlock) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-panel-2 px-2 py-1.5">
      <span className="text-[10px] uppercase text-dim font-mono">{block.kind}</span>
      <div className="flex-1 flex flex-wrap gap-1.5 items-center">
        {block.kind === 'compare' && (
          <>
            <SeriesPicker value={block.series} onChange={(s) => onUpdate({ ...block, series: s })} />
            <Select value={block.op} onChange={(v) => onUpdate({ ...block, op: v as CompareOp })}
              options={['>', '<', '>=', '<=', '=='] as CompareOp[]} />
            <NumberInput value={block.value} onChange={(v) => onUpdate({ ...block, value: v })} />
          </>
        )}
        {block.kind === 'cross' && (
          <>
            <SeriesPicker value={block.a} onChange={(s) => onUpdate({ ...block, a: s })} />
            <Select value={block.op} onChange={(v) => onUpdate({ ...block, op: v as CrossOp })}
              options={['crossUp', 'crossDown'] as CrossOp[]} />
            <SeriesPicker value={block.b} onChange={(s) => onUpdate({ ...block, b: s })} />
          </>
        )}
        {block.kind === 'state' && (
          <>
            <SeriesPicker value={block.a} onChange={(s) => onUpdate({ ...block, a: s })} />
            <Select value={block.op} onChange={(v) => onUpdate({ ...block, op: v as StateOp })}
              options={['above', 'below'] as StateOp[]} />
            <SeriesPicker value={block.b} onChange={(s) => onUpdate({ ...block, b: s })} />
          </>
        )}
        {block.kind === 'event' && (
          <>
            <Select value={block.event.kind}
              onChange={(v) => onUpdate({ ...block, event: { ...block.event, kind: v as SignalEventKind } })}
              options={EVENT_CATALOGUE.map((e) => e.kind)}
              labels={Object.fromEntries(EVENT_CATALOGUE.map((e) => [e.kind, e.label]))} />
            <span className="text-[10px] text-dim">swingLength</span>
            <NumberInput
              value={block.event.params.swingLength ?? 50}
              onChange={(v) => onUpdate({ ...block, event: { ...block.event, params: { ...block.event.params, swingLength: v } } })}
            />
          </>
        )}
      </div>
      <button type="button" onClick={onRemove} className="rounded p-0.5 text-dim hover:bg-panel hover:text-loss" aria-label="Remove">
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── SeriesPicker — pick indicator + tune params ──────────────────────────────
function SeriesPicker({ value, onChange }: { value: SeriesRef; onChange: (s: SeriesRef) => void }) {
  const meta = SERIES_BY_ID.get(value.id)!
  return (
    <div className="flex items-center gap-1">
      <select value={value.id}
        onChange={(e) => onChange(newSeriesRef(e.target.value as SeriesId))}
        className="rounded border border-border bg-panel px-1.5 py-0.5 text-[10px] text-text outline-none focus:border-brand/60">
        {SERIES_CATALOGUE.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {meta.paramFields.map((p) => (
        <NumberInput key={p.key}
          value={value.params[p.key] ?? p.default}
          onChange={(v) => onChange({ ...value, params: { ...value.params, [p.key]: v } })}
          min={p.min} max={p.max} title={p.label} small />
      ))}
    </div>
  )
}

// ── Tiny atoms ───────────────────────────────────────────────────────────────
function Select<T extends string>({ value, onChange, options, labels }: {
  value: T; onChange: (v: T) => void; options: T[]; labels?: Record<string, string>
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}
      className="rounded border border-border bg-panel px-1.5 py-0.5 text-[10px] font-mono text-text outline-none focus:border-brand/60">
      {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
    </select>
  )
}

// While focused, shows a raw string draft so you can clear/retype freely (no
// stuck leading zero, no NaN). Commits only valid numbers; reverts to the
// current value on blur if left blank.
function useNumDraft(value: number) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const display = focused ? draft : String(value)
  const onFocus = () => { setDraft(String(value)); setFocused(true) }
  const onBlur = () => setFocused(false)
  return { display, onFocus, onBlur, setDraft }
}

function NumberInput({ value, onChange, min, max, step, title, small }: {
  value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; title?: string; small?: boolean
}) {
  const d = useNumDraft(value)
  return (
    <input type="number" inputMode="decimal" value={d.display} title={title}
      min={min} max={max} step={step ?? 0.01}
      onFocus={d.onFocus} onBlur={d.onBlur}
      onChange={(e) => { d.setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n) }}
      className={`rounded border border-border bg-panel py-0.5 text-text outline-none focus:border-brand/60 font-mono ${small ? 'w-14 px-1 text-[10px]' : 'w-20 px-1.5 text-[10px]'}`} />
  )
}

function NumberField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number
}) {
  const d = useNumDraft(value)
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-dim uppercase">{label}</span>
      <input type="number" inputMode="decimal" value={d.display} min={min} max={max} step={step ?? 1}
        onFocus={d.onFocus} onBlur={d.onBlur}
        onChange={(e) => { d.setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n) }}
        className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs font-mono text-text outline-none focus:border-brand/60" />
    </label>
  )
}
