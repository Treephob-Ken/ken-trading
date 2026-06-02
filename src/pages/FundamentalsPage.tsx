import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Brain, Maximize2, Minus, RefreshCw, X } from 'lucide-react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { apiFetch } from '@/contexts/AuthContext'
import PageHeader from '@/components/ui/PageHeader'

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

type VolZone = 'Calm' | 'Normal' | 'Elevated' | 'Extreme'
interface VolPoint { time: number; rv7: number | null; rv30: number | null; atrPct: number | null }
interface VolResult {
  current: { rv7: number; rv30: number; atrPct: number; zone: VolZone }
  history: VolPoint[]
}

type MayerZone = 'Cheap' | 'Fair' | 'Hot' | 'Cycle Top'
interface CyclePoint {
  time: number; close: number
  ma200: number | null; ma111x2: number | null; ma350: number | null; mayer: number | null
}
interface CycleResult {
  current: { mayer: number; zone: MayerZone; ma200: number; ma111x2: number; ma350: number; piGapPct: number }
  history: CyclePoint[]
}

interface LSPoint { time: number; ratio: number }
interface PremiumPoint { time: number; pct: number }
interface SmartMoneyResult {
  longShort: { current: number; history: LSPoint[] }
  premium: { current: number; history: PremiumPoint[] }
}

interface Bundle {
  verdict: Verdict
  fng: FngResult
  mvrv: MvrvResult
  funding: FundingResult
  oi: OiResult
  dominance: DominanceResult
  regime: RegimeResult
  volatility: VolResult
  cycle: CycleResult
  smartMoney: SmartMoneyResult
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
      const endpoints = [
        'verdict', 'fear-greed', 'mvrv', 'funding', 'oi', 'dominance',
        'regime?asset=BTC&tf=1d', 'volatility', 'cycle', 'smart-money',
      ]
      const results = await Promise.all(
        endpoints.map((e) => apiFetch(`/api/fundamentals/${e}`).then(async (r) => {
          if (!r.ok) throw new Error(`${e}: ${(await r.json().catch(() => ({})) as { error?: string }).error ?? r.status}`)
          return r.json()
        })),
      )
      const [verdict, fng, mvrv, funding, oi, dominance, regime, volatility, cycle, smartMoney] = results as [
        Verdict, FngResult, MvrvResult, FundingResult, OiResult, DominanceResult, RegimeResult,
        VolResult, CycleResult, SmartMoneyResult,
      ]
      withViewTransition(() => {
        setData({ verdict, fng, mvrv, funding, oi, dominance, regime, volatility, cycle, smartMoney })
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
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden gap-4 px-3 py-4 sm:px-6 sm:py-5">
      {/* ─── Header ─── */}
      <PageHeader
        icon={Brain}
        title="Fundamentals"
        subtitle="Sentiment · valuation · regime · positioning — institutional view on BTC"
        actions={
          <>
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
          </>
        }
      />

      {error && (
        <div role="alert" className="rounded-xl border border-loss/30 bg-loss/10 p-3 text-xs text-loss">
          {error}
        </div>
      )}

      {!data && !error && <SkeletonGrid />}

      {data && (
        <>
          <SummaryCard bundle={data} />
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
            <VolatilityCard vol={data.volatility} />
            <CycleCard cycle={data.cycle} />
            <SmartMoneyCard sm={data.smartMoney} />
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
      <div className="h-[420px] rounded-2xl border border-border bg-panel/60 animate-pulse" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl border border-border bg-panel/60 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[340px] rounded-2xl border border-border bg-panel/60 animate-pulse" />
        ))}
      </div>
    </div>
  )
}

// ─── Summary card (7-step framework, replaces old VerdictCard) ───────────────
// Mirrors the "สูตร 7-step" reading order from docs/USER_GUIDE.md §10 so the
// whole macro picture is visible above the fold. Each row's tone uses the same
// thresholds as its matching detail card; rows scroll to those cards on click.

type StepTone = Tone

interface SummaryStep {
  n: number
  name: string
  reading: string
  tone: StepTone
  target: string | null
}

function combineTones(...tones: Tone[]): Tone {
  if (tones.some((t) => t === 'loss')) return 'loss'
  if (tones.some((t) => t === 'warn')) return 'warn'
  if (tones.every((t) => t === 'gain')) return 'gain'
  return 'neutral'
}

function openCard(id: string): void {
  window.dispatchEvent(new CustomEvent<string>('open-fund-modal', { detail: id }))
}

