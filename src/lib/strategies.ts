import type { Candle, Signal, StrategyId } from '@/types'
import {
  bollinger,
  cci,
  crossDown,
  crossUp,
  donchian,
  ema,
  macd,
  psar,
  rsi,
  sma,
  stochRsi,
  stochastic,
  supertrend,
  williamsR,
} from './indicators'

export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

export type StrategyCategory = 'Trend' | 'Oscillator' | 'Volatility'

export interface StrategyMeta {
  id: StrategyId
  name: string
  category: StrategyCategory
  description: string
  params: ParamDef[]
}

const p = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
): ParamDef => ({ key, label, min, max, step, default: def })

export const STRATEGIES: StrategyMeta[] = [
  {
    id: 'macd',
    name: 'MACD Crossover',
    category: 'Trend',
    description:
      'Goes long when the MACD line crosses above its signal line and exits when it crosses back below — a classic momentum strategy.',
    params: [
      p('fast', 'Fast EMA', 2, 50, 1, 12),
      p('slow', 'Slow EMA', 5, 100, 1, 26),
      p('signal', 'Signal EMA', 2, 50, 1, 9),
    ],
  },
  {
    id: 'ema',
    name: 'EMA Crossover',
    category: 'Trend',
    description:
      'Buys on a golden cross (fast EMA crossing above slow EMA) and sells on a death cross — a popular trend-following strategy.',
    params: [
      p('fast', 'Fast EMA', 2, 100, 1, 20),
      p('slow', 'Slow EMA', 5, 300, 1, 50),
    ],
  },
  {
    id: 'sma',
    name: 'SMA Crossover',
    category: 'Trend',
    description:
      'The simple-moving-average version of the golden/death cross. The 50/200 SMA cross is the most-watched signal in markets.',
    params: [
      p('fast', 'Fast SMA', 2, 100, 1, 50),
      p('slow', 'Slow SMA', 5, 400, 1, 200),
    ],
  },
  {
    id: 'supertrend',
    name: 'Supertrend',
    category: 'Trend',
    description:
      'An ATR-based trend filter. Buys when the trend flips up, sells when it flips down. Very popular for catching sustained moves.',
    params: [
      p('period', 'ATR Period', 2, 50, 1, 10),
      p('mult', 'ATR Multiplier', 1, 8, 0.5, 3),
    ],
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    category: 'Trend',
    description:
      'Wilder’s stop-and-reverse. Buys when price crosses above the SAR and sells when it crosses below — a trailing trend system.',
    params: [
      p('step', 'Acceleration Step', 0.01, 0.1, 0.01, 0.02),
      p('max', 'Max Acceleration', 0.05, 0.5, 0.05, 0.2),
    ],
  },
  {
    id: 'donchian',
    name: 'Donchian Breakout',
    category: 'Trend',
    description:
      'The Turtle Traders’ system. Buys when price breaks above the highest high of the last N bars, sells on a break of the low.',
    params: [p('period', 'Channel Period', 5, 100, 1, 20)],
  },
  {
    id: 'rsi',
    name: 'RSI Reversal',
    category: 'Oscillator',
    description:
      'Buys when RSI climbs back above the oversold level and sells when it drops below the overbought level — a mean-reversion strategy.',
    params: [
      p('period', 'RSI Period', 2, 50, 1, 14),
      p('oversold', 'Oversold Level', 5, 45, 1, 30),
      p('overbought', 'Overbought Level', 55, 95, 1, 70),
    ],
  },
  {
    id: 'stochastic',
    name: 'Stochastic Oscillator',
    category: 'Oscillator',
    description:
      'Buys when %K crosses above %D and sells when it crosses below — a widely used momentum oscillator.',
    params: [
      p('kPeriod', '%K Period', 2, 50, 1, 14),
      p('kSmooth', '%K Smoothing', 1, 10, 1, 3),
      p('dPeriod', '%D Period', 1, 10, 1, 3),
    ],
  },
  {
    id: 'stochrsi',
    name: 'Stochastic RSI',
    category: 'Oscillator',
    description:
      'Applies the stochastic formula to RSI for a faster, more sensitive oscillator. Buys/sells on the %K-%D cross.',
    params: [
      p('rsiPeriod', 'RSI Period', 2, 50, 1, 14),
      p('stochPeriod', 'Stoch Period', 2, 50, 1, 14),
      p('kSmooth', '%K Smoothing', 1, 10, 1, 3),
      p('dSmooth', '%D Smoothing', 1, 10, 1, 3),
    ],
  },
  {
    id: 'cci',
    name: 'CCI',
    category: 'Oscillator',
    description:
      'Commodity Channel Index. Buys when CCI crosses above -100 and sells when it crosses below +100.',
    params: [p('period', 'CCI Period', 5, 100, 1, 20)],
  },
  {
    id: 'williamsr',
    name: 'Williams %R',
    category: 'Oscillator',
    description:
      'Buys when %R crosses above -80 (leaving oversold) and sells when it crosses below -20 (leaving overbought).',
    params: [p('period', '%R Period', 2, 50, 1, 14)],
  },
  {
    id: 'bollinger',
    name: 'Bollinger Bands',
    category: 'Volatility',
    description:
      'Buys when price crosses back above the lower band and sells when it crosses below the upper band — a volatility mean-reversion strategy.',
    params: [
      p('period', 'Period', 5, 100, 1, 20),
      p('mult', 'Std Dev Multiplier', 1, 4, 0.1, 2),
    ],
  },
  {
    id: 'elliott',
    name: 'Elliott Wave',
    category: 'Trend',
    description:
      'Detects 5-wave impulse structures using ZigZag pivot analysis. Draws wave labels (①–⑤), Fibonacci retracement zones, and extension targets. Buys at confirmed wave 2/4 lows, sells at wave 3/5 highs.',
    params: [p('zigzag', 'ZigZag Threshold %', 1, 15, 0.5, 3)],
  },
]

