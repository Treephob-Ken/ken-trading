import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ChevronsRight,
  Eye,
  EyeOff,
  Play,
  Plus,
  Rocket,
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
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
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
import StrandedBanner, { type StrandedPosition } from '@/components/StrandedBanner'
import MultiBotConflictBanner from '@/components/MultiBotConflictBanner'
import LiveStatusCard from '@/components/signalbot/LiveStatusCard'
import LivePositionCard from '@/components/signalbot/LivePositionCard'
import TradeSetupCard from '@/components/signalbot/TradeSetupCard'
import SignalFunnelCard from '@/components/signalbot/SignalFunnelCard'
import ForecastVsActualCard from '@/components/signalbot/ForecastVsActualCard'
import EnsembleVotesCard from '@/components/signalbot/EnsembleVotesCard'
import PositionSizeCard from '@/components/PositionSizeCard'
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
  // Set when strategyId === 'custom' — points at a Strategy Builder spec.
  customStrategyId?: string
  params: Record<string, number>; asset: string; size: number
  slippagePct: number; cooldownSec: number; tradeSide: TradeSide
  tpPct?: number; slPct?: number
  // Risk mode — when set, bot recomputes size from live price on each trade:
  // positionUsd = riskUsd / (slPct/100); size = positionUsd / currentPrice.
  riskUsd?: number
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
  // Slippage gate — abort if HL mid differs from Binance signal close by more than this %.
  maxDivergencePct?: number
  // Catch-up on start — if the most-recent closed bar already fired a signal
  // AND the live price is still favorable, enter immediately on bot start
  // instead of waiting for the next bar.
  catchUpOnStart?: boolean
  // Suggested-TP mode — when true, bot uses MFE-median as TP instead of tpPct
  useSuggestedTp?: boolean
  // Backtest reference captured at deploy time (UI-only — never traded on).
  // Powers the "Backtest vs Live" forward-test card.
  backtestSnapshot?: BacktestSnapshot
}
interface BacktestSnapshot {
  winRate: number
  profitFactor: number
  expectancy: number
  maxDrawdownPct: number
  totalReturnPct: number
  numTrades: number
  feePct: number
  capturedAt: number
}
interface BotSummary {
  id: string; name: string; running: boolean; strategyId: string
  symbol: string; timeframe: string
  pausedForNetworkSwitch?: boolean
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
  blockedBySlippage?: number
  lastTradeAt?: number
  // Auto-pause reason if the bot stopped itself after 3+ failed orders
  // (e.g. insufficient margin). Null when healthy.
  autoPausedReason?: string | null
  // MFE-based TP suggestion (populated when useSuggestedTp is on or after
  // a manual refresh). null = never computed for this bot.
  tpSuggestion?: TpSuggestion | null
}

interface TpSuggestionStats {
  count: number; avg: number; median: number; p25: number; p75: number
  suggestion: number | null
}
interface TpSuggestion {
  buy: TpSuggestionStats | null
  sell: TpSuggestionStats | null
  symbol: string; timeframe: string; strategyId: string
  lookbackBars: number; computedAt: number
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

// Number input that lets you clear/retype freely. While focused it shows a raw
// string draft (so "", "3.", "0.5" are all editable and the leading zero isn't
// glued on); on blur it reconciles to the committed value. Empty → undefined.
function NumInput({ value, onChange, disabled, placeholder, min, step }: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  disabled?: boolean; placeholder?: string; min?: string; step?: string
}) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const display = focused ? draft : (value === undefined || Number.isNaN(value) ? '' : String(value))
  return (
    <input type="number" inputMode="decimal" disabled={disabled} placeholder={placeholder} min={min} step={step ?? 'any'}
      className={inputCls}
      value={display}
      onFocus={() => { setDraft(value === undefined || Number.isNaN(value) ? '' : String(value)); setFocused(true) }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setDraft(e.target.value)
        const t = e.target.value.trim()
        if (t === '') { onChange(undefined); return }
        const n = Number(t)
        if (Number.isFinite(n)) onChange(n)
      }} />
  )
}

