// Fundamentals data layer — sentiment, valuation, regime, and an institutional
// verdict aggregator. Server-side fetching avoids browser CORS, caches free
// public APIs (alternative.me, CoinMetrics community, CoinGecko, Binance) so
// we stay polite, and keeps any future paid keys off the client.

import { Router, type Request, type Response } from 'express'
import { requireAuth } from './auth.js'
import { fetchKlines } from './strategy/market-data.js'
import { ema, bollinger } from './strategy/indicators.js'

// ─── tiny in-memory cache ────────────────────────────────────────────────────

interface CacheEntry<T> { ts: number; data: T }
const cache = new Map<string, CacheEntry<unknown>>()

async function cachedFetch<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  const now = Date.now()
  if (hit && now - hit.ts < ttlMs) return hit.data as T
  const data = await fn()
  cache.set(key, { ts: now, data })
  return data
}

async function fetchJSON<T>(url: string, timeoutMs = 8000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return (await res.json()) as T
}

// ─── Fear & Greed Index (alternative.me) ─────────────────────────────────────

interface FngRaw {
  data: Array<{ value: string; value_classification: string; timestamp: string }>
}

export interface FngPoint { time: number; value: number; label: string }
export interface FngResult { current: FngPoint; history: FngPoint[] }

async function fetchFearGreed(limit = 365): Promise<FngResult> {
  return cachedFetch(`fng:${limit}`, 60 * 60 * 1000, async () => {
    const raw = await fetchJSON<FngRaw>(`https://api.alternative.me/fng/?limit=${limit}`)
    // alternative.me returns newest-first; reverse to chronological.
    const pts: FngPoint[] = raw.data
      .map((d) => ({
        time: Number(d.timestamp),
        value: Number(d.value),
        label: d.value_classification,
      }))
      .reverse()
    if (pts.length === 0) throw new Error('Empty F&G response')
    return { current: pts[pts.length - 1], history: pts }
  })
}

// ─── MVRV (CoinMetrics community API — free, no key) ─────────────────────────

interface CmRaw {
  data: Array<{ time: string; CapMVRVCur?: string }>
}

export interface MvrvPoint { time: number; value: number }
export interface MvrvResult {
  current: MvrvPoint
  history: MvrvPoint[]
  mean: number       // long-term average for reference band
  stdev: number
}

async function fetchMVRV(days = 730): Promise<MvrvResult> {
  return cachedFetch(`mvrv:${days}`, 6 * 60 * 60 * 1000, async () => {
    const start = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const url =
      `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics` +
      `?assets=btc&metrics=CapMVRVCur&start_time=${start}&page_size=10000`
    const raw = await fetchJSON<CmRaw>(url, 12_000)
    const pts: MvrvPoint[] = raw.data
      .filter((d) => d.CapMVRVCur != null)
      .map((d) => ({
        time: Math.floor(new Date(d.time).getTime() / 1000),
        value: Number(d.CapMVRVCur),
      }))
      .filter((p) => Number.isFinite(p.value))
    if (pts.length === 0) throw new Error('Empty MVRV response')
    const vals = pts.map((p) => p.value)
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
    const stdev = Math.sqrt(variance)
    return { current: pts[pts.length - 1], history: pts, mean, stdev }
  })
}

// ─── BTC Dominance (CoinGecko free /global) ──────────────────────────────────

interface CgGlobal {
  data: {
    market_cap_percentage: Record<string, number>
    total_market_cap: Record<string, number>
  }
}

export interface DominanceResult {
  btcDominance: number
  ethDominance: number
  totalMarketCapUsd: number
}

async function fetchDominance(): Promise<DominanceResult> {
  return cachedFetch('dominance', 60 * 60 * 1000, async () => {
    const raw = await fetchJSON<CgGlobal>('https://api.coingecko.com/api/v3/global', 8000)
    return {
      btcDominance: Number(raw.data.market_cap_percentage.btc ?? 0),
      ethDominance: Number(raw.data.market_cap_percentage.eth ?? 0),
      totalMarketCapUsd: Number(raw.data.total_market_cap.usd ?? 0),
    }
  })
}

// ─── Funding rates (Binance public futures) ──────────────────────────────────

interface BinanceFundingRow { fundingTime: number; fundingRate: string }

