// Strategy signal generation. The signal logic here is kept identical to the
// web app's src/lib/strategies.ts (generateSignals) so the bot trades exactly
// what the backtester shows. The chart-only output (lines, sub-panes, wave
// labels) is intentionally omitted — the bot only needs buy/sell signals.

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
} from './indicators.js'

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Signal = 'buy' | 'sell' | null

export type StrategyId =
  | 'macd'
  | 'ema'
  | 'sma'
  | 'rsi'
  | 'bollinger'
  | 'supertrend'
  | 'psar'
  | 'donchian'
  | 'stochastic'
  | 'stochrsi'
  | 'cci'
  | 'williamsr'
  | 'elliott'
  | 'traderxo'

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
      'Goes long when the MACD line crosses above its signal line and exits when it crosses back below.',
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
    description: 'Buys on a golden cross (fast EMA above slow EMA), sells on a death cross.',
    params: [
      p('fast', 'Fast EMA', 2, 100, 1, 20),
      p('slow', 'Slow EMA', 5, 300, 1, 50),
    ],
  },
  {
    id: 'sma',
    name: 'SMA Crossover',
    category: 'Trend',
    description: 'The simple-moving-average golden/death cross.',
    params: [
      p('fast', 'Fast SMA', 2, 100, 1, 50),
      p('slow', 'Slow SMA', 5, 400, 1, 200),
    ],
  },
  {
    id: 'supertrend',
    name: 'Supertrend',
    category: 'Trend',
    description: 'An ATR-based trend filter. Buys when the trend flips up, sells when it flips down.',
    params: [
      p('period', 'ATR Period', 2, 50, 1, 10),
      p('mult', 'ATR Multiplier', 1, 8, 0.5, 3),
    ],
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    category: 'Trend',
    description: 'Wilder’s stop-and-reverse. Buys when price crosses above the SAR, sells when below.',
    params: [
      p('step', 'Acceleration Step', 0.01, 0.1, 0.01, 0.02),
      p('max', 'Max Acceleration', 0.05, 0.5, 0.05, 0.2),
    ],
  },
  {
    id: 'donchian',
    name: 'Donchian Breakout',
    category: 'Trend',
    description: 'Buys when price breaks above the highest high of the last N bars, sells on a low break.',
    params: [p('period', 'Channel Period', 5, 100, 1, 20)],
  },
  {
    id: 'rsi',
    name: 'RSI Reversal',
    category: 'Oscillator',
    description: 'Buys when RSI climbs back above oversold, sells when it drops below overbought.',
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
    description: 'Buys when %K crosses above %D, sells when it crosses below.',
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
    description: 'A faster oscillator — stochastic applied to RSI. Buys/sells on the %K-%D cross.',
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
    description: 'Buys when CCI crosses above -100, sells when it crosses below +100.',
    params: [p('period', 'CCI Period', 5, 100, 1, 20)],
  },
  {
    id: 'williamsr',
    name: 'Williams %R',
    category: 'Oscillator',
    description: 'Buys when %R crosses above -80, sells when it crosses below -20.',
    params: [p('period', '%R Period', 2, 50, 1, 14)],
  },
  {
    id: 'bollinger',
    name: 'Bollinger Bands',
    category: 'Volatility',
    description: 'Buys when price crosses back above the lower band, sells when it crosses below the upper band.',
    params: [
      p('period', 'Period', 5, 100, 1, 20),
      p('mult', 'Std Dev Multiplier', 1, 4, 0.1, 2),
    ],
  },
  {
    id: 'elliott',
    name: 'Elliott Wave',
    category: 'Trend',
    description: 'Buys at confirmed ZigZag pivot lows, sells at pivot highs.',
    params: [p('zigzag', 'ZigZag Threshold %', 1, 15, 0.5, 3)],
  },
  {
    id: 'traderxo',
    name: 'Trader XO Macro Trend',
    category: 'Trend',
    description: 'EMA trend bias + StochRSI confirmation + long MA filter. Buys when price > MA, fast > slow EMA, and StochRSI K crosses above D below 50.',
    params: [
      p('fast', 'Fast EMA', 2, 50, 1, 12),
      p('slow', 'Slow EMA', 5, 100, 1, 25),
      p('maLen', 'MA Filter', 50, 500, 10, 200),
      p('rsiLen', 'RSI Length', 2, 50, 1, 14),
      p('stochLen', 'Stoch Length', 2, 50, 1, 14),
    ],
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

interface EWPivot { idx: number; kind: 'high' | 'low' }

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
        out.push({ idx: extIdx, kind: 'high' })
        dir = 'down'; extPrice = low; extIdx = i
      }
    } else {
      if (low <= extPrice) { extPrice = low; extIdx = i }
      else if ((high - extPrice) / extPrice >= thresh) {
        out.push({ idx: extIdx, kind: 'low' })
        dir = 'up'; extPrice = high; extIdx = i
      }
    }
  }
  out.push({ idx: extIdx, kind: dir === 'up' ? 'high' : 'low' })
  return out
}

