import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { apiFetch } from '@/contexts/AuthContext'
import { useHLAssets } from '@/lib/hlAssets'
import { fetchKlines } from '@/lib/binance'
import { generateSignals } from '@/lib/strategies'
import type { StrategyOutput } from '@/lib/strategies'
import type { Candle, StrategyId } from '@/types'
import LiveBotHeader from '@/components/LiveBotHeader'
import LiveStatusCard from '@/components/signalbot/LiveStatusCard'
import SignalFunnelCard from '@/components/signalbot/SignalFunnelCard'
import EnsembleVotesCard from '@/components/signalbot/EnsembleVotesCard'
import ChartHoverPanel, {
  findCandleIndexByTime,
  type ChartHoverState,
  type HoverTradeInfo,
} from '@/components/ui/ChartHoverPanel'
import { analyzeRegime } from '@/lib/markov'

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
  // MTF filter — block trades that conflict with the higher TF's last signal
  mtfEnabled?: boolean
  mtfTimeframe?: string
  // Ensemble mode — run multiple strategies and only trade when the
  // configured threshold of strategies agree on a direction.
  ensembleMode?: boolean
  ensembleStrategyIds?: string[]
  ensembleThreshold?: number
  // Daily-loss circuit-breaker — pause new entries once today's loss exceeds this %.
  dailyLossLimitPct?: number
}
interface BotSummary {
  id: string; name: string; running: boolean; strategyId: string
  symbol: string; timeframe: string
}
interface SignalBotStatus {
  id: string; name: string; running: boolean; startedAt: number | null
  config: SignalBotConfig; lastSignal: 'buy' | 'sell' | null
  lastSignalAt: number | null; lastEvaluatedAt: number | null
  lastClosedBarTime?: number | null
  computedSize?: number | null
  lastError: string | null; tradesExecuted: number
  // Last seen direction on the configured higher timeframe. The bot blocks
  // trades whose direction disagrees with this.
  mtfTrend?: 'buy' | 'sell' | null
  // Last ensemble vote breakdown (only present when ensembleMode = true and
  // at least one bar has been evaluated).
  lastVotes?: { buy: number; sell: number; abstain: number; threshold: number } | null
  // Daily loss circuit-breaker state. dailyPnlPct is the signed % move since
  // the UTC midnight equity snapshot; dailyPaused = true means new entries
  // are suspended until tomorrow UTC.
  dailyPnlPct?: number | null
  dailyPaused?: boolean
  // Signal funnel counters (since last start)
  signalsSeen?: number
  signalsExecuted?: number
  blockedByMtf?: number
  blockedByCooldown?: number
  blockedByDailyPause?: number
  blockedByEnsemble?: number
  lastTradeAt?: number
}
interface TradeRecord {
  time: number; side: 'buy' | 'sell'; asset: string; size: number; price: number | null
}
// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']
const POLL_MS = 5000
const t = (n: number) => n as UTCTimestamp

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

