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
import LiveBotHeader from '@/components/LiveBotHeader'
import StrandedBanner, { type StrandedPosition } from '@/components/StrandedBanner'
import MultiBotConflictBanner from '@/components/MultiBotConflictBanner'
import GridActivityCard from '@/components/gridbot/GridActivityCard'
import PositionSizeCard from '@/components/PositionSizeCard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GridBotSummary {
  id: string; name: string; asset: string; gridCount: number; lower: number; upper: number; running: boolean
  pausedForNetworkSwitch?: boolean
}

interface GridConfig {
  id?: string; name?: string; asset: string; lower: number; upper: number; gridCount: number
  mode: 'arithmetic' | 'geometric'; timeframe: string
  investment?: number; leverage?: number; orderSize?: number
  stopLossPrice?: number; takeProfitPrice?: number; triggerPrice?: number
}

interface GridStats {
  asset: string
  currentPrice: number; realizedPnl: number; roundtrips: number; unrealizedPnl: number
  netPosition: number; totalPnl: number; aprPct: number; openOrders: number; fills: number
  feesPaid: number; orderSize: number; effectiveBudget: number; state: string | null
  stopReason?: string; startedAt: number; lines?: number[]
  stopLossPrice?: number; takeProfitPrice?: number; slDistancePct?: number; tpDistancePct?: number
  slArmedOnExchange?: boolean; tpArmedOnExchange?: boolean
  liquidationPrice?: number; liquidationDistancePct?: number; leverage: number
  slUnreachable?: boolean
  // Activity diagnostics (added with GridActivityCard)
  lastFillAt?: number | null
  lastRoundtripAt?: number | null
  fillsPerHour?: number
  roundtripsPerHour?: number
  gridPositionPct?: number | null
  nearestLineIdx?: number | null
  distanceToNearestLinePct?: number | null
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
    // HIP-3 dex perps (e.g. "xyz:CRCL") have no Binance pair — pass the coin
    // name through unchanged so fetchKlines routes it to HL's candle endpoint.
    const chartSymbol = asset.includes(':') ? asset : `${asset.toUpperCase()}USDT`
    fetchKlines({ symbol: chartSymbol, interval: timeframe })
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

  // Position-source map for stranded-bot detection.
  interface SourceEntry {
    kind: 'signal' | 'grid'
    botId: string
    botName: string
    running: boolean
    strategyId?: string
    gridCount?: number
    stranded?: boolean
    position?: StrandedPosition
  }
  const [sources, setSources] = useState<Record<string, SourceEntry[]>>({})

  const refreshSources = useCallback(() => {
    apiFetch('/api/positions/sources')
      .then((r) => r.ok ? r.json() : {})
      .then((d: Record<string, SourceEntry[]>) => setSources(d))
      .catch(() => { /* tolerate */ })
  }, [])
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

  // Compute sizing from risk inputs.
  // SL/TP are anchored to the grid lower/upper bounds (NOT midPx) so the stop
  // sits OUTSIDE the grid range — only fires if the range completely breaks.
  // Anchoring to midPx would put SL inside the range and trigger on normal
  // grid drawdown. Matches the Deploy-from-Grid-Optimizer behaviour.
  const computeSizing = () => {
    if (typeof riskUsd !== 'number' || typeof slPct !== 'number') return null
    if (riskUsd <= 0 || slPct <= 0) return null
    const positionUsd = riskUsd / (slPct / 100)
    const maxLev = assetInfo?.maxLeverage ?? 1
    const margin = positionUsd / maxLev
    const lower = cfg?.lower ?? 0
    const upper = cfg?.upper ?? 0
    const count = cfg?.gridCount ?? 0
    const orderSize = (upper > 0 && count > 0)
      ? (margin * maxLev * 0.5) / (count * upper)
      : null
    const slPrice = lower > 0 ? +(lower * (1 - slPct / 100)).toFixed(6) : null
    const tpPrice = upper > 0 ? +(upper * (1 + slPct / 100)).toFixed(6) : null
    return { margin, maxLev, positionUsd, orderSize, slPrice, tpPrice }
  }

