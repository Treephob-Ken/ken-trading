import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  Play,
  Plus,
  Save,
  Square,
  X,
} from 'lucide-react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { apiFetch } from '@/contexts/AuthContext'
import { useHLAssets } from '@/lib/hlAssets'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParamDef {
  key: string; label: string; min: number; max: number; step: number; default: number
}
interface StrategyMeta {
  id: string; name: string; category: string; description: string; params: ParamDef[]
}
type TradeSide = 'both' | 'buy' | 'sell'
interface SignalBotConfig {
  symbol: string; timeframe: string; strategyId: string
  params: Record<string, number>; asset: string; size: number
  slippagePct: number; cooldownSec: number; tradeSide: TradeSide
  tpPct?: number; slPct?: number
}
interface BotSummary {
  id: string; name: string; running: boolean; strategyId: string
  symbol: string; timeframe: string
}
interface SignalBotStatus {
  id: string; name: string; running: boolean; startedAt: number | null
  config: SignalBotConfig; lastSignal: 'buy' | 'sell' | null
  lastSignalAt: number | null; lastEvaluatedAt: number | null
  lastError: string | null; tradesExecuted: number
}
interface TradeRecord {
  time: number; side: 'buy' | 'sell'; asset: string; size: number; price: number | null
}
interface ChartCandle {
  time: number; open: number; high: number; low: number; close: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']
const POLL_MS = 5000
const t = (n: number) => n as UTCTimestamp

function fmtTime(ms: number | null) {
  return ms ? new Date(ms).toLocaleTimeString() : '—'
}

const inputCls = 'w-full rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">{label}</span>
      {children}
    </label>
  )
}

// ── Signal chart sub-component ────────────────────────────────────────────────

