// Technical indicator math. All functions return arrays aligned to the input,
// with NaN for positions where the indicator is not yet defined.

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    let ok = true
    for (let j = i - period + 1; j <= i; j++) {
      if (Number.isNaN(values[j])) {
        ok = false
        break
      }
      sum += values[j]
    }
    if (ok) out[i] = sum / period
  }
  return out
}

// EMA that tolerates leading NaN values (seeds with an SMA of the first
// `period` valid values). Works for both price series and derived series.
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  const k = 2 / (period + 1)
  let prev = NaN
  let count = 0
  let seed = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) continue
    if (Number.isNaN(prev)) {
      count++
      seed += v
      if (count === period) {
        prev = seed / period
        out[i] = prev
      }
    } else {
      prev = v * k + prev * (1 - k)
      out[i] = prev
    }
  }
  return out
}

// Wilder's smoothing (running moving average, alpha = 1/period).
export function rma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  let prev = NaN
  let count = 0
  let seed = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) continue
    if (Number.isNaN(prev)) {
      count++
      seed += v
      if (count === period) {
        prev = seed / period
        out[i] = prev
      }
    } else {
      prev = (prev * (period - 1) + v) / period
      out[i] = prev
    }
  }
  return out
}

export function rollingMax(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  for (let i = period - 1; i < values.length; i++) {
    let m = -Infinity
    let ok = true
    for (let j = i - period + 1; j <= i; j++) {
      if (Number.isNaN(values[j])) {
        ok = false
        break
      }
      if (values[j] > m) m = values[j]
    }
    if (ok) out[i] = m
  }
  return out
}

export function rollingMin(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  for (let i = period - 1; i < values.length; i++) {
    let m = Infinity
    let ok = true
    for (let j = i - period + 1; j <= i; j++) {
      if (Number.isNaN(values[j])) {
        ok = false
        break
      }
      if (values[j] < m) m = values[j]
    }
    if (ok) out[i] = m
  }
  return out
}

export interface MacdResult {
  macd: number[]
  signal: number[]
  hist: number[]
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult {
  const fastEma = ema(closes, fast)
  const slowEma = ema(closes, slow)
  const macdLine = closes.map((_, i) =>
    Number.isNaN(fastEma[i]) || Number.isNaN(slowEma[i])
      ? NaN
      : fastEma[i] - slowEma[i],
  )
  const signal = ema(macdLine, signalPeriod)
  const hist = macdLine.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(signal[i]) ? NaN : v - signal[i],
  )
  return { macd: macdLine, signal, hist }
}

// Wilder's RSI.
export function rsi(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN)
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    const gain = Math.max(change, 0)
    const loss = Math.max(-change, 0)
    if (i <= period) {
      avgGain += gain
      avgLoss += loss
      if (i === period) {
        avgGain /= period
        avgLoss /= period
        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
        out[i] = 100 - 100 / (1 + rs)
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
      out[i] = 100 - 100 / (1 + rs)
    }
  }
  return out
}

export interface BollingerResult {
  mid: number[]
  upper: number[]
  lower: number[]
}

export function bollinger(
  closes: number[],
  period: number,
  mult: number,
): BollingerResult {
  const mid = new Array<number>(closes.length).fill(NaN)
  const upper = new Array<number>(closes.length).fill(NaN)
  const lower = new Array<number>(closes.length).fill(NaN)
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]
    const m = sum / period
    let sq = 0
    for (let j = i - period + 1; j <= i; j++) sq += (closes[j] - m) ** 2
    const sd = Math.sqrt(sq / period)
    mid[i] = m
    upper[i] = m + mult * sd
    lower[i] = m - mult * sd
  }
  return { mid, upper, lower }
}

// Average True Range (Wilder).
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number[] {
  const tr = new Array<number>(highs.length).fill(NaN)
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      tr[i] = highs[i] - lows[i]
    } else {
      tr[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      )
    }
  }
  return rma(tr, period)
}