  const sizing = computeSizing()

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveConfig = async () => {
    if (!cfg) return
    if (!cfg.asset || !cfg.lower || !cfg.upper || !cfg.gridCount) {
      setNotice({ text: 'Fill in asset, lower, upper, grid count', ok: false }); return
    }

    // The Risk Calculator no longer auto-applies — it shows a suggestion the
    // user has to confirm via the "Apply to Budget + SL/TP" button. This means
    // the config the user sees in the form is exactly what gets saved.
    const finalCfg = { ...cfg }

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
      } else {
        // Surface the error so the user isn't staring at an empty right pane
        // wondering why nothing loaded. Common causes: stale bot id (404),
        // expired session (401), or a backend hiccup (5xx).
        const text = await cfgRes.text().catch(() => '')
        setNotice({
          text: `Couldn't load bot config (${cfgRes.status}): ${text || 'no response body'}. Click the bot again to retry.`,
          ok: false,
        })
      }
      if (logRes.ok) setLogs(await logRes.json())
    } catch (e) {
      setNotice({
        text: `Couldn't reach the bot server: ${(e as Error).message}. Click the bot again to retry.`,
        ok: false,
      })
    }
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

  // Poll the sources map so stranded banners react to external changes.
  useEffect(() => {
    refreshSources()
    const id = setInterval(refreshSources, POLL_MS)
    return () => clearInterval(id)
  }, [refreshSources])

  // ── Selection helpers ────────────────────────────────────────────────────────

  const selectBot = (id: string) => {
    const sameBot = id === selectedId
    setSelectedId(id); setIsNew(false); setDirty(false)
    setCfg(null); setStats(null); setLogs([]); setNotice(null)
    setRiskUsd(''); setSlPct('')
    // Re-clicking the same bot doesn't change selectedId, so the load
    // useEffect won't re-fire. Call loadBot directly so a "retry by
    // re-clicking" actually retries.
    if (sameBot) void loadBot(id)
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden md:flex-row">

      {/* ── Left sidebar: bot list + config form ──
          On mobile (<md) it stacks above the detail pane at full width, capped
          at 50vh so the detail pane stays reachable. On md+ it reverts to the
          desktop 300px fixed-width column. */}
      <aside className="flex w-full shrink-0 flex-col overflow-hidden border-b border-border bg-panel/60 max-h-[50vh] md:h-full md:w-[300px] md:max-h-none md:border-b-0 md:border-r">

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
          {bots.map(b => {
            const stranded = (sources[(b.asset || '').toUpperCase()] ?? []).some(
              (s) => s.botId === b.id && s.kind === 'grid' && s.stranded,
            )
            const paused = b.pausedForNetworkSwitch === true
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBot(b.id)}
                className={`flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                  selectedId === b.id && !isNew ? 'bg-brand/10 text-text' : 'text-dim hover:text-text hover:bg-panel-2'
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${
                  b.running ? 'bg-gain animate-pulse' : paused ? 'bg-warn' : 'bg-border'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold">{b.name || b.asset}</span>
                    {paused && (
                      <span
                        title="Auto-stopped when you switched to mainnet — will resume if you switch back to testnet."
                        className="shrink-0 rounded-sm border border-warn/40 bg-warn/10 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-warn"
                      >
                        ⏸ Paused
                      </span>
                    )}
                    {stranded && !paused && (
                      <span
                        title="Bot stopped but a position is still open on this asset"
                        className="shrink-0 rounded-sm border border-warn/40 bg-warn/10 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-warn"
                      >
                        Stranded
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-dim">
                    {b.asset} · {b.gridCount} grids · {(+b.lower).toFixed(2)}–{(+b.upper).toFixed(2)}
                  </div>
                </div>
              </button>
            )
          })}
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
              {/* Stranded position banner */}
              {selectedId && !isNew && cfg.asset && (() => {
                const arr = sources[cfg.asset.toUpperCase()] ?? []
                const mine = arr.find((s) => s.botId === selectedId && s.kind === 'grid')
                if (!mine?.stranded || !mine.position) return null
                return (
                  <StrandedBanner
                    asset={cfg.asset.toUpperCase()}
                    botName={bots.find((b) => b.id === selectedId)?.name ?? cfg.asset}
                    botKind="grid"
                    position={mine.position}
                    resumeEndpoint={`/api/bots/${selectedId}/start`}
                    onAfterAction={() => {
                      refresh()
                      refreshSources()
                    }}
                  />
                )
              })()}

              {/* Multi-bot conflict */}
              {selectedId && !isNew && cfg.asset && (() => {
                const arr = sources[cfg.asset.toUpperCase()] ?? []
                if (arr.length < 2) return null
                return (
                  <MultiBotConflictBanner
                    asset={cfg.asset.toUpperCase()}
                    sources={arr}
                    hideBotId={selectedId}
                  />
                )
              })()}

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
                  {symbols.map(s => <option key={s.symbol} value={s.base}>{s.base}/USDC</option>)}
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
              <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Sizing — Budget mode <span className="text-[9px] font-normal text-brand">(recommended for grids)</span></p>
              <p className="text-[10px] text-dim leading-snug">
                Type how much capital to commit. The bot divides it across all grid cells.
              </p>

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
              <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Risk Calculator <span className="text-[9px] font-normal text-dim">(optional)</span></p>
              <p className="text-[10px] text-dim leading-snug">
                Helper — suggests a Budget given "how much I'm willing to lose if SL hits". Caveat: grid bots scale into a position, so actual loss can exceed Risk USD if the grid filled deeply. Use as a guide, not a guarantee.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Risk USD">
                  <input type="number" disabled={running} step="any" min="0" placeholder="e.g. 50"
                    value={riskUsd}
                    onChange={e => setRiskUsd(e.target.value === '' ? '' : +e.target.value)}
                    className={inputCls} />
                </Field>
                <Field label="SL % below lower">
                  <input type="number" disabled={running} step="0.1" min="0" placeholder="e.g. 5"
                    value={slPct}
                    onChange={e => setSlPct(e.target.value === '' ? '' : +e.target.value)}
                    className={inputCls} />
                </Field>
              </div>

              {sizing && (
                <div className="rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-[10px] space-y-1">
                  <div className="flex justify-between"><span className="text-dim">Notional</span><span className="font-mono text-text">${sizing.positionUsd.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-dim">Suggested Budget</span><span className="font-mono text-brand font-semibold">${sizing.margin.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-dim">Leverage</span><span className="font-mono text-text">{sizing.maxLev}x</span></div>
                  {sizing.orderSize && <div className="flex justify-between"><span className="text-dim">Order size</span><span className="font-mono text-text">{sizing.orderSize.toFixed(5)} {cfg.asset}</span></div>}
                  {sizing.slPrice
                    ? (
                      <div className="flex justify-between"><span className="text-dim">SL / TP price</span><span className="font-mono text-text">${sizing.slPrice} / ${sizing.tpPrice}</span></div>
                    )
                    : (
                      <p className="text-[10px] text-warn">Set Range Low/High above to compute SL/TP anchored to the grid bounds.</p>
                    )
                  }
                  {sizing.slPrice && (
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => {
                        patch({
                          investment: +sizing.margin.toFixed(6),
                          leverage: sizing.maxLev,
                          stopLossPrice: sizing.slPrice ?? undefined,
                          takeProfitPrice: sizing.tpPrice ?? undefined,
                        })
                      }}
                      className="mt-1 w-full rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[10px] font-semibold text-brand transition-colors hover:bg-brand/20 disabled:opacity-40"
                    >
                      Apply to Budget + SL/TP
                    </button>
                  )}
                </div>
              )}

              <div className="my-1 h-px bg-border" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Safety (manual prices)</p>
              <p className="text-[10px] text-dim leading-snug">
                Best practice: set SL <strong>below</strong> the grid lower bound (and TP <strong>above</strong> upper) so the grid runs normally inside its range and the stop only fires if the range completely breaks down.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <Field label="SL price">
                  <input type="number" disabled={running} step="any" min="0"
                    placeholder={cfg.lower ? (cfg.lower * 0.95).toFixed(4) : 'off'}
                    value={cfg.stopLossPrice ?? ''}
                    onChange={e => patch({ stopLossPrice: e.target.value === '' ? undefined : +e.target.value })}
                    className={inputCls} />
                </Field>
                <Field label="TP price">
                  <input type="number" disabled={running} step="any" min="0"
                    placeholder={cfg.upper ? (cfg.upper * 1.05).toFixed(4) : 'off'}
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

              {/* Quick-fill suggestion when grid bounds are set and SL is empty */}
              {cfg.lower && cfg.upper && (!cfg.stopLossPrice || !cfg.takeProfitPrice) && (
                <button
                  type="button"
                  disabled={running}
                  onClick={() => {
                    patch({
                      stopLossPrice: cfg.stopLossPrice ?? +(cfg.lower! * 0.95).toFixed(6),
                      takeProfitPrice: cfg.takeProfitPrice ?? +(cfg.upper! * 1.05).toFixed(6),
                    })
                  }}
                  className="rounded-md border border-border bg-panel-2 px-2 py-1 text-[10px] text-dim transition-colors hover:text-text disabled:opacity-40"
                >
                  Suggest SL = ${(cfg.lower * 0.95).toFixed(4)} (5% below lower) · TP = ${(cfg.upper * 1.05).toFixed(4)} (5% above upper)
                </button>
              )}

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
                className="flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
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

        {/* ── Position Size card (consistent across pages) ── */}
        {cfg && (() => {
          const inv = typeof cfg.investment === 'number' ? cfg.investment : 0
          const lev = typeof cfg.leverage === 'number' && cfg.leverage > 0 ? cfg.leverage : 1
          const notional = inv > 0 ? inv * lev : null
          return (
            <PositionSizeCard
              notional={notional}
              leverage={lev}
              leverageLabel="Leverage"
              slPct={null}
              footnote={inv > 0 ? `Budget $${inv.toFixed(2)} × ${lev}× leverage${assetInfo?.maxLeverage ? ` · HL max ${assetInfo.maxLeverage}×` : ''}` : 'set Budget + Leverage above'}
            />
          )
        })()}
      </aside>

      {/* ── Right main area ── */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">

        {/* Live status header */}
        {selectedId && !isNew && (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="flex-1 min-w-0">
              <LiveBotHeader
                name={bots.find(b => b.id === selectedId)?.name ?? 'Grid Bot'}
                state={
                  stats?.state === 'stopped'
                    ? 'stopped'
                    : running || stats?.state === 'live' || stats?.state === 'init' || stats?.state === 'waiting-trigger'
                    ? 'running'
                    : 'stopped'
                }
                summary={cfg ? `${cfg.asset} · ${cfg.gridCount} grids · ${cfg.lower}–${cfg.upper} · ${cfg.mode}` : undefined}
                startedAt={stats?.startedAt && stats.startedAt > 0 ? stats.startedAt : null}
                tradesExecuted={stats?.roundtrips}
              />
            </div>
            <div className="flex items-stretch gap-2">
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
          </div>
        )}

        {/* New-bot title */}
        {isNew && (
          <div className="card flex items-center gap-3 p-4">
            <Activity className="h-5 w-5 shrink-0 text-dim" />
            <div>
              <div className="font-semibold text-text">New Grid Bot</div>
              <div className="mt-0.5 text-[11px] text-dim">Fill in asset, range, and grid count, then save to enable Start.</div>
            </div>
          </div>
        )}

        {/* Notice */}
        {notice && (
          <div className={`card flex flex-wrap items-center justify-between gap-3 p-3 text-xs ${notice.ok ? 'border-gain/30 bg-gain/5 text-gain' : 'border-loss/30 bg-loss/5 text-loss'}`}>
            <span>{notice.text}</span>
            {!notice.ok && selectedId && !isNew && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setNotice(null); void loadBot(selectedId) }}
                  className="rounded-md border border-loss/40 bg-loss/10 px-2.5 py-1 text-[11px] font-semibold text-loss hover:bg-loss/20"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    // Escape hatch for stranded bots — config file corrupted
                    // beyond what loadConfigUnsafe can salvage, server bug, etc.
                    // Confirms first because this is destructive.
                    if (!confirm(`Delete this bot config permanently? This cannot be undone.`)) return
                    try {
                      const res = await apiFetch(`/api/bots/${selectedId}`, { method: 'DELETE' })
                      if (!res.ok) {
                        const text = await res.text().catch(() => '')
                        setNotice({ text: `Delete failed (${res.status}): ${text || 'no response body'}`, ok: false })
                        return
                      }
                      // Refresh the list and clear selection so the user lands on a clean state.
                      setSelectedId(null); setCfg(null); setStats(null); setLogs([])
                      setNotice({ text: 'Bot deleted.', ok: true })
                      const listRes = await apiFetch('/api/bots')
                      if (listRes.ok) setBots(await listRes.json())
                    } catch (e) {
                      setNotice({ text: `Delete failed: ${(e as Error).message}`, ok: false })
                    }
                  }}
                  className="rounded-md border border-loss/60 bg-loss/20 px-2.5 py-1 text-[11px] font-semibold text-loss hover:bg-loss/30"
                  title="Permanently delete this bot's saved config"
                >
                  Delete bot
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading placeholder — selected a bot but config isn't loaded yet.
            Without this, the right pane was completely empty during the fetch
            (or forever, if the fetch silently failed). Retry button covers the
            "request hung" case where no error fired but nothing arrived. */}
        {selectedId && !isNew && !cfg && !notice && (
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 shrink-0 animate-pulse text-dim" />
              <div className="text-sm text-dim">Loading bot config…</div>
            </div>
            <button
              type="button"
              onClick={() => void loadBot(selectedId)}
              className="rounded-md border border-border bg-panel-2 px-2.5 py-1 text-[11px] font-semibold text-text hover:border-brand/40"
              title="Re-fetch this bot's config and logs"
            >
              Retry
            </button>
          </div>
        )}

        {/* Config missing required range fields — explain instead of hiding silently. */}
        {cfg && (!cfg.asset || !cfg.lower || !cfg.upper || !cfg.gridCount) && (
          <div className="card flex items-center gap-3 p-4">
            <Activity className="h-5 w-5 shrink-0 text-warn" />
            <div className="text-sm text-text">
              This bot's config is missing one of: asset, lower bound, upper bound, or grid count.
              Fill in the form on the left and save to enable the chart.
            </div>
          </div>
        )}

        {/* Chart */}
        {cfg && cfg.asset && cfg.lower && cfg.upper && cfg.gridCount && (
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-text">
              {cfg.asset}/USDC · {cfg.timeframe}
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

        {/* Activity diagnostics — answers "is this grid working hard enough?" */}
        {stats && cfg?.asset && (
          <GridActivityCard stats={{
            asset: cfg.asset,
            startedAt: stats.startedAt,
            state: stats.state ?? 'init',
            currentPrice: stats.currentPrice,
            fills: stats.fills,
            roundtrips: stats.roundtrips,
            lines: stats.lines ?? [],
            lastFillAt: stats.lastFillAt,
            lastRoundtripAt: stats.lastRoundtripAt,
            fillsPerHour: stats.fillsPerHour,
            roundtripsPerHour: stats.roundtripsPerHour,
            gridPositionPct: stats.gridPositionPct,
            nearestLineIdx: stats.nearestLineIdx,
            distanceToNearestLinePct: stats.distanceToNearestLinePct,
          }} />
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

        {/* Activity log — collapsed by default. Useful for debugging but not at-a-glance. */}
        {logs.length > 0 && (
          <details className="card p-4 group">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-text">
              <span className="flex items-center gap-2">
                <span className="text-dim transition-transform group-open:rotate-90">▶</span>
                Activity log
              </span>
              <span className="font-mono text-[11px] font-normal text-dim tabular-nums">{logs.length} lines</span>
            </summary>
            <div className="mt-3 h-52 overflow-y-auto rounded-xl border border-border bg-bg p-3 font-mono text-[10px] leading-relaxed">
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
          </details>
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
                className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-bg mx-auto hover:opacity-90 transition-opacity"
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