// Returns one signal per candle, aligned to the input. NaN-tolerant: early
// bars where the indicator is undefined yield a null (no-signal).
export function generateSignals(
  id: StrategyId,
  candles: Candle[],
  params: Record<string, number>,
): Signal[] {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const n = candles.length

  switch (id) {
    case 'macd': {
      const m = macd(closes, params.fast, params.slow, params.signal)
      return buildSignals(
        n,
        (i) => crossUp(m.macd, m.signal, i),
        (i) => crossDown(m.macd, m.signal, i),
      )
    }
    case 'ema': {
      const fast = ema(closes, params.fast)
      const slow = ema(closes, params.slow)
      return buildSignals(n, (i) => crossUp(fast, slow, i), (i) => crossDown(fast, slow, i))
    }
    case 'sma': {
      const fast = sma(closes, params.fast)
      const slow = sma(closes, params.slow)
      return buildSignals(n, (i) => crossUp(fast, slow, i), (i) => crossDown(fast, slow, i))
    }
    case 'supertrend': {
      const st = supertrend(highs, lows, closes, params.period, params.mult)
      return buildSignals(
        n,
        (i) => i > 0 && st.trend[i] === 1 && st.trend[i - 1] === -1,
        (i) => i > 0 && st.trend[i] === -1 && st.trend[i - 1] === 1,
      )
    }
    case 'psar': {
      const sar = psar(highs, lows, params.step, params.max)
      return buildSignals(n, (i) => crossUp(closes, sar, i), (i) => crossDown(closes, sar, i))
    }
    case 'donchian': {
      const d = donchian(highs, lows, params.period)
      return buildSignals(
        n,
        (i) => crossUp(closes, d.upper, i),
        (i) => crossDown(closes, d.lower, i),
      )
    }
    case 'rsi': {
      const r = rsi(closes, params.period)
      const osLevel = closes.map(() => params.oversold)
      const obLevel = closes.map(() => params.overbought)
      return buildSignals(
        n,
        (i) => crossUp(r, osLevel, i),
        (i) => crossDown(r, obLevel, i),
      )
    }
    case 'stochastic': {
      const s = stochastic(highs, lows, closes, params.kPeriod, params.kSmooth, params.dPeriod)
      return buildSignals(n, (i) => crossUp(s.k, s.d, i), (i) => crossDown(s.k, s.d, i))
    }
    case 'stochrsi': {
      const s = stochRsi(closes, params.rsiPeriod, params.stochPeriod, params.kSmooth, params.dSmooth)
      return buildSignals(n, (i) => crossUp(s.k, s.d, i), (i) => crossDown(s.k, s.d, i))
    }
    case 'cci': {
      const c = cci(highs, lows, closes, params.period)
      const lower = closes.map(() => -100)
      const upper = closes.map(() => 100)
      return buildSignals(n, (i) => crossUp(c, lower, i), (i) => crossDown(c, upper, i))
    }
    case 'williamsr': {
      const w = williamsR(highs, lows, closes, params.period)
      const lower = closes.map(() => -80)
      const upper = closes.map(() => -20)
      return buildSignals(n, (i) => crossUp(w, lower, i), (i) => crossDown(w, upper, i))
    }
    case 'bollinger': {
      const b = bollinger(closes, params.period, params.mult)
      return buildSignals(
        n,
        (i) => crossUp(closes, b.lower, i),
        (i) => crossDown(closes, b.upper, i),
      )
    }
    case 'elliott': {
      const pivots = ewZigZag(candles, params.zigzag ?? 3)
      const signals: Signal[] = candles.map(() => null)
      for (const piv of pivots) {
        const next = piv.idx + 1
        if (next < n) signals[next] = piv.kind === 'low' ? 'buy' : 'sell'
      }
      return signals
    }
    case 'traderxo': {
      const fastEma = ema(closes, params.fast)
      const slowEma = ema(closes, params.slow)
      // Signal fires at the EMA crossover bar, matching the Pine Script arrows.
      // maLen/rsiLen/stochLen params are available as visual overlays on the web app
      // but not used as entry conditions (they are background-only on TradingView).
      return buildSignals(
        n,
        (i) => crossUp(fastEma, slowEma, i),
        (i) => crossDown(fastEma, slowEma, i),
      )
    }
  }
}

// ── Chart overlay data ──────────────────────────────────────────────────────
// Returns indicator series (mainLines, subPane) for a strategy so the dashboard
// can render overlays on the LW Charts candlestick chart. No signal logic here —
// signal computation stays in generateSignals.

export interface SeriesLine {
  id: string
  color: string
  data: Array<{ time: number; value: number }>
}