// Position-size input shown in $ but stored as a coin quantity. Uses a focused
// draft so editing isn't round-tripped through the live price (which was
// re-formatting every keystroke and gluing a "0" you couldn't delete).
function UsdSizeInput({ qty, price, disabled, onQty }: {
  qty: number; price: number | null; disabled?: boolean; onQty: (q: number) => void
}) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const usd = price && price > 0 ? qty * price : qty
  const display = focused ? draft : (usd > 0 ? (price ? usd.toFixed(2) : String(qty)) : '')
  return (
    <input type="number" inputMode="decimal" disabled={disabled} step="any" min="0"
      className={inputCls}
      value={display}
      onFocus={() => { setDraft(usd > 0 ? String(Math.round(usd * 100) / 100) : ''); setFocused(true) }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setDraft(e.target.value)
        const t = e.target.value.trim()
        if (t === '') { onQty(0); return }
        const v = Number(t)
        if (!Number.isFinite(v)) return
        const q = price && price > 0 ? v / price : v
        onQty(parseFloat(q.toFixed(6)))
      }} />
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

  // Chart + marker plugin refs so the visibility toggles and "Latest Price"
  // button can operate without rebuilding the chart.
  const chartRef = useRef<IChartApi | null>(null)
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const indicatorLinesRef = useRef<ISeriesApi<'Line'>[]>([])
  // Horizontal Fibonacci price lines from the strategy (Elliott W2/W3/W4/W5,
  // ABC retracements). Kept so the indicator toggle can hide/show them.
  const fibLinesRef = useRef<IPriceLine[]>([])
  const waveMarkersRef = useRef<SeriesMarker<Time>[]>([])
  const signalMarkersRef = useRef<SeriesMarker<Time>[]>([])
  const tradeMarkersRef = useRef<SeriesMarker<Time>[]>([])

  // Live-chart defaults: show trade markers, hide indicator lines for clean candles.
  const [showSignals, setShowSignals] = useState(true)
  const [showIndicator, setShowIndicator] = useState(false)

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

    // Strategy indicator overlays — captured in a ref so we can toggle them.
    indicatorLinesRef.current = []
    for (const ln of strategyOutput.mainLines) {
      const s = chart.addSeries(LineSeries, {
        color: ln.color, lineWidth: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        visible: showIndicator,
      })
      s.setData(ln.data.map(p => ({ time: t(p.time), value: p.value })))
      indicatorLinesRef.current.push(s)
    }

    // SMC structure lines: one short horizontal segment per BOS/CHoCH (pivot →
    // break). Kept in indicatorLinesRef so the Hide-Indicator toggle hides them.
    for (const sl of strategyOutput.structureLines ?? []) {
      const s = chart.addSeries(LineSeries, {
        color: sl.color, lineWidth: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        visible: showIndicator,
      })
      s.setData([
        { time: t(sl.fromTime), value: sl.level },
        { time: t(sl.toTime), value: sl.level },
      ])
      indicatorLinesRef.current.push(s)
    }

    // Horizontal price lines (Elliott Fibonacci retracements, etc.) — same
    // rendering as the Backtester's ChartPanel so live charts match what the
    // backtest shows. Captured so the Hide Indicator toggle can hide them too.
    fibLinesRef.current = []
    for (const pl of strategyOutput.priceLines ?? []) {
      const handle = candleSeries.createPriceLine({
        price: pl.price,
        color: pl.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: showIndicator,
        lineVisible: showIndicator,
        title: pl.label,
      })
      fibLinesRef.current.push(handle)
    }

    // Wave-number annotations (Elliott ① ② ③ ④ ⑤) — pinned to the chart, not
    // part of the buy/sell toggle.
    waveMarkersRef.current = (strategyOutput.waveMarkers ?? []).map(wm => ({
      time: t(wm.time) as Time,
      position: wm.position,
      color: '#a78bfa',
      shape: 'circle',
      text: wm.label,
      size: 0.5,
    }))

    // We intentionally do NOT render hindsight strategy B/S markers — only the
    // bot's actual fills, walked chronologically and paired into open/close
    // events with realized PnL. Style mirrors the Trade Log detail chart.
    //
    // Partial fills: a single market order on HL often returns as 3-5 fills
    // back-to-back. Without aggregation each one becomes its own marker and
    // the chart turns into a wall of stacked text. So we first roll same-side
    // fills within a 60-second window into one logical event before walking
    // the pair state.
    signalMarkersRef.current = []
    tradeMarkersRef.current = []
    const FILL_GROUP_MS = 60_000
    const rawSorted = [...trades]
      .filter(tr => tr.price != null && tr.price > 0)
      .sort((a, b) => a.time - b.time)
    type AggFill = { time: number; side: 'buy' | 'sell'; size: number; price: number }
    const sortedTrades: AggFill[] = []
    for (const tr of rawSorted) {
      const last = sortedTrades[sortedTrades.length - 1]
      const px = tr.price as number
      if (last && last.side === tr.side && tr.time - last.time < FILL_GROUP_MS) {
        // Merge into the prior logical fill — size-weighted price average.
        const totalSize = last.size + tr.size
        last.price = (last.price * last.size + px * tr.size) / totalSize
        last.size = totalSize
        last.time = tr.time   // anchor to the most recent partial
      } else {
        sortedTrades.push({ time: tr.time, side: tr.side, size: tr.size, price: px })
      }
    }

    let posSize = 0           // signed: + long, − short
    let entryPx = 0           // size-weighted average entry price
    let entrySide: 'long' | 'short' | null = null
    for (const tr of sortedTrades) {
      const px = tr.price
      const time = t(Math.floor(tr.time / 1000)) as Time
      const signed = tr.side === 'buy' ? tr.size : -tr.size

      // OPEN — flat → directional
      if (posSize === 0) {
        posSize = signed
        entryPx = px
        entrySide = signed > 0 ? 'long' : 'short'
        tradeMarkersRef.current.push({
          time,
          position: signed > 0 ? 'belowBar' : 'aboveBar',
          color: signed > 0 ? '#26a69a' : '#ef5350',
          shape: signed > 0 ? 'arrowUp' : 'arrowDown',
          text: signed > 0 ? 'BUY' : 'SELL',
          size: 1,
        })
        continue
      }

      const sameSide = (posSize > 0 && signed > 0) || (posSize < 0 && signed < 0)
      if (sameSide) {
        // Position scaling — average price, no marker (avoids "Add long" clutter).
        const newSize = posSize + signed
        entryPx = (entryPx * Math.abs(posSize) + px * Math.abs(signed)) / Math.abs(newSize)
        posSize = newSize
        continue
      }

      // CLOSE (and maybe flip)
      const closeSize = Math.min(Math.abs(posSize), Math.abs(signed))
      const pnl = entrySide === 'long'
        ? (px - entryPx) * closeSize
        : (entryPx - px) * closeSize
      tradeMarkersRef.current.push({
        time,
        position: posSize > 0 ? 'aboveBar' : 'belowBar',
        color: pnl >= 0 ? '#26a69a' : '#ef5350',
        shape: posSize > 0 ? 'arrowDown' : 'arrowUp',
        text: `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`,
        size: 1,
      })

      const remainder = Math.abs(signed) - closeSize
      if (remainder > 0) {
        // Flip — fill closed the old side and opened a new one
        posSize = signed > 0 ? remainder : -remainder
        entryPx = px
        entrySide = signed > 0 ? 'long' : 'short'
        tradeMarkersRef.current.push({
          time,
          position: signed > 0 ? 'belowBar' : 'aboveBar',
          color: signed > 0 ? '#26a69a' : '#ef5350',
          shape: signed > 0 ? 'arrowUp' : 'arrowDown',
          text: signed > 0 ? 'BUY' : 'SELL',
          size: 1,
        })
      } else {
        posSize = 0
        entrySide = null
      }
    }

    // Solid entry / dashed exit price lines for the most recent CLOSED round-
    // trip, same style as the Trade Log detail chart. Skipped while a position
    // is still open since "exit" hasn't happened yet.
    if (posSize === 0 && sortedTrades.length >= 2) {
      // Walk backwards to find the last open → close pair
      let lastEntry: { px: number; side: 'long' | 'short' } | null = null
      let lastExitPx: number | null = null
      let scanPos = 0
      let scanEntryPx = 0
      let scanSide: 'long' | 'short' | null = null
      for (const tr of sortedTrades) {
        const signed = tr.side === 'buy' ? tr.size : -tr.size
        if (scanPos === 0) {
          scanPos = signed
          scanEntryPx = tr.price
          scanSide = signed > 0 ? 'long' : 'short'
        } else {
          const sameSide = (scanPos > 0 && signed > 0) || (scanPos < 0 && signed < 0)
          if (sameSide) {
            const newSize = scanPos + signed
            scanEntryPx = (scanEntryPx * Math.abs(scanPos) + tr.price * Math.abs(signed)) / Math.abs(newSize)
            scanPos = newSize
          } else {
            const closeSize = Math.min(Math.abs(scanPos), Math.abs(signed))
            const remainder = Math.abs(signed) - closeSize
            if (remainder === 0) {
              lastEntry = { px: scanEntryPx, side: scanSide as 'long' | 'short' }
              lastExitPx = tr.price
              scanPos = 0
              scanSide = null
            }
          }
        }
      }
      if (lastEntry && lastExitPx != null) {
        const entryColor = lastEntry.side === 'long' ? '#26a69a' : '#ef5350'
        candleSeries.createPriceLine({
          price: lastEntry.px,
          color: entryColor,
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `ENTRY ${lastEntry.side.toUpperCase()}`,
        })
        const pnl = lastEntry.side === 'long'
          ? lastExitPx - lastEntry.px
          : lastEntry.px - lastExitPx
        candleSeries.createPriceLine({
          price: lastExitPx,
          color: pnl >= 0 ? '#26a69a' : '#ef5350',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `EXIT ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}`,
        })
      }
    }

    const markersPlugin = createSeriesMarkers(candleSeries, [])
    markersApiRef.current = markersPlugin
    chartRef.current = chart
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
      chartRef.current = null
      markersApiRef.current = null
      indicatorLinesRef.current = []
      fibLinesRef.current = []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, strategyOutput, trades])

  // Apply markers — wave numbers always show; buy/sell + trade arrows respect
  // the showSignals toggle. Re-runs whenever the underlying data changes too.
  useEffect(() => {
    const api = markersApiRef.current
    if (!api) return
    const list: SeriesMarker<Time>[] = [
      ...waveMarkersRef.current,
      ...(showSignals ? signalMarkersRef.current : []),
      ...(showSignals ? tradeMarkersRef.current : []),
    ]
    list.sort((a, b) => Number(a.time) - Number(b.time))
    api.setMarkers(list)
  }, [showSignals, candles, strategyOutput, trades])

  // Toggle indicator visibility (main-chart lines + Fibonacci price lines)
  // without rebuilding the chart. Sub-pane chart is hidden via CSS below.
  useEffect(() => {
    for (const s of indicatorLinesRef.current) {
      try { s.applyOptions({ visible: showIndicator }) } catch {}
    }
    for (const pl of fibLinesRef.current) {
      try { pl.applyOptions({ lineVisible: showIndicator, axisLabelVisible: showIndicator }) } catch {}
    }
  }, [showIndicator])

  const goToLatest = () => {
    const chart = chartRef.current
    if (!chart || candles.length === 0) return
    const ts = chart.timeScale()
    const range = ts.getVisibleLogicalRange()
    const width = range ? range.to - range.from : 60
    const lastIdx = candles.length - 1
    // Centers the latest candle by extending visible range half-a-width past it.
    ts.setVisibleLogicalRange({
      from: lastIdx - width / 2,
      to: lastIdx + width / 2,
    })
  }

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
    <div className="card shrink-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold text-text">
          Chart
          <span className="ml-2 text-xs font-normal font-sans text-dim">
            {cfg.symbol.includes(':')
              ? `${cfg.symbol.split(':')[1]}/USDC`
              : cfg.symbol.replace(/USDT$/, '/USDC')} · {cfg.timeframe}
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {strategyOutput?.mainLines && strategyOutput.mainLines.length > 0 && (
            <span className="font-mono text-[10px] text-dim">
              {strategyOutput.mainLines.map(l => l.id).join(' · ')}
            </span>
          )}
          {loadingCandles && (
            <span className="text-[10px] text-dim animate-pulse">Loading…</span>
          )}
          <button
            onClick={() => setShowSignals((v) => !v)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 transition ${
              showSignals
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-panel-2 text-muted hover:border-border-strong hover:text-text'
            }`}
            title="Show or hide BUY/SELL signal markers and executed trade arrows"
          >
            {showSignals ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {showSignals ? 'Hide Buy/Sell' : 'Show Buy/Sell'}
          </button>
          <button
            onClick={() => setShowIndicator((v) => !v)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 transition ${
              showIndicator
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-panel-2 text-muted hover:border-border-strong hover:text-text'
            }`}
            title="Show or hide strategy indicator lines (ZigZag, EMA, BB, etc.)"
          >
            {showIndicator ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {showIndicator ? 'Hide Indicator' : 'Show Indicator'}
          </button>
          <button
            onClick={goToLatest}
            className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-muted transition hover:border-border-strong hover:text-text"
            title="Jump to the most recent price"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
            Latest Price
          </button>
        </div>
      </div>
      {loadingCandles && !candles.length ? (
        <div className="flex h-[300px] min-h-[300px] items-center justify-center text-sm text-dim">
          Loading chart…
        </div>
      ) : (
        <div className="relative">
          <div ref={mainRef} className="h-[300px] min-h-[300px] w-full" />
          <ChartHoverPanel
            hover={hover}
            candles={candles}
            regimeLabels={regimeLabels}
            tradeAtBar={resolveTradeAtBar}
          />
        </div>
      )}
      {strategyOutput?.subPane && (
        <div className={showIndicator ? '' : 'hidden'}>
          <div className="border-t border-border bg-panel px-3 py-1 font-mono text-[10px] text-dim">
            {strategyOutput.subPane.title}
          </div>
          <div ref={subRef} className="h-[108px] w-full" />
        </div>
      )}
    </div>
  )
}

