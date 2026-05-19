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

export interface StrategyOutput {
  signals: Signal[]
  mainLines: SeriesLine[]
  subPane?: {
    title: string
    lines: SeriesLine[]
    hist?: HistPoint[]
    refLines?: number[]
  }
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
  }
}