function SummaryCard({ bundle }: { bundle: Bundle }) {
  const { verdict, fng, mvrv, regime, funding, oi, dominance, volatility, cycle, smartMoney } = bundle
  const sTone = stanceTone(verdict.stance)
  const sTC = toneClasses[sTone]

  // Per-reading tones — duplicated locally from each detail card so the source
  // of truth stays adjacent to its display. Edits to a card's tone rule should
  // also update the matching block here.
  const fngV = fng.current.value
  const fngTone: Tone = fngV <= 25 ? 'loss' : fngV <= 45 ? 'warn' : fngV < 55 ? 'neutral' : fngV < 75 ? 'warn' : 'gain'

  const mvrvV = mvrv.current.value
  const mvrvMean = mvrv.mean
  const mvrvTone: Tone =
    mvrvV < 1 ? 'gain'
    : mvrvV < mvrvMean * 0.85 ? 'gain'
    : mvrvV < mvrvMean * 1.15 ? 'neutral'
    : mvrvV < 3.7 ? 'warn'
    : 'loss'
  const mvrvZone =
    mvrvV < 1 ? 'Deep value'
    : mvrvV < mvrvMean * 0.85 ? 'Cheap'
    : mvrvV < mvrvMean * 1.15 ? 'Fair'
    : mvrvV < 3.7 ? 'Rich'
    : 'Euphoric'

  const regimeTones: Record<RegimeLabel, Tone> = {
    Markup: 'gain', Accumulation: 'warn', Distribution: 'warn', Markdown: 'loss',
  }
  const regimeTone = regimeTones[regime.label]

  const fundingApr = funding.annualizedPct
  const fundingTone: Tone =
    fundingApr > 30 ? 'loss' : fundingApr > 15 ? 'warn' : fundingApr > -10 ? 'neutral' : 'gain'
  const oiTone: Tone = Math.abs(oi.pct30d) > 20 ? 'warn' : 'neutral'

  const volTones: Record<VolZone, Tone> = {
    Calm: 'gain', Normal: 'neutral', Elevated: 'warn', Extreme: 'loss',
  }
  const volTone = volTones[volatility.current.zone]

  const mayerTones: Record<MayerZone, Tone> = {
    Cheap: 'gain', Fair: 'neutral', Hot: 'warn', 'Cycle Top': 'loss',
  }
  const mayerTone = mayerTones[cycle.current.zone]
  const piTone: Tone = cycle.current.piGapPct >= 0 ? 'loss' : cycle.current.piGapPct > -10 ? 'warn' : 'neutral'

  const lsV = smartMoney.longShort.current
  const lsTone: Tone =
    lsV > 1.6 ? 'loss' : lsV > 1.2 ? 'warn' : lsV > 0.8 ? 'neutral' : 'gain'
  const prV = smartMoney.premium.current
  const prTone: Tone =
    prV > 0.05 ? 'gain' : prV > -0.05 ? 'neutral' : prV > -0.15 ? 'warn' : 'loss'

  // Dominance is informational for BTC bias, but the guide counts it in the
  // 11-indicator confidence rule — extreme alt-season or BTC-season = warn.
  const domTone: Tone = dominance.btcDominance > 60 || dominance.btcDominance < 45 ? 'warn' : 'neutral'

  const steps: SummaryStep[] = [
    {
      n: 1,
      name: 'Verdict + Stance',
      reading: verdict.stance,
      tone: sTone,
      target: null,
    },
    {
      n: 2,
      name: 'Macro Cycle (Mayer + Pi)',
      reading: `Mayer ${cycle.current.mayer.toFixed(2)} (${cycle.current.zone}) · Pi ${cycle.current.piGapPct >= 0 ? '+' : ''}${cycle.current.piGapPct.toFixed(1)}%`,
      tone: combineTones(mayerTone, piTone),
      target: 'fund-cycle',
    },
    {
      n: 3,
      name: 'Sentiment + Valuation',
      reading: `F&G ${fngV} ${fng.current.label} · MVRV ${mvrvV.toFixed(2)} ${mvrvZone}`,
      tone: combineTones(fngTone, mvrvTone),
      target: 'fund-fng',
    },
    {
      n: 4,
      name: 'Regime (Wyckoff)',
      reading: `${regime.label} · ${Math.round(regime.confidence * 100)}% conf`,
      tone: regimeTone,
      target: 'fund-regime',
    },
    {
      n: 5,
      name: 'Leverage (Funding + OI)',
      reading: `Funding ${fundingApr.toFixed(1)}% APR · OI ${oi.pct30d >= 0 ? '+' : ''}${oi.pct30d.toFixed(1)}%/30d`,
      tone: combineTones(fundingTone, oiTone),
      target: 'fund-leverage',
    },
    {
      n: 6,
      name: 'Volatility',
      reading: `30D RV ${volatility.current.rv30.toFixed(1)}% · ${volatility.current.zone}`,
      tone: volTone,
      target: 'fund-vol',
    },
    {
      n: 7,
      name: 'Smart Money',
      reading: `L/S ${lsV.toFixed(2)} · CB ${prV >= 0 ? '+' : ''}${prV.toFixed(2)}%`,
      tone: combineTones(lsTone, prTone),
      target: 'fund-smartmoney',
    },
  ]

  // Decision rule from USER_GUIDE.md: count all 11 sub-readings for confidence.
  const allTones: Tone[] = [
    mayerTone, piTone, fngTone, mvrvTone, regimeTone,
    fundingTone, oiTone, domTone, volTone, lsTone, prTone,
  ]
  const bullish = allTones.filter((t) => t === 'gain').length
  const bearish = allTones.filter((t) => t === 'loss').length
  const neutralCt = allTones.length - bullish - bearish
  const highConf: 'bullish' | 'bearish' | null =
    bullish >= 6 ? 'bullish' : bearish >= 6 ? 'bearish' : null

  return (
    <article
      aria-live="polite"
      className={`rounded-2xl border ${sTC.ring} ${sTC.bg} backdrop-blur-sm p-5 shadow-[0_4px_24px_rgba(0,0,0,.35)]`}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
          Overall Summary · {verdict.asset}
        </span>
        <span className={`flex items-center gap-2 text-lg font-semibold ${sTC.text}`}>
          <span className={`h-2 w-2 rounded-full ${sTC.dot}`} aria-hidden="true" />
          {verdict.stance}
        </span>
      </div>

      <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-text/90">{verdict.narrative}</p>

      <div className="mt-4 border-t border-border/60" />

      <ol className="mt-3 flex flex-col gap-1">
        {steps.map((step) => {
          const tc = toneClasses[step.tone]
          const isClickable = step.target !== null
          const rowContent = (
            <>
              <span className="w-5 shrink-0 text-[10px] font-semibold text-dim">{step.n}.</span>
              <span className="w-44 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {step.name}
              </span>
              <span className="fund-num flex-1 truncate font-mono text-[12px] text-text/90">
                {step.reading}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border ${tc.ring} ${tc.bg} px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tc.text}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${tc.dot}`} aria-hidden="true" />
                {step.tone === 'gain' ? 'bullish' : step.tone === 'loss' ? 'bearish' : step.tone === 'warn' ? 'caution' : 'neutral'}
              </span>
            </>
          )
          return isClickable ? (
            <li key={step.n}>
              <button
                type="button"
                onClick={() => openCard(step.target as string)}
                aria-label={`${step.name}: ${step.reading}. Open detail chart.`}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border-strong/60 hover:bg-panel/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                {rowContent}
              </button>
            </li>
          ) : (
            <li key={step.n} className="flex items-center gap-3 px-2 py-1.5">
              {rowContent}
            </li>
          )
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-[11px]">
        <span className="text-dim">Score:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-gain" aria-hidden="true" />
          <span className="fund-num font-mono text-gain">{bullish}</span>
          <span className="text-muted">bullish</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-dim" aria-hidden="true" />
          <span className="fund-num font-mono text-muted">{neutralCt}</span>
          <span className="text-muted">neutral</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-loss" aria-hidden="true" />
          <span className="fund-num font-mono text-loss">{bearish}</span>
          <span className="text-muted">bearish</span>
        </span>
        {highConf && (
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              highConf === 'bullish' ? 'border-gain/30 bg-gain/10 text-gain' : 'border-loss/30 bg-loss/10 text-loss'
            }`}
          >
            High-confidence {highConf} (≥6/11)
          </span>
        )}
      </div>
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

// ─── Chart tooltip helper ────────────────────────────────────────────────────
// Creates an absolutely-positioned tooltip div inside the chart container and
// wires it to the chart's crosshair-move event. The caller supplies a formatter
// that receives the latest MouseEventParams and returns the tooltip's innerHTML
// (or null to hide). The returned cleanup detaches the subscription + node.

interface CrosshairSubscribe {
  (handler: (param: MouseEventParams<Time>) => void): void
  (handler: null): void
}

function attachTooltip(
  el: HTMLElement,
  chart: IChartApi,
  formatter: (param: MouseEventParams<Time>) => string | null,
): () => void {
  const tip = document.createElement('div')
  tip.className = 'chart-tooltip'
  el.appendChild(tip)
  const handler = (param: MouseEventParams<Time>) => {
    if (!param.time || !param.point) {
      tip.classList.remove('active')
      return
    }
    const html = formatter(param)
    if (!html) {
      tip.classList.remove('active')
      return
    }
    tip.innerHTML = html
    tip.classList.add('active')
  }
  ;(chart.subscribeCrosshairMove as unknown as CrosshairSubscribe)(handler)
  return () => {
    ;(chart.unsubscribeCrosshairMove as unknown as CrosshairSubscribe)(handler)
    tip.remove()
  }
}

function tipRow(label: string, value: string, swatch?: string): string {
  const dot = swatch ? `<span class="chart-tooltip-swatch" style="background:${swatch}"></span>` : ''
  return `<div class="chart-tooltip-row"><span class="chart-tooltip-label">${dot}${label}</span><span class="chart-tooltip-value">${value}</span></div>`
}

function fmtDate(t: number): string {
  const d = new Date(t * 1000)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
function fmtDateTime(t: number): string {
  const d = new Date(t * 1000)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtUsd(v: number): string {
  return v >= 1000 ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${v.toFixed(2)}`
}
function nearest<T extends { time: number }>(arr: T[], time: number): T | null {
  // Binary search by .time (ascending)
  if (arr.length === 0) return null
  let lo = 0, hi = arr.length - 1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (arr[m].time === time) return arr[m]
    if (arr[m].time < time) lo = m + 1
    else hi = m - 1
  }
  // Pick closer of lo/hi
  const a = arr[Math.max(0, hi)]
  const b = arr[Math.min(arr.length - 1, lo)]
  if (!a) return b
  if (!b) return a
  return Math.abs(a.time - time) <= Math.abs(b.time - time) ? a : b
}

// ─── ExpandableQCard ─────────────────────────────────────────────────────────
// One card chrome with an inline chart + a maximize button that opens a
// <dialog> rendering the SAME chart (via the same setup fn) at 70vh. Uses
// the native <dialog> element — ESC + backdrop click close it for free.

interface ExpandableProps {
  question: string
  interpretation?: string
  ariaSummary?: string
  statHeader: React.ReactNode
  setupChart: (el: HTMLElement) => () => void
  inlineHeight: number
  anchorId?: string
}

function ExpandableQCard({
  question,
  interpretation,
  ariaSummary,
  statHeader,
  setupChart,
  inlineHeight,
  anchorId,
}: ExpandableProps) {
  const inlineRef = useRef<HTMLDivElement>(null)
  const modalChartRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!inlineRef.current) return
    return setupChart(inlineRef.current)
  }, [setupChart])

  useEffect(() => {
    if (!open || !modalChartRef.current) return
    return setupChart(modalChartRef.current)
  }, [open, setupChart])

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // Summary card dispatches `open-fund-modal` with the card's anchorId to
  // pop this card's existing modal open from outside.
  useEffect(() => {
    if (!anchorId) return
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail === anchorId) setOpen(true)
    }
    window.addEventListener('open-fund-modal', handler)
    return () => window.removeEventListener('open-fund-modal', handler)
  }, [anchorId])

  return (
    <>
      <article
        id={anchorId}
        aria-label={ariaSummary ?? question}
        className="fund-card defer-render flex flex-col gap-3 rounded-2xl border border-border bg-panel/85 backdrop-blur-sm p-4 shadow-[0_4px_24px_rgba(0,0,0,.35)] transition-colors hover:border-border-strong/70 scroll-mt-4"
      >
        <h2 className="text-[13px] font-semibold tracking-tight text-text">{question}</h2>
        {statHeader}
        <div className="relative">
          <div ref={inlineRef} className="fund-well w-full overflow-hidden" style={{ height: inlineHeight }} />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Expand chart"
            className="chart-expand-btn"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {interpretation && (
          <p className="text-[11px] leading-relaxed text-muted">
            <span className="text-dim">→ </span>{interpretation}
          </p>
        )}
      </article>

      <dialog
        ref={dialogRef}
        className="chart-modal"
        aria-label={question}
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === dialogRef.current) setOpen(false) }}
      >
        <div className="flex flex-col gap-4 p-5">
          <header className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-text">{question}</h2>
              {statHeader}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="chart-expand-btn !relative !top-0 !right-0"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>
          {open && (
            <div ref={modalChartRef} className="fund-well w-full overflow-hidden" style={{ height: '70vh' }} />
          )}
          {interpretation && (
            <p className="text-xs leading-relaxed text-muted">
              <span className="text-dim">→ </span>{interpretation}
            </p>
          )}
        </div>
      </dialog>
    </>
  )
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
  const v = fng.current.value
  const tone: Tone = v <= 25 ? 'loss' : v <= 45 ? 'warn' : v < 55 ? 'neutral' : v < 75 ? 'warn' : 'gain'

  const setupChart = useCallback((el: HTMLElement) => {
    const chart = makeChart(el)
    const series = chart.addSeries(AreaSeries, {
      lineColor: 'rgba(167,139,250,0.9)',
      topColor: 'rgba(167,139,250,0.35)', bottomColor: 'rgba(167,139,250,0.02)',
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    })
    series.setData(fng.history.map((p) => ({ time: t(p.time), value: p.value })))
    const detachTip = attachTooltip(el, chart, (param) => {
      const time = Number(param.time)
      const p = nearest(fng.history, time)
      if (!p) return null
      return tipRow('Date', fmtDate(p.time)) +
             tipRow('F&G',  String(p.value), '#a78bfa') +
             tipRow('Mood', p.label)
    })
    const detachReflow = attachReflow(chart, el)
    return () => { detachTip(); detachReflow() }
  }, [fng])

  const interp = `${fng.current.label} (${v}/100). ` +
    (v <= 25 ? 'Capitulation zone — contrarian setups historically favorable.'
    : v <= 45 ? 'Crowd is anxious — typically late accumulation territory.'
    : v < 55 ? 'Crowd is balanced.'
    : v < 75 ? 'Optimism is building — watch for froth.'
    : 'Euphoria — historically a risky zone for fresh longs.')

  return (
    <ExpandableQCard
      question="Is the market greedy or fearful?"
      interpretation={interp}
      ariaSummary={`Fear and greed index at ${v} of 100 — ${fng.current.label}`}
      statHeader={<StatHeader tone={tone} value={String(v)} label={fng.current.label} hint="1Y history · 0 fear → 100 greed" />}
      setupChart={setupChart}
      inlineHeight={220}
      anchorId="fund-fng"
    />
  )
}

// ─── MVRV card ───────────────────────────────────────────────────────────────

function MvrvCard({ mvrv }: { mvrv: MvrvResult }) {
  const v = mvrv.current.value
  const mean = mvrv.mean
  const tone: Tone = v < 1 ? 'gain' : v < mean * 0.85 ? 'gain' : v < mean * 1.15 ? 'neutral' : v < 3.7 ? 'warn' : 'loss'

  const setupChart = useCallback((el: HTMLElement) => {
    const chart = makeChart(el)
    const series = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 2 })
    series.setData(mvrv.history.map((p) => ({ time: t(p.time), value: p.value })))
    const meanLine = chart.addSeries(LineSeries, { color: '#5b6478', lineWidth: 1, lineStyle: LineStyle.Dashed })
    meanLine.setData(mvrv.history.map((p) => ({ time: t(p.time), value: mvrv.mean })))
    const topLine = chart.addSeries(LineSeries, { color: 'rgba(239,68,68,0.5)', lineWidth: 1, lineStyle: LineStyle.Dotted })
    topLine.setData(mvrv.history.map((p) => ({ time: t(p.time), value: 3.7 })))
    const botLine = chart.addSeries(LineSeries, { color: 'rgba(34,197,94,0.5)', lineWidth: 1, lineStyle: LineStyle.Dotted })
    botLine.setData(mvrv.history.map((p) => ({ time: t(p.time), value: 1.0 })))

    const detachTip = attachTooltip(el, chart, (param) => {
      const time = Number(param.time)
      const p = nearest(mvrv.history, time)
      if (!p) return null
      const diff = p.value - mvrv.mean
      const zone = p.value < 1 ? 'Deep value'
        : p.value < mvrv.mean * 0.85 ? 'Cheap'
        : p.value < mvrv.mean * 1.15 ? 'Fair'
        : p.value < 3.7 ? 'Rich' : 'Euphoric'
      return tipRow('Date', fmtDate(p.time)) +
             tipRow('MVRV', p.value.toFixed(3), '#a78bfa') +
             tipRow('vs mean', `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`) +
             tipRow('Zone', zone)
    })
    const detachReflow = attachReflow(chart, el)
    return () => { detachTip(); detachReflow() }
  }, [mvrv])

  const interp = `MVRV at ${v.toFixed(2)} vs long-term mean ${mean.toFixed(2)}. ` +
    (v < 1 ? 'Below realized cap — historically a deep value zone.'
    : v < mean * 0.85 ? 'Below long-term average — cheap on this metric.'
    : v < mean * 1.15 ? 'In the long-term fair-value band.'
    : v < 3.7 ? 'Above average — getting rich; not euphoric yet.'
    : 'Above 3.7 — historical euphoria zone, prior cycle tops sit here.')

  return (
    <ExpandableQCard
      question="Is BTC overvalued vs its own history?"
      interpretation={interp}
      ariaSummary={`MVRV ratio ${v.toFixed(2)}, long-term mean ${mean.toFixed(2)}`}
      statHeader={<StatHeader tone={tone} value={v.toFixed(2)} label="MVRV" hint={`mean ${mean.toFixed(2)} · red dotted 3.7 = top · green dotted 1.0 = bottom`} />}
      setupChart={setupChart}
      inlineHeight={220}
      anchorId="fund-mvrv"
    />
  )
}

// ─── Regime card ─────────────────────────────────────────────────────────────

function RegimeCard({ regime }: { regime: RegimeResult }) {
  const toneByLabel: Record<RegimeLabel, Tone> = {
    Markup: 'gain', Accumulation: 'warn', Distribution: 'warn', Markdown: 'loss',
  }
  const tone = toneByLabel[regime.label]
  const conf = Math.round(regime.confidence * 100)

  const setupChart = useCallback((el: HTMLElement) => {
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

    const detachTip = attachTooltip(el, chart, (param) => {
      const time = Number(param.time)
      const idx = regime.candles.findIndex((c) => c.time === time)
      const i = idx >= 0 ? idx : regime.candles.findIndex((c) => c.time >= time)
      if (i < 0) return null
      const c = regime.candles[i]
      const e50v = regime.ema50[i]
      const e200v = regime.ema200[i]
      const dir = c.close >= c.open ? 'up' : 'down'
      return tipRow('Date', fmtDate(c.time)) +
             tipRow('Open',  fmtUsd(c.open)) +
             tipRow('High',  fmtUsd(c.high)) +
             tipRow('Low',   fmtUsd(c.low)) +
             tipRow('Close', fmtUsd(c.close), dir === 'up' ? '#10b981' : '#ef4444') +
             (e50v != null  ? tipRow('EMA50',  fmtUsd(e50v),  '#a78bfa') : '') +
             (e200v != null ? tipRow('EMA200', fmtUsd(e200v), '#f59e0b') : '')
    })
    const detachReflow = attachReflow(chart, el)
    return () => { detachTip(); detachReflow() }
  }, [regime])

  const interpByLabel: Record<RegimeLabel, string> = {
    Markup: 'Trend is up and price is in the upper part of the range — Wyckoff markup. Pullbacks into EMA50 are typical entries.',
    Markdown: 'Trend is down and price is in the lower part of the range — Wyckoff markdown. Rallies into EMA50 typically fail.',
    Accumulation: 'Range-bound after weakness with tight volatility — Wyckoff accumulation. Long setups develop as the range narrows.',
    Distribution: 'Range-bound after strength with tight volatility — Wyckoff distribution. Watch for failed breakouts and lower highs.',
  }

  return (
    <ExpandableQCard
      question="Which Wyckoff phase are we in?"
      interpretation={`${interpByLabel[regime.label]} (${regime.reason})`}
      ariaSummary={`Regime ${regime.label} at ${conf} percent confidence`}
      statHeader={<StatHeader tone={tone} value={regime.label} label={`${conf}% conf`} hint="candles · EMA50 (violet) · EMA200 (amber)" />}
      setupChart={setupChart}
      inlineHeight={240}
      anchorId="fund-regime"
    />
  )
}

// ─── Funding + OI card ───────────────────────────────────────────────────────

function FundingOiCard({ funding, oi }: { funding: FundingResult; oi: OiResult }) {
  const inlineFRef = useRef<HTMLDivElement>(null)
  const inlineORef = useRef<HTMLDivElement>(null)
  const modalFRef = useRef<HTMLDivElement>(null)
  const modalORef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const fundingApr = funding.annualizedPct
  const fundingTone: Tone =
    fundingApr > 30 ? 'loss' : fundingApr > 15 ? 'warn' : fundingApr > -10 ? 'neutral' : 'gain'
  const fundTC = toneClasses[fundingTone]

  const setupFunding = useCallback((el: HTMLElement) => {
    const chart = makeChart(el)
    const series = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 })
    series.setData(funding.history.map((p) => ({ time: t(p.time), value: p.rate * 100 })))
    const detachTip = attachTooltip(el, chart, (param) => {
      const time = Number(param.time)
      const p = nearest(funding.history, time)
      if (!p) return null
      const ratePct = p.rate * 100
      const apr = p.rate * 1095 * 100
      return tipRow('Time', fmtDateTime(p.time)) +
             tipRow('Rate', `${ratePct.toFixed(4)}% / 8h`, '#f59e0b') +
             tipRow('APR',  `${apr.toFixed(1)}%`)
    })
    const detachReflow = attachReflow(chart, el)
    return () => { detachTip(); detachReflow() }
  }, [funding])

  const setupOi = useCallback((el: HTMLElement) => {
    const chart = makeChart(el)
    const series = chart.addSeries(AreaSeries, {
      lineColor: 'rgba(96,165,250,0.9)',
      topColor: 'rgba(96,165,250,0.35)', bottomColor: 'rgba(96,165,250,0.02)',
    })
    series.setData(oi.history.map((p) => ({ time: t(p.time), value: p.usd / 1e9 })))
    const detachTip = attachTooltip(el, chart, (param) => {
      const time = Number(param.time)
      const idx = oi.history.findIndex((p) => p.time === time)
      const i = idx >= 0 ? idx : oi.history.findIndex((p) => p.time >= time)
      if (i < 0) return null
      const p = oi.history[i]
      const prev = i > 0 ? oi.history[i - 1] : null
      const delta = prev ? ((p.usd - prev.usd) / prev.usd) * 100 : 0
      return tipRow('Time', fmtDateTime(p.time)) +
             tipRow('OI',   `$${(p.usd / 1e9).toFixed(2)}B`, '#60a5fa') +
             (prev ? tipRow('Δ vs prev', `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`) : '')
    })
    const detachReflow = attachReflow(chart, el)
    return () => { detachTip(); detachReflow() }
  }, [oi])

  useEffect(() => { if (inlineFRef.current) return setupFunding(inlineFRef.current) }, [setupFunding])
  useEffect(() => { if (inlineORef.current) return setupOi(inlineORef.current) }, [setupOi])
  useEffect(() => { if (open && modalFRef.current) return setupFunding(modalFRef.current) }, [open, setupFunding])
  useEffect(() => { if (open && modalORef.current) return setupOi(modalORef.current) }, [open, setupOi])
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail === 'fund-leverage') setOpen(true)
    }
    window.addEventListener('open-fund-modal', handler)
    return () => window.removeEventListener('open-fund-modal', handler)
  }, [])

  const oiNote = oi.pct30d >= 0
    ? `OI is up ${oi.pct30d.toFixed(1)}% over 30 days — more leverage in the system.`
    : `OI is down ${Math.abs(oi.pct30d).toFixed(1)}% over 30 days — deleveraging.`

  const interp =
    (fundingApr > 30 ? 'Funding is hot — longs paying heavily. Crowded long, squeeze risk.'
    : fundingApr > 15 ? 'Funding is warm — bias is long.'
    : fundingApr > -10 ? 'Funding is neutral — no extreme positioning.'
    : 'Funding is negative — shorts paying. Crowded short setups can squeeze higher.') +
    ` ${oiNote}`

  const statHeader = (
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
  )

  return (
    <>
      <article
        id="fund-leverage"
        aria-label={`Funding rate ${fundingApr.toFixed(1)} percent annualized, open interest ${(oi.current.usd / 1e9).toFixed(2)} billion dollars`}
        className="fund-card defer-render flex flex-col gap-3 rounded-2xl border border-border bg-panel/85 backdrop-blur-sm p-4 shadow-[0_4px_24px_rgba(0,0,0,.35)] transition-colors hover:border-border-strong/70 scroll-mt-4"
      >
        <h2 className="text-[13px] font-semibold tracking-tight text-text">Is leverage flashing a warning?</h2>
        {statHeader}
        <div className="relative">
          <p className="mb-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Funding rate (% per 8h)</p>
          <div ref={inlineFRef} className="fund-well h-[100px] w-full overflow-hidden" />
          <button type="button" onClick={() => setOpen(true)} aria-label="Expand charts" className="chart-expand-btn" style={{ top: 22 }}>
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div>
          <p className="mb-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Open interest ($B)</p>
          <div ref={inlineORef} className="fund-well h-[100px] w-full overflow-hidden" />
        </div>
        <p className="text-[11px] leading-relaxed text-muted"><span className="text-dim">→ </span>{interp}</p>
      </article>

      <dialog ref={dialogRef} className="chart-modal" aria-label="Leverage detail" onClose={() => setOpen(false)} onClick={(e) => { if (e.target === dialogRef.current) setOpen(false) }}>
        <div className="flex flex-col gap-4 p-5">
          <header className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-text">Is leverage flashing a warning?</h2>
              {statHeader}
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="chart-expand-btn !relative !top-0 !right-0">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>
          {open && (
            <>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Funding rate (% per 8h)</p>
                <div ref={modalFRef} className="fund-well w-full overflow-hidden" style={{ height: '32vh' }} />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Open interest ($B)</p>
                <div ref={modalORef} className="fund-well w-full overflow-hidden" style={{ height: '32vh' }} />
              </div>
            </>
          )}
          <p className="text-xs leading-relaxed text-muted"><span className="text-dim">→ </span>{interp}</p>
        </div>
      </dialog>
    </>
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

// ─── Realized Volatility card ────────────────────────────────────────────────

function VolatilityCard({ vol }: { vol: VolResult }) {
  const { rv7, rv30, atrPct, zone } = vol.current
  const toneByZone: Record<VolZone, Tone> = {
    Calm: 'gain', Normal: 'neutral', Elevated: 'warn', Extreme: 'loss',
  }
  const tone = toneByZone[zone]

  const setupChart = useCallback((el: HTMLElement) => {
    const chart = makeChart(el)
    const rv30Series = chart.addSeries(AreaSeries, {
      lineColor: 'rgba(167,139,250,0.9)',
      topColor: 'rgba(167,139,250,0.30)', bottomColor: 'rgba(167,139,250,0.02)',
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
    })
    rv30Series.setData(
      vol.history.filter((p) => p.rv30 != null).map((p) => ({ time: t(p.time), value: p.rv30 as number })),
    )
    const rv7Series = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 })
    rv7Series.setData(
      vol.history.filter((p) => p.rv7 != null).map((p) => ({ time: t(p.time), value: p.rv7 as number })),
    )
    for (const [val, color] of [[25, 'rgba(34,197,94,0.4)'], [50, 'rgba(245,158,11,0.4)'], [80, 'rgba(239,68,68,0.4)']] as const) {
      const band = chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: LineStyle.Dotted })
      band.setData(vol.history.map((p) => ({ time: t(p.time), value: val })))
    }
    const detachTip = attachTooltip(el, chart, (param) => {
      const time = Number(param.time)
      const p = nearest(vol.history, time)
      if (!p) return null
      const z = p.rv30 == null ? '—'
        : p.rv30 < 25 ? 'Calm'
        : p.rv30 < 50 ? 'Normal'
        : p.rv30 < 80 ? 'Elevated'
        : 'Extreme'
      return tipRow('Date', fmtDate(p.time)) +
             tipRow('30D RV', p.rv30 != null ? `${p.rv30.toFixed(1)}%` : '—', '#a78bfa') +
             tipRow('7D RV',  p.rv7  != null ? `${p.rv7.toFixed(1)}%`  : '—', '#f59e0b') +
             tipRow('ATR%',   p.atrPct != null ? `${p.atrPct.toFixed(2)}%` : '—') +
             tipRow('Zone',   z)
    })
    const detachReflow = attachReflow(chart, el)
    return () => { detachTip(); detachReflow() }
  }, [vol])

  const interp = `30D annualized RV at ${rv30.toFixed(1)}% (zone: ${zone}); 7D at ${rv7.toFixed(1)}%; daily ATR ${atrPct.toFixed(2)}% of price. ` +
    (zone === 'Calm' ? 'Tight grids and tight SLs work — but compressions historically resolve into expansion.'
    : zone === 'Normal' ? 'Standard regime — bot defaults are appropriate.'
    : zone === 'Elevated' ? 'Widen grid spacing and SL distance; consider reducing position size.'
    : 'Extreme vol — protect capital. Avoid fresh entries, reduce leverage, expect overnight gaps.')

  return (
    <ExpandableQCard
      question="How violent is the market right now?"
      interpretation={interp}
      ariaSummary={`Realized volatility 30 day ${rv30.toFixed(1)} percent, zone ${zone}`}
      statHeader={<StatHeader tone={tone} value={`${rv30.toFixed(1)}%`} label={`30D RV · ${zone}`} hint={`7D RV ${rv7.toFixed(1)}% · daily ATR ${atrPct.toFixed(2)}%`} />}
      setupChart={setupChart}
      inlineHeight={220}
      anchorId="fund-vol"
    />
  )
}

// ─── Cycle Position card (Mayer + Pi Cycle) ──────────────────────────────────

function CycleCard({ cycle }: { cycle: CycleResult }) {
  const { mayer, zone, piGapPct } = cycle.current
  const toneByZone: Record<MayerZone, Tone> = {
    Cheap: 'gain', Fair: 'neutral', Hot: 'warn', 'Cycle Top': 'loss',
  }
  const tone = toneByZone[zone]

  const setupChart = useCallback((el: HTMLElement) => {
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b93a7',
        fontFamily: "'Inter', system-ui, sans-serif",
      },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: false, secondsVisible: false, borderColor: '#2a3142', rightOffset: 0, barSpacing: 1, fixLeftEdge: true, fixRightEdge: true },
      rightPriceScale: { borderColor: '#2a3142', mode: 1 /* Logarithmic */, scaleMargins: { top: 0.1, bottom: 0.1 } },
      handleScale: false, handleScroll: false,
    })
    const priceSer = chart.addSeries(LineSeries, { color: '#e8e8f2', lineWidth: 1 })
    priceSer.setData(cycle.history.map((p) => ({ time: t(p.time), value: p.close })))
    const ma200Ser = chart.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1, lineStyle: LineStyle.Dashed })
    ma200Ser.setData(cycle.history.filter((p) => p.ma200 != null).map((p) => ({ time: t(p.time), value: p.ma200 as number })))
    const ma111Ser = chart.addSeries(LineSeries, { color: '#10b981', lineWidth: 1, lineStyle: LineStyle.Dotted })
    ma111Ser.setData(cycle.history.filter((p) => p.ma111x2 != null).map((p) => ({ time: t(p.time), value: p.ma111x2 as number })))
    const ma350Ser = chart.addSeries(LineSeries, { color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dotted })
    ma350Ser.setData(cycle.history.filter((p) => p.ma350 != null).map((p) => ({ time: t(p.time), value: p.ma350 as number })))

    const detachTip = attachTooltip(el, chart, (param) => {
      const time = Number(param.time)
      const p = nearest(cycle.history, time)
      if (!p) return null
      const myr = p.mayer != null ? p.mayer.toFixed(2) : '—'
      const pi = p.ma111x2 != null && p.ma350 != null && p.ma350 > 0
        ? `${(((p.ma111x2 - p.ma350) / p.ma350) * 100).toFixed(1)}%` : '—'
      return tipRow('Date',   fmtDate(p.time)) +
             tipRow('BTC',    fmtUsd(p.close), '#e8e8f2') +
             tipRow('200DMA', p.ma200 != null ? fmtUsd(p.ma200) : '—', '#a78bfa') +
             tipRow('Mayer',  myr) +
             tipRow('111×2',  p.ma111x2 != null ? fmtUsd(p.ma111x2) : '—', '#10b981') +
             tipRow('350DMA', p.ma350 != null ? fmtUsd(p.ma350) : '—', '#ef4444') +
             tipRow('Pi gap', pi)
    })
    const detachReflow = attachReflow(chart, el)
    return () => { detachTip(); detachReflow() }
  }, [cycle])

  const piNote = piGapPct < 0
    ? `Pi Cycle Top is ${Math.abs(piGapPct).toFixed(1)}% away (111DMA × 2 below 350DMA — not in top zone).`
    : `⚠ Pi Cycle Top triggered ${piGapPct.toFixed(1)}% above the line — historically a cycle peak warning.`

  const interp = `Mayer Multiple at ${mayer.toFixed(2)} (zone: ${zone}). ${piNote} ` +
    (zone === 'Cheap' ? 'Below 0.8 — generational accumulation zone in prior cycles.'
    : zone === 'Fair' ? 'Mid-range — neither cheap nor euphoric.'
    : zone === 'Hot' ? 'Above 1.8 — late-cycle territory, prior cycle tops formed around here.'
    : 'Above 2.4 — historical cycle-top zone, take risk off.')

  return (
    <ExpandableQCard
      question="Where are we in the macro cycle?"
      interpretation={interp}
      ariaSummary={`Mayer Multiple ${mayer.toFixed(2)}, zone ${zone}`}
      statHeader={<StatHeader tone={tone} value={mayer.toFixed(2)} label={`Mayer · ${zone}`} hint="log price · 200DMA (violet) · 111×2 (green) · 350DMA (red)" />}
      setupChart={setupChart}
      inlineHeight={240}
      anchorId="fund-cycle"
    />
  )
}

// ─── Smart-money positioning card ────────────────────────────────────────────

function SmartMoneyCard({ sm }: { sm: SmartMoneyResult }) {
  const inlineLsRef = useRef<HTMLDivElement>(null)
  const inlinePrRef = useRef<HTMLDivElement>(null)
  const modalLsRef = useRef<HTMLDivElement>(null)
  const modalPrRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  const lsCurrent = sm.longShort.current
  const prCurrent = sm.premium.current
  const lsTone: Tone =
    lsCurrent > 1.6 ? 'loss' : lsCurrent > 1.2 ? 'warn' : lsCurrent > 0.8 ? 'neutral' : 'gain'
  const prTone: Tone =
    prCurrent > 0.15 ? 'gain' : prCurrent > 0.05 ? 'gain' : prCurrent > -0.05 ? 'neutral' : prCurrent > -0.15 ? 'warn' : 'loss'
  const lsTC = toneClasses[lsTone]
  const prTC = toneClasses[prTone]

  const setupLs = useCallback((el: HTMLElement) => {
    const chart = makeChart(el)
    const series = chart.addSeries(LineSeries, { color: '#60a5fa', lineWidth: 1 })
    series.setData(sm.longShort.history.map((p) => ({ time: t(p.time), value: p.ratio })))
    const ref = chart.addSeries(LineSeries, { color: '#5b6478', lineWidth: 1, lineStyle: LineStyle.Dashed })
    ref.setData(sm.longShort.history.map((p) => ({ time: t(p.time), value: 1 })))
    const detachTip = attachTooltip(el, chart, (param) => {
      const time = Number(param.time)
      const p = nearest(sm.longShort.history, time)
      if (!p) return null
      const reading = p.ratio > 1.6 ? 'crowded long'
        : p.ratio > 1.2 ? 'lean long'
        : p.ratio > 0.8 ? 'balanced'
        : 'lean short'
      return tipRow('Time', fmtDateTime(p.time)) +
             tipRow('L/S',  p.ratio.toFixed(3), '#60a5fa') +
             tipRow('Reading', reading)
    })
    const detachReflow = attachReflow(chart, el)
    return () => { detachTip(); detachReflow() }
  }, [sm])

  const setupPr = useCallback((el: HTMLElement) => {
    const chart = makeChart(el)
    const series = chart.addSeries(AreaSeries, {
      lineColor: 'rgba(34,197,94,0.9)',
      topColor: 'rgba(34,197,94,0.30)', bottomColor: 'rgba(239,68,68,0.10)',
    })
    series.setData(sm.premium.history.map((p) => ({ time: t(p.time), value: p.pct })))
    const ref = chart.addSeries(LineSeries, { color: '#5b6478', lineWidth: 1, lineStyle: LineStyle.Dashed })
    ref.setData(sm.premium.history.map((p) => ({ time: t(p.time), value: 0 })))
    const detachTip = attachTooltip(el, chart, (param) => {
      const time = Number(param.time)
      const p = nearest(sm.premium.history, time)
      if (!p) return null
      const dir = p.pct >= 0.05 ? 'US bidding up' : p.pct <= -0.05 ? 'US discount / Asia-led' : 'flat'
      return tipRow('Date', fmtDate(p.time)) +
             tipRow('Premium', `${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(2)}%`, '#22c55e') +
             tipRow('Reading', dir)
    })
    const detachReflow = attachReflow(chart, el)
    return () => { detachTip(); detachReflow() }
  }, [sm])

  useEffect(() => { if (inlineLsRef.current) return setupLs(inlineLsRef.current) }, [setupLs])
  useEffect(() => { if (inlinePrRef.current) return setupPr(inlinePrRef.current) }, [setupPr])
  useEffect(() => { if (open && modalLsRef.current) return setupLs(modalLsRef.current) }, [open, setupLs])
  useEffect(() => { if (open && modalPrRef.current) return setupPr(modalPrRef.current) }, [open, setupPr])
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail === 'fund-smartmoney') setOpen(true)
    }
    window.addEventListener('open-fund-modal', handler)
    return () => window.removeEventListener('open-fund-modal', handler)
  }, [])

  const lsLabel =
    lsCurrent > 1.6 ? 'top traders crowded long' :
    lsCurrent > 1.2 ? 'top traders lean long' :
    lsCurrent > 0.8 ? 'top traders balanced' :
                       'top traders lean short'
  const prLabel =
    prCurrent > 0.15 ? 'strong US institutional buying' :
    prCurrent > 0.05 ? 'mild US premium' :
    prCurrent > -0.05 ? 'flat — no clear directional flow' :
    prCurrent > -0.15 ? 'mild discount — Asia-led tape' :
                         'strong negative premium — US outflow'

  const interp = `Top-trader L/S ratio at ${lsCurrent.toFixed(2)} (${lsLabel}). Coinbase Premium at ${prCurrent.toFixed(2)}% — ${prLabel}.`

  const statHeader = (
    <div className="fund-stat-row flex flex-wrap items-center gap-2">
      <div className={`inline-flex items-baseline gap-2 rounded-lg border ${lsTC.ring} ${lsTC.bg} px-3 py-1.5`}>
        <span className={`fund-num font-mono text-base font-semibold ${lsTC.text}`}>{lsCurrent.toFixed(2)}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${lsTC.text}`}>Top L/S</span>
      </div>
      <div className={`inline-flex items-baseline gap-2 rounded-lg border ${prTC.ring} ${prTC.bg} px-3 py-1.5`}>
        <span className={`fund-num font-mono text-base font-semibold ${prTC.text}`}>{prCurrent >= 0 ? '+' : ''}{prCurrent.toFixed(2)}%</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${prTC.text}`}>CB Premium</span>
      </div>
      <span className="fund-stat-hint text-[10px] text-dim">Binance top accts · Coinbase vs Binance spot</span>
    </div>
  )

  return (
    <>
      <article
        id="fund-smartmoney"
        aria-label={`Long short ratio ${lsCurrent.toFixed(2)}, Coinbase premium ${prCurrent.toFixed(2)} percent`}
        className="fund-card defer-render flex flex-col gap-3 rounded-2xl border border-border bg-panel/85 backdrop-blur-sm p-4 shadow-[0_4px_24px_rgba(0,0,0,.35)] transition-colors hover:border-border-strong/70 scroll-mt-4"
      >
        <h2 className="text-[13px] font-semibold tracking-tight text-text">Where is the smart money positioned?</h2>
        {statHeader}
        <div className="relative">
          <p className="mb-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Top-trader long/short ratio</p>
          <div ref={inlineLsRef} className="fund-well h-[100px] w-full overflow-hidden" />
          <button type="button" onClick={() => setOpen(true)} aria-label="Expand charts" className="chart-expand-btn" style={{ top: 22 }}>
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div>
          <p className="mb-1 mt-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Coinbase premium gap (%)</p>
          <div ref={inlinePrRef} className="fund-well h-[100px] w-full overflow-hidden" />
        </div>
        <p className="text-[11px] leading-relaxed text-muted"><span className="text-dim">→ </span>{interp}</p>
      </article>

      <dialog ref={dialogRef} className="chart-modal" aria-label="Smart money detail" onClose={() => setOpen(false)} onClick={(e) => { if (e.target === dialogRef.current) setOpen(false) }}>
        <div className="flex flex-col gap-4 p-5">
          <header className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-text">Where is the smart money positioned?</h2>
              {statHeader}
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="chart-expand-btn !relative !top-0 !right-0">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>
          {open && (
            <>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Top-trader long/short ratio</p>
                <div ref={modalLsRef} className="fund-well w-full overflow-hidden" style={{ height: '32vh' }} />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-dim">Coinbase premium gap (%)</p>
                <div ref={modalPrRef} className="fund-well w-full overflow-hidden" style={{ height: '32vh' }} />
              </div>
            </>
          )}
          <p className="text-xs leading-relaxed text-muted"><span className="text-dim">→ </span>{interp}</p>
        </div>
      </dialog>
    </>
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