export function strategyMeta(id: StrategyId): StrategyMeta {
  return STRATEGIES.find((s) => s.id === id) as StrategyMeta
}

export function defaultParams(id: StrategyId): Record<string, number> {
  const out: Record<string, number> = {}
  for (const param of strategyMeta(id).params) out[param.key] = param.default
  return out
}

export interface LinePoint {
  time: number
  value: number
}

export interface HistPoint {
  time: number
  value: number
  color: string
}

export interface SeriesLine {
  id: string
  color: string
  data: LinePoint[]
}

export interface WaveMarker {
  time: number
  label: string
  position: 'aboveBar' | 'belowBar'
}

export interface PriceLine {
  price: number
  color: string
  label: string
}

export interface StrategyOutput {
  signals: Signal[]
  mainLines: SeriesLine[]
  subPane?: {
    title: string
    lines: SeriesLine[]
    hist?: HistPoint[]
    refLines?: number[]
  }
  waveMarkers?: WaveMarker[]
  priceLines?: PriceLine[]
}

function toLine(times: number[], values: number[]): LinePoint[] {
  const out: LinePoint[] = []
  for (let i = 0; i < values.length; i++) {
    if (!Number.isNaN(values[i])) out.push({ time: times[i], value: values[i] })
  }
  return out
}

function buildSignals(
  n: number,
  isBuy: (i: number) => boolean,
  isSell: (i: number) => boolean,
): Signal[] {
  const signals: Signal[] = []
  for (let i = 0; i < n; i++) {
    signals.push(isBuy(i) ? 'buy' : isSell(i) ? 'sell' : null)
  }
  return signals
}

// ── Elliott Wave helpers ─────────────────────────────────────────────────────

interface EWPivot { idx: number; time: number; price: number; kind: 'high' | 'low' }
interface EWImpulse { pivots: EWPivot[]; dir: 'up' | 'down'; w1: number; w3: number; w5: number }

function ewZigZag(candles: Candle[], threshPct: number): EWPivot[] {
  const thresh = threshPct / 100
  const out: EWPivot[] = []
  if (candles.length < 10) return out

  let dir: 'up' | 'down' = candles[1].close >= candles[0].close ? 'up' : 'down'
  let extIdx = 0
  let extPrice = dir === 'up' ? candles[0].high : candles[0].low

  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i]
    if (dir === 'up') {
      if (high >= extPrice) { extPrice = high; extIdx = i }
      else if ((extPrice - low) / extPrice >= thresh) {
        out.push({ idx: extIdx, time: candles[extIdx].time, price: extPrice, kind: 'high' })
        dir = 'down'; extPrice = low; extIdx = i
      }
    } else {
      if (low <= extPrice) { extPrice = low; extIdx = i }
      else if ((high - extPrice) / extPrice >= thresh) {
        out.push({ idx: extIdx, time: candles[extIdx].time, price: extPrice, kind: 'low' })
        dir = 'up'; extPrice = high; extIdx = i
      }
    }
  }
  // Add the current extreme as a provisional unconfirmed pivot
  out.push({ idx: extIdx, time: candles[extIdx].time, price: extPrice, kind: dir === 'up' ? 'high' : 'low' })
  return out
}