export interface SupertrendResult {
  line: number[]
  trend: number[] // 1 = up, -1 = down
}

export function supertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
  mult: number,
): SupertrendResult {
  const n = closes.length
  const a = atr(highs, lows, closes, period)
  const line = new Array<number>(n).fill(NaN)
  const trend = new Array<number>(n).fill(0)
  let finalUpper = NaN
  let finalLower = NaN
  let prevTrend = 1
  let started = false

  for (let i = 0; i < n; i++) {
    if (Number.isNaN(a[i]) || i === 0) continue
    const hl2 = (highs[i] + lows[i]) / 2
    const basicUpper = hl2 + mult * a[i]
    const basicLower = hl2 - mult * a[i]

    const fu =
      Number.isNaN(finalUpper) ||
      basicUpper < finalUpper ||
      closes[i - 1] > finalUpper
        ? basicUpper
        : finalUpper
    const fl =
      Number.isNaN(finalLower) ||
      basicLower > finalLower ||
      closes[i - 1] < finalLower
        ? basicLower
        : finalLower

    let curTrend: number
    if (!started) {
      curTrend = 1
      started = true
    } else if (prevTrend === 1) {
      curTrend = closes[i] < fl ? -1 : 1
    } else {
      curTrend = closes[i] > fu ? 1 : -1
    }

    line[i] = curTrend === 1 ? fl : fu
    trend[i] = curTrend
    finalUpper = fu
    finalLower = fl
    prevTrend = curTrend
  }
  return { line, trend }
}

// Parabolic SAR.
export function psar(
  highs: number[],
  lows: number[],
  step: number,
  maxStep: number,
): number[] {
  const n = highs.length
  const out = new Array<number>(n).fill(NaN)
  if (n < 2) return out

  let trendUp = highs[1] >= highs[0]
  let sar = trendUp ? lows[0] : highs[0]
  let ep = trendUp ? highs[1] : lows[1]
  let af = step
  out[1] = sar

  for (let i = 2; i < n; i++) {
    sar = sar + af * (ep - sar)
    if (trendUp) {
      sar = Math.min(sar, lows[i - 1], lows[i - 2])
      if (lows[i] < sar) {
        trendUp = false
        sar = ep
        ep = lows[i]
        af = step
      } else if (highs[i] > ep) {
        ep = highs[i]
        af = Math.min(af + step, maxStep)
      }
    } else {
      sar = Math.max(sar, highs[i - 1], highs[i - 2])
      if (highs[i] > sar) {
        trendUp = true
        sar = ep
        ep = highs[i]
        af = step
      } else if (lows[i] < ep) {
        ep = lows[i]
        af = Math.min(af + step, maxStep)
      }
    }
    out[i] = sar
  }
  return out
}

export interface StochResult {
  k: number[]
  d: number[]
}

export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number,
  kSmooth: number,
  dPeriod: number,
): StochResult {
  const hh = rollingMax(highs, kPeriod)
  const ll = rollingMin(lows, kPeriod)
  const rawK = closes.map((c, i) => {
    if (Number.isNaN(hh[i]) || Number.isNaN(ll[i])) return NaN
    return hh[i] === ll[i] ? 50 : (100 * (c - ll[i])) / (hh[i] - ll[i])
  })
  const k = sma(rawK, kSmooth)
  const d = sma(k, dPeriod)
  return { k, d }
}

export function stochRsi(
  closes: number[],
  rsiPeriod: number,
  stochPeriod: number,
  kSmooth: number,
  dSmooth: number,
): StochResult {
  const r = rsi(closes, rsiPeriod)
  const hh = rollingMax(r, stochPeriod)
  const ll = rollingMin(r, stochPeriod)
  const raw = r.map((v, i) => {
    if (Number.isNaN(v) || Number.isNaN(hh[i]) || Number.isNaN(ll[i])) return NaN
    return hh[i] === ll[i] ? 50 : (100 * (v - ll[i])) / (hh[i] - ll[i])
  })
  const k = sma(raw, kSmooth)
  const d = sma(k, dSmooth)
  return { k, d }
}