export interface FundingPoint { time: number; rate: number }
export interface FundingResult {
  current: FundingPoint
  annualizedPct: number
  history: FundingPoint[]
}

async function fetchFunding(limit = 240): Promise<FundingResult> {
  return cachedFetch(`funding:${limit}`, 5 * 60 * 1000, async () => {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${limit}`
    const raw = await fetchJSON<BinanceFundingRow[]>(url)
    const pts: FundingPoint[] = raw.map((r) => ({
      time: Math.floor(r.fundingTime / 1000),
      rate: Number(r.fundingRate),
    }))
    if (pts.length === 0) throw new Error('Empty funding response')
    const current = pts[pts.length - 1]
    // Binance funding settles every 8h → 3 × 365 = 1095 periods per year.
    const annualizedPct = current.rate * 1095 * 100
    return { current, annualizedPct, history: pts }
  })
}

// ─── Open Interest history (Binance public futures) ──────────────────────────

interface BinanceOiRow { timestamp: number; sumOpenInterestValue: string }

export interface OiPoint { time: number; usd: number }
export interface OiResult { current: OiPoint; history: OiPoint[]; pct30d: number }

async function fetchOI(): Promise<OiResult> {
  return cachedFetch('oi', 5 * 60 * 1000, async () => {
    // 4h candles × 180 = 30 days of context.
    const url =
      `https://fapi.binance.com/futures/data/openInterestHist` +
      `?symbol=BTCUSDT&period=4h&limit=180`
    const raw = await fetchJSON<BinanceOiRow[]>(url)
    const pts: OiPoint[] = raw.map((r) => ({
      time: Math.floor(r.timestamp / 1000),
      usd: Number(r.sumOpenInterestValue),
    }))
    if (pts.length === 0) throw new Error('Empty OI response')
    const first = pts[0].usd
    const last = pts[pts.length - 1].usd
    const pct30d = first > 0 ? ((last - first) / first) * 100 : 0
    return { current: pts[pts.length - 1], history: pts, pct30d }
  })
}

// ─── Regime classifier (Wyckoff-style 4-state) ───────────────────────────────

export type RegimeLabel = 'Accumulation' | 'Markup' | 'Distribution' | 'Markdown'

export interface RegimeCandle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface RegimeResult {
  label: RegimeLabel
  confidence: number     // 0..1
  reason: string         // short human description of the call
  candles: RegimeCandle[]
  ema50: Array<number | null>
  ema200: Array<number | null>
  donchianPos: number    // 0..1, where the latest close sits in the 120-bar range
  bbBandwidth: number    // normalized BB width (low = tight range)
  return30d: number      // pct
  return90d: number      // pct
}