function ewFindImpulse(pivots: EWPivot[]): EWImpulse | null {
  if (pivots.length < 6) return null
  for (let s = Math.max(0, pivots.length - 10); s <= pivots.length - 6; s++) {
    const p = pivots.slice(s, s + 6)
    // Upward: low,high,low,high,low,high
    if (p[0].kind === 'low' && p[1].kind === 'high' && p[2].kind === 'low' &&
        p[3].kind === 'high' && p[4].kind === 'low' && p[5].kind === 'high') {
      const w1 = p[1].price - p[0].price
      const w3 = p[3].price - p[2].price
      const w5 = p[5].price - p[4].price
      if (p[2].price <= p[0].price) continue   // W2 can't retrace 100%
      if (p[4].price <= p[1].price) continue   // W4 can't overlap W1
      if (w3 < w1 && w3 < w5) continue         // W3 can't be shortest
      if (w1 <= 0 || w3 <= 0 || w5 <= 0) continue
      return { pivots: p, dir: 'up', w1, w3, w5 }
    }
    // Downward: high,low,high,low,high,low
    if (p[0].kind === 'high' && p[1].kind === 'low' && p[2].kind === 'high' &&
        p[3].kind === 'low' && p[4].kind === 'high' && p[5].kind === 'low') {
      const w1 = p[0].price - p[1].price
      const w3 = p[2].price - p[3].price
      const w5 = p[4].price - p[5].price
      if (p[2].price >= p[0].price) continue
      if (p[4].price >= p[1].price) continue
      if (w3 < w1 && w3 < w5) continue
      if (w1 <= 0 || w3 <= 0 || w5 <= 0) continue
      return { pivots: p, dir: 'down', w1, w3, w5 }
    }
  }
  return null
}

function ewFibLines(imp: EWImpulse): PriceLine[] {
  const p = imp.pivots
  const lines: PriceLine[] = []
  if (imp.dir === 'up') {
    const w1Len = imp.w1
    const w2End = p[2].price
    const w4End = p[4].price
    const w5End = p[5].price
    const impulseLen = w5End - p[0].price
    // W2 retracement zone of W1
    lines.push({ price: p[1].price - w1Len * 0.382, color: '#f59e0b', label: 'W2 38.2%' })
    lines.push({ price: p[1].price - w1Len * 0.618, color: '#f97316', label: 'W2 61.8% ★' })
    // W3 extension targets from W2 bottom
    lines.push({ price: w2End + w1Len * 1.382, color: '#4ade80', label: 'W3 138.2%' })
    lines.push({ price: w2End + w1Len * 1.618, color: '#22c55e', label: 'W3 161.8% ★' })
    lines.push({ price: w2End + w1Len * 2.618, color: '#16a34a', label: 'W3 261.8%' })
    // W4 retracement of W3
    lines.push({ price: p[3].price - imp.w3 * 0.382, color: '#fb923c', label: 'W4 38.2%' })
    // W5 targets from W4
    lines.push({ price: w4End + w1Len * 0.618, color: '#93c5fd', label: 'W5 61.8%' })
    lines.push({ price: w4End + w1Len * 1.000, color: '#3b82f6', label: 'W5 = W1 ★' })
    lines.push({ price: w4End + w1Len * 1.382, color: '#1d4ed8', label: 'W5 138.2%' })
    // Correction targets after W5
    lines.push({ price: w5End - impulseLen * 0.382, color: '#f87171', label: 'ABC 38.2%' })
    lines.push({ price: w5End - impulseLen * 0.618, color: '#ef4444', label: 'ABC 61.8% ★' })
  } else {
    const w1Len = imp.w1
    const w2End = p[2].price
    const w4End = p[4].price
    const w5End = p[5].price
    const impulseLen = p[0].price - w5End
    lines.push({ price: p[1].price + w1Len * 0.382, color: '#f59e0b', label: 'W2 38.2%' })
    lines.push({ price: p[1].price + w1Len * 0.618, color: '#f97316', label: 'W2 61.8% ★' })
    lines.push({ price: w2End - w1Len * 1.382, color: '#4ade80', label: 'W3 138.2%' })
    lines.push({ price: w2End - w1Len * 1.618, color: '#22c55e', label: 'W3 161.8% ★' })
    lines.push({ price: w2End - w1Len * 2.618, color: '#16a34a', label: 'W3 261.8%' })
    lines.push({ price: p[3].price + imp.w3 * 0.382, color: '#fb923c', label: 'W4 38.2%' })
    lines.push({ price: w4End - w1Len * 0.618, color: '#93c5fd', label: 'W5 61.8%' })
    lines.push({ price: w4End - w1Len * 1.000, color: '#3b82f6', label: 'W5 = W1 ★' })
    lines.push({ price: w4End - w1Len * 1.382, color: '#1d4ed8', label: 'W5 138.2%' })
    lines.push({ price: w5End + impulseLen * 0.382, color: '#f87171', label: 'ABC 38.2%' })
    lines.push({ price: w5End + impulseLen * 0.618, color: '#ef4444', label: 'ABC 61.8% ★' })
  }
  return lines
}