// Canonicalize an asset key. Same rules the bot server uses for the
// /api/positions/sources map and what getAccountState returns: HIP-3 stays
// `dex:COIN` (dex lowercase, coin upper), plain crypto becomes UPPERCASE.
function canonAsset(raw: string): string {
  const s = raw.trim()
  if (s.includes(':')) {
    const i = s.indexOf(':')
    return s.slice(0, i).toLowerCase() + ':' + s.slice(i + 1).toUpperCase()
  }
  return s.toUpperCase()
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SignalBotsPage() {
  const { symbols } = useHLAssets()

  const [strategies, setStrategies] = useState<StrategyMeta[]>([])
  const [bots, setBots] = useState<BotSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  // True from arriving via Backtester "Deploy" until the bot is started — drives
  // the Save → Start guide banner so a fresh deploy isn't left wondering.
  const [cameFromDeploy, setCameFromDeploy] = useState(false)
  const [status, setStatus] = useState<SignalBotStatus | null>(null)
  const [cfg, setCfg] = useState<SignalBotConfig | null>(null)
  const [logs, setLogs] = useState<{ ts: string; level: string; msg: string }[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
  const [assetPrice, setAssetPrice] = useState<number | null>(null)
  // Live mark price surfaced by LivePositionCard; used by LiveStatusCard for $ size.
  const [livePrice, setLivePrice] = useState<number | null>(null)
  // All-time stats for the selected bot. Polled on a slow cadence (60s) because
  // it hits HL's fill history which is rate-limited and slow.
  const [botStats, setBotStats] = useState<{
    netPnl: number; roundTrips: number; winRate: number
  } | null>(null)
  const [maxLeverage, setMaxLeverage] = useState<number | null>(null)
  // Live SL/TP for the bot's asset (when a position is open on HL).
  // Polled together with status. null = not yet fetched; { slPx: null, tpPx: null } = no brackets.
  const [brackets, setBrackets] = useState<{ slPx: number | null; tpPx: number | null } | null>(null)
  // Count of consecutive empty bracket polls — HL's frontendOpenOrders is
  // flaky and intermittently returns no triggers even while they're alive.
  // We require 2 empty polls in a row before clearing the panel, so the UI
  // doesn't flicker "No active SL/TP" every 5s.
  const emptyBracketCountRef = useRef(0)
  const bracketsRef = useRef<{ slPx: number | null; tpPx: number | null } | null>(null)
  useEffect(() => { bracketsRef.current = brackets }, [brackets])
  // Bracket edit form state — `null` = view mode, object = editing
  const [bracketEdit, setBracketEdit] = useState<{ slPrice: string; tpPrice: string } | null>(null)

  // Position-source map (keyed by asset, e.g. ETH) — used to detect stranded
  // positions (stopped bot + open exchange position on same asset).
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

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const dirtyRef = useRef(dirty)
  // Bumped each time saveConfig finishes. Polls remember the value at their
  // start; if it changed by the time the poll's response arrives, the server
  // data we just fetched predates the save and we must NOT overwrite local cfg.
  const saveTokenRef = useRef(0)
  dirtyRef.current = dirty

  const running = status?.running ?? false
  const selectedMeta = strategies.find(s => s.id === cfg?.strategyId)

  // For custom (Strategy Builder) bots, fetch the spec so we can show what the
  // bot actually trades — direction, ATR/% stops, condition counts — since
  // those live in the spec, not the bot config.
  interface CustomSpecInfo {
    name: string
    direction?: 'long' | 'short' | 'both'
    stopMode?: 'pct' | 'atr'
    atrMult?: number; rr?: number; atrLength?: number
    riskPct?: number; slPct?: number; tpPct?: number
    entryLong?: { conditions: unknown[] }; entryShort?: { conditions: unknown[] }
  }
  const [customSpec, setCustomSpec] = useState<CustomSpecInfo | null>(null)
  const customId = cfg?.strategyId === 'custom' ? cfg.customStrategyId : undefined
  useEffect(() => {
    if (!customId) { setCustomSpec(null); return }
    let cancelled = false
    apiFetch(`/api/builder/strategies/${customId}`)
      .then(r => r.ok ? r.json() : null)
      .then((s: CustomSpecInfo | null) => { if (!cancelled) setCustomSpec(s) })
      .catch(() => { if (!cancelled) setCustomSpec(null) })
    return () => { cancelled = true }
  }, [customId])

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
        ? `${canonAsset(cfg.asset)}-${cfg.strategyId.toUpperCase()}-${cfg.timeframe.toUpperCase()}`
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
      // Invalidate any in-flight poll responses that fetched data before this save.
      saveTokenRef.current += 1
      // Adopt the server's parsed config directly — keeps the form in sync
      // even if the next poll is delayed.
      if (data.config) setCfg(data.config)
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
      if (action === 'start') setCameFromDeploy(false)  // journey complete
      setNotice({ text: action === 'start' ? 'Bot started' : 'Bot stopped', ok: true })
    } catch (e) {
      setNotice({ text: `${action} failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  // Toggle the MFE-based TP suggestion mode without stopping the bot.
  const toggleSuggestedTp = async (enabled: boolean) => {
    if (!selectedId) return
    setBusy(true); setNotice(null)
    try {
      const res = await apiFetch(`/api/signal/bots/${selectedId}/use-suggested-tp`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = (await res.json()) as { useSuggestedTp?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setCfg(prev => prev ? { ...prev, useSuggestedTp: enabled } : prev)
      setNotice({ text: `Suggested TP ${enabled ? 'ON' : 'OFF'}`, ok: true })
    } catch (e) {
      setNotice({ text: `Toggle failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  // Cancel the live SL/TP brackets on the bot's open position.
  const cancelBrackets = async () => {
    const asset = (cfg?.asset || '').trim().toUpperCase()
    if (!asset) return
    if (!confirm(`Cancel SL and TP orders for ${asset}?\n\nThe position will be left NAKED — no automatic stop loss.`)) return
    setBusy(true); setNotice(null)
    try {
      const res = await apiFetch(`/api/positions/${encodeURIComponent(asset)}/brackets`, { method: 'DELETE' })
      const data = (await res.json()) as { cancelled?: number; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setBrackets({ slPx: null, tpPx: null })
      setNotice({ text: `Cancelled ${data.cancelled ?? 0} bracket order(s)`, ok: true })
    } catch (e) {
      setNotice({ text: `Cancel failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  // Replace the live SL/TP brackets with user-entered prices.
  const saveBrackets = async () => {
    const asset = (cfg?.asset || '').trim().toUpperCase()
    if (!asset || !bracketEdit) return
    const slPrice = bracketEdit.slPrice === '' ? null : Number(bracketEdit.slPrice)
    const tpPrice = bracketEdit.tpPrice === '' ? null : Number(bracketEdit.tpPrice)
    if (slPrice === null && tpPrice === null) {
      setNotice({ text: 'Enter at least one of SL or TP price', ok: false }); return
    }
    if (slPrice !== null && (!Number.isFinite(slPrice) || slPrice <= 0)) {
      setNotice({ text: 'SL price must be a positive number', ok: false }); return
    }
    if (tpPrice !== null && (!Number.isFinite(tpPrice) || tpPrice <= 0)) {
      setNotice({ text: 'TP price must be a positive number', ok: false }); return
    }
    setBusy(true); setNotice(null)
    try {
      const body: Record<string, number> = {}
      if (slPrice !== null) body.slPrice = slPrice
      if (tpPrice !== null) body.tpPrice = tpPrice
      const res = await apiFetch(`/api/positions/${encodeURIComponent(asset)}/brackets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as {
        slPlaced?: boolean; tpPlaced?: boolean; cancelled?: number; error?: string
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const tags: string[] = []
      if (slPrice !== null) tags.push(data.slPlaced ? 'SL ✓' : 'SL ✗')
      if (tpPrice !== null) tags.push(data.tpPlaced ? 'TP ✓' : 'TP ✗')
      const allOk = (slPrice === null || data.slPlaced) && (tpPrice === null || data.tpPlaced)
      setNotice({ text: `Updated brackets (${tags.join(', ')})`, ok: !!allOk })
      setBrackets({ slPx: slPrice ?? brackets?.slPx ?? null, tpPx: tpPrice ?? brackets?.tpPx ?? null })
      setBracketEdit(null)
    } catch (e) {
      setNotice({ text: `Update failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  // Force-recompute the MFE-based TP suggestion immediately.
  const refreshTpSuggestion = async () => {
    if (!selectedId) return
    setBusy(true); setNotice(null)
    try {
      const res = await apiFetch(`/api/signal/bots/${selectedId}/tp-suggestion/refresh`, { method: 'POST' })
      const data = (await res.json()) as TpSuggestion | { error?: string }
      if (!res.ok) throw new Error(('error' in data ? data.error : '') || `HTTP ${res.status}`)
      setStatus(prev => prev ? { ...prev, tpSuggestion: data as TpSuggestion } : prev)
      setNotice({ text: 'TP suggestion refreshed', ok: true })
    } catch (e) {
      setNotice({ text: `Refresh failed: ${(e as Error).message}`, ok: false })
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
    // Snapshot the save token BEFORE the fetch. If it changes by the time the
    // response arrives, a save fired in between and our data is stale.
    const tokenAtStart = saveTokenRef.current
    try {
      const [stRes, logRes] = await Promise.all([
        apiFetch(`/api/signal/bots/${id}`),
        apiFetch(`/api/signal/bots/${id}/logs`),
      ])
      if (stRes.ok) {
        const st: SignalBotStatus = await stRes.json()
        setStatus(st)
        setBots(prev => prev.map(b => b.id === id ? { ...b, running: st.running } : b))
        // Skip cfg overwrite if (a) user is mid-edit, OR (b) a save fired
        // while this poll was in flight (response is now stale).
        const staleByRace = saveTokenRef.current !== tokenAtStart
        if ((!dirtyRef.current && !staleByRace) || st.running) setCfg(st.config)
        // Fetch live brackets for this bot's asset — fire-and-forget so a
        // slow HL response doesn't block the status update.
        //
        // Stickiness: HL's frontendOpenOrders intermittently returns no
        // triggers for ~1 poll even while brackets are alive. To stop the
        // panel from flickering "No active SL/TP" every 5s, we only clear
        // brackets after 2 consecutive empty polls. Errors keep stale data.
        const asset = (st.config?.asset || '').trim().toUpperCase()
        if (asset) {
          apiFetch(`/api/positions/${encodeURIComponent(asset)}/brackets`)
            .then(async (r) => ({ ok: r.ok, data: r.ok ? await r.json() as { slPx: number | null; tpPx: number | null } : null }))
            .then(({ ok, data }) => {
              if (!ok || !data) return // keep stale brackets on HTTP error
              const empty = data.slPx === null && data.tpPx === null
              const hadBefore = bracketsRef.current && (bracketsRef.current.slPx !== null || bracketsRef.current.tpPx !== null)
              if (empty && hadBefore && emptyBracketCountRef.current < 1) {
                emptyBracketCountRef.current += 1
                return // 1st empty after good data — likely transient, keep stale
              }
              emptyBracketCountRef.current = 0
              setBrackets(data)
            })
            .catch(() => { /* keep stale brackets on network error */ })
        } else {
          emptyBracketCountRef.current = 0
          setBrackets(null)
        }
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
            // Auto-TP: bot computes its own MFE-based take-profit
            useSuggestedTp?: boolean
            // MTF filter
            mtfEnabled?: boolean; mtfTimeframe?: string
            // Backtest reference for the forward-test card
            backtestSnapshot?: BacktestSnapshot
          }
          const stratId = pre.strategy ?? strats[0]?.id ?? 'macd'
          const stratMeta = strats.find(s => s.id === stratId)
          const params: Record<string, number> = {}
          if (stratMeta) for (const d of stratMeta.params) params[d.key] = d.default
          if (pre.params) Object.assign(params, pre.params)
          // HIP-3 assets carry a colon (e.g. "xyz:GOLD") and have no Binance
          // pair, so we don't append USDT and we keep the dex prefix in lowercase.
          const preAsset = (pre.asset ?? 'ETH')
          const preIsHip3 = preAsset.includes(':')
          const canonPre = preIsHip3
            ? preAsset.slice(0, preAsset.indexOf(':')).toLowerCase() + ':' + preAsset.slice(preAsset.indexOf(':') + 1).toUpperCase()
            : preAsset.toUpperCase()
          const newCfg: SignalBotConfig = {
            asset: canonPre,
            symbol: preIsHip3 ? canonPre : `${canonPre}USDT`,
            timeframe: pre.timeframe ?? '1h',
            strategyId: stratId,
            params,
            size: pre.size ?? 0.01,
            slippagePct: 1,
            cooldownSec: 60,
            tradeSide: (pre.direction === 'short' ? 'sell' : pre.direction === 'both' ? 'both' : 'buy') as TradeSide,
            slPct: pre.slPct ?? pre.sizingSlPct,
            tpPct: pre.tpPct,
            useSuggestedTp: pre.useSuggestedTp,
            riskUsd: pre.riskUsd,
            mtfEnabled: pre.mtfEnabled,
            mtfTimeframe: pre.mtfTimeframe,
            backtestSnapshot: pre.backtestSnapshot,
          }
          setIsNew(true)
          setSelectedId(null)
          setCfg(newCfg)
          setDirty(true)
          setCameFromDeploy(true)
          return
        } catch { /* bad sessionStorage — ignore */ }
      }

      // Open a specific bot when arrived via ?select=<id> (e.g. the Strategy
      // Builder "Deploy" creates the bot server-side then routes here).
      const selectId = new URLSearchParams(window.location.search).get('select')
      if (selectId && botList.some((b) => b.id === selectId)) {
        setSelectedId(selectId)
        setCameFromDeploy(true) // surface the "created — press Start" guide
        return
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

  // Poll the sources map on the same cadence so stranded banners react when
  // a position is closed externally or a bot's running flag changes.
  useEffect(() => {
    refreshSources()
    const id = setInterval(refreshSources, POLL_MS)
    return () => clearInterval(id)
  }, [refreshSources])

  // All-time bot stats — slower poll (60s) because HL fills are expensive.
  useEffect(() => {
    if (!selectedId || isNew) { setBotStats(null); return }
    let cancelled = false
    const load = () => {
      apiFetch(`/api/signal/bots/${selectedId}/stats`)
        .then((r) => r.ok ? r.json() : null)
        .then((d: { netPnl: number; roundTrips: number; winRate: number } | null) => {
          if (!cancelled && d) setBotStats(d)
        })
        .catch(() => { /* tolerate */ })
    }
    load()
    const id = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [selectedId, isNew])

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

  // Position sizing: risk $ / SL% → position notional → qty. Reads from cfg
  // so the values persist across reload. Backend recomputes size on each trade
  // from live price when cfg.riskUsd + cfg.slPct are both set.
  const sizingResult = useMemo(() => {
    const risk = typeof cfg?.riskUsd === 'number' && cfg.riskUsd > 0 ? cfg.riskUsd : null
    const sl = typeof cfg?.slPct === 'number' && cfg.slPct > 0 ? cfg.slPct : null
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
  }, [cfg?.riskUsd, cfg?.slPct, cfg?.asset, assetPrice, maxLeverage])

  const riskMode = sizingResult !== null


  // When switching to a bot, clear new-bot state
  const selectBot = (id: string) => {
    if (id === selectedId && !isNew) return  // already selected — don't null cfg and break the form
    setSelectedId(id)
    setIsNew(false)
    setDirty(false)
    setStatus(null)
    setCfg(null)
    setNotice(null)
    setCameFromDeploy(false)
  }

  const startNew = () => {
    setSelectedId(null)
    setIsNew(true)
    setStatus(null)
    setCfg(blankCfg())
    setDirty(false)
    setNotice(null)
    setCameFromDeploy(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">

      {/* ── Left sidebar: bot list + config form ──
          On phones + iPad portrait (<lg) it stacks full-width above the chart
          and the whole PAGE scrolls, so the config form is fully readable. On
          lg+ (iPad landscape / desktop) it becomes a fixed-width side column. */}
      <aside className="flex w-full shrink-0 flex-col border-b border-border bg-panel/60 lg:h-full lg:w-[320px] lg:overflow-hidden lg:border-b-0 lg:border-r">

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

        {/* Bot list — capped on mobile so the config form below stays reachable. */}
        <div className="flex max-h-[40vh] flex-col overflow-y-auto border-b border-border lg:max-h-none">
          {bots.length === 0 && !isNew && (
            <p className="px-4 py-3 text-xs text-dim">No bots yet. Click New to create one.</p>
          )}
          {bots.map(b => {
            const asset = canonAsset(b.symbol.replace(/USDT$/i, ''))
            const stranded = (sources[asset] ?? []).some(
              (s) => s.botId === b.id && s.kind === 'signal' && s.stranded,
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
                    <span className="truncate text-xs font-semibold">{b.name}</span>
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
                  <div className="truncate text-[10px] text-dim">{b.symbol} · {b.timeframe}</div>
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
        {cfg && (
          <div className="p-4 lg:flex-1 lg:overflow-y-auto">
            <div className="flex flex-col gap-3">
              {/* Stranded position banner — selected bot is stopped but its
                  asset still has an open position on the exchange. */}
              {selectedId && !isNew && cfg.asset && (() => {
                const arr = sources[canonAsset(cfg.asset)] ?? []
                const mine = arr.find((s) => s.botId === selectedId && s.kind === 'signal')
                if (!mine?.stranded || !mine.position) return null
                return (
                  <StrandedBanner
                    asset={canonAsset(cfg.asset)}
                    botName={bots.find((b) => b.id === selectedId)?.name ?? cfg.asset}
                    botKind="signal"
                    position={mine.position}
                    resumeEndpoint={`/api/signal/bots/${selectedId}/start`}
                    onAfterAction={() => {
                      refresh()
                      refreshSources()
                    }}
                  />
                )
              })()}

              {/* Multi-bot conflict — two or more bots on this asset. */}
              {selectedId && !isNew && cfg.asset && (() => {
                const arr = sources[canonAsset(cfg.asset)] ?? []
                if (arr.length < 2) return null
                return (
                  <MultiBotConflictBanner
                    asset={canonAsset(cfg.asset)}
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

              {riskMode && (
                <div className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-1.5 text-[10px] leading-snug">
                  <span className="font-semibold text-brand">Risk Mode:</span>{' '}
                  <span className="font-mono text-text">${cfg.riskUsd}</span>{' '}
                  risk / <span className="font-mono text-text">{cfg.slPct}%</span> SL{' '}
                  → ~<span className="font-mono text-text">{sizingResult?.qty}</span>{' '}
                  <span className="text-dim">(recomputed each trade from live price)</span>
                </div>
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
                  {symbols.map(s => {
                    const label = s.base.includes(':') ? s.base.split(':')[1] : s.base
                    return <option key={s.symbol} value={s.symbol}>{label}/USDC{s.base.includes(':') ? ` · ${s.base.split(':')[0]}` : ''}</option>
                  })}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Strategy">
                  {cfg.strategyId === 'custom' ? (
                    <div className={`${inputCls} flex items-center`} title="Built in the Strategy Builder">
                      {customSpec?.name ?? 'Custom (Builder)'}
                    </div>
                  ) : (
                    <select disabled={running} value={cfg.strategyId} onChange={(e) => onStrategyChange(e.target.value)} className={inputCls}>
                      {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Timeframe">
                  <select disabled={running} value={cfg.timeframe} onChange={(e) => patch({ timeframe: e.target.value })} className={inputCls}>
                    {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                  </select>
                </Field>
              </div>

              {/* Read-only summary for custom (Builder) strategies — direction,
                  stops, condition counts all live in the spec, not the config. */}
              {cfg.strategyId === 'custom' && (
                <div className="rounded-lg border border-brand/30 bg-brand/5 p-2.5 text-[11px] space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-text">⚙ Custom strategy · {customSpec?.name ?? '…'}</span>
                    <a href="/builder" className="text-brand hover:underline text-[10px] whitespace-nowrap">Edit in Builder →</a>
                  </div>
                  <div className="text-dim">
                    Direction: <span className="text-text">{cfg.tradeSide === 'both' ? 'Long & Short' : cfg.tradeSide === 'sell' ? 'Short only' : 'Long only'}</span>
                    {' · '}Stops: <span className="text-text">{
                      customSpec?.stopMode === 'atr'
                        ? `ATR(${customSpec.atrLength ?? 14})×${customSpec.atrMult ?? 2} · ${customSpec.rr ?? 2}R`
                        : (cfg.slPct || cfg.tpPct) ? `Fixed SL ${cfg.slPct ?? 0}% / TP ${cfg.tpPct ?? 0}%` : 'set in Builder'
                    }</span>
                  </div>
                  <div className="text-dim">
                    Entry conditions: {customSpec?.entryLong?.conditions.length ?? 0} long
                    {customSpec?.entryShort?.conditions.length ? ` · ${customSpec.entryShort.conditions.length} short` : ''}
                  </div>
                  {(() => {
                    const risk = customSpec?.riskPct ?? 1
                    const R = customSpec?.stopMode === 'atr'
                      ? (customSpec?.rr ?? 2)
                      : (customSpec?.slPct && customSpec?.tpPct ? customSpec.tpPct / customSpec.slPct : null)
                    return (
                      <div className="text-dim">
                        Per trade: <span className="font-semibold text-loss">−{risk}%</span> of account on a stop
                        {R != null && <> · <span className="font-semibold text-gain">+{(risk * R).toFixed(2)}%</span> on target</>}
                      </div>
                    )
                  })()}
                  <div className="text-dim/70 text-[10px]">
                    Position size = <span className="text-text">Risk % of your account</span> ÷ stop distance, per trade (set in the Builder).
                    {customSpec?.stopMode === 'atr' ? ' SL/TP come from ATR — the TP/SL % and sizing fields below don’t apply.' : ' The sizing fields below don’t apply.'}
                  </div>
                </div>
              )}

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

              {/* SMC has an extra entry knob not in strategyMeta: enter on the
                  break (0) or wait for the pull-back and enter on the retest of
                  the broken level / order-block / FVG (1/2/3). */}
              {cfg.strategyId === 'smc' && (
                <Field label="Entry rule">
                  <select disabled={running} value={cfg.params.entryMode ?? 0}
                    onChange={(e) => patch({ params: { ...cfg.params, entryMode: Number(e.target.value) } })}
                    className={inputCls}>
                    <option value={0}>Break — enter on the break</option>
                    <option value={1}>Retest level — wait for pull-back to broken level</option>
                    <option value={2}>Retest OB — wait for pull-back to order block</option>
                    <option value={3}>Retest FVG — wait for pull-back to fair-value gap</option>
                  </select>
                </Field>
              )}

              <div className="my-1 h-px bg-border" />

              {/* ── Sizing Mode — mirrors the Backtester's Fixed | Risk-based toggle ── */}
              <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Sizing mode</p>
              <div className="flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => {
                    // Switch to Fixed: clear riskUsd so the implicit mode flips back.
                    if (riskMode) patch({ riskUsd: undefined })
                  }}
                  className={`flex-1 px-3 py-1.5 text-xs font-semibold transition-colors ${
                    !riskMode ? 'bg-brand text-bg' : 'bg-panel-2 text-dim hover:text-text'
                  } disabled:opacity-50`}
                >
                  Fixed
                </button>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => {
                    // Switch to Risk-based: seed riskUsd if empty so the toggle "sticks".
                    if (!riskMode) patch({ riskUsd: cfg.riskUsd ?? 50 })
                  }}
                  className={`flex-1 px-3 py-1.5 text-xs font-semibold transition-colors ${
                    riskMode ? 'bg-brand text-bg' : 'bg-panel-2 text-dim hover:text-text'
                  } disabled:opacity-50`}
                >
                  Risk-based
                </button>
              </div>

              {!riskMode ? (
                <Field label="Position Size ($)">
                  <UsdSizeInput qty={cfg.size} price={assetPrice} disabled={running}
                    onQty={(q) => patch({ size: q })} />
                </Field>
              ) : (
                <Field label="Risk USD">
                  <NumInput value={cfg.riskUsd} disabled={running} placeholder="e.g. 50" min="0"
                    onChange={(v) => patch({ riskUsd: v })} />
                </Field>
              )}
              <p className="text-[10px] text-dim leading-snug">
                {riskMode
                  ? `Risk mode — bot recomputes size on every trade so the $ you can lose at Auto SL % stays constant${cfg.slPct ? ` (currently ${cfg.slPct}%)` : ' (set an Auto SL % below first)'}.`
                  : 'Fixed mode — the bot opens this exact $ position every signal. Input is converted to qty using live price.'}
              </p>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Slippage %">
                  <NumInput value={cfg.slippagePct} disabled={running} min="0" step="0.1"
                    onChange={(v) => patch({ slippagePct: v ?? 0 })} />
                </Field>
                <Field label="Cooldown (s)">
                  <NumInput value={cfg.cooldownSec} disabled={running} min="0" step="1"
                    onChange={(v) => patch({ cooldownSec: v ?? 0 })} />
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
                <Field label="Max divergence %">
                  <input type="number" disabled={running} step="0.05" min="0" max="10" placeholder="off (e.g. 0.30)"
                    value={cfg.maxDivergencePct ?? ''}
                    onChange={(e) => patch({ maxDivergencePct: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className={inputCls} />
                </Field>
              </div>
              <p className="text-[10px] text-dim leading-snug">
                {cfg.maxDivergencePct
                  ? `Slippage gate ON — trade aborted if Hyperliquid's price differs from the Binance signal close by more than ${cfg.maxDivergencePct}%. Protects against Binance↔HL price drift during fast moves.`
                  : 'Slippage gate OFF — trades always execute regardless of HL price drift from signal close.'}
              </p>

              {/* ── Live brackets on HL — view + edit + cancel ─────────────── */}
              <div className="my-1 h-px bg-border" />
              <div className="rounded-lg border border-border bg-panel-2 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-text">
                    Live brackets {cfg.asset ? `(${cfg.asset})` : ''}
                  </span>
                  {brackets && (brackets.slPx || brackets.tpPx) && !bracketEdit && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setBracketEdit({
                          slPrice: brackets.slPx?.toString() ?? '',
                          tpPrice: brackets.tpPx?.toString() ?? '',
                        })}
                        disabled={busy}
                        className="rounded-md border border-border bg-panel px-2 py-1 text-[10px] text-dim hover:text-text hover:border-brand/40 transition-colors disabled:opacity-40"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={cancelBrackets}
                        disabled={busy}
                        className="rounded-md border border-loss/40 bg-loss/10 px-2 py-1 text-[10px] font-semibold text-loss hover:bg-loss/20 transition-colors disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {!brackets ? (
                  <p className="text-[10px] text-dim italic">Loading…</p>
                ) : bracketEdit ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-dim leading-snug">
                      Enter new <strong>trigger prices</strong>. Leave blank to skip placing
                      that leg. Existing brackets will be cancelled first. Requires an open
                      position on the exchange.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-0.5 block text-[10px] text-loss font-semibold">New SL price ($)</label>
                        <input type="number" step="any" min="0" placeholder="blank to skip"
                          value={bracketEdit.slPrice}
                          onChange={(e) => setBracketEdit({ ...bracketEdit, slPrice: e.target.value })}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[10px] text-gain font-semibold">New TP price ($)</label>
                        <input type="number" step="any" min="0" placeholder="blank to skip"
                          value={bracketEdit.tpPrice}
                          onChange={(e) => setBracketEdit({ ...bracketEdit, tpPrice: e.target.value })}
                          className={inputCls} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={saveBrackets}
                        disabled={busy}
                        className="flex-1 rounded-md bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-black hover:opacity-90 disabled:opacity-40"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => setBracketEdit(null)}
                        disabled={busy}
                        className="flex-1 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11px] text-dim hover:text-text disabled:opacity-40"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ) : brackets.slPx === null && brackets.tpPx === null ? (
                  <p className="text-[10px] text-dim italic">
                    No active SL/TP on Hyperliquid for {cfg.asset || 'this asset'}.
                    {' '}Will appear here after the bot fires the next entry.
                  </p>
                ) : (
                  <div className="space-y-1.5 text-[10px]">
                    <div className="flex justify-between rounded-md bg-panel px-2 py-1.5">
                      <span className="font-semibold text-loss">SL</span>
                      <span className="font-mono text-text">
                        {brackets.slPx ? `$${brackets.slPx.toFixed(6).replace(/\.?0+$/, '')}` : '— (not set)'}
                      </span>
                    </div>
                    <div className="flex justify-between rounded-md bg-panel px-2 py-1.5">
                      <span className="font-semibold text-gain">TP</span>
                      <span className="font-mono text-text">
                        {brackets.tpPx ? `$${brackets.tpPx.toFixed(6).replace(/\.?0+$/, '')}` : '— (not set)'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Advanced settings — folded by default to keep the form light.
                  Holds the auto-TP suggestion, catch-up, and higher-TF filter. ── */}
              <div className="my-1 h-px bg-border" />
              <details className="group rounded-lg border border-border bg-panel-2/30">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-dim">
                    <span className="transition-transform group-open:rotate-90">▶</span>
                    Advanced settings
                  </span>
                  <span className="flex items-center gap-1">
                    {cfg.useSuggestedTp && <span className="rounded border border-brand/40 bg-brand/10 px-1 py-px text-[8px] font-bold uppercase text-brand">auto-TP</span>}
                    {cfg.catchUpOnStart && <span className="rounded border border-brand/40 bg-brand/10 px-1 py-px text-[8px] font-bold uppercase text-brand">catch-up</span>}
                    {cfg.mtfEnabled && <span className="rounded border border-brand/40 bg-brand/10 px-1 py-px text-[8px] font-bold uppercase text-brand">MTF</span>}
                    {!cfg.useSuggestedTp && !cfg.catchUpOnStart && !cfg.mtfEnabled && (
                      <span className="text-[9px] text-dim">auto-TP · catch-up · higher-TF</span>
                    )}
                  </span>
                </summary>
                <div className="flex flex-col gap-2 px-3 pb-3 pt-1">

              {/* ── Suggested TP (MFE median) — toggleable live ─────────────── */}
              <div className="rounded-lg border border-border bg-panel-2 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-text">Suggested TP (MFE P75)</span>
                  <button
                    type="button"
                    onClick={() => toggleSuggestedTp(!cfg.useSuggestedTp)}
                    disabled={busy}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      cfg.useSuggestedTp
                        ? 'bg-brand/20 text-brand border border-brand/40'
                        : 'bg-panel border border-border text-dim hover:text-text'
                    }`}
                  >
                    {cfg.useSuggestedTp ? '● ON' : '○ OFF'}
                  </button>
                </div>
                <p className="mb-2 text-[10px] text-dim leading-snug">
                  Looks back 1500 bars, finds every past signal, and measures how far price ran
                  before reversal. Sets TP at the <strong>P75</strong> of that distribution — far
                  enough from fill to avoid HL "trigger condition met" rejections, but still
                  within the strategy's typical reach. Needs ≥5 signals per side.
                  Good for sideways; turn OFF in trends.
                </p>

                {status?.tpSuggestion ? (
                  <div className="space-y-2 text-[10px]">
                    {(['buy', 'sell'] as const).map((side) => {
                      const s = status.tpSuggestion?.[side]
                      if (!s) return null
                      const using = cfg.useSuggestedTp && s.suggestion && s.suggestion > 0
                      return (
                        <div key={side} className="rounded-md bg-panel px-2 py-1.5">
                          <div className="flex items-center justify-between">
                            <span className={`font-mono font-semibold uppercase ${side === 'buy' ? 'text-gain' : 'text-loss'}`}>{side}</span>
                            <span className="text-dim">n={s.count}</span>
                          </div>
                          <div className="mt-1 grid grid-cols-4 gap-1 font-mono text-[10px]">
                            <div><span className="text-dim">P25</span> {s.p25}%</div>
                            <div><span className="text-dim">Median</span> {s.median}%</div>
                            <div><span className="text-dim">P75</span> {s.p75}%</div>
                            <div><span className="text-dim">Avg</span> {s.avg}%</div>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-dim">Suggested TP</span>
                            <span className={`font-mono font-semibold ${using ? 'text-brand' : 'text-text'}`}>
                              {s.suggestion ? `${s.suggestion}%` : `— (need ≥5 signals)`}
                              {using ? ' ← active' : ''}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                    {!status.tpSuggestion.buy && !status.tpSuggestion.sell && (
                      <p className="text-warn">No signals found in lookback window.</p>
                    )}
                    <p className="text-[9px] text-dim">
                      Computed {new Date(status.tpSuggestion.computedAt).toLocaleTimeString()}
                      {' · '}{status.tpSuggestion.lookbackBars} bars
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] text-dim italic">
                    No suggestion computed yet. {cfg.useSuggestedTp
                      ? 'Will compute on next bot start.'
                      : 'Click Refresh to preview the suggestion.'}
                  </p>
                )}

                <button
                  type="button"
                  onClick={refreshTpSuggestion}
                  disabled={busy}
                  className="mt-2 w-full rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11px] text-dim hover:text-text hover:border-brand/40 transition-colors disabled:opacity-40"
                >
                  Refresh suggestion
                </button>
              </div>

              {/* ── Catch-up on start — enter on a fresh pre-startup signal if price still favorable ── */}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                disabled={running}
                onClick={() => patch({ catchUpOnStart: !cfg.catchUpOnStart })}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  cfg.catchUpOnStart
                    ? 'border-brand/50 bg-brand/10 text-brand'
                    : 'border-border bg-panel-2 text-muted hover:text-text'
                } disabled:opacity-50`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      cfg.catchUpOnStart ? 'bg-brand shadow-[0_0_6px_hsl(var(--brand))]' : 'bg-dim'
                    }`}
                  />
                  {cfg.catchUpOnStart ? 'Catch-up on start: ON' : 'Catch-up on start: OFF'}
                </span>
                <span className="font-mono text-[10px] text-dim">
                  {cfg.catchUpOnStart ? 'enter immediately' : 'wait for next bar'}
                </span>
              </button>
              <p className="text-[10px] text-dim leading-snug">
                {cfg.catchUpOnStart
                  ? `If the most-recent closed bar already fired a signal AND the live price is still on the favorable side (buy: live ≤ signal close; sell: live ≥ signal close), the bot enters immediately on start instead of waiting for the next bar to close.`
                  : `Bot ignores any signal that fired before you pressed Start — it waits for a fresh signal on the next bar close.`}
              </p>

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
                </div>
              </details>

              <div className="my-1 h-px bg-border" />

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
        {cfg && !riskMode && (
          <PositionSizeCard
            notional={assetPrice && cfg.size > 0 ? cfg.size * assetPrice : null}
            leverage={maxLeverage}
            slPct={cfg.slPct ?? null}
            footnote={assetPrice ? `≈ ${cfg.size} ${cfg.asset} at $${assetPrice.toFixed(2)}` : null}
          />
        )}
        {cfg && riskMode && sizingResult?.rawQty && (
          <PositionSizeCard
            notional={assetPrice && sizingResult.rawQty ? sizingResult.rawQty * assetPrice : null}
            leverage={maxLeverage}
            slPct={cfg.slPct ?? null}
            footnote={assetPrice ? `Risk mode · ≈ ${sizingResult.rawQty.toFixed(6)} ${cfg.asset} at $${assetPrice.toFixed(2)}` : null}
          />
        )}
      </aside>

      {/* ── Right main area ── */}
      <div className="flex min-w-0 flex-col gap-4 p-4 lg:flex-1 lg:overflow-y-auto lg:p-5">

        {/* Deploy guide — only while coming from the Backtester "Deploy" button.
            Walks the user through the two steps that actually put the bot live:
            Create Bot (save), then Start. Clears once the bot is started. */}
        {cameFromDeploy && (
          <div className="rounded-xl border border-brand/30 bg-brand/5 p-3.5">
            <div className="mb-2 flex items-center gap-1.5">
              <Rocket className="h-4 w-4 text-brand" />
              <span className="text-sm font-semibold text-text">Deployed from Backtester — 2 steps to go live</span>
            </div>
            <ol className="flex flex-col gap-1.5 text-[11px] text-dim">
              <li className="flex items-center gap-2">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                  isNew ? 'bg-brand text-bg' : 'bg-gain/20 text-gain'
                }`}>{isNew ? '1' : '✓'}</span>
                <span className={isNew ? 'text-text' : ''}>
                  Review the settings on the left, then click <span className="font-semibold text-text">Create Bot</span>.
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                  !isNew && !running ? 'bg-brand text-bg' : 'bg-panel-2 text-dim'
                }`}>2</span>
                <span className={!isNew && !running ? 'text-text' : ''}>
                  Click <span className="font-semibold text-text">Start</span> to go live — you'll then see the
                  next-bar countdown, signals, and trades below.
                </span>
              </li>
            </ol>
          </div>
        )}

        {/* Live status header — verdict-style pulse pill + chips + inline error */}
        {selectedId && !isNew && status && (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="flex-1 min-w-0">
              <LiveBotHeader
                name={bots.find(b => b.id === selectedId)?.name ?? 'Signal Bot'}
                state={(status.autoPausedReason || status.lastError) ? 'error' : running ? 'running' : 'stopped'}
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
                lastError={status.autoPausedReason || status.lastError}
                tradesExecuted={status.tradesExecuted}
                allTimeNetPnl={botStats?.netPnl ?? null}
                allTimeRoundTrips={botStats?.roundTrips ?? null}
                allTimeWinRate={botStats?.winRate ?? null}
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
              <LiveStatusCard status={status} lastPrice={livePrice} />
              <SignalFunnelCard status={status} />
            </div>
            {cfg?.backtestSnapshot && (
              <ForecastVsActualCard snapshot={cfg.backtestSnapshot} live={botStats} />
            )}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <LivePositionCard
                asset={status.config.asset}
                onMarkPrice={setLivePrice}
              />
              <TradeSetupCard
                status={status}
                strategies={strategies}
                lastPrice={livePrice}
              />
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
                className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-bg mx-auto hover:opacity-90 transition-opacity"
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