async function computeRegime(asset = 'BTC', tf = '1d'): Promise<RegimeResult> {
  return cachedFetch(`regime:${asset}:${tf}`, 10 * 60 * 1000, async () => {
    const symbol = `${asset.toUpperCase()}USDT`
    const candles = await fetchKlines(symbol, tf, 300)
    if (candles.length < 200) throw new Error(`Not enough candles for regime (got ${candles.length})`)
    const closes = candles.map((c) => c.close)
    const e50 = ema(closes, 50)
    const e200 = ema(closes, 200)
    const bb = bollinger(closes, 20, 2)
    const n = candles.length

    // Donchian-style position over last 120 bars: 0 = at range low, 1 = at high.
    const lookback = Math.min(120, n)
    let hi = -Infinity, lo = Infinity
    for (let i = n - lookback; i < n; i++) {
      if (candles[i].high > hi) hi = candles[i].high
      if (candles[i].low < lo) lo = candles[i].low
    }
    const last = closes[n - 1]
    const donchianPos = hi > lo ? (last - lo) / (hi - lo) : 0.5

    // Bollinger bandwidth normalized — small = tight range (potential acc/dist).
    const bbWidth = bb.upper[n - 1] - bb.lower[n - 1]
    const bbBandwidth = bb.mid[n - 1] > 0 ? bbWidth / bb.mid[n - 1] : 0

    const return30d = closes[n - 31] ? ((last - closes[n - 31]) / closes[n - 31]) * 100 : 0
    const return90d = closes[n - 91] ? ((last - closes[n - 91]) / closes[n - 91]) * 100 : 0

    const emaUp = e50[n - 1] > e200[n - 1]
    const emaDown = e50[n - 1] < e200[n - 1]
    // "Tight" range = bandwidth below the 30th percentile of the last 120 bars.
    const recentBws: number[] = []
    for (let i = n - lookback; i < n; i++) {
      const w = bb.upper[i] - bb.lower[i]
      const m = bb.mid[i]
      if (Number.isFinite(w) && Number.isFinite(m) && m > 0) recentBws.push(w / m)
    }
    recentBws.sort((a, b) => a - b)
    const p30 = recentBws[Math.floor(recentBws.length * 0.3)] ?? bbBandwidth
    const tight = bbBandwidth <= p30

    // ── Scoring ──
    // Each state gets a 0..1 score; pick the highest. Confidence = winner / sum.
    const scores: Record<RegimeLabel, number> = {
      Markup: 0,
      Markdown: 0,
      Accumulation: 0,
      Distribution: 0,
    }

    // Markup: emaUp + positive momentum + price in upper Donchian
    if (emaUp) scores.Markup += 0.4
    if (return30d > 5) scores.Markup += 0.3
    if (donchianPos > 0.6) scores.Markup += 0.3

    // Markdown: emaDown + negative momentum + price in lower Donchian
    if (emaDown) scores.Markdown += 0.4
    if (return30d < -5) scores.Markdown += 0.3
    if (donchianPos < 0.4) scores.Markdown += 0.3

    // Accumulation: tight range, lower Donchian, after weakness (90D negative or flat)
    if (tight) scores.Accumulation += 0.4
    if (donchianPos < 0.5) scores.Accumulation += 0.2
    if (return90d < 0 || (return30d > -3 && return30d < 3 && return90d < 10)) scores.Accumulation += 0.4

    // Distribution: tight range, upper Donchian, after strength
    if (tight) scores.Distribution += 0.4
    if (donchianPos > 0.5) scores.Distribution += 0.2
    if (return90d > 15 && Math.abs(return30d) < 8) scores.Distribution += 0.4

    let best: RegimeLabel = 'Accumulation'
    let bestScore = -1
    for (const k of Object.keys(scores) as RegimeLabel[]) {
      if (scores[k] > bestScore) { bestScore = scores[k]; best = k }
    }
    const total = Object.values(scores).reduce((s, v) => s + v, 0)
    const confidence = total > 0 ? bestScore / total : 0.25

    const reasonBits: string[] = []
    reasonBits.push(emaUp ? 'EMA50 > EMA200' : emaDown ? 'EMA50 < EMA200' : 'EMAs flat')
    reasonBits.push(`30D ${return30d.toFixed(1)}%`)
    reasonBits.push(`range pos ${(donchianPos * 100).toFixed(0)}%`)
    if (tight) reasonBits.push('range tight')

    return {
      label: best,
      confidence,
      reason: reasonBits.join(' · '),
      candles: candles.map((c) => ({
        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      })),
      ema50: e50.map((v) => (Number.isFinite(v) ? v : null)),
      ema200: e200.map((v) => (Number.isFinite(v) ? v : null)),
      donchianPos,
      bbBandwidth,
      return30d,
      return90d,
    }
  })
}

// ─── Verdict aggregator ──────────────────────────────────────────────────────

export type Stance = 'Bullish' | 'Cautiously Bullish' | 'Neutral' | 'Cautiously Bearish' | 'Bearish'