// ── End Elliott Wave helpers ─────────────────────────────────────────────────

export function generateSignals(
  id: StrategyId,
  candles: Candle[],
  params: Record<string, number>,
): StrategyOutput {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const times = candles.map((c) => c.time)
  const n = candles.length

  switch (id) {
    case 'macd': {
      const m = macd(closes, params.fast, params.slow, params.signal)
      const signals = buildSignals(
        n,
        (i) => crossUp(m.macd, m.signal, i),
        (i) => crossDown(m.macd, m.signal, i),
      )
      const hist: HistPoint[] = []
      for (let i = 0; i < n; i++) {
        if (!Number.isNaN(m.hist[i])) {
          hist.push({
            time: times[i],
            value: m.hist[i],
            color:
              m.hist[i] >= 0 ? 'rgba(29,191,115,0.5)' : 'rgba(237,75,75,0.5)',
          })
        }
      }
      return {
        signals,
        mainLines: [],
        subPane: {
          title: 'MACD',
          lines: [
            { id: 'macd', color: '#3b9eff', data: toLine(times, m.macd) },
            { id: 'signal', color: '#ff9f43', data: toLine(times, m.signal) },
          ],
          hist,
          refLines: [0],
        },
      }
    }

    case 'ema': {
      const fast = ema(closes, params.fast)
      const slow = ema(closes, params.slow)
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(fast, slow, i),
          (i) => crossDown(fast, slow, i),
        ),
        mainLines: [
          { id: 'emaFast', color: '#3b9eff', data: toLine(times, fast) },
          { id: 'emaSlow', color: '#ff9f43', data: toLine(times, slow) },
        ],
      }
    }

    case 'sma': {
      const fast = sma(closes, params.fast)
      const slow = sma(closes, params.slow)
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(fast, slow, i),
          (i) => crossDown(fast, slow, i),
        ),
        mainLines: [
          { id: 'smaFast', color: '#3b9eff', data: toLine(times, fast) },
          { id: 'smaSlow', color: '#ff9f43', data: toLine(times, slow) },
        ],
      }
    }

    case 'supertrend': {
      const st = supertrend(highs, lows, closes, params.period, params.mult)
      const signals = buildSignals(
        n,
        (i) => i > 0 && st.trend[i] === 1 && st.trend[i - 1] === -1,
        (i) => i > 0 && st.trend[i] === -1 && st.trend[i - 1] === 1,
      )
      return {
        signals,
        mainLines: [
          { id: 'supertrend', color: '#a78bfa', data: toLine(times, st.line) },
        ],
      }
    }

    case 'psar': {
      const sar = psar(highs, lows, params.step, params.max)
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(closes, sar, i),
          (i) => crossDown(closes, sar, i),
        ),
        mainLines: [{ id: 'psar', color: '#a78bfa', data: toLine(times, sar) }],
      }
    }

    case 'donchian': {
      const d = donchian(highs, lows, params.period)
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(closes, d.upper, i),
          (i) => crossDown(closes, d.lower, i),
        ),
        mainLines: [
          { id: 'dcUpper', color: 'rgba(237,75,75,0.7)', data: toLine(times, d.upper) },
          { id: 'dcLower', color: 'rgba(29,191,115,0.7)', data: toLine(times, d.lower) },
        ],
      }
    }

    case 'rsi': {
      const r = rsi(closes, params.period)
      const osLevel = closes.map(() => params.oversold)
      const obLevel = closes.map(() => params.overbought)
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(r, osLevel, i),
          (i) => crossDown(r, obLevel, i),
        ),
        mainLines: [],
        subPane: {
          title: 'RSI',
          lines: [{ id: 'rsi', color: '#c084fc', data: toLine(times, r) }],
          refLines: [params.oversold, params.overbought],
        },
      }
    }

    case 'stochastic': {
      const s = stochastic(
        highs,
        lows,
        closes,
        params.kPeriod,
        params.kSmooth,
        params.dPeriod,
      )
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(s.k, s.d, i),
          (i) => crossDown(s.k, s.d, i),
        ),
        mainLines: [],
        subPane: {
          title: 'Stochastic',
          lines: [
            { id: 'k', color: '#3b9eff', data: toLine(times, s.k) },
            { id: 'd', color: '#ff9f43', data: toLine(times, s.d) },
          ],
          refLines: [20, 80],
        },
      }
    }

    case 'stochrsi': {
      const s = stochRsi(
        closes,
        params.rsiPeriod,
        params.stochPeriod,
        params.kSmooth,
        params.dSmooth,
      )
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(s.k, s.d, i),
          (i) => crossDown(s.k, s.d, i),
        ),
        mainLines: [],
        subPane: {
          title: 'Stoch RSI',
          lines: [
            { id: 'k', color: '#3b9eff', data: toLine(times, s.k) },
            { id: 'd', color: '#ff9f43', data: toLine(times, s.d) },
          ],
          refLines: [20, 80],
        },
      }
    }

    case 'cci': {
      const c = cci(highs, lows, closes, params.period)
      const lower = closes.map(() => -100)
      const upper = closes.map(() => 100)
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(c, lower, i),
          (i) => crossDown(c, upper, i),
        ),
        mainLines: [],
        subPane: {
          title: 'CCI',
          lines: [{ id: 'cci', color: '#c084fc', data: toLine(times, c) }],
          refLines: [-100, 0, 100],
        },
      }
    }

    case 'williamsr': {
      const w = williamsR(highs, lows, closes, params.period)
      const lower = closes.map(() => -80)
      const upper = closes.map(() => -20)
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(w, lower, i),
          (i) => crossDown(w, upper, i),
        ),
        mainLines: [],
        subPane: {
          title: 'Williams %R',
          lines: [{ id: 'wr', color: '#c084fc', data: toLine(times, w) }],
          refLines: [-80, -20],
        },
      }
    }

    case 'bollinger': {
      const b = bollinger(closes, params.period, params.mult)
      return {
        signals: buildSignals(
          n,
          (i) => crossUp(closes, b.lower, i),
          (i) => crossDown(closes, b.upper, i),
        ),
        mainLines: [
          { id: 'bbUpper', color: 'rgba(237,75,75,0.7)', data: toLine(times, b.upper) },
          { id: 'bbMid', color: 'rgba(150,150,150,0.6)', data: toLine(times, b.mid) },
          { id: 'bbLower', color: 'rgba(29,191,115,0.7)', data: toLine(times, b.lower) },
        ],
      }
    }

    case 'elliott': {
      const pivots = ewZigZag(candles, params.zigzag ?? 3)
      const impulse = ewFindImpulse(pivots)

      // ZigZag line connecting all confirmed pivots
      const zigzagData: LinePoint[] = pivots.map((p) => ({ time: p.time, value: p.price }))

      // Wave number labels at each pivot of the identified impulse
      const waveMarkers: WaveMarker[] = []
      const waveLabels = ['0', '①', '②', '③', '④', '⑤']
      if (impulse) {
        impulse.pivots.forEach((p, i) => {
          waveMarkers.push({
            time: p.time,
            label: waveLabels[i],
            position: p.kind === 'high' ? 'aboveBar' : 'belowBar',
          })
        })
      }

      // Fibonacci levels based on the impulse structure
      const priceLines: PriceLine[] = impulse ? ewFibLines(impulse) : []

      // Signals: buy at confirmed zigzag lows (wave 2/4), sell at highs (wave 3/5)
      const signals: Signal[] = candles.map(() => null)
      for (const p of pivots) {
        const next = p.idx + 1
        if (next < n) signals[next] = p.kind === 'low' ? 'buy' : 'sell'
      }

      return {
        signals,
        mainLines: [{ id: 'zigzag', color: 'rgba(167,139,250,0.8)', data: zigzagData }],
        waveMarkers,
        priceLines,
      }
    }
  }
}
