import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Brain, Minus, RefreshCw } from 'lucide-react'
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

// ─── Server response shapes (mirror bot/src/fundamentals.ts) ─────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const t = (n: number) => n as UTCTimestamp

const toneClasses: Record<Tone, { ring: string; bg: string; text: string; dot: string }> = {
  gain:    { ring: 'border-gain/30',   bg: 'bg-gain/10',   text: 'text-gain',   dot: 'bg-gain'   },
  loss:    { ring: 'border-loss/30',   bg: 'bg-loss/10',   text: 'text-loss',   dot: 'bg-loss'   },
  warn:    { ring: 'border-warn/30',   bg: 'bg-warn/10',   text: 'text-warn',   dot: 'bg-warn'   },
  neutral: { ring: 'border-border',    bg: 'bg-panel-2',   text: 'text-muted',  dot: 'bg-dim'    },
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

// Trend = direction of last value vs the value 7 samples ago (or earliest).
function trend(values: number[]): { dir: 'up' | 'down' | 'flat'; delta: number } {
  if (values.length < 2) return { dir: 'flat', delta: 0 }
  const last = values[values.length - 1]
  const prevIdx = Math.max(0, values.length - 8)
  const prev = values[prevIdx]
  if (!Number.isFinite(prev) || prev === 0) return { dir: 'flat', delta: 0 }
  const delta = last - prev
  const pct = (delta / Math.abs(prev)) * 100
  if (Math.abs(pct) < 1) return { dir: 'flat', delta }
  return { dir: pct > 0 ? 'up' : 'down', delta }
}

// Run a state update inside a View Transition when supported. Falls back to
// an immediate update on browsers that don't support the API (Baseline 2025).
function withViewTransition(fn: () => void): void {
  type DocWithVT = Document & { startViewTransition?: (cb: () => void) => unknown }
  const doc = document as DocWithVT
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(fn)
  } else {
    fn()
  }
}