export function cci(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number[] {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3)
  const ma = sma(tp, period)
  const out = new Array<number>(closes.length).fill(NaN)
  for (let i = period - 1; i < closes.length; i++) {
    if (Number.isNaN(ma[i])) continue
    let dev = 0
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - ma[i])
    dev /= period
    out[i] = dev === 0 ? 0 : (tp[i] - ma[i]) / (0.015 * dev)
  }
  return out
}

export function williamsR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number[] {
  const hh = rollingMax(highs, period)
  const ll = rollingMin(lows, period)
  return closes.map((c, i) => {
    if (Number.isNaN(hh[i]) || Number.isNaN(ll[i])) return NaN
    return hh[i] === ll[i] ? -50 : (-100 * (hh[i] - c)) / (hh[i] - ll[i])
  })
}

export interface DonchianResult {
  upper: number[]
  lower: number[]
}

// Channel built from the `period` bars PRIOR to each bar, so a close beyond
// the channel is a genuine breakout of the recent range.
export function donchian(
  highs: number[],
  lows: number[],
  period: number,
): DonchianResult {
  const n = highs.length
  const upper = new Array<number>(n).fill(NaN)
  const lower = new Array<number>(n).fill(NaN)
  for (let i = period; i < n; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - period; j < i; j++) {
      if (highs[j] > hi) hi = highs[j]
      if (lows[j] < lo) lo = lows[j]
    }
    upper[i] = hi
    lower[i] = lo
  }
  return { upper, lower }
}

// True when series `a` crosses from at-or-below `b` to strictly above it.
// ADX + Directional Movement Index. Wilder's classic trend-strength indicator.
// adx > 20 indicates a real trend; +di > -di = uptrend, -di > +di = downtrend.
export interface AdxResult { plusDI: number[]; minusDI: number[]; adx: number[] }
export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): AdxResult {
  const n = highs.length
  const tr = new Array<number>(n).fill(NaN)
  const plusDM = new Array<number>(n).fill(0)
  const minusDM = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = highs[i] - lows[i]; continue }
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    )
    const upMove = highs[i] - highs[i - 1]
    const downMove = lows[i - 1] - lows[i]
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0
  }
  const atrSm = rma(tr, period)
  const plusDMSm = rma(plusDM, period)
  const minusDMSm = rma(minusDM, period)
  const plusDI = atrSm.map((a, i) => (a > 0 ? 100 * (plusDMSm[i] / a) : NaN))
  const minusDI = atrSm.map((a, i) => (a > 0 ? 100 * (minusDMSm[i] / a) : NaN))
  const dx = plusDI.map((pdi, i) => {
    const sum = pdi + minusDI[i]
    if (sum <= 0 || Number.isNaN(sum)) return NaN
    return 100 * Math.abs(pdi - minusDI[i]) / sum
  })
  const adxLine = rma(dx, period)
  return { plusDI, minusDI, adx: adxLine }
}

