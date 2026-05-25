import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, RefreshCw } from 'lucide-react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { apiFetch } from '@/contexts/AuthContext'

// ── Server response shapes (mirror bot/src/fundamentals.ts) ───────────────────

type Tone = 'gain' | 'loss' | 'warn' | 'neutral'
type RegimeLabel = 'Accumulation' | 'Markup' | 'Distribution' | 'Markdown'

interface Verdict {
  asset: string
  generatedAt: number
  stance: string
  narrative: string
  chips: Record<'sentiment' | 'valuation' | 'regime' | 'leverage' | 'breadth', { label: string; tone: Tone }>
  inputs: {
    fng: number; mvrv: number; mvrvMean: number
    fundingAnnualizedPct: number; oiPct30d: number
    btcDominance: number; regime: RegimeLabel; regimeConfidence: number
  }
}
interface FngPoint { time: number; value: number; label: string }
interface FngResult { current: FngPoint; history: FngPoint[] }

interface MvrvPoint { time: number; value: number }
interface MvrvResult { current: MvrvPoint; history: MvrvPoint[]; mean: number; stdev: number }

interface FundingResult {
  current: { time: number; rate: number }
  annualizedPct: number
  history: Array<{ time: number; rate: number }>
}
interface OiResult {
  current: { time: number; usd: number }
  history: Array<{ time: number; usd: number }>
  pct30d: number
}
interface DominanceResult { btcDominance: number; ethDominance: number; totalMarketCapUsd: number }

interface RegimeResult {
  label: RegimeLabel; confidence: number; reason: string
  candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>
  ema50: Array<number | null>; ema200: Array<number | null>
  donchianPos: number; bbBandwidth: number; return30d: number; return90d: number
}

interface Bundle {
  verdict: Verdict
  fng: FngResult
  mvrv: MvrvResult
  funding: FundingResult
  oi: OiResult
  dominance: DominanceResult
  regime: RegimeResult
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const t = (n: number) => n as UTCTimestamp

const toneClasses: Record<Tone, { ring: string; bg: string; text: string; dot: string }> = {
  gain:    { ring: 'border-gain/30',   bg: 'bg-gain/10',   text: 'text-gain',   dot: 'bg-gain'   },
  loss:    { ring: 'border-loss/30',   bg: 'bg-loss/10',   text: 'text-loss',   dot: 'bg-loss'   },
  warn:    { ring: 'border-warn/30',   bg: 'bg-warn/10',   text: 'text-warn',   dot: 'bg-warn'   },
  neutral: { ring: 'border-border',    bg: 'bg-panel-2',   text: 'text-dim',    dot: 'bg-dim'    },
}

function stanceTone(stance: string): Tone {
  if (stance.includes('Bullish')) return stance.startsWith('Cautiously') ? 'warn' : 'gain'
  if (stance.includes('Bearish')) return stance.startsWith('Cautiously') ? 'warn' : 'loss'
  return 'neutral'
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FundamentalsPage() {
  const [data, setData] = useState<Bundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState(0)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const endpoints = ['verdict', 'fear-greed', 'mvrv', 'funding', 'oi', 'dominance', 'regime?asset=BTC&tf=1d']
      const results = await Promise.all(
        endpoints.map((e) => apiFetch(`/api/fundamentals/${e}`).then(async (r) => {
          if (!r.ok) throw new Error(`${e}: ${(await r.json().catch(() => ({})) as { error?: string }).error ?? r.status}`)
          return r.json()
        })),
      )
      const [verdict, fng, mvrv, funding, oi, dominance, regime] = results as [
        Verdict, FngResult, MvrvResult, FundingResult, OiResult, DominanceResult, RegimeResult,
      ]
      setData({ verdict, fng, mvrv, funding, oi, dominance, regime })
      setLastFetch(Date.now())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden p-5 gap-4">
      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand/30 bg-brand/10">
            <Brain className="h-[18px] w-[18px] text-brand" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text">Fundamentals</h1>
            <p className="text-[11px] text-dim">
              Sentiment, valuation & regime — institutional view on BTC
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-dim tabular-nums">
            {lastFetch ? `Updated ${timeAgo(lastFetch)}` : 'Loading…'}
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-xs text-dim hover:text-text disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-loss/30 bg-loss/10 p-3 text-xs text-loss">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex flex-1 items-center justify-center text-xs text-dim">
          Fetching fundamentals…
        </div>
      )}

