// Technical indicator math. Ported verbatim from the web app's
// src/lib/indicators.ts so the bot evaluates signals identically to the
// backtester. All functions return arrays aligned to the input, with NaN
// for positions where the indicator is not yet defined.

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
  trend: number[]
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

// ADX + Directional Movement Index. Mirrors src/lib/indicators.ts (web).
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

// Ichimoku Cloud. Senkou A/B at bar i = the value from `displacement` bars ago
// (so the cloud at the current bar is computed from past data only).
export interface IchimokuResult {
  tenkan: number[]; kijun: number[]; senkouA: number[]; senkouB: number[]; chikou: number[]
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
  const senkouA = senkouARaw.map((_, i) => (i - displacement >= 0 ? senkouARaw[i - displacement] : NaN))
  const senkouB = senkouBRaw.map((_, i) => (i - displacement >= 0 ? senkouBRaw[i - displacement] : NaN))
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

export function crossDown(a: number[], b: number[], i: number): boolean {
  if (i < 1) return false
  const a0 = a[i - 1]
  const a1 = a[i]
  const b0 = b[i - 1]
  const b1 = b[i]
  if ([a0, a1, b0, b1].some(Number.isNaN)) return false
  return a0 >= b0 && a1 < b1
}