function SignalChart({ botId }: { botId: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)

  useEffect(() => {
    if (!botId) return
    const el = ref.current
    if (!el) return

    const chart = createChart(el, {
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
    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })

    const markers = createSeriesMarkers(candleSeries, [])
    markersRef.current = markers

    let cancelled = false
    Promise.all([
      apiFetch(`/api/signal/bots/${botId}/chart-data`).then(r => r.ok ? r.json() : null),
      apiFetch(`/api/signal/bots/${botId}/trades`).then(r => r.ok ? r.json() : []),
    ]).then(([cd, trades]: [{ candles: ChartCandle[] } | null, TradeRecord[]]) => {
      if (cancelled || !cd?.candles?.length) return
      candleSeries.setData(
        cd.candles.map(c => ({ time: t(c.time / 1000), open: c.open, high: c.high, low: c.low, close: c.close }))
      )
      const markerList: SeriesMarker<Time>[] = (trades ?? [])
        .filter(tr => tr.price)
        .map(tr => ({
          time: t(Math.floor(tr.time / 1000)) as Time,
          position: tr.side === 'buy' ? 'belowBar' : 'aboveBar',
          color: tr.side === 'buy' ? '#26a69a' : '#ef5350',
          shape: tr.side === 'buy' ? 'arrowUp' : 'arrowDown',
          text: tr.side === 'buy' ? 'B' : 'S',
          size: 1,
        }))
      markers.setMarkers(markerList)
      chart.timeScale().fitContent()
    }).catch(() => {})

    return () => {
      cancelled = true
      markers.detach()
      markersRef.current = null
      chart.remove()
      chartRef.current = null
    }
  }, [botId])

  if (!botId) return null

  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">Chart</h3>
      <div ref={ref} className="h-[300px] w-full" />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SignalBotsPage() {
  const { symbols } = useHLAssets()

  const [strategies, setStrategies] = useState<StrategyMeta[]>([])
  const [bots, setBots] = useState<BotSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [status, setStatus] = useState<SignalBotStatus | null>(null)
  const [cfg, setCfg] = useState<SignalBotConfig | null>(null)
  const [logs, setLogs] = useState<{ ts: string; level: string; msg: string }[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const running = status?.running ?? false
  const selectedMeta = strategies.find(s => s.id === cfg?.strategyId)

  // Default blank config for new bots
  function blankCfg(): SignalBotConfig {
    const firstStrat = strategies[0]
    const params: Record<string, number> = {}
    if (firstStrat) for (const d of firstStrat.params) params[d.key] = d.default
    return {
      symbol: 'ETHUSDT', timeframe: '1h',
      strategyId: firstStrat?.id ?? 'macd', params,
      asset: 'ETH', size: 0.01, slippagePct: 1, cooldownSec: 60,
      tradeSide: 'both',
    }
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const patch = (p: Partial<SignalBotConfig>) => {
    setCfg(c => c ? { ...c, ...p } : c)
    setDirty(true)
  }

  const onStrategyChange = (id: string) => {
    const meta = strategies.find(s => s.id === id)
    if (!meta) return
    const params: Record<string, number> = {}
    for (const d of meta.params) params[d.key] = d.default
    patch({ strategyId: id, params })
  }

  const saveConfig = async () => {
    if (!cfg) return
    setBusy(true); setNotice(null)
    try {
      let res: Response
      const botName = isNew
        ? `${cfg.asset.toUpperCase()}-${cfg.strategyId.toUpperCase()}-${cfg.timeframe.toUpperCase()}`
        : undefined
      if (selectedId && !isNew) {
        res = await apiFetch(`/api/signal/bots/${selectedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: cfg }),
        })
      } else {
        res = await apiFetch('/api/signal/bots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: botName, config: cfg }),
        })
      }
      const data = (await res.json()) as SignalBotStatus & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (isNew && data.id) {
        setIsNew(false)
        setSelectedId(data.id)
        setBots(prev => [...prev, {
          id: data.id, name: data.name, running: false,
          strategyId: cfg.strategyId, symbol: cfg.symbol, timeframe: cfg.timeframe,
        }])
      }
      setDirty(false)
      setNotice({ text: 'Configuration saved', ok: true })
    } catch (e) {
      setNotice({ text: `Save failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  const control = async (action: 'start' | 'stop') => {
    if (!selectedId) return
    setBusy(true); setNotice(null)
    try {
      const res = await apiFetch(`/api/signal/bots/${selectedId}/${action}`, { method: 'POST' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setNotice({ text: action === 'start' ? 'Bot started' : 'Bot stopped', ok: true })
    } catch (e) {
      setNotice({ text: `${action} failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  const deleteBot = async () => {
    if (!selectedId) return
    if (!confirm('Delete this bot?')) return
    setBusy(true)
    try {
      await apiFetch(`/api/signal/bots/${selectedId}`, { method: 'DELETE' })
      setBots(prev => prev.filter(b => b.id !== selectedId))
      setSelectedId(null); setStatus(null); setCfg(null)
    } catch (e) {
      setNotice({ text: `Delete failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    const id = selectedIdRef.current
    if (!id) return
    try {
      const [stRes, logRes] = await Promise.all([
        apiFetch(`/api/signal/bots/${id}`),
        apiFetch(`/api/signal/bots/${id}/logs`),
      ])
      if (stRes.ok) {
        const st: SignalBotStatus = await stRes.json()
        setStatus(st)
        setBots(prev => prev.map(b => b.id === id ? { ...b, running: st.running } : b))
        if (!dirtyRef.current || st.running) setCfg(st.config)
      }
      if (logRes.ok) setLogs(await logRes.json())
    } catch { /* silently skip — server may be restarting */ }
  }, [])

  // Load strategies + bot list on mount
  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/api/strategies').then(r => r.ok ? r.json() : []).catch(() => []),
      apiFetch('/api/signal/bots').then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([strats, botList]: [StrategyMeta[], BotSummary[]]) => {
      if (cancelled) return
      setStrategies(strats)
      setBots(botList)

      // Pre-fill from sessionStorage (set by Backtester "Deploy as Signal Bot")
      const pending = sessionStorage.getItem('pending_signal_bot_config')
      if (pending) {
        sessionStorage.removeItem('pending_signal_bot_config')
        try {
          const pre = JSON.parse(pending) as {
            asset?: string; strategy?: string; timeframe?: string
            params?: Record<string, number>; direction?: string
          }
          const stratId = pre.strategy ?? strats[0]?.id ?? 'macd'
          const stratMeta = strats.find(s => s.id === stratId)
          const params: Record<string, number> = {}
          if (stratMeta) for (const d of stratMeta.params) params[d.key] = d.default
          if (pre.params) Object.assign(params, pre.params)
          const newCfg: SignalBotConfig = {
            asset: pre.asset?.toUpperCase() ?? 'ETH',
            symbol: `${(pre.asset ?? 'ETH').toUpperCase()}USDT`,
            timeframe: pre.timeframe ?? '1h',
            strategyId: stratId,
            params,
            size: 0.01, slippagePct: 1, cooldownSec: 60,
            tradeSide: (pre.direction === 'short' ? 'sell' : pre.direction === 'both' ? 'both' : 'buy') as TradeSide,
          }
          setIsNew(true)
          setSelectedId(null)
          setCfg(newCfg)
          setDirty(true)
          return
        } catch { /* bad sessionStorage — ignore */ }
      }

      // Auto-select first bot
      if (botList.length > 0) setSelectedId(botList[0].id)
    })
    return () => { cancelled = true }
  }, [])

  // Poll selected bot
  useEffect(() => {
    if (!selectedId) return
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [selectedId, refresh])

  // When switching to a bot, clear new-bot state
  const selectBot = (id: string) => {
    setSelectedId(id)
    setIsNew(false)
    setDirty(false)
    setStatus(null)
    setCfg(null)
    setNotice(null)
  }

  const startNew = () => {
    setSelectedId(null)
    setIsNew(true)
    setStatus(null)
    setCfg(blankCfg())
    setDirty(false)
    setNotice(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* ── Left sidebar: bot list + config form ── */}
      <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-r border-border bg-panel/60">

        {/* Bot list header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text">Signal Bots</h2>
          <button
            type="button"
            onClick={startNew}
            className="flex items-center gap-1 rounded-lg bg-brand/10 border border-brand/20 px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand/15 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>

        {/* Bot list */}
        <div className="flex flex-col overflow-y-auto border-b border-border">
          {bots.length === 0 && !isNew && (
            <p className="px-4 py-3 text-xs text-dim">No bots yet. Click New to create one.</p>
          )}
          {bots.map(b => (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBot(b.id)}
              className={`flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                selectedId === b.id && !isNew ? 'bg-brand/10 text-text' : 'text-dim hover:text-text hover:bg-panel-2'
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${b.running ? 'bg-gain animate-pulse' : 'bg-border'}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">{b.name}</div>
                <div className="truncate text-[10px] text-dim">{b.symbol} · {b.timeframe}</div>
              </div>
            </button>
          ))}
          {isNew && (
            <div className="flex items-center gap-2.5 bg-brand/10 px-4 py-2.5 text-text">
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-brand">New Bot</div>
                <div className="truncate text-[10px] text-dim">unsaved</div>
              </div>
            </div>
          )}
        </div>

        {/* Config form */}
        {cfg && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-3">
              {running && (
                <p className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-1.5 text-[10px] text-warn">
                  Stop the bot to edit its configuration.
                </p>
              )}

              <Field label="Asset">
                <select
                  disabled={running}
                  value={cfg.symbol}
                  onChange={(e) => {
                    const sym = e.target.value
                    patch({ symbol: sym, asset: sym.replace(/USDT$/, '') })
                  }}
                  className={inputCls}
                >
                  {symbols.map(s => <option key={s.symbol} value={s.symbol}>{s.base}/USDT</option>)}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Strategy">
                  <select disabled={running} value={cfg.strategyId} onChange={(e) => onStrategyChange(e.target.value)} className={inputCls}>
                    {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Timeframe">
                  <select disabled={running} value={cfg.timeframe} onChange={(e) => patch({ timeframe: e.target.value })} className={inputCls}>
                    {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                  </select>
                </Field>
              </div>

              {selectedMeta?.description && (
                <p className="text-[10px] leading-relaxed text-dim">{selectedMeta.description}</p>
              )}

              {selectedMeta && selectedMeta.params.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {selectedMeta.params.map(d => (
                    <Field key={d.key} label={d.label}>
                      <input type="number" disabled={running} min={d.min} max={d.max} step={d.step}
                        value={cfg.params[d.key] ?? d.default}
                        onChange={(e) => patch({ params: { ...cfg.params, [d.key]: Number(e.target.value) } })}
                        className={inputCls} />
                    </Field>
                  ))}
                </div>
              )}

              <div className="my-1 h-px bg-border" />

              <div className="grid grid-cols-2 gap-2">
                <Field label="Order size">
                  <input type="number" disabled={running} step="any" min="0"
                    value={cfg.size} onChange={(e) => patch({ size: Number(e.target.value) })} className={inputCls} />
                </Field>
                <Field label="Slippage %">
                  <input type="number" disabled={running} step="0.1" min="0"
                    value={cfg.slippagePct} onChange={(e) => patch({ slippagePct: Number(e.target.value) })} className={inputCls} />
                </Field>
                <Field label="Cooldown (s)">
                  <input type="number" disabled={running} step="1" min="0"
                    value={cfg.cooldownSec} onChange={(e) => patch({ cooldownSec: Number(e.target.value) })} className={inputCls} />
                </Field>
                <Field label="Direction">
                  <select disabled={running} value={cfg.tradeSide} onChange={(e) => patch({ tradeSide: e.target.value as TradeSide })} className={inputCls}>
                    <option value="both">Both</option>
                    <option value="buy">Buy only</option>
                    <option value="sell">Sell only</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Auto TP %">
                  <input type="number" disabled={running} step="0.1" min="0" placeholder="off"
                    value={cfg.tpPct ?? ''}
                    onChange={(e) => patch({ tpPct: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className={inputCls} />
                </Field>
                <Field label="Auto SL %">
                  <input type="number" disabled={running} step="0.1" min="0" placeholder="off"
                    value={cfg.slPct ?? ''}
                    onChange={(e) => patch({ slPct: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className={inputCls} />
                </Field>
              </div>

              <button
                type="button"
                disabled={running || busy || (!dirty && !isNew)}
                onClick={saveConfig}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" />
                {isNew ? 'Create Bot' : dirty ? 'Save Config' : 'Saved'}
              </button>

              {selectedId && !isNew && !running && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={deleteBot}
                  className="flex items-center justify-center gap-1 rounded-xl border border-loss/30 px-3 py-1.5 text-[11px] text-loss/80 hover:bg-loss/5 transition-colors disabled:opacity-40"
                >
                  <X className="h-3 w-3" /> Delete Bot
                </button>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* ── Right main area ── */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">

        {/* Status / control banner */}
        {(selectedId || isNew) && (
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <Activity className={`h-5 w-5 shrink-0 ${running ? 'text-gain animate-pulse' : 'text-dim'}`} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text">
                    {isNew ? 'New Bot' : (bots.find(b => b.id === selectedId)?.name ?? 'Signal Bot')}
                  </span>
                  {status && (
                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      running ? 'border-gain/40 bg-gain/10 text-gain'
                        : 'border-border bg-panel-2 text-dim'
                    }`}>
                      {running ? 'Running' : 'Idle'}
                    </span>
                  )}
                </div>
                {status && (
                  <div className="mt-0.5 text-[11px] text-dim">
                    Last signal: {status.lastSignal
                      ? <span className={status.lastSignal === 'buy' ? 'text-gain' : 'text-loss'}>
                          {status.lastSignal.toUpperCase()} @ {fmtTime(status.lastSignalAt)}
                        </span>
                      : 'none yet'
                    }
                    {' · '}Trades: {status.tradesExecuted}
                  </div>
                )}
              </div>
            </div>

            {/* Start / Stop */}
            {selectedId && !isNew && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={running || busy || dirty}
                  onClick={() => control('start')}
                  title={dirty ? 'Save config first' : undefined}
                  className="flex items-center gap-1.5 rounded-xl bg-gain px-4 py-2 text-xs font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Play className="h-3.5 w-3.5" /> Start
                </button>
                <button
                  type="button"
                  disabled={!running || busy}
                  onClick={() => control('stop')}
                  className="flex items-center gap-1.5 rounded-xl bg-loss px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
              </div>
            )}
          </div>
        )}

        {/* Notice */}
        {notice && (
          <div className={`card p-3 text-xs ${notice.ok ? 'border-gain/30 bg-gain/5 text-gain' : 'border-loss/30 bg-loss/5 text-loss'}`}>
            {notice.text}
          </div>
        )}

        {/* Last error */}
        {status?.lastError && (
          <div className="card border-loss/30 bg-loss/5 p-3 text-xs text-loss">
            Last error: {status.lastError}
          </div>
        )}

        {/* Chart */}
        <SignalChart botId={selectedId && !isNew ? selectedId : null} />

        {/* Manual trade card */}
        {selectedId && !isNew && (
          <ManualTradeCard botId={selectedId} busy={busy} onBusy={setBusy} onNotice={setNotice} />
        )}

        {/* Activity log */}
        {logs.length > 0 && (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-text">Activity Log</h3>
            <div className="h-52 overflow-y-auto rounded-xl border border-border bg-bg p-3 font-mono text-[10px] leading-relaxed">
              {[...logs].reverse().slice(0, 100).map((l, i) => (
                <div key={i} className="mb-1 last:mb-0 break-words">
                  <span className="text-dim">[{l.ts.slice(11)}]</span>{' '}
                  <span className={
                    l.level === 'ok' || l.level === 'fill' ? 'text-gain'
                      : l.level === 'err' ? 'text-loss'
                        : l.level === 'warn' ? 'text-warn'
                          : 'text-text'
                  }>{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!selectedId && !isNew && bots.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16">
            <div className="rounded-2xl border border-border bg-panel p-8 text-center max-w-sm">
              <Activity className="mx-auto mb-3 h-8 w-8 text-dim" />
              <h3 className="mb-2 font-semibold text-text">No signal bots yet</h3>
              <p className="mb-5 text-sm text-dim">
                Create a bot to run a strategy live on Hyperliquid. Or backtest a strategy
                first and deploy it directly.
              </p>
              <button
                type="button"
                onClick={startNew}
                className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white mx-auto hover:opacity-90 transition-opacity"
              >
                <Plus className="h-4 w-4" /> New Signal Bot
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Manual trade card ─────────────────────────────────────────────────────────

function ManualTradeCard({
  botId, busy, onBusy, onNotice,
}: {
  botId: string
  busy: boolean
  onBusy: (v: boolean) => void
  onNotice: (n: { text: string; ok: boolean }) => void
}) {
  const [size, setSize] = useState<number | ''>('')
  const [tpPct, setTpPct] = useState<number | ''>('')
  const [slPct, setSlPct] = useState<number | ''>('')
  const [asset, setAsset] = useState<string | null>(null)

  useEffect(() => {
    apiFetch(`/api/signal/bots/${botId}`)
      .then(r => r.ok ? r.json() : null)
      .then((st: SignalBotStatus | null) => { if (st) setAsset(st.config.asset) })
      .catch(() => {})
  }, [botId])

  const trade = async (side: 'buy' | 'sell') => {
    if (!asset) return
    onBusy(true)
    const body: Record<string, unknown> = {
      asset, side,
      size: typeof size === 'number' && size > 0 ? size : 0.01,
      orderType: 'market', maxSlippagePct: 1,
    }
    if (typeof tpPct === 'number' && tpPct > 0) body.tpPct = tpPct
    if (typeof slPct === 'number' && slPct > 0) body.slPct = slPct
    try {
      const res = await apiFetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { message?: string; filled?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      onNotice({ text: data.message || 'Order sent', ok: Boolean(data.filled) })
    } catch (e) {
      onNotice({ text: `Trade failed: ${(e as Error).message}`, ok: false })
    } finally { onBusy(false) }
  }

  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">Manual Trade</h3>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Field label="Size">
          <input type="number" step="any" min="0" placeholder="0.01"
            value={size} onChange={(e) => setSize(e.target.value === '' ? '' : Number(e.target.value))}
            className={inputCls} />
        </Field>
        <Field label="TP %">
          <input type="number" step="0.1" min="0" placeholder="off"
            value={tpPct} onChange={(e) => setTpPct(e.target.value === '' ? '' : Number(e.target.value))}
            className={inputCls} />
        </Field>
        <Field label="SL %">
          <input type="number" step="0.1" min="0" placeholder="off"
            value={slPct} onChange={(e) => setSlPct(e.target.value === '' ? '' : Number(e.target.value))}
            className={inputCls} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || !asset} onClick={() => trade('buy')}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-gain px-3 py-2 text-xs font-bold text-black hover:opacity-90 disabled:opacity-40 transition-opacity">
          <ArrowUpCircle className="h-4 w-4" /> Buy {asset ?? ''}
        </button>
        <button type="button" disabled={busy || !asset} onClick={() => trade('sell')}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-loss px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40 transition-opacity">
          <ArrowDownCircle className="h-4 w-4" /> Sell {asset ?? ''}
        </button>
      </div>
    </div>
  )
}
