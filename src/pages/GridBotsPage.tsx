import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Activity,
  Play,
  Plus,
  Save,
  Square,
  X,
} from 'lucide-react'
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { apiFetch } from '@/contexts/AuthContext'
import { useHLAssets } from '@/lib/hlAssets'
import { fetchKlines } from '@/lib/binance'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GridBotSummary {
  id: string; name: string; asset: string; gridCount: number; lower: number; upper: number; running: boolean
}

interface GridConfig {
  id?: string; name?: string; asset: string; lower: number; upper: number; gridCount: number
  mode: 'arithmetic' | 'geometric'; timeframe: string
  investment?: number; leverage?: number; orderSize?: number
  stopLossPrice?: number; takeProfitPrice?: number; triggerPrice?: number
}

interface GridStats {
  currentPrice: number; realizedPnl: number; roundtrips: number; unrealizedPnl: number
  netPosition: number; totalPnl: number; aprPct: number; openOrders: number; fills: number
  feesPaid: number; orderSize: number; effectiveBudget: number; state: string | null
  stopReason?: string; startedAt: number; lines?: number[]
  stopLossPrice?: number; takeProfitPrice?: number; slDistancePct?: number; tpDistancePct?: number
  slArmedOnExchange?: boolean; tpArmedOnExchange?: boolean
  liquidationPrice?: number; liquidationDistancePct?: number; leverage: number
  slUnreachable?: boolean
}