export interface VerdictSnapshot {
  asset: string
  generatedAt: number
  stance: Stance
  narrative: string
  chips: {
    sentiment: { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral' }
    valuation: { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral' }
    regime: { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral' }
    leverage: { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral' }
    breadth: { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral' }
  }
  inputs: {
    fng: number
    mvrv: number
    mvrvMean: number
    fundingAnnualizedPct: number
    oiPct30d: number
    btcDominance: number
    regime: RegimeLabel
    regimeConfidence: number
  }
}

function classifyFng(v: number): { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral'; sentimentBias: number } {
  // sentimentBias: -1 (extreme greed → bearish setup) … +1 (extreme fear → bullish setup)
  if (v <= 20) return { label: `Extreme Fear (${v})`, tone: 'loss', sentimentBias: 1 }
  if (v <= 40) return { label: `Fear (${v})`, tone: 'warn', sentimentBias: 0.5 }
  if (v < 60) return { label: `Neutral (${v})`, tone: 'neutral', sentimentBias: 0 }
  if (v < 80) return { label: `Greed (${v})`, tone: 'warn', sentimentBias: -0.5 }
  return { label: `Extreme Greed (${v})`, tone: 'gain', sentimentBias: -1 }
}

function classifyMvrv(v: number, mean: number): { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral'; valueBias: number } {
  // Cheap (low MVRV) → bullish bias; expensive → bearish.
  if (v < 1) return { label: `Deeply Undervalued (${v.toFixed(2)})`, tone: 'gain', valueBias: 1 }
  if (v < mean * 0.85) return { label: `Cheap (${v.toFixed(2)})`, tone: 'gain', valueBias: 0.5 }
  if (v < mean * 1.15) return { label: `Fair (${v.toFixed(2)})`, tone: 'neutral', valueBias: 0 }
  if (v < 3.7) return { label: `Rich (${v.toFixed(2)})`, tone: 'warn', valueBias: -0.5 }
  return { label: `Euphoric (${v.toFixed(2)})`, tone: 'loss', valueBias: -1 }
}

function classifyFunding(annualPct: number): { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral'; levBias: number } {
  // Extreme positive funding = longs paying = crowded longs → bearish.
  if (annualPct > 30) return { label: `Hot (${annualPct.toFixed(1)}% APR)`, tone: 'loss', levBias: -1 }
  if (annualPct > 15) return { label: `Warm (${annualPct.toFixed(1)}% APR)`, tone: 'warn', levBias: -0.5 }
  if (annualPct > 0) return { label: `Neutral (${annualPct.toFixed(1)}% APR)`, tone: 'neutral', levBias: 0 }
  if (annualPct > -10) return { label: `Soft (${annualPct.toFixed(1)}% APR)`, tone: 'gain', levBias: 0.5 }
  return { label: `Negative (${annualPct.toFixed(1)}% APR)`, tone: 'gain', levBias: 1 }
}

function classifyRegime(label: RegimeLabel, conf: number): { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral'; regBias: number } {
  const pct = Math.round(conf * 100)
  switch (label) {
    case 'Markup':       return { label: `Markup (${pct}%)`,       tone: 'gain',    regBias:  1 }
    case 'Markdown':     return { label: `Markdown (${pct}%)`,     tone: 'loss',    regBias: -1 }
    case 'Accumulation': return { label: `Accumulation (${pct}%)`, tone: 'warn',    regBias:  0.5 }
    case 'Distribution': return { label: `Distribution (${pct}%)`, tone: 'warn',    regBias: -0.5 }
  }
}

function classifyDominance(d: number): { label: string; tone: 'gain' | 'loss' | 'warn' | 'neutral'; breadthBias: number } {
  // Lower dominance = alts running = risk-on. For BTC itself this is neutral.
  if (d > 60) return { label: `BTC ${d.toFixed(1)}% (BTC season)`,  tone: 'neutral', breadthBias: 0 }
  if (d > 50) return { label: `BTC ${d.toFixed(1)}% (mixed)`,        tone: 'neutral', breadthBias: 0 }
  if (d > 45) return { label: `BTC ${d.toFixed(1)}% (alts firm)`,    tone: 'gain',    breadthBias: 0.3 }
  return       { label: `BTC ${d.toFixed(1)}% (alt season)`,         tone: 'gain',    breadthBias: 0.5 }
}

function pickStance(score: number): Stance {
  if (score >=  1.2) return 'Bullish'
  if (score >=  0.4) return 'Cautiously Bullish'
  if (score >  -0.4) return 'Neutral'
  if (score >  -1.2) return 'Cautiously Bearish'
  return 'Bearish'
}

async function computeVerdict(asset = 'BTC'): Promise<VerdictSnapshot> {
  // Fetch in parallel — each is independently cached.
  const [fng, mvrv, dom, funding, oi, regime] = await Promise.all([
    fetchFearGreed(365).catch((e) => { throw new Error(`F&G: ${e.message}`) }),
    fetchMVRV(730).catch((e) => { throw new Error(`MVRV: ${e.message}`) }),
    fetchDominance().catch((e) => { throw new Error(`Dominance: ${e.message}`) }),
    fetchFunding(240).catch((e) => { throw new Error(`Funding: ${e.message}`) }),
    fetchOI().catch((e) => { throw new Error(`OI: ${e.message}`) }),
    computeRegime(asset, '1d').catch((e) => { throw new Error(`Regime: ${e.message}`) }),
  ])

  const sent = classifyFng(fng.current.value)
  const val = classifyMvrv(mvrv.current.value, mvrv.mean)
  const lev = classifyFunding(funding.annualizedPct)
  const reg = classifyRegime(regime.label, regime.confidence)
  const dm = classifyDominance(dom.btcDominance)

  // Composite score: weights tuned to favor regime + valuation over short-term sentiment.
  const score =
    sent.sentimentBias * 0.20 +
    val.valueBias     * 0.30 +
    reg.regBias       * 0.30 +
    lev.levBias       * 0.15 +
    dm.breadthBias    * 0.05

  const stance = pickStance(score)

  // ── Narrative paragraph ──
  const oiTrend = oi.pct30d >= 0
    ? `open interest is up ${oi.pct30d.toFixed(1)}% over 30 days`
    : `open interest has fallen ${Math.abs(oi.pct30d).toFixed(1)}% over 30 days`

  const narrative =
    `${asset} reads ${stance.toLowerCase()}. ` +
    `The crowd sits at ${sent.label.toLowerCase()} on the Fear & Greed Index, ` +
    `while on-chain valuation via MVRV at ${mvrv.current.value.toFixed(2)} is ` +
    `${val.label.toLowerCase().replace(/\s*\([^)]*\)\s*/, '')} relative to the ` +
    `long-term mean of ${mvrv.mean.toFixed(2)}. ` +
    `The price regime classifier reads ${regime.label.toLowerCase()} ` +
    `(${Math.round(regime.confidence * 100)}% confidence; ${regime.reason}). ` +
    `Derivatives positioning is ${lev.label.toLowerCase().replace(/\s*\([^)]*\)\s*/, '')} — ` +
    `${oiTrend}. BTC dominance at ${dom.btcDominance.toFixed(1)}% indicates ` +
    `${dm.label.toLowerCase().includes('alt') ? 'capital rotating into alts' : 'a BTC-led tape'}.`

  return {
    asset,
    generatedAt: Date.now(),
    stance,
    narrative,
    chips: {
      sentiment: { label: sent.label, tone: sent.tone },
      valuation: { label: val.label,  tone: val.tone  },
      regime:    { label: reg.label,  tone: reg.tone  },
      leverage:  { label: lev.label,  tone: lev.tone  },
      breadth:   { label: dm.label,   tone: dm.tone   },
    },
    inputs: {
      fng: fng.current.value,
      mvrv: mvrv.current.value,
      mvrvMean: mvrv.mean,
      fundingAnnualizedPct: funding.annualizedPct,
      oiPct30d: oi.pct30d,
      btcDominance: dom.btcDominance,
      regime: regime.label,
      regimeConfidence: regime.confidence,
    },
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const fundamentalsRouter = Router()

fundamentalsRouter.get('/fear-greed', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await fetchFearGreed(365)) }
  catch (e) { res.status(502).json({ error: (e as Error).message }) }
})

fundamentalsRouter.get('/mvrv', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await fetchMVRV(730)) }
  catch (e) { res.status(502).json({ error: (e as Error).message }) }
})

fundamentalsRouter.get('/dominance', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await fetchDominance()) }
  catch (e) { res.status(502).json({ error: (e as Error).message }) }
})

fundamentalsRouter.get('/funding', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await fetchFunding(240)) }
  catch (e) { res.status(502).json({ error: (e as Error).message }) }
})

fundamentalsRouter.get('/oi', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await fetchOI()) }
  catch (e) { res.status(502).json({ error: (e as Error).message }) }
})

fundamentalsRouter.get('/regime', requireAuth, async (req: Request, res: Response) => {
  const asset = (typeof req.query.asset === 'string' ? req.query.asset : 'BTC').toUpperCase()
  const tf = typeof req.query.tf === 'string' ? req.query.tf : '1d'
  try { res.json(await computeRegime(asset, tf)) }
  catch (e) { res.status(502).json({ error: (e as Error).message }) }
})

fundamentalsRouter.get('/verdict', requireAuth, async (req: Request, res: Response) => {
  const asset = (typeof req.query.asset === 'string' ? req.query.asset : 'BTC').toUpperCase()
  try { res.json(await computeVerdict(asset)) }
  catch (e) { res.status(502).json({ error: (e as Error).message }) }
})