export interface ChartDataOutput {
  mainLines: SeriesLine[]
  subPane?: {
    title: string
    lines: SeriesLine[]
    refLines?: number[]
  }
  waveMarkers?: Array<{ time: number; label: string; position: 'aboveBar' | 'belowBar' }>
  priceLines?: Array<{ price: number; color: string; label: string }>
}

function toLine(
  times: number[],
  values: number[],
): Array<{ time: number; value: number }> {
  return times
    .map((t, i) => ({ time: t, value: values[i] }))
    .filter((p) => isFinite(p.value))
}

export function generateChartData(
  id: StrategyId,
  candles: Candle[],
  params: Record<string, number>,
): ChartDataOutput {
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const times = candles.map((c) => c.time)

  switch (id) {
    case 'macd': {
      const m = macd(closes, params.fast, params.slow, params.signal)
      return {
        mainLines: [],
        subPane: {
          title: 'MACD',
          lines: [
            { id: 'macd',   color: '#3b9eff', data: toLine(times, m.macd) },
            { id: 'signal', color: '#ff9f43', data: toLine(times, m.signal) },
          ],
        },
      }
    }
    case 'ema': {
      const fast = ema(closes, params.fast)
      const slow = ema(closes, params.slow)
      return {
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
        mainLines: [
          { id: 'smaFast', color: '#3b9eff', data: toLine(times, fast) },
          { id: 'smaSlow', color: '#ff9f43', data: toLine(times, slow) },
        ],
      }
    }
    case 'supertrend': {
      const st = supertrend(highs, lows, closes, params.period, params.mult)
      return {
        mainLines: [
          { id: 'supertrend', color: '#a78bfa', data: toLine(times, st.line) },
        ],
      }
    }
    case 'psar': {
      const sar = psar(highs, lows, params.step, params.max)
      return {
        mainLines: [{ id: 'psar', color: '#a78bfa', data: toLine(times, sar) }],
      }
    }
    case 'donchian': {
      const d = donchian(highs, lows, params.period)
      return {
        mainLines: [
          { id: 'dcUpper', color: 'rgba(237,75,75,0.7)',   data: toLine(times, d.upper) },
          { id: 'dcLower', color: 'rgba(29,191,115,0.7)',  data: toLine(times, d.lower) },
        ],
      }
    }
    case 'rsi': {
      const r = rsi(closes, params.period)
      return {
        mainLines: [],
        subPane: {
          title: 'RSI',
          lines: [{ id: 'rsi', color: '#c084fc', data: toLine(times, r) }],
          refLines: [params.oversold ?? 30, params.overbought ?? 70],
        },
      }
    }
    case 'stochastic': {
      const s = stochastic(highs, lows, closes, params.kPeriod, params.kSmooth, params.dPeriod)
      return {
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
      const s = stochRsi(closes, params.rsiPeriod, params.stochPeriod, params.kSmooth, params.dSmooth)
      return {
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
      return {
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
      return {
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
        mainLines: [
          { id: 'bbUpper', color: 'rgba(237,75,75,0.7)',  data: toLine(times, b.upper) },
          { id: 'bbMid',   color: 'rgba(150,150,150,0.6)', data: toLine(times, b.mid) },
          { id: 'bbLower', color: 'rgba(29,191,115,0.7)', data: toLine(times, b.lower) },
        ],
      }
    }
    case 'elliott': {
      const pivots = ewZigZag(candles, params.zigzag ?? 3)
      const zigzagData = pivots.map((p) => ({
        time: candles[p.idx].time,
        value: p.kind === 'high' ? candles[p.idx].high : candles[p.idx].low,
      }))
      const waveLabels = ['①', '②', '③', '④', '⑤']
      const waveMarkers = pivots.slice(0, 5).map((p, i) => ({
        time: candles[p.idx].time,
        label: waveLabels[i] ?? `${i + 1}`,
        position: (p.kind === 'high' ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
      }))
      return {
        mainLines: [{ id: 'zigzag', color: 'rgba(167,139,250,0.8)', data: zigzagData }],
        waveMarkers,
      }
    }
    case 'traderxo': {
      const fastEma = ema(closes, params.fast)
      const slowEma = ema(closes, params.slow)
      const maFilter = ema(closes, params.maLen)
      const sr = stochRsi(closes, params.rsiLen, params.stochLen, 3, 3)
      return {
        mainLines: [
          { id: 'txoFast', color: '#3b9eff', data: toLine(times, fastEma) },
          { id: 'txoSlow', color: '#ff9f43', data: toLine(times, slowEma) },
          { id: 'txoMA',   color: 'rgba(167,139,250,0.5)', data: toLine(times, maFilter) },
        ],
        subPane: {
          title: 'StochRSI',
          lines: [
            { id: 'txoK', color: '#3b9eff', data: toLine(times, sr.k) },
            { id: 'txoD', color: '#ff9f43', data: toLine(times, sr.d) },
          ],
          refLines: [20, 50, 80],
        },
      }
    }
  }
}
