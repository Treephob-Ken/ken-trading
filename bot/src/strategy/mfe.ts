// MFE (Maximum Favorable Excursion) analysis for TP suggestion.
//
// Walks the strategy's historical signals on `lookbackBars` of candles, and
// for each entry signal measures how far price ran in the trade's favor
// before the next opposite signal (the "max favorable excursion").
//
// The TP suggestion is the median (P50) of that distribution: setting TP
// there means roughly half of past trades would have hit the target, which
// is a reasonable middle-ground between "lock profit quickly" and "let it
// run". The full distribution (avg / median / P25 / P75) is returned so
// the UI can show users the spread instead of a single magic number.

import { fetchKlines } from './market-data.js'
import { generateSignals, type StrategyId, type Candle, type Signal } from './strategies.js'

export interface MfeStats {
  count: number     // number of qualifying past trades
  avg: number       // mean MFE %
  median: number    // P50 MFE %
  p25: number       // P25 MFE %
  p75: number       // P75 MFE %
  suggestion: number | null  // suggested TP % (= median) or null if too few signals
}

export interface MfeResult {
  buy: MfeStats | null
  sell: MfeStats | null
  // Combined suggestion: max of buy/sell (so we never under-shoot either
  // direction). When tradeSide is restricted, the bot picks the right one.
  symbol: string
  timeframe: string
  strategyId: StrategyId
  lookbackBars: number
  computedAt: number
}

const LOOKBACK_BARS = 500
const MIN_SIGNALS = 10

// Public: compute MFE stats for a bot's exact strategy/symbol/timeframe.
export async function computeMfeStats(
  symbol: string,
  timeframe: string,
  strategyId: StrategyId,
  params: Record<string, number>,
): Promise<MfeResult> {
  const candles: Candle[] = await fetchKlines(symbol, timeframe, LOOKBACK_BARS)
  const result: MfeResult = {
    buy: null,
    sell: null,
    symbol,
    timeframe,
    strategyId,
    lookbackBars: candles.length,
    computedAt: Date.now(),
  }
  if (candles.length < 50) return result

  const signals: Signal[] = generateSignals(strategyId, candles, params)

  const buyMfes: number[] = []
  const sellMfes: number[] = []

  for (let i = 0; i < signals.length - 1; i++) {
    const sig = signals[i]
    if (sig !== 'buy' && sig !== 'sell') continue
    const entryPx = candles[i].close
    if (!(entryPx > 0)) continue

    // Find next opposite signal — that's the exit boundary for this trade.
    let exitIdx = signals.length - 1
    for (let j = i + 1; j < signals.length; j++) {
      if (signals[j] && signals[j] !== sig) { exitIdx = j; break }
    }

    if (sig === 'buy') {
      let maxHigh = entryPx
      for (let k = i + 1; k <= exitIdx; k++) {
        if (candles[k].high > maxHigh) maxHigh = candles[k].high
      }
      const mfe = ((maxHigh - entryPx) / entryPx) * 100
      if (mfe > 0) buyMfes.push(mfe)
    } else {
      let minLow = entryPx
      for (let k = i + 1; k <= exitIdx; k++) {
        if (candles[k].low < minLow) minLow = candles[k].low
      }
      const mfe = ((entryPx - minLow) / entryPx) * 100
      if (mfe > 0) sellMfes.push(mfe)
    }
  }

  result.buy = summarize(buyMfes)
  result.sell = summarize(sellMfes)
  return result
}

function summarize(xs: number[]): MfeStats | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const n = sorted.length
  const avg = sorted.reduce((s, v) => s + v, 0) / n
  const median = pct(sorted, 0.5)
  const p25 = pct(sorted, 0.25)
  const p75 = pct(sorted, 0.75)
  const suggestion = n >= MIN_SIGNALS ? round(median) : null
  return {
    count: n,
    avg: round(avg),
    median: round(median),
    p25: round(p25),
    p75: round(p75),
    suggestion,
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function round(x: number): number {
  return Math.round(x * 100) / 100
}