      {data && (
        <>
          {/* ─── Overall Verdict ─── */}
          <VerdictCard verdict={data.verdict} />

          {/* ─── Summary chips ─── */}
          <ChipRow verdict={data.verdict} />

          {/* ─── Q-cards grid ─── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <FngCard fng={data.fng} />
            <MvrvCard mvrv={data.mvrv} />
            <RegimeCard regime={data.regime} />
            <FundingOiCard funding={data.funding} oi={data.oi} />
            <DominanceCard dominance={data.dominance} />
          </div>
        </>
      )}
    </div>
  )
}

// ── Verdict card ──────────────────────────────────────────────────────────────

function VerdictCard({ verdict }: { verdict: Verdict }) {
  const tone = stanceTone(verdict.stance)
  const tc = toneClasses[tone]
  return (
    <div className={`rounded-xl border ${tc.ring} ${tc.bg} p-5`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[11px] uppercase tracking-wider text-dim">Overall Verdict</span>
        <span className={`flex items-center gap-2 text-base font-semibold ${tc.text}`}>
          <span className={`h-2 w-2 rounded-full ${tc.dot}`} />
          {verdict.stance}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-text">{verdict.narrative}</p>
    </div>
  )
}

// ── Chip row ──────────────────────────────────────────────────────────────────

function ChipRow({ verdict }: { verdict: Verdict }) {
  const items: Array<{ label: string; chip: { label: string; tone: Tone } }> = [
    { label: 'Sentiment', chip: verdict.chips.sentiment },
    { label: 'Valuation', chip: verdict.chips.valuation },
    { label: 'Regime',    chip: verdict.chips.regime    },
    { label: 'Leverage',  chip: verdict.chips.leverage  },
    { label: 'Breadth',   chip: verdict.chips.breadth   },
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {items.map(({ label, chip }) => {
        const tc = toneClasses[chip.tone]
        return (
          <div key={label} className={`flex flex-col gap-1 rounded-xl border ${tc.ring} ${tc.bg} px-3 py-2`}>
            <span className="text-[10px] uppercase tracking-wider text-dim">{label}</span>
            <span className={`text-xs font-semibold ${tc.text}`}>{chip.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Card chrome ───────────────────────────────────────────────────────────────

function QCard({ question, interpretation, children }: { question: string; interpretation?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-panel p-4">
      <h2 className="text-sm font-semibold text-text">{question}</h2>
      <div className="min-h-[180px]">{children}</div>
      {interpretation && (
        <p className="text-[11px] leading-relaxed text-dim">→ {interpretation}</p>
      )}
    </div>
  )
}

// ── Fear & Greed card ─────────────────────────────────────────────────────────

function FngCard({ fng }: { fng: FngResult }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const v = fng.current.value
  const tone: Tone = v <= 25 ? 'loss' : v <= 45 ? 'warn' : v < 55 ? 'neutral' : v < 75 ? 'warn' : 'gain'
  const tc = toneClasses[tone]

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = makeChart(el)
    const series = chart.addSeries(AreaSeries, {
      lineColor: 'rgba(167,139,250,0.9)',
      topColor: 'rgba(167,139,250,0.35)', bottomColor: 'rgba(167,139,250,0.02)',
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    })
    series.setData(fng.history.map((p) => ({ time: t(p.time), value: p.value })))
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => { ro.disconnect(); chart.remove() }
  }, [fng])

  const interp = `${fng.current.label} (${v}/100). ` +
    (v <= 25 ? 'Capitulation zone — contrarian setups historically favorable.'
    : v <= 45 ? 'Crowd is anxious — typically late accumulation territory.'
    : v < 55 ? 'Crowd is balanced.'
    : v < 75 ? 'Optimism is building — watch for froth.'
    : 'Euphoria — historically a risky zone for fresh longs.')

  return (
    <QCard question="Is the market greedy or fearful?" interpretation={interp}>
      <div className="grid grid-cols-[140px_1fr] gap-4">
        <div className={`flex flex-col items-center justify-center rounded-lg border ${tc.ring} ${tc.bg} p-3`}>
          <span className={`font-mono text-3xl font-semibold ${tc.text}`}>{v}</span>
          <span className={`text-[10px] uppercase tracking-wider ${tc.text}`}>{fng.current.label}</span>
          <span className="mt-1 text-[10px] text-dim">0 = fear · 100 = greed</span>
        </div>
        <div ref={containerRef} className="h-[180px] w-full overflow-hidden rounded-lg border border-border bg-panel-2" />
      </div>
    </QCard>
  )
}

// ── MVRV card ─────────────────────────────────────────────────────────────────

function MvrvCard({ mvrv }: { mvrv: MvrvResult }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const v = mvrv.current.value
  const mean = mvrv.mean
  const tone: Tone = v < 1 ? 'gain' : v < mean * 0.85 ? 'gain' : v < mean * 1.15 ? 'neutral' : v < 3.7 ? 'warn' : 'loss'
  const tc = toneClasses[tone]

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = makeChart(el)
    const series = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 2 })
    series.setData(mvrv.history.map((p) => ({ time: t(p.time), value: p.value })))

    const meanLine = chart.addSeries(LineSeries, { color: '#5b6478', lineWidth: 1, lineStyle: LineStyle.Dashed })
    meanLine.setData(mvrv.history.map((p) => ({ time: t(p.time), value: mvrv.mean })))

    const topLine = chart.addSeries(LineSeries, { color: 'rgba(239,68,68,0.5)', lineWidth: 1, lineStyle: LineStyle.Dotted })
    topLine.setData(mvrv.history.map((p) => ({ time: t(p.time), value: 3.7 })))

    const botLine = chart.addSeries(LineSeries, { color: 'rgba(34,197,94,0.5)', lineWidth: 1, lineStyle: LineStyle.Dotted })
    botLine.setData(mvrv.history.map((p) => ({ time: t(p.time), value: 1.0 })))

    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => { ro.disconnect(); chart.remove() }
  }, [mvrv])

  const interp = `MVRV at ${v.toFixed(2)} vs long-term mean ${mean.toFixed(2)}. ` +
    (v < 1 ? 'Below realized cap — historically a deep value zone.'
    : v < mean * 0.85 ? 'Below long-term average — cheap on this metric.'
    : v < mean * 1.15 ? 'In the long-term fair-value band.'
    : v < 3.7 ? 'Above average — getting rich; not euphoric yet.'
    : 'Above 3.7 — historical euphoria zone, prior cycle tops sit here.')

  return (
    <QCard question="Is BTC overvalued vs its own history?" interpretation={interp}>
      <div className="grid grid-cols-[140px_1fr] gap-4">
        <div className={`flex flex-col items-center justify-center rounded-lg border ${tc.ring} ${tc.bg} p-3`}>
          <span className={`font-mono text-3xl font-semibold ${tc.text}`}>{v.toFixed(2)}</span>
          <span className="text-[10px] uppercase tracking-wider text-dim">MVRV</span>
          <span className="mt-1 text-[10px] text-dim">mean {mean.toFixed(2)}</span>
        </div>
        <div ref={containerRef} className="h-[180px] w-full overflow-hidden rounded-lg border border-border bg-panel-2" />
      </div>
    </QCard>
  )
}

// ── Regime card ───────────────────────────────────────────────────────────────

function RegimeCard({ regime }: { regime: RegimeResult }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const toneByLabel: Record<RegimeLabel, Tone> = {
    Markup: 'gain', Accumulation: 'warn', Distribution: 'warn', Markdown: 'loss',
  }
  const tone = toneByLabel[regime.label]
  const tc = toneClasses[tone]
  const conf = Math.round(regime.confidence * 100)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = makeChart(el)
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    })
    candles.setData(regime.candles.map((c) => ({
      time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close,
    })))
    const e50 = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1 })
    e50.setData(regime.ema50.map((v, i) => v == null
      ? { time: t(regime.candles[i].time), value: NaN }
      : { time: t(regime.candles[i].time), value: v }).filter((p) => Number.isFinite(p.value)))
    const e200 = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 })
    e200.setData(regime.ema200.map((v, i) => v == null
      ? { time: t(regime.candles[i].time), value: NaN }
      : { time: t(regime.candles[i].time), value: v }).filter((p) => Number.isFinite(p.value)))
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => { ro.disconnect(); chart.remove() }
  }, [regime])

  const interpByLabel: Record<RegimeLabel, string> = {
    Markup: 'Trend is up and price is in the upper part of the range — Wyckoff markup phase. Pullbacks into the EMA50 are typical entries.',
    Markdown: 'Trend is down and price is in the lower part of the range — Wyckoff markdown phase. Rallies into EMA50 typically fail.',
    Accumulation: 'Range-bound after weakness with tight volatility — Wyckoff accumulation. Long setups develop as the range narrows.',
    Distribution: 'Range-bound after strength with tight volatility — Wyckoff distribution. Watch for failed breakouts and lower highs.',
  }

  return (
    <QCard
      question="Which Wyckoff phase are we in?"
      interpretation={`${interpByLabel[regime.label]} (${regime.reason})`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className={`rounded-lg border ${tc.ring} ${tc.bg} px-3 py-1.5`}>
            <span className={`text-sm font-semibold ${tc.text}`}>{regime.label}</span>
            <span className={`ml-2 font-mono text-xs ${tc.text}`}>{conf}%</span>
          </div>
          <span className="text-[11px] text-dim">EMA50 (violet) · EMA200 (amber)</span>
        </div>
        <div ref={containerRef} className="h-[200px] w-full overflow-hidden rounded-lg border border-border bg-panel-2" />
      </div>
    </QCard>
  )
}

// ── Funding + OI card ─────────────────────────────────────────────────────────

function FundingOiCard({ funding, oi }: { funding: FundingResult; oi: OiResult }) {
  const fRef = useRef<HTMLDivElement>(null)
  const oRef = useRef<HTMLDivElement>(null)
  const fundingApr = funding.annualizedPct
  const fundingTone: Tone = fundingApr > 30 ? 'loss' : fundingApr > 15 ? 'warn' : fundingApr > -10 ? 'neutral' : 'gain'
  const fundTC = toneClasses[fundingTone]

  useEffect(() => {
    const fel = fRef.current; const oel = oRef.current
    if (!fel || !oel) return
    const fChart = makeChart(fel)
    const fSer = fChart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 })
    fSer.setData(funding.history.map((p) => ({ time: t(p.time), value: p.rate * 100 })))
    fChart.timeScale().fitContent()

    const oChart = makeChart(oel)
    const oSer = oChart.addSeries(AreaSeries, {
      lineColor: 'rgba(96,165,250,0.9)',
      topColor: 'rgba(96,165,250,0.35)', bottomColor: 'rgba(96,165,250,0.02)',
    })
    oSer.setData(oi.history.map((p) => ({ time: t(p.time), value: p.usd / 1e9 })))
    oChart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      fChart.applyOptions({ width: fel.clientWidth, height: fel.clientHeight })
      oChart.applyOptions({ width: oel.clientWidth, height: oel.clientHeight })
    })
    ro.observe(fel); ro.observe(oel)
    return () => { ro.disconnect(); fChart.remove(); oChart.remove() }
  }, [funding, oi])

  const oiNote = oi.pct30d >= 0
    ? `OI is up ${oi.pct30d.toFixed(1)}% over 30 days — more leverage in the system.`
    : `OI is down ${Math.abs(oi.pct30d).toFixed(1)}% over 30 days — deleveraging.`

  const interp =
    (fundingApr > 30 ? 'Funding is hot — longs paying heavily. Crowded long, squeeze risk.'
    : fundingApr > 15 ? 'Funding is warm — bias is long.'
    : fundingApr > -10 ? 'Funding is neutral — no extreme positioning.'
    : 'Funding is negative — shorts paying. Crowded short setups can squeeze higher.') +
    ` ${oiNote}`

  return (
    <QCard question="Is leverage flashing a warning?" interpretation={interp}>
      <div className="grid grid-cols-[160px_1fr] gap-4">
        <div className={`flex flex-col items-center justify-center rounded-lg border ${fundTC.ring} ${fundTC.bg} p-3`}>
          <span className={`font-mono text-2xl font-semibold ${fundTC.text}`}>{fundingApr.toFixed(1)}%</span>
          <span className="text-[10px] uppercase tracking-wider text-dim">Funding (APR)</span>
          <span className="mt-2 font-mono text-base text-text">${(oi.current.usd / 1e9).toFixed(2)}B</span>
          <span className="text-[10px] uppercase tracking-wider text-dim">Open Interest</span>
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-dim mb-1">Funding rate (%)</p>
            <div ref={fRef} className="h-[80px] w-full overflow-hidden rounded-lg border border-border bg-panel-2" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-dim mb-1">Open interest ($B)</p>
            <div ref={oRef} className="h-[80px] w-full overflow-hidden rounded-lg border border-border bg-panel-2" />
          </div>
        </div>
      </div>
    </QCard>
  )
}

// ── Dominance card ────────────────────────────────────────────────────────────

function DominanceCard({ dominance }: { dominance: DominanceResult }) {
  const d = dominance.btcDominance
  const eth = dominance.ethDominance
  const others = Math.max(0, 100 - d - eth)
  const interp =
    d > 60 ? 'BTC season — capital concentrated in BTC. Alts typically underperform.'
    : d > 50 ? 'Mixed regime — BTC leads but alts can run on selective news.'
    : d > 45 ? 'Alts holding ground vs BTC. Watch ETH/BTC for the rotation cue.'
    : 'Alt season — capital is rotating into smaller caps. Higher beta, higher risk.'

  return (
    <QCard
      question="Risk-on or risk-off across crypto?"
      interpretation={`${interp} Total market cap: $${(dominance.totalMarketCapUsd / 1e12).toFixed(2)}T.`}
    >
      <div className="grid grid-cols-[160px_1fr] gap-4">
        <div className="flex flex-col items-center justify-center rounded-lg border border-warn/30 bg-warn/10 p-3">
          <span className="font-mono text-3xl font-semibold text-warn">{d.toFixed(1)}%</span>
          <span className="text-[10px] uppercase tracking-wider text-dim">BTC Dominance</span>
        </div>
        <div className="flex flex-col justify-center gap-3">
          <DominanceBar label="BTC"    pct={d}      color="bg-warn" />
          <DominanceBar label="ETH"    pct={eth}    color="bg-brand" />
          <DominanceBar label="Others" pct={others} color="bg-dim/60" />
        </div>
      </div>
    </QCard>
  )
}

function DominanceBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 text-[11px] text-dim">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
        <div className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="w-12 text-right font-mono text-[11px] tabular-nums text-text">{pct.toFixed(1)}%</span>
    </div>
  )
}

// ── Shared chart factory ──────────────────────────────────────────────────────

function makeChart(el: HTMLElement): IChartApi {
  return createChart(el, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: '#8b93a7',
      fontFamily: "'Inter', system-ui, sans-serif",
    },
    grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
    crosshair: { mode: 1 },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3142' },
    rightPriceScale: { borderColor: '#2a3142' },
    handleScale: false, handleScroll: false,
  })
}