function SignalChart({ botId, cfg }: { botId: string | null; cfg: SignalBotConfig }) {
  const mainRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [loadingCandles, setLoadingCandles] = useState(false)
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [hover, setHover] = useState<ChartHoverState | null>(null)

  // Live Markov regime labels for the hover overlay. Cheap — same logic the
  // Backtester runs; just needs ≥30 candles to start labelling.
  const regimeLabels = useMemo(() => {
    if (candles.length < 30) return undefined
    return analyzeRegime(candles).labels
  }, [candles])

  // Fetch Binance candles whenever asset or timeframe changes
  useEffect(() => {
    let cancelled = false
    setLoadingCandles(true)
    setCandles([])
    fetchKlines({ symbol: cfg.symbol, interval: cfg.timeframe })
      .then(data => { if (!cancelled) { setCandles(data); setLoadingCandles(false) } })
      .catch(() => { if (!cancelled) { setCandles([]); setLoadingCandles(false) } })
    return () => { cancelled = true }
  }, [cfg.symbol, cfg.timeframe])

  // Fetch actual executed trades for saved bots
  useEffect(() => {
    if (!botId) { setTrades([]); return }
    let cancelled = false
    apiFetch(`/api/signal/bots/${botId}/trades`)
      .then(r => r.ok ? r.json() : [])
      .then((d: TradeRecord[]) => { if (!cancelled) setTrades(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [botId])

  // Run strategy client-side — same as Backtester, so signals match exactly
  const paramsKey = JSON.stringify(cfg.params)
  const strategyOutput = useMemo<StrategyOutput | null>(() => {
    if (candles.length < 35) return null
    try { return generateSignals(cfg.strategyId as StrategyId, candles, cfg.params) }
    catch { return null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, cfg.strategyId, paramsKey])

  // Build / tear down LW Charts whenever data changes
  useEffect(() => {
    const el = mainRef.current
    if (!el || !candles.length || !strategyOutput) return

    const sharedLayout = {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: '#8b93a7',
      fontFamily: "'Inter', system-ui, sans-serif",
    }
    const sharedGrid = {
      vertLines: { color: 'rgba(255,255,255,0.04)' },
      horzLines: { color: 'rgba(255,255,255,0.04)' },
    }

    const chart = createChart(el, {
      autoSize: true,
      layout: sharedLayout,
      grid: sharedGrid,
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3142' },
      rightPriceScale: { borderColor: '#2a3142' },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })
    candleSeries.setData(
      candles.map(c => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))
    )

    // Strategy indicator overlays
    for (const ln of strategyOutput.mainLines) {
      const s = chart.addSeries(LineSeries, {
        color: ln.color, lineWidth: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
      s.setData(ln.data.map(p => ({ time: t(p.time), value: p.value })))
    }

    // Horizontal price lines (Elliott Fibonacci retracements, etc.) — same
    // rendering as the Backtester's ChartPanel so live charts match what the
    // backtest shows.
    for (const pl of strategyOutput.priceLines ?? []) {
      candleSeries.createPriceLine({
        price: pl.price,
        color: pl.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: pl.label,
      })
    }

    // Strategy signals (teal/red arrows — identical to Backtester style)
    const allMarkers: SeriesMarker<Time>[] = []

    // Wave-number labels (Elliott ① ② ③ ④ ⑤) — folded into the same marker list.
    for (const wm of strategyOutput.waveMarkers ?? []) {
      allMarkers.push({
        time: t(wm.time) as Time,
        position: wm.position,
        color: '#a78bfa',
        shape: 'circle',
        text: wm.label,
        size: 0.5,
      })
    }

    strategyOutput.signals.forEach((sig, i) => {
      if (!sig) return
      allMarkers.push({
        time: t(candles[i].time) as Time,
        position: sig === 'buy' ? 'belowBar' : 'aboveBar',
        color: sig === 'buy' ? '#26a69a' : '#ef5350',
        shape: sig === 'buy' ? 'arrowUp' : 'arrowDown',
        text: sig === 'buy' ? 'B' : 'S',
        size: 1,
      })
    })

    // Actual executed trades (yellow/orange — distinguish from signals)
    trades.filter(tr => tr.price).forEach(tr => {
      allMarkers.push({
        time: t(Math.floor(tr.time / 1000)) as Time,
        position: tr.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: tr.side === 'buy' ? '#facc15' : '#f97316',
        shape: tr.side === 'buy' ? 'arrowUp' : 'arrowDown',
        text: tr.side === 'buy' ? '▲' : '▼',
        size: 2,
      })
    })

    // LW Charts requires markers sorted ascending by time
    allMarkers.sort((a, b) => Number(a.time) - Number(b.time))
    const markersPlugin = createSeriesMarkers(candleSeries, allMarkers)
    chart.timeScale().fitContent()

    // Crosshair → hovered bar — drives the overlay panel
    const crosshairHandler = (p: Parameters<Parameters<typeof chart.subscribeCrosshairMove>[0]>[0]) => {
      const tt = p.time
      if (typeof tt !== 'number') { setHover(null); return }
      const idx = findCandleIndexByTime(candles, tt)
      setHover({ time: candles[idx].time, barIdx: idx })
    }
    chart.subscribeCrosshairMove(crosshairHandler)

    // Sub-pane for oscillators (RSI, MACD, Stoch …)
    let subChart: IChartApi | null = null
    const sp = strategyOutput.subPane
    if (sp && subRef.current) {
      subChart = createChart(subRef.current, {
        autoSize: true,
        layout: sharedLayout,
        grid: sharedGrid,
        crosshair: { mode: 1 },
        timeScale: { visible: false, borderColor: '#2a3142' },
        rightPriceScale: { borderColor: '#2a3142' },
        handleScroll: false,
        handleScale: false,
      })
      const sc = subChart
      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) sc.timeScale().setVisibleLogicalRange(range)
      })
      for (const ln of sp.lines) {
        const s = sc.addSeries(LineSeries, {
          color: ln.color, lineWidth: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        s.setData(ln.data.map(p => ({ time: t(p.time), value: p.value })))
        if (sp.refLines && ln === sp.lines[0]) {
          for (const level of sp.refLines) {
            s.createPriceLine({
              price: level, color: '#5b6478', lineWidth: 1,
              lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '',
            })
          }
        }
      }
      sc.timeScale().fitContent()
    }

    return () => {
      chart.unsubscribeCrosshairMove(crosshairHandler)
      markersPlugin.detach()
      chart.remove()
      subChart?.remove()
    }
  }, [candles, strategyOutput, trades])

  // tradeAtBar resolver — actual executed trades have ms timestamps; convert + match against bar second.
  const resolveTradeAtBar = (c: Candle): HoverTradeInfo | null => {
    const tr = trades.find((t2) => Math.floor(t2.time / 1000) === c.time)
    if (!tr) return null
    return {
      label: tr.side === 'buy' ? 'BUY' : 'SELL',
      tone: tr.side === 'buy' ? 'gain' : 'loss',
    }
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold text-text">
          Chart
          <span className="ml-2 text-xs font-normal font-sans text-dim">
            {cfg.symbol.replace(/USDT$/, '/USDT')} · {cfg.timeframe}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {strategyOutput?.mainLines && strategyOutput.mainLines.length > 0 && (
            <span className="font-mono text-[10px] text-dim">
              {strategyOutput.mainLines.map(l => l.id).join(' · ')}
            </span>
          )}
          {loadingCandles && (
            <span className="text-[10px] text-dim animate-pulse">Loading…</span>
          )}
        </div>
      </div>
      {loadingCandles && !candles.length ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-dim">
          Loading chart…
        </div>
      ) : (
        <div className="relative">
          <div ref={mainRef} className="h-[300px] w-full" />
          <ChartHoverPanel
            hover={hover}
            candles={candles}
            regimeLabels={regimeLabels}
            tradeAtBar={resolveTradeAtBar}
          />
        </div>
      )}
      {strategyOutput?.subPane && (
        <>
          <div className="border-t border-border bg-panel px-3 py-1 font-mono text-[10px] text-dim">
            {strategyOutput.subPane.title}
          </div>
          <div ref={subRef} className="h-[108px] w-full" />
        </>
      )}
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
  const [riskUsd, setRiskUsd] = useState<number | ''>('')
  const [sizingSlPct, setSizingSlPct] = useState<number | ''>('')
  const [assetPrice, setAssetPrice] = useState<number | null>(null)
  const [maxLeverage, setMaxLeverage] = useState<number | null>(null)

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
            // Direct sizing (fixed / compounding mode)
            size?: number
            // Risk-based sizing fields (volatility mode — pre-fill sizing calculator)
            riskUsd?: number; sizingSlPct?: number
            // Bot risk controls
            slPct?: number; tpPct?: number
            // MTF filter
            mtfEnabled?: boolean; mtfTimeframe?: string
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
            size: pre.size ?? 0.01,
            slippagePct: 1,
            cooldownSec: 60,
            tradeSide: (pre.direction === 'short' ? 'sell' : pre.direction === 'both' ? 'both' : 'buy') as TradeSide,
            slPct: pre.slPct,
            tpPct: pre.tpPct,
            mtfEnabled: pre.mtfEnabled,
            mtfTimeframe: pre.mtfTimeframe,
          }
          setIsNew(true)
          setSelectedId(null)
          setCfg(newCfg)
          setDirty(true)
          // Pre-fill Risk Mode calculator when backtester used volatility sizing
          if (pre.riskUsd) setRiskUsd(pre.riskUsd)
          if (pre.sizingSlPct) setSizingSlPct(pre.sizingSlPct)
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

  // Fetch price + max leverage for the selected asset so the sizing card can render
  useEffect(() => {
    const asset = cfg?.asset
    if (!asset) return
    setAssetPrice(null); setMaxLeverage(null)
    apiFetch(`/api/asset-info?asset=${encodeURIComponent(asset)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { midPx?: number; maxLeverage?: number } | null) => {
        if (d?.midPx) setAssetPrice(d.midPx)
        if (d?.maxLeverage) setMaxLeverage(d.maxLeverage)
      })
      .catch(() => {})
  }, [cfg?.asset])

  // Position sizing: risk $ / SL% → position notional → qty
  const sizingResult = useMemo(() => {
    const risk = typeof riskUsd === 'number' && riskUsd > 0 ? riskUsd : null
    const sl = typeof sizingSlPct === 'number' && sizingSlPct > 0 ? sizingSlPct : null
    if (!risk || !sl) return null
    const positionUsd = risk / (sl / 100)
    const rawQty = assetPrice ? positionUsd / assetPrice : null
    return {
      positionUsd: `$${positionUsd.toLocaleString('en', { maximumFractionDigits: 0 })}`,
      qty: rawQty ? `${rawQty.toFixed(6)} ${cfg?.asset ?? ''}` : '— (loading price)',
      rawQty,
      maxLev: maxLeverage ? `${maxLeverage}×` : '—',
      margin: positionUsd && maxLeverage ? `$${(positionUsd / maxLeverage).toFixed(2)}` : '—',
      slPrices: assetPrice
        ? `$${(assetPrice * (1 - sl / 100)).toLocaleString('en', { maximumFractionDigits: 4 })}  /  $${(assetPrice * (1 + sl / 100)).toLocaleString('en', { maximumFractionDigits: 4 })}`
        : `−${sl}% / +${sl}% from entry`,
    }
  }, [riskUsd, sizingSlPct, cfg?.asset, assetPrice, maxLeverage])

  // Auto-apply computed qty to Order size whenever sizing result updates
  useEffect(() => {
    if (sizingResult?.rawQty && !running) {
      patch({ size: parseFloat(sizingResult.rawQty.toFixed(6)) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizingResult?.rawQty])


  // When switching to a bot, clear new-bot state
  const selectBot = (id: string) => {
    if (id === selectedId && !isNew) return  // already selected — don't null cfg and break the form
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

              {/* ── MTF filter — block trades whose direction conflicts with HTF ── */}
              <div className="my-1 h-px bg-border" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Higher-TF filter</p>
              <button
                type="button"
                disabled={running}
                onClick={() => patch({ mtfEnabled: !cfg.mtfEnabled })}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  cfg.mtfEnabled
                    ? 'border-brand/50 bg-brand/10 text-brand'
                    : 'border-border bg-panel-2 text-muted hover:text-text'
                } disabled:opacity-50`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      cfg.mtfEnabled ? 'bg-brand shadow-[0_0_6px_hsl(var(--brand))]' : 'bg-dim'
                    }`}
                  />
                  {cfg.mtfEnabled ? 'Filter ON' : 'Filter OFF'}
                </span>
                <span className="font-mono text-[10px] text-dim">{cfg.mtfTimeframe ?? '—'}</span>
              </button>
              {cfg.mtfEnabled && (
                <Field label="Higher timeframe">
                  <select
                    disabled={running}
                    value={cfg.mtfTimeframe ?? '4h'}
                    onChange={(e) => patch({ mtfTimeframe: e.target.value })}
                    className={inputCls}
                  >
                    {TIMEFRAMES
                      .filter((tf) => TIMEFRAMES.indexOf(tf) > TIMEFRAMES.indexOf(cfg.timeframe))
                      .map((tf) => (
                        <option key={tf} value={tf}>{tf}</option>
                      ))}
                  </select>
                </Field>
              )}
              <p className="text-[10px] text-dim leading-snug">
                {cfg.mtfEnabled
                  ? `Bot fetches ${cfg.mtfTimeframe} candles on every tick. Trades only fire when the latest ${cfg.mtfTimeframe} signal points the same direction as the ${cfg.timeframe} entry. Blocked trades are logged.`
                  : 'Off — every signal on the entry timeframe is taken without checking higher-TF agreement.'}
              </p>

              {/* ── Position Sizing Calculator ── */}
              <div className="my-1 h-px bg-border" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Risk mode (auto-sizes)</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Risk USD">
                  <input
                    type="number" step="any" min="0" placeholder="e.g. 50"
                    value={riskUsd}
                    onChange={(e) => setRiskUsd(e.target.value === '' ? '' : Number(e.target.value))}
                    className={inputCls}
                  />
                </Field>
                <Field label="SL %">
                  <input
                    type="number" step="0.1" min="0" placeholder="e.g. 2"
                    value={sizingSlPct}
                    onChange={(e) => setSizingSlPct(e.target.value === '' ? '' : Number(e.target.value))}
                    className={inputCls}
                  />
                </Field>
              </div>
              {sizingResult && (
                <div className="rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-[10px] space-y-1">
                  <div className="flex justify-between"><span className="text-dim">Notional</span><span className="font-mono text-text">{sizingResult.positionUsd}</span></div>
                  <div className="flex justify-between"><span className="text-dim">Order size</span><span className="font-mono text-text">{sizingResult.qty}</span></div>
                  <div className="flex justify-between"><span className="text-dim">Leverage</span><span className="font-mono text-text">{sizingResult.maxLev}</span></div>
                  <div className="flex justify-between"><span className="text-dim">Margin (USDC)</span><span className="font-mono text-text">{sizingResult.margin}</span></div>
                  <div className="flex justify-between"><span className="text-dim">SL/TP</span><span className="font-mono text-loss">{sizingResult.slPrices}</span></div>
                </div>
              )}
              <div className="my-1 h-px bg-border" />

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

        {/* Live status header — verdict-style pulse pill + chips + inline error */}
        {selectedId && !isNew && status && (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="flex-1 min-w-0">
              <LiveBotHeader
                name={bots.find(b => b.id === selectedId)?.name ?? 'Signal Bot'}
                state={status.lastError ? (running ? 'error' : 'error') : running ? 'running' : 'stopped'}
                summary={
                  `${status.config.asset} · ${status.config.timeframe} · ${status.config.strategyId.toUpperCase()}` +
                  (status.config.mtfEnabled && status.config.mtfTimeframe
                    ? ` · MTF ${status.config.mtfTimeframe}${
                        status.mtfTrend
                          ? ` ${status.mtfTrend === 'buy' ? '↑BUY' : '↓SELL'}`
                          : ' (no HTF signal yet)'
                      }`
                    : '')
                }
                startedAt={status.startedAt}
                lastSignal={status.lastSignal}
                lastSignalAt={status.lastSignalAt}
                lastError={status.lastError}
                tradesExecuted={status.tradesExecuted}
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

        {/* New-bot title (no status to show yet) */}
        {isNew && (
          <div className="card flex items-center gap-3 p-4">
            <Activity className="h-5 w-5 shrink-0 text-dim" />
            <div>
              <div className="font-semibold text-text">New Bot</div>
              <div className="mt-0.5 text-[11px] text-dim">Configure and save to enable Start.</div>
            </div>
          </div>
        )}

        {/* Notice */}
        {notice && (
          <div className={`card p-3 text-xs ${notice.ok ? 'border-gain/30 bg-gain/5 text-gain' : 'border-loss/30 bg-loss/5 text-loss'}`}>
            {notice.text}
          </div>
        )}

        {/* Chart — renders for both new and saved bots as soon as cfg is set */}
        {cfg && <SignalChart botId={selectedId && !isNew ? selectedId : null} cfg={cfg} />}

        {/* Operational analytics — only for an existing, saved bot with a status */}
        {selectedId && !isNew && status && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <LiveStatusCard status={status} lastPrice={null} />
              <SignalFunnelCard status={status} />
            </div>
            {status.config.ensembleMode && (
              <EnsembleVotesCard status={status} strategies={strategies} />
            )}
          </>
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
          </details>
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