// Ichimoku Cloud — Tenkan-sen (conversion line), Kijun-sen (base line),
// Senkou A/B (cloud top/bottom), Chikou (lagging). Values past the current bar
// (the cloud is plotted `displacement` bars into the future) are NOT included
// in the returned arrays at the current index — they're real cloud values
// computed from history N bars ago.
export interface IchimokuResult {
  tenkan: number[]      // (period highest+lowest)/2 over `tenkanPeriod`
  kijun: number[]       // same over `kijunPeriod`
  senkouA: number[]     // (tenkan+kijun)/2, plotted `displacement` bars forward — here, the cloud value AT this bar (computed from `displacement` bars ago)
  senkouB: number[]     // (period highest+lowest)/2 over `senkouBPeriod`, plotted `displacement` bars forward
  chikou: number[]      // closes, plotted `displacement` bars back — here, close from `displacement` bars ago
}
export function ichimoku(
  highs: number[],
  lows: number[],
  closes: number[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  senkouBPeriod = 52,
  displacement = 26,
): IchimokuResult {
  const n = highs.length
  const mid = (h: number[], l: number[], p: number, idx: number): number => {
    if (idx + 1 < p) return NaN
    let hi = -Infinity, lo = Infinity
    for (let k = idx - p + 1; k <= idx; k++) {
      if (h[k] > hi) hi = h[k]
      if (l[k] < lo) lo = l[k]
    }
    return (hi + lo) / 2
  }
  const tenkan = new Array<number>(n).fill(NaN)
  const kijun = new Array<number>(n).fill(NaN)
  const senkouARaw = new Array<number>(n).fill(NaN)
  const senkouBRaw = new Array<number>(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    tenkan[i] = mid(highs, lows, tenkanPeriod, i)
    kijun[i] = mid(highs, lows, kijunPeriod, i)
    senkouARaw[i] = !Number.isNaN(tenkan[i]) && !Number.isNaN(kijun[i]) ? (tenkan[i] + kijun[i]) / 2 : NaN
    senkouBRaw[i] = mid(highs, lows, senkouBPeriod, i)
  }
  // Shift senkou forward by `displacement` — the cloud value AT bar i is the
  // value computed `displacement` bars ago. Backtest-safe (uses past data only).
  const senkouA = senkouARaw.map((_, i) => (i - displacement >= 0 ? senkouARaw[i - displacement] : NaN))
  const senkouB = senkouBRaw.map((_, i) => (i - displacement >= 0 ? senkouBRaw[i - displacement] : NaN))
  // Chikou shifted back: at bar i, chikou is the close from `displacement` bars later.
  // For real-time use we expose it as the close from `displacement` bars ago so it's
  // always defined for past bars and never peeks into the future.
  const chikou = closes.map((_, i) => (i - displacement >= 0 ? closes[i - displacement] : NaN))
  return { tenkan, kijun, senkouA, senkouB, chikou }
}

export function crossUp(a: number[], b: number[], i: number): boolean {
  if (i < 1) return false
  const a0 = a[i - 1]
  const a1 = a[i]
  const b0 = b[i - 1]
  const b1 = b[i]
  if ([a0, a1, b0, b1].some(Number.isNaN)) return false
  return a0 <= b0 && a1 > b1
}

// True when series `a` crosses from at-or-above `b` to strictly below it.
export function crossDown(a: number[], b: number[], i: number): boolean {
  if (i < 1) return false
  const a0 = a[i - 1]
  const a1 = a[i]
  const b0 = b[i - 1]
  const b1 = b[i]
  if ([a0, a1, b0, b1].some(Number.isNaN)) return false
  return a0 >= b0 && a1 < b1
}

// ── Smart Money Concepts — swing structure (BOS / CHoCH) ─────────────────────
//
// Port of the core swing-structure detector from LuxAlgo's Smart Money Concepts
// Pine indicator. Walks the bars maintaining a leg state (bullish/bearish),
// places a swing pivot at the start of each new leg, then fires a signal when
// price closes through the most recent pivot:
//
//   close > last swing high → "Bullish CHoCH" (if prior bias was bearish)
//                            or "Bullish BOS"  (if prior bias was already bullish)
//   close < last swing low  → "Bearish CHoCH" (if prior bias was bullish)
//                            or "Bearish BOS"  (if prior bias was already bearish)
//
// signalMode controls which fire as trade signals:
//   'choch'     → only CHoCH (regime flips). Fewer but higher-conviction signals.
//   'both'      → CHoCH + BOS. Continuation trades included; more signals.

export interface SMCResult {
  // Per-bar buy/sell signals (null = no signal).
  signals: ('buy' | 'sell' | null)[]
  // Side history of the most-recent swing pivots — useful for charting later.
  swingHighs: { time: number; level: number; bar: number }[]
  swingLows:  { time: number; level: number; bar: number }[]
  // Every structure break (both BOS and CHoCH, regardless of signalMode) so the
  // chart can label them. Display-only — does not affect signals.
  breaks: { time: number; kind: 'BOS' | 'CHoCH'; bias: 'bullish' | 'bearish' }[]
}

export type SMCSignalMode = 'choch' | 'both'

export function smcStructure(
  highs: number[],
  lows: number[],
  closes: number[],
  times: number[],
  swingSize: number,
  signalMode: SMCSignalMode,
): SMCResult {
  const n = highs.length
  const signals: ('buy' | 'sell' | null)[] = new Array(n).fill(null)
  const swingHighs: SMCResult['swingHighs'] = []
  const swingLows:  SMCResult['swingLows']  = []
  const breaks: SMCResult['breaks'] = []
  if (n < swingSize + 2 || swingSize < 2) return { signals, swingHighs, swingLows, breaks }

  // Pine `var leg = 0` → start bearish; flips when newLegHigh / newLegLow fires.
  let leg = 0       // 0 = bearish leg, 1 = bullish leg
  let prevLeg = 0
  // Most recent pivots — these are what we watch for cross breaks.
  let pendingHigh: { level: number; bar: number; crossed: boolean } | null = null
  let pendingLow:  { level: number; bar: number; crossed: boolean } | null = null
  // Trend bias — flipped on each cross. 0 unknown, 1 bullish, -1 bearish.
  let bias: 0 | 1 | -1 = 0

  for (let i = swingSize; i < n; i++) {
    // Mirror PineScript's leg() — was the bar `swingSize` ago the highest /
    // lowest of the rolling window that includes the current bar?
    const refIdx = i - swingSize
    let maxRange = -Infinity
    let minRange = Infinity
    for (let k = refIdx + 1; k <= i; k++) {
      if (highs[k] > maxRange) maxRange = highs[k]
      if (lows[k] < minRange) minRange = lows[k]
    }
    const newLegHigh = highs[refIdx] > maxRange
    const newLegLow  = lows[refIdx]  < minRange

    prevLeg = leg
    if (newLegHigh) leg = 0
    else if (newLegLow) leg = 1
    const startOfNewLeg = leg !== prevLeg

    if (startOfNewLeg) {
      if (leg === 1) {
        // New bullish leg → swing low confirmed at refIdx.
        pendingLow = { level: lows[refIdx], bar: refIdx, crossed: false }
        swingLows.push({ time: times[refIdx], level: lows[refIdx], bar: refIdx })
      } else {
        // New bearish leg → swing high confirmed at refIdx.
        pendingHigh = { level: highs[refIdx], bar: refIdx, crossed: false }
        swingHighs.push({ time: times[refIdx], level: highs[refIdx], bar: refIdx })
      }
    }

    // BOS / CHoCH detection — close cross through the latest pivot.
    if (pendingHigh && !pendingHigh.crossed && closes[i] > pendingHigh.level) {
      const isChoch = bias === -1
      pendingHigh.crossed = true
      bias = 1
      breaks.push({ time: times[i], kind: isChoch ? 'CHoCH' : 'BOS', bias: 'bullish' })
      if (signalMode === 'both' || isChoch) signals[i] = 'buy'
    }
    if (pendingLow && !pendingLow.crossed && closes[i] < pendingLow.level) {
      const isChoch = bias === 1
      pendingLow.crossed = true
      bias = -1
      breaks.push({ time: times[i], kind: isChoch ? 'CHoCH' : 'BOS', bias: 'bearish' })
      if (signalMode === 'both' || isChoch) signals[i] = 'sell'
    }
  }

  return { signals, swingHighs, swingLows, breaks }
}