// ─── Main page ───────────────────────────────────────────────────────────────

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
      withViewTransition(() => {
        setData({ verdict, fng, mvrv, funding, oi, dominance, regime })
        setLastFetch(Date.now())
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden gap-4 px-5 py-5">
      {/* ─── Header ─── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand/30 bg-brand/10">
            <Brain className="h-[18px] w-[18px] text-brand" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text">Fundamentals</h1>
            <p className="text-[11px] text-dim">
              Sentiment · valuation · regime · positioning — institutional view on BTC
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="fund-num font-mono text-[11px] text-dim">
            {lastFetch ? `Updated ${timeAgo(lastFetch)}` : 'Loading…'}
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            aria-label="Refresh fundamentals data"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-xs text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-loss/30 bg-loss/10 p-3 text-xs text-loss">
          {error}
        </div>
      )}

      {!data && !error && <SkeletonGrid />}

      {data && (
        <>
          <VerdictCard verdict={data.verdict} />
          <ChipRow verdict={data.verdict} bundle={data} />
          <section
            aria-label="Fundamentals charts"
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <FngCard fng={data.fng} />
            <MvrvCard mvrv={data.mvrv} />
            <RegimeCard regime={data.regime} />
            <FundingOiCard funding={data.funding} oi={data.oi} />
            <DominanceCard dominance={data.dominance} />
          </section>
        </>
      )}
    </div>
  )
}

// ─── Skeleton (no CLS — reserves the exact card heights) ─────────────────────

function SkeletonGrid() {
  return (
    <div aria-busy="true" aria-label="Loading fundamentals" className="flex flex-col gap-4">
      <div className="h-32 rounded-2xl border border-border bg-panel/60 animate-pulse" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl border border-border bg-panel/60 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[340px] rounded-2xl border border-border bg-panel/60 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

// ─── Verdict card ────────────────────────────────────────────────────────────

function VerdictCard({ verdict }: { verdict: Verdict }) {
  const tone = stanceTone(verdict.stance)
  const tc = toneClasses[tone]
  return (
    <article
      aria-live="polite"
      className={`rounded-2xl border ${tc.ring} ${tc.bg} backdrop-blur-sm p-5 shadow-[0_4px_24px_rgba(0,0,0,.35)]`}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
          Overall Verdict · {verdict.asset}
        </span>
        <span className={`flex items-center gap-2 text-lg font-semibold ${tc.text}`}>
          <span className={`h-2 w-2 rounded-full ${tc.dot}`} aria-hidden="true" />
          {verdict.stance}
        </span>
      </div>
      <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-text/90">{verdict.narrative}</p>
    </article>
  )
}

// ─── Chip row with trend arrows ──────────────────────────────────────────────

function ChipRow({ verdict, bundle }: { verdict: Verdict; bundle: Bundle }) {
  // Compute a trend direction per chip from the corresponding history series.
  const fngTrend = trend(bundle.fng.history.map((p) => p.value))
  const mvrvTrend = trend(bundle.mvrv.history.map((p) => p.value))
  const fundingTrend = trend(bundle.funding.history.map((p) => p.rate))
  const oiTrend = trend(bundle.oi.history.map((p) => p.usd))
  const items: Array<{ label: string; chip: { label: string; tone: Tone }; dir: 'up' | 'down' | 'flat' }> = [
    { label: 'Sentiment', chip: verdict.chips.sentiment, dir: fngTrend.dir },
    { label: 'Valuation', chip: verdict.chips.valuation, dir: mvrvTrend.dir },
    { label: 'Regime',    chip: verdict.chips.regime,    dir: 'flat' },
    { label: 'Leverage',  chip: verdict.chips.leverage,  dir: fundingTrend.dir },
    { label: 'Breadth',   chip: verdict.chips.breadth,   dir: oiTrend.dir },
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {items.map(({ label, chip, dir }) => {
        const tc = toneClasses[chip.tone]
        return (
          <div
            key={label}
            className={`flex flex-col gap-1 rounded-xl border ${tc.ring} ${tc.bg} px-3 py-2`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">
              {label}
            </span>
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${tc.text} fund-num`}>
              <TrendIcon dir={dir} />
              {chip.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TrendIcon({ dir }: { dir: 'up' | 'down' | 'flat' }) {
  // Adds shape redundancy to color tone so the chart is readable colorblind.
  if (dir === 'up')   return <ArrowUp   className="h-3 w-3 shrink-0" aria-label="trend up" />
  if (dir === 'down') return <ArrowDown className="h-3 w-3 shrink-0" aria-label="trend down" />
  return <Minus className="h-3 w-3 shrink-0" aria-label="trend flat" />
}

// ─── Card chrome ─────────────────────────────────────────────────────────────

function QCard({
  question,
  interpretation,
  ariaSummary,
  children,
}: {
  question: string
  interpretation?: string
  ariaSummary?: string
  children: React.ReactNode
}) {
  return (
    <article
      aria-label={ariaSummary ?? question}
      className="fund-card defer-render flex flex-col gap-3 rounded-2xl border border-border bg-panel/85 backdrop-blur-sm p-4 shadow-[0_4px_24px_rgba(0,0,0,.35)] transition-colors hover:border-border-strong/70"
    >
      <h2 className="text-[13px] font-semibold tracking-tight text-text">{question}</h2>
      {children}
      {interpretation && (
        <p className="text-[11px] leading-relaxed text-muted">
          <span className="text-dim">→ </span>{interpretation}
        </p>
      )}
    </article>
  )
}

function StatHeader({
  tone,
  value,
  label,
  hint,
}: {
  tone: Tone
  value: string
  label: string
  hint?: string
}) {
  const tc = toneClasses[tone]
  return (
    <div className="fund-stat-row flex flex-wrap items-center gap-2">
      <div className={`inline-flex items-baseline gap-2 rounded-lg border ${tc.ring} ${tc.bg} px-3 py-1.5`}>
        <span className={`fund-num font-mono text-base font-semibold ${tc.text}`}>{value}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${tc.text}`}>{label}</span>
      </div>
      {hint && <span className="fund-stat-hint text-[10px] text-dim">{hint}</span>}
    </div>
  )
}

// ─── Fear & Greed card ───────────────────────────────────────────────────────

function FngCard({ fng }: { fng: FngResult }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const v = fng.current.value
  const tone: Tone = v <= 25 ? 'loss' : v <= 45 ? 'warn' : v < 55 ? 'neutral' : v < 75 ? 'warn' : 'gain'

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
    return attachReflow(chart, el)
  }, [fng])

  const interp = `${fng.current.label} (${v}/100). ` +
    (v <= 25 ? 'Capitulation zone — contrarian setups historically favorable.'
    : v <= 45 ? 'Crowd is anxious — typically late accumulation territory.'
    : v < 55 ? 'Crowd is balanced.'
    : v < 75 ? 'Optimism is building — watch for froth.'
    : 'Euphoria — historically a risky zone for fresh longs.')

  return (
    <QCard
      question="Is the market greedy or fearful?"
      interpretation={interp}
      ariaSummary={`Fear and greed index at ${v} of 100 — ${fng.current.label}`}
    >
      <StatHeader tone={tone} value={String(v)} label={fng.current.label} hint="1Y history · 0 fear → 100 greed" />
      <div ref={containerRef} className="fund-well h-[220px] w-full overflow-hidden" />
    </QCard>
  )
}

// ─── MVRV card ───────────────────────────────────────────────────────────────

function MvrvCard({ mvrv }: { mvrv: MvrvResult }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const v = mvrv.current.value
  const mean = mvrv.mean
  const tone: Tone = v < 1 ? 'gain' : v < mean * 0.85 ? 'gain' : v < mean * 1.15 ? 'neutral' : v < 3.7 ? 'warn' : 'loss'

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

    return attachReflow(chart, el)
  }, [mvrv])

  const interp = `MVRV at ${v.toFixed(2)} vs long-term mean ${mean.toFixed(2)}. ` +
    (v < 1 ? 'Below realized cap — historically a deep value zone.'
    : v < mean * 0.85 ? 'Below long-term average — cheap on this metric.'
    : v < mean * 1.15 ? 'In the long-term fair-value band.'
    : v < 3.7 ? 'Above average — getting rich; not euphoric yet.'
    : 'Above 3.7 — historical euphoria zone, prior cycle tops sit here.')

  return (
    <QCard
      question="Is BTC overvalued vs its own history?"
      interpretation={interp}
      ariaSummary={`MVRV ratio ${v.toFixed(2)}, long-term mean ${mean.toFixed(2)}`}
    >
      <StatHeader tone={tone} value={v.toFixed(2)} label="MVRV" hint={`mean ${mean.toFixed(2)} · red dotted 3.7 = top zone · green dotted 1.0 = bottom`} />
      <div ref={containerRef} className="fund-well h-[220px] w-full overflow-hidden" />
    </QCard>
  )
}

// ─── Regime card ─────────────────────────────────────────────────────────────

function RegimeCard({ regime }: { regime: RegimeResult }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const toneByLabel: Record<RegimeLabel, Tone> = {
    Markup: 'gain', Accumulation: 'warn', Distribution: 'warn', Markdown: 'loss',
  }
  const tone = toneByLabel[regime.label]
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
    return attachReflow(chart, el)
  }, [regime])

  const interpByLabel: Record<RegimeLabel, string> = {
    Markup: 'Trend is up and price is in the upper part of the range — Wyckoff markup. Pullbacks into EMA50 are typical entries.',
    Markdown: 'Trend is down and price is in the lower part of the range — Wyckoff markdown. Rallies into EMA50 typically fail.',
    Accumulation: 'Range-bound after weakness with tight volatility — Wyckoff accumulation. Long setups develop as the range narrows.',
    Distribution: 'Range-bound after strength with tight volatility — Wyckoff distribution. Watch for failed breakouts and lower highs.',
  }

  return (
    <QCard
      question="Which Wyckoff phase are we in?"
      interpretation={`${interpByLabel[regime.label]} (${regime.reason})`}
      ariaSummary={`Regime ${regime.label} at ${conf} percent confidence`}
    >
      <StatHeader tone={tone} value={regime.label} label={`${conf}% conf`} hint="candles · EMA50 (violet) · EMA200 (amber)" />
      <div ref={containerRef} className="fund-well h-[240px] w-full overflow-hidden" />
    </QCard>
  )
}

// ─── Funding + OI card ───────────────────────────────────────────────────────

function FundingOiCard({ funding, oi }: { funding: FundingResult; oi: OiResult }) {
  const fRef = useRef<HTMLDivElement>(null)
  const oRef = useRef<HTMLDivElement>(null)
  const fundingApr = funding.annualizedPct
  const fundingTone: Tone =
    fundingApr > 30 ? 'loss' : fundingApr > 15 ? 'warn' : fundingApr > -10 ? 'neutral' : 'gain'
  const fundTC = toneClasses[fundingTone]

  useEffect(() => {
    const fel = fRef.current; const oel = oRef.current
    if (!fel || !oel) return
    const fChart = makeChart(fel)
    const fSer = fChart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 })
    fSer.setData(funding.history.map((p) => ({ time: t(p.time), value: p.rate * 100 })))

    const oChart = makeChart(oel)
    const oSer = oChart.addSeries(AreaSeries, {
      lineColor: 'rgba(96,165,250,0.9)',
      topColor: 'rgba(96,165,250,0.35)', bottomColor: 'rgba(96,165,250,0.02)',
    })
    oSer.setData(oi.history.map((p) => ({ time: t(p.time), value: p.usd / 1e9 })))

    const cleanupF = attachReflow(fChart, fel)
    const cleanupO = attachReflow(oChart, oel)
    return () => { cleanupF(); cleanupO() }
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
    <QCard
      question="Is leverage flashing a warning?"
      interpretation={interp}
      ariaSummary={`Funding rate ${fundingApr.toFixed(1)} percent annualized, open interest ${(oi.current.usd / 1e9).toFixed(2)} billion dollars`}
    >
      <div className="fund-stat-row flex flex-wrap items-center gap-2">
        <div className={`inline-flex items-baseline gap-2 rounded-lg border ${fundTC.ring} ${fundTC.bg} px-3 py-1.5`}>
          <span className={`fund-num font-mono text-base font-semibold ${fundTC.text}`}>{fundingApr.toFixed(1)}%</span>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${fundTC.text}`}>Funding APR</span>
        </div>
        <div className="inline-flex items-baseline gap-2 rounded-lg border border-border bg-panel-2 px-3 py-1.5">
          <span className="fund-num font-mono text-base font-semibold text-text">${(oi.current.usd / 1e9).toFixed(2)}B</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Open Interest</span>
        </div>
        <span className="fund-stat-hint text-[10px] text-dim">80 days · 30d OI</span>
      </div>
      <div>
        <p className="mb-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Funding rate (% per 8h)</p>
        <div ref={fRef} className="fund-well h-[100px] w-full overflow-hidden" />
      </div>
      <div>
        <p className="mb-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Open interest ($B)</p>
        <div ref={oRef} className="fund-well h-[100px] w-full overflow-hidden" />
      </div>
    </QCard>
  )
}

// ─── Dominance card ──────────────────────────────────────────────────────────

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
      ariaSummary={`BTC dominance at ${d.toFixed(1)} percent`}
    >
      <StatHeader tone="warn" value={`${d.toFixed(1)}%`} label="BTC Dominance" hint="composition of total crypto market cap" />
      <div className="fund-well flex flex-col gap-3 p-4">
        <DominanceBar label="BTC"    pct={d}      color="bg-warn"   />
        <DominanceBar label="ETH"    pct={eth}    color="bg-brand"  />
        <DominanceBar label="Others" pct={others} color="bg-dim/60" />
      </div>
    </QCard>
  )
}

function DominanceBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 text-[11px] font-semibold uppercase tracking-wider text-dim">{label}</span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`${label} share of total market cap`}
        className="relative h-2 flex-1 overflow-hidden rounded-full bg-panel-2"
      >
        <div className={`absolute inset-y-0 left-0 ${color} transition-[width] duration-500`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="fund-num w-14 text-right font-mono text-[11px] text-text">{pct.toFixed(1)}%</span>
    </div>
  )
}

// ─── Shared chart factory ────────────────────────────────────────────────────

function makeChart(el: HTMLElement): IChartApi {
  const chart = createChart(el, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: '#8b93a7',
      fontFamily: "'Inter', system-ui, sans-serif",
    },
    grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
    crosshair: { mode: 1 },
    // rightOffset 0 = data hugs the right edge instead of leaving 10 bars of blank space.
    // fixLeftEdge keeps the first bar pinned so the series stretches edge-to-edge.
    timeScale: {
      timeVisible: true, secondsVisible: false, borderColor: '#2a3142',
      rightOffset: 0, barSpacing: 3, fixLeftEdge: true, fixRightEdge: true,
    },
    rightPriceScale: { borderColor: '#2a3142', scaleMargins: { top: 0.1, bottom: 0.1 } },
    handleScale: false, handleScroll: false,
  })
  return chart
}

// Re-fit on every container resize. autoSize handles the canvas, but fitContent
// must be re-applied or the time scale stays at whatever it computed at 0×0.
function attachReflow(chart: IChartApi, el: HTMLElement): () => void {
  chart.timeScale().fitContent()
  const ro = new ResizeObserver(() => {
    if (el.clientWidth > 0) chart.timeScale().fitContent()
  })
  ro.observe(el)
  return () => { ro.disconnect(); chart.remove() }
}