interface LogLine { ts: string; level: string; msg: string; botId?: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']
const MODES = [{ value: 'arithmetic', label: 'Arithmetic' }, { value: 'geometric', label: 'Geometric' }]
const POLL_MS = 5000
const t = (n: number) => n as UTCTimestamp

function fmtUsd(v: number) {
  return (v >= 0 ? '+' : '') + v.toFixed(2)
}
function fmtPct(v: number) {
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
}
function fmtRuntime(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function buildGridLines(lower: number, upper: number, count: number, mode: string): number[] {
  const lines: number[] = []
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const price = mode === 'geometric'
      ? lower * Math.pow(upper / lower, t)
      : lower + (upper - lower) * t
    lines.push(price)
  }
  return lines
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

function StatRow({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-dim">{label}</span>
      <div className="text-right">
        <span className={`font-mono text-sm font-semibold tabular-nums ${cls ?? 'text-text'}`}>{value}</span>
        {sub && <span className="ml-1 text-[10px] text-dim">{sub}</span>}
      </div>
    </div>
  )
}

// ── Grid chart sub-component ──────────────────────────────────────────────────

function GridBotChart({
  asset, timeframe, lower, upper, gridCount, mode,
  stopLossPrice, takeProfitPrice, statsLines,
}: {
  asset: string; timeframe: string; lower: number; upper: number; gridCount: number; mode: string
  stopLossPrice?: number; takeProfitPrice?: number; statsLines?: number[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const key = `${asset}:${timeframe}:${lower}:${upper}:${gridCount}:${mode}`

  useEffect(() => {
    if (!asset || !lower || !upper || !gridCount) return
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

    let cancelled = false
    fetchKlines({ symbol: `${asset.toUpperCase()}USDT`, interval: timeframe })
      .then((candles) => {
        if (cancelled || !candles.length) return
        candleSeries.setData(
          candles.map(c => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))
        )

        // Draw grid lines (from stats if running, else from config)
        const linePrices = statsLines?.length ? statsLines : buildGridLines(lower, upper, gridCount, mode)
        const currentPrice = candles[candles.length - 1].close
        const dense = linePrices.length > 16

        for (const price of linePrices) {
          const isMid = Math.abs(price - currentPrice) < (upper - lower) * 0.02
          candleSeries.createPriceLine({
            price,
            color: isMid ? '#ffd23f' : price < currentPrice ? '#26a69a' : '#ef5350',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: !dense,
            title: '',
          })
        }

        // SL/TP lines
        if (stopLossPrice) {
          candleSeries.createPriceLine({
            price: stopLossPrice, color: '#ef5350', lineWidth: 2,
            lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'SL',
          })
        }
        if (takeProfitPrice) {
          candleSeries.createPriceLine({
            price: takeProfitPrice, color: '#26a69a', lineWidth: 2,
            lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'TP',
          })
        }

        chart.timeScale().fitContent()
      })
      .catch(() => {})

    return () => {
      cancelled = true
      chart.remove()
      chartRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stopLossPrice, takeProfitPrice])

  return <div ref={ref} className="h-[300px] w-full" />
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GridBotsPage() {
  const { symbols } = useHLAssets()
  const [searchParams] = useSearchParams()

  const [bots, setBots] = useState<GridBotSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [cfg, setCfg] = useState<Partial<GridConfig> | null>(null)
  const [stats, setStats] = useState<GridStats | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [assetInfo, setAssetInfo] = useState<{ maxLeverage?: number; midPx?: number } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)

  // Risk-mode sizing inputs (UI-only, not in config directly)
  const [riskUsd, setRiskUsd] = useState<number | ''>('')
  const [slPct, setSlPct] = useState<number | ''>('')

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const running = bots.find(b => b.id === selectedId)?.running ?? false

  // ── Asset info fetch ─────────────────────────────────────────────────────────

  const fetchAssetInfo = useCallback(async (asset: string) => {
    if (!asset) return
    try {
      const r = await apiFetch(`/api/asset-info?asset=${encodeURIComponent(asset.toUpperCase())}`)
      if (r.ok) setAssetInfo(await r.json())
    } catch { /* ignore */ }
  }, [])

  // ── Config helpers ───────────────────────────────────────────────────────────

  const patch = (p: Partial<GridConfig>) => {
    setCfg(c => c ? { ...c, ...p } : c)
    setDirty(true)
  }

  const autoName = (asset: string, count: number) =>
    count > 0 ? `${asset.toUpperCase()}-GRID-${count}` : `${asset.toUpperCase()}-GRID`

  function blankCfg(): Partial<GridConfig> {
    return {
      asset: '', lower: undefined, upper: undefined, gridCount: 8,
      mode: 'arithmetic', timeframe: '1h',
    }
  }

  // Compute sizing from risk inputs
  const computeSizing = () => {
    if (typeof riskUsd !== 'number' || typeof slPct !== 'number') return null
    if (riskUsd <= 0 || slPct <= 0) return null
    const positionUsd = riskUsd / (slPct / 100)
    const maxLev = assetInfo?.maxLeverage ?? 1
    const margin = positionUsd / maxLev
    const midPx = assetInfo?.midPx ?? 0
    const upper = cfg?.upper ?? 0
    const count = cfg?.gridCount ?? 0
    const orderSize = (upper > 0 && count > 0)
      ? (margin * maxLev * 0.5) / (count * upper)
      : null
    const slPrice = midPx ? +(midPx * (1 - slPct / 100)).toFixed(4) : null
    const tpPrice = midPx ? +(midPx * (1 + slPct / 100)).toFixed(4) : null
    return { margin, maxLev, positionUsd, orderSize, slPrice, tpPrice }
  }

  const sizing = computeSizing()

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveConfig = async () => {
    if (!cfg) return
    if (!cfg.asset || !cfg.lower || !cfg.upper || !cfg.gridCount) {
      setNotice({ text: 'Fill in asset, lower, upper, grid count', ok: false }); return
    }

    // Apply risk-mode sizing if active
    let finalCfg = { ...cfg }
    if (sizing) {
      finalCfg = {
        ...finalCfg,
        investment: +sizing.margin.toFixed(6),
        leverage: sizing.maxLev,
        stopLossPrice: sizing.slPrice ?? undefined,
        takeProfitPrice: sizing.tpPrice ?? undefined,
      }
    }

    if (!finalCfg.investment && !finalCfg.orderSize) {
      setNotice({ text: 'Provide either Budget or Order Size', ok: false }); return
    }

    // Auto-name if blank (asset + gridCount are validated above)
    if (!finalCfg.name) {
      finalCfg.name = autoName(finalCfg.asset!, finalCfg.gridCount!)
    }

    setBusy(true); setNotice(null)
    try {
      const url = (selectedId && !isNew) ? `/api/bots/${selectedId}/config` : '/api/bots'
      const method = (selectedId && !isNew) ? 'PUT' : 'POST'
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalCfg),
      })
      const data = (await res.json()) as GridConfig & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

      const newId = data.id ?? selectedId!
      // Refresh bot list
      const listRes = await apiFetch('/api/bots')
      if (listRes.ok) setBots(await listRes.json())
      setSelectedId(newId)
      setIsNew(false)
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
      const res = await apiFetch(`/api/bots/${selectedId}/${action}`, { method: 'POST' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setBots(prev => prev.map(b => b.id === selectedId ? { ...b, running: action === 'start' } : b))
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
      const res = await apiFetch(`/api/bots/${selectedId}`, { method: 'DELETE' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setBots(prev => prev.filter(b => b.id !== selectedId))
      setSelectedId(null); setCfg(null); setStats(null)
    } catch (e) {
      setNotice({ text: `Delete failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  // ── Data fetching ────────────────────────────────────────────────────────────

  const loadBot = useCallback(async (id: string) => {
    try {
      const [cfgRes, logRes] = await Promise.all([
        apiFetch(`/api/bots/${id}/config`),
        apiFetch(`/api/bots/${id}/logs`),
      ])
      if (cfgRes.ok) {
        const c: GridConfig = await cfgRes.json()
        setCfg(c)
        setDirty(false)
        fetchAssetInfo(c.asset)
      }
      if (logRes.ok) setLogs(await logRes.json())
    } catch { /* server may be restarting */ }
  }, [fetchAssetInfo])

  const refresh = useCallback(async () => {
    const id = selectedIdRef.current
    if (!id) return
    try {
      const r = await apiFetch(`/api/bots/${id}/stats`)
      if (r.ok) {
        const d: { running: boolean; stats?: GridStats } = await r.json()
        if (d.running && d.stats) {
          setStats(d.stats)
          setBots(prev => prev.map(b => b.id === id ? { ...b, running: true } : b))
        } else {
          setStats(null)
          setBots(prev => prev.map(b => b.id === id ? { ...b, running: false } : b))
        }
      }
    } catch { /* ignore */ }
  }, [])

  // Load bot list on mount; honour ?select=<id> deep-link from Grid Optimizer
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/bots')
      .then(r => r.ok ? r.json() : [])
      .then((list: GridBotSummary[]) => {
        if (cancelled) return
        setBots(list)
        const selectParam = searchParams.get('select')
        const target = selectParam && list.find(b => b.id === selectParam)
          ? selectParam
          : list.length > 0 ? list[0].id : null
        if (target) setSelectedId(target)
      })
      .catch(() => {})
    return () => { cancelled = true }
  // searchParams is stable after first render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load config + logs when selection changes
  useEffect(() => {
    if (!selectedId || isNew) return
    setStats(null); setLogs([]); setNotice(null)
    loadBot(selectedId)
  }, [selectedId, isNew, loadBot])

  // Poll stats every 5s
  useEffect(() => {
    if (!selectedId || isNew) return
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [selectedId, isNew, refresh])

  // ── Selection helpers ────────────────────────────────────────────────────────

  const selectBot = (id: string) => {
    setSelectedId(id); setIsNew(false); setDirty(false)
    setCfg(null); setStats(null); setLogs([]); setNotice(null)
    setRiskUsd(''); setSlPct('')
  }

  const startNew = () => {
    setSelectedId(null); setIsNew(true)
    setCfg(blankCfg()); setStats(null); setLogs([])
    setDirty(false); setNotice(null)
    setRiskUsd(''); setSlPct('')
    setAssetInfo(null)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* ── Left sidebar: bot list + config form ── */}
      <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-hidden border-r border-border bg-panel/60">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text">Grid Bots</h2>
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
                <div className="truncate text-xs font-semibold">{b.name || b.asset}</div>
                <div className="truncate text-[10px] text-dim">
                  {b.asset} · {b.gridCount} grids · {(+b.lower).toFixed(2)}–{(+b.upper).toFixed(2)}
                </div>
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
        {cfg !== null && (
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
                  value={cfg.asset ?? ''}
                  onChange={(e) => {
                    const asset = e.target.value
                    const count = cfg.gridCount ?? 8
                    patch({ asset, name: autoName(asset, count) })
                    fetchAssetInfo(asset)
                  }}
                  className={inputCls}
                >
                  <option value="">— select —</option>
                  {symbols.map(s => <option key={s.symbol} value={s.base}>{s.base}/USDT</option>)}
                </select>
              </Field>

              {assetInfo?.midPx && (
                <p className="text-[10px] text-dim">
                  Current: <span className="text-text font-mono">${assetInfo.midPx.toFixed(4)}</span>
                  {assetInfo.maxLeverage && <span className="ml-2">Max lev: {assetInfo.maxLeverage}x</span>}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Field label="Lower price">
                  <input type="number" disabled={running} step="any" min="0"
                    value={cfg.lower ?? ''}
                    onChange={e => patch({ lower: e.target.value === '' ? undefined : +e.target.value })}
                    className={inputCls} />
                </Field>
                <Field label="Upper price">
                  <input type="number" disabled={running} step="any" min="0"
                    value={cfg.upper ?? ''}
                    onChange={e => patch({ upper: e.target.value === '' ? undefined : +e.target.value })}
                    className={inputCls} />
                </Field>
                <Field label="Grid count">
                  <input type="number" disabled={running} step="1" min="2" max="100"
                    value={cfg.gridCount ?? ''}
                    onChange={e => {
                      const count = e.target.value === '' ? undefined : +e.target.value
                      patch({ gridCount: count, name: cfg.asset && count ? autoName(cfg.asset, count) : cfg.name })
                    }}
                    className={inputCls} />
                </Field>
                <Field label="Mode">
                  <select disabled={running} value={cfg.mode ?? 'arithmetic'}
                    onChange={e => patch({ mode: e.target.value as GridConfig['mode'] })}
                    className={inputCls}>
                    {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Timeframe (chart)">
                <select disabled={running} value={cfg.timeframe ?? '1h'}
                  onChange={e => patch({ timeframe: e.target.value })}
                  className={inputCls}>
                  {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                </select>
              </Field>

              <div className="my-1 h-px bg-border" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Sizing</p>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Budget (USDC)">
                  <input type="number" disabled={running} step="any" min="0"
                    value={cfg.investment ?? ''}
                    onChange={e => patch({ investment: e.target.value === '' ? undefined : +e.target.value })}
                    className={inputCls} />
                </Field>
                <Field label="Leverage">
                  <input type="number" disabled={running} step="1" min="1"
                    value={cfg.leverage ?? ''}
                    onChange={e => patch({ leverage: e.target.value === '' ? undefined : +e.target.value })}
                    className={inputCls} />
                </Field>
              </div>

              <Field label="Or: order size (contracts)">
                <input type="number" disabled={running} step="any" min="0"
                  value={cfg.orderSize ?? ''}
                  onChange={e => patch({ orderSize: e.target.value === '' ? undefined : +e.target.value })}
                  className={inputCls} />
              </Field>

              <div className="my-1 h-px bg-border" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Risk mode (auto-sizes)</p>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Risk USD">
                  <input type="number" disabled={running} step="any" min="0" placeholder="e.g. 50"
                    value={riskUsd}
                    onChange={e => setRiskUsd(e.target.value === '' ? '' : +e.target.value)}
                    className={inputCls} />
                </Field>
                <Field label="SL %">
                  <input type="number" disabled={running} step="0.1" min="0" placeholder="e.g. 5"
                    value={slPct}
                    onChange={e => setSlPct(e.target.value === '' ? '' : +e.target.value)}
                    className={inputCls} />
                </Field>
              </div>

              {sizing && (
                <div className="rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-[10px] space-y-1">
                  <div className="flex justify-between"><span className="text-dim">Notional</span><span className="font-mono text-text">${sizing.positionUsd.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-dim">Margin (USDC)</span><span className="font-mono text-text">${sizing.margin.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-dim">Leverage</span><span className="font-mono text-text">{sizing.maxLev}x</span></div>
                  {sizing.orderSize && <div className="flex justify-between"><span className="text-dim">Order size</span><span className="font-mono text-text">{sizing.orderSize.toFixed(5)} {cfg.asset}</span></div>}
                  {sizing.slPrice && <div className="flex justify-between"><span className="text-dim">SL/TP</span><span className="font-mono text-text">${sizing.slPrice} / ${sizing.tpPrice}</span></div>}
                </div>
              )}

              <div className="my-1 h-px bg-border" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Safety (optional)</p>

              <div className="grid grid-cols-2 gap-2">
                <Field label="SL price">
                  <input type="number" disabled={running} step="any" min="0" placeholder="off"
                    value={cfg.stopLossPrice ?? ''}
                    onChange={e => patch({ stopLossPrice: e.target.value === '' ? undefined : +e.target.value })}
                    className={inputCls} />
                </Field>
                <Field label="TP price">
                  <input type="number" disabled={running} step="any" min="0" placeholder="off"
                    value={cfg.takeProfitPrice ?? ''}
                    onChange={e => patch({ takeProfitPrice: e.target.value === '' ? undefined : +e.target.value })}
                    className={inputCls} />
                </Field>
                <Field label="Trigger price">
                  <input type="number" disabled={running} step="any" min="0" placeholder="off"
                    value={cfg.triggerPrice ?? ''}
                    onChange={e => patch({ triggerPrice: e.target.value === '' ? undefined : +e.target.value })}
                    className={inputCls} />
                </Field>
              </div>

              <Field label="Bot name">
                <input type="text" disabled={running}
                  value={cfg.name ?? ''}
                  onChange={e => patch({ name: e.target.value })}
                  className={inputCls} />
              </Field>

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
                    {isNew ? 'New Bot' : (bots.find(b => b.id === selectedId)?.name ?? 'Grid Bot')}
                  </span>
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    running ? 'border-gain/40 bg-gain/10 text-gain'
                      : stats?.state === 'stopped' ? 'border-loss/40 bg-loss/10 text-loss'
                        : 'border-border bg-panel-2 text-dim'
                  }`}>
                    {stats?.state === 'live' ? 'Running'
                      : stats?.state === 'init' ? 'Initializing'
                        : stats?.state === 'waiting-trigger' ? 'Waiting'
                          : running ? 'Starting' : 'Idle'}
                  </span>
                </div>
                {cfg && (
                  <div className="mt-0.5 text-[11px] text-dim">
                    {cfg.asset} · {cfg.gridCount} grids · {cfg.lower}–{cfg.upper} · {cfg.mode}
                  </div>
                )}
              </div>
            </div>

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

        {/* Chart */}
        {cfg && cfg.asset && cfg.lower && cfg.upper && cfg.gridCount && (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-text">
              {cfg.asset}/USDT · {cfg.timeframe}
              <span className="ml-2 text-xs text-dim font-normal">
                {cfg.lower}–{cfg.upper} · {cfg.gridCount} grids
              </span>
            </h3>
            <GridBotChart
              asset={cfg.asset}
              timeframe={cfg.timeframe ?? '1h'}
              lower={cfg.lower}
              upper={cfg.upper}
              gridCount={cfg.gridCount}
              mode={cfg.mode ?? 'arithmetic'}
              stopLossPrice={cfg.stopLossPrice}
              takeProfitPrice={cfg.takeProfitPrice}
              statsLines={stats?.lines}
            />
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-text">
              Live Stats
              {stats.startedAt > 0 && (
                <span className="ml-2 text-xs text-dim font-normal">
                  runtime {fmtRuntime(Date.now() - stats.startedAt)}
                </span>
              )}
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-panel-2 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">P&amp;L</p>
                <StatRow label="Realized" value={fmtUsd(stats.realizedPnl)}
                  sub={`${stats.roundtrips} roundtrips`}
                  cls={stats.realizedPnl >= 0 ? 'text-gain' : 'text-loss'} />
                <StatRow label="Unrealized" value={fmtUsd(stats.unrealizedPnl)}
                  sub={`pos ${stats.netPosition.toFixed(4)}`}
                  cls={stats.unrealizedPnl >= 0 ? 'text-gain' : 'text-loss'} />
                <StatRow label="Total" value={fmtUsd(stats.totalPnl)}
                  sub={`APR ${fmtPct(stats.aprPct)}`}
                  cls={stats.totalPnl >= 0 ? 'text-gain' : 'text-loss'} />
                <StatRow label="Fees paid" value={fmtUsd(stats.feesPaid)} cls="text-warn" />
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-panel-2 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Orders</p>
                <StatRow label="Open orders" value={String(stats.openOrders)} />
                <StatRow label="Fills" value={`${stats.fills} fills`} />
                <StatRow label="Order size" value={stats.orderSize.toFixed(4)}
                  sub={`${cfg?.asset ?? ''}`} />
                <StatRow label="Budget" value={`$${stats.effectiveBudget.toFixed(2)}`} />
              </div>
            </div>
          </div>
        )}

        {/* Safety panel */}
        {stats && (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-text">Safety</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* SL */}
              <div className="rounded-xl border border-border bg-panel-2 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-dim">Stop Loss</p>
                <p className="font-mono text-sm font-semibold text-text">
                  {stats.stopLossPrice != null ? `$${stats.stopLossPrice.toFixed(4)}` : '—'}
                </p>
                <p className="text-[10px] text-dim">
                  {stats.stopLossPrice != null && stats.slDistancePct != null
                    ? `${stats.slDistancePct > 0 ? '−' : '+'}${Math.abs(stats.slDistancePct).toFixed(2)}% from price`
                    : 'not configured'}
                </p>
                {stats.stopLossPrice != null && (
                  <span className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    stats.slArmedOnExchange ? 'bg-gain/10 text-gain' : 'bg-warn/10 text-warn'
                  }`}>
                    {stats.slArmedOnExchange ? 'on exchange' : 'bot-only'}
                  </span>
                )}
              </div>
              {/* TP */}
              <div className="rounded-xl border border-border bg-panel-2 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-dim">Take Profit</p>
                <p className="font-mono text-sm font-semibold text-text">
                  {stats.takeProfitPrice != null ? `$${stats.takeProfitPrice.toFixed(4)}` : '—'}
                </p>
                <p className="text-[10px] text-dim">
                  {stats.takeProfitPrice != null && stats.tpDistancePct != null
                    ? `${stats.tpDistancePct >= 0 ? '+' : '−'}${Math.abs(stats.tpDistancePct).toFixed(2)}% from price`
                    : 'not configured'}
                </p>
                {stats.takeProfitPrice != null && (
                  <span className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    stats.tpArmedOnExchange ? 'bg-gain/10 text-gain' : 'bg-warn/10 text-warn'
                  }`}>
                    {stats.tpArmedOnExchange ? 'on exchange' : 'bot-only'}
                  </span>
                )}
              </div>
              {/* Liquidation */}
              <div className="rounded-xl border border-border bg-panel-2 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-dim">Liquidation</p>
                <p className={`font-mono text-sm font-semibold ${
                  stats.liquidationDistancePct != null && stats.liquidationDistancePct < 5 ? 'text-loss' : 'text-warn'
                }`}>
                  {stats.liquidationPrice != null ? `$${stats.liquidationPrice.toFixed(4)}` : '—'}
                </p>
                <p className="text-[10px] text-dim">
                  {stats.liquidationDistancePct != null
                    ? `${stats.liquidationDistancePct.toFixed(2)}% away · ${stats.leverage}x`
                    : stats.netPosition === 0 ? 'flat — no risk' : `${stats.leverage}x leverage`}
                </p>
              </div>
            </div>
            {stats.slUnreachable && (
              <p className="mt-2 text-[10px] text-loss">⚠ SL past liquidation price</p>
            )}
            {stats.stopReason && (
              <p className="mt-1 text-[10px] text-warn">Stop reason: {stats.stopReason}</p>
            )}
          </div>
        )}

        {/* Activity log */}
        {logs.length > 0 && (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-text">Activity Log</h3>
            <div className="h-52 overflow-y-auto rounded-xl border border-border bg-bg p-3 font-mono text-[10px] leading-relaxed">
              {[...logs].reverse().slice(0, 200).map((l, i) => (
                <div key={i} className="mb-1 last:mb-0 break-words">
                  <span className="text-dim">[{l.ts.slice(11, 19)}]</span>{' '}
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
              <h3 className="mb-2 font-semibold text-text">No grid bots yet</h3>
              <p className="mb-5 text-sm text-dim">
                Create a bot to run a grid strategy live on Hyperliquid.
                Or use the Grid Optimizer to design your range and deploy directly.
              </p>
              <button
                type="button"
                onClick={startNew}
                className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white mx-auto hover:opacity-90 transition-opacity"
              >
                <Plus className="h-4 w-4" /> New Grid Bot
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
