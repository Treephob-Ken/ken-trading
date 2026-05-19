import type { Candle } from '@/types'

// ---------------------------------------------------------------------------
// Grid trading optimizer.
//
// A grid bot places buy/sell limit orders at fixed price levels inside a
// range. Profit comes from harvesting oscillation: buy a cell's lower line,
// sell its upper line, repeat. This module simulates that over a window of
// candles and sweeps the grid count to find the most profitable setup.
// ---------------------------------------------------------------------------

export type GridMode = 'arithmetic' | 'geometric'
export type GridType = 'neutral' | 'long' | 'short'

const YEAR_MS = 365 * 24 * 3600 * 1000

// Milliseconds per bar, used to annualize returns.
export const TF_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
}

export interface GridParams {
  lookback: number
  minGrids: number
  maxGrids: number
  mode: GridMode
  type: GridType
  investment: number
  feeRate: number // taker fee per side, as a fraction (0.0005 = 0.05%)
}

export interface GridSim {
  gridCount: number // number of cells (intervals)
  lines: number[] // grid line prices, ascending — length gridCount + 1
  spacing: number // average spacing between lines (price units)
  spacingPct: number // spacing as % of the anchor price
  completedTrades: number // closed buy→sell roundtrips
  fills: number // total order fills (buys + sells)
  realizedPnl: number // profit booked on closed roundtrips, net of fees
  realizedPct: number
  unrealizedPnl: number // floating PnL on inventory still held at the end
  unrealizedPct: number
  totalPnl: number
  totalReturnPct: number
  feesPaid: number
  openInventoryValue: number
  maxDrawdownPct: number
  equityCurve: { time: number; value: number }[]
}

export interface MarketFit {
  efficiencyRatio: number // Kaufman ER, 0..1 — low = choppy (good for grids)
  atrPct: number // average bar range as % of price
  rangePct: number // window high-to-low spread as % of price
  score: number // 0..100 grid suitability
  verdict: 'Excellent' | 'Good' | 'Marginal' | 'Poor'
}

export interface GridOptimizeResult {
  lower: number
  upper: number
  anchor: number
  best: GridSim
  sweep: { gridCount: number; totalPnl: number; realizedPnl: number; trades: number }[]
  breakevenPct: number // minimum spacing % to cover round-trip fees
  breakevenAbs: number
  market: MarketFit
}

export interface GridLine {
  price: number
  kind: 'long' | 'short' | 'mid'
}

// Build ascending grid line prices. Arithmetic = equal price gaps;
// geometric = equal percentage gaps (better for volatile assets).
function buildLines(
  lower: number,
  upper: number,
  count: number,
  mode: GridMode,
): number[] {
  const lines: number[] = []
  if (mode === 'geometric' && lower > 0) {
    const r = Math.pow(upper / lower, 1 / count)
    for (let i = 0; i <= count; i++) lines.push(lower * Math.pow(r, i))
  } else {
    const step = (upper - lower) / count
    for (let i = 0; i <= count; i++) lines.push(lower + step * i)
  }
  return lines
}

interface SimOpts {
  mode: GridMode
  type: GridType
  investment: number
  feeRate: number
}

// Simulate one grid configuration over a window of candles. Each cell holds at
// most one unit: it buys when price crosses its lower line downward and sells
// when price crosses its upper line upward. To capture intrabar oscillation
// the candle is walked as open→low→high→close (or the reverse for down bars).
export function simulateGrid(
  window: Candle[],
  lower: number,
  upper: number,
  count: number,
  opts: SimOpts,
): GridSim {
  const lines = buildLines(lower, upper, count, opts.mode)
  const anchor = window[window.length - 1]?.close ?? (lower + upper) / 2
  const capitalPerCell = opts.investment / count
  const buyFee = opts.feeRate * capitalPerCell
  const qty: number[] = []
  for (let k = 0; k < count; k++) qty.push(capitalPerCell / lines[k])

  const cellActive = (k: number): boolean => {
    if (opts.type === 'long') return lines[k] < anchor
    if (opts.type === 'short') return lines[k] >= anchor
    return true
  }

  const holding = new Array<boolean>(count).fill(false)
  let realizedPnl = 0
  let feesPaid = 0
  let fills = 0
  let completedTrades = 0
  const equityCurve: { time: number; value: number }[] = []

  const unrealizedAt = (price: number): number => {
    let u = 0
    for (let k = 0; k < count; k++) {
      if (holding[k]) u += qty[k] * (price - lines[k]) - buyFee
    }
    return u
  }

  let prevClose = window[0]?.open ?? anchor

  for (const c of window) {
    const path =
      c.close >= c.open
        ? [prevClose, c.open, c.low, c.high, c.close]
        : [prevClose, c.open, c.high, c.low, c.close]

    for (let s = 0; s < path.length - 1; s++) {
      const a = path[s]
      const b = path[s + 1]
      if (b > a) {
        // crossing up — sell the cell below each crossed line
        for (let i = 1; i < lines.length; i++) {
          if (lines[i] > a && lines[i] <= b) {
            const cell = i - 1
            if (holding[cell] && cellActive(cell)) {
              const sellFee = opts.feeRate * qty[cell] * lines[i]
              realizedPnl +=
                qty[cell] * (lines[i] - lines[cell]) - buyFee - sellFee
              feesPaid += sellFee
              holding[cell] = false
              fills++
              completedTrades++
            }
          }
        }
      } else if (b < a) {
        // crossing down — buy the cell whose lower line was crossed
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i] < a && lines[i] >= b && i < count) {
            if (!holding[i] && cellActive(i)) {
              holding[i] = true
              feesPaid += buyFee
              fills++
            }
          }
        }
      }
    }

    equityCurve.push({
      time: c.time,
      value: opts.investment + realizedPnl + unrealizedAt(c.close),
    })
    prevClose = c.close
  }

  const finalClose = window[window.length - 1]?.close ?? anchor
  const unrealizedPnl = unrealizedAt(finalClose)
  let openInventoryValue = 0
  for (let k = 0; k < count; k++) {
    if (holding[k]) openInventoryValue += qty[k] * finalClose
  }

  let peak = -Infinity
  let maxDrawdownPct = 0
  for (const pt of equityCurve) {
    if (pt.value > peak) peak = pt.value
    if (peak > 0) {
      const dd = ((peak - pt.value) / peak) * 100
      if (dd > maxDrawdownPct) maxDrawdownPct = dd
    }
  }

  let spacingSum = 0
  for (let i = 1; i < lines.length; i++) spacingSum += lines[i] - lines[i - 1]
  const spacing = spacingSum / Math.max(1, lines.length - 1)
  const totalPnl = realizedPnl + unrealizedPnl
  const inv = opts.investment

  return {
    gridCount: count,
    lines,
    spacing,
    spacingPct: anchor > 0 ? (spacing / anchor) * 100 : 0,
    completedTrades,
    fills,
    realizedPnl,
    realizedPct: (realizedPnl / inv) * 100,
    unrealizedPnl,
    unrealizedPct: (unrealizedPnl / inv) * 100,
    totalPnl,
    totalReturnPct: (totalPnl / inv) * 100,
    feesPaid,
    openInventoryValue,
    maxDrawdownPct,
    equityCurve,
  }
}

// Scores how grid-friendly the window is. Grids profit from sideways chop and
// die in strong trends, so a low Kaufman efficiency ratio scores high.
function analyzeMarket(
  window: Candle[],
  lower: number,
  upper: number,
  anchor: number,
): MarketFit {
  let pathSum = 0
  for (let i = 1; i < window.length; i++) {
    pathSum += Math.abs(window[i].close - window[i - 1].close)
  }
  const net = Math.abs(
    (window[window.length - 1]?.close ?? 0) - (window[0]?.close ?? 0),
  )
  const efficiencyRatio = pathSum > 0 ? net / pathSum : 0

  let trSum = 0
  for (const c of window) trSum += c.close > 0 ? (c.high - c.low) / c.close : 0
  const atrPct = window.length ? (trSum / window.length) * 100 : 0
  const rangePct = anchor > 0 ? ((upper - lower) / anchor) * 100 : 0

  const choppiness = 1 - Math.min(1, efficiencyRatio)
  const volFactor = Math.min(1, atrPct / 0.4)
  const score = Math.round(
    Math.max(0, Math.min(100, choppiness * 100 * (0.4 + 0.6 * volFactor))),
  )
  const verdict =
    score >= 70
      ? 'Excellent'
      : score >= 50
        ? 'Good'
        : score >= 30
          ? 'Marginal'
          : 'Poor'

  return { efficiencyRatio, atrPct, rangePct, score, verdict }
}

// Sweep the grid count and keep the configuration with the highest total PnL.
export function optimizeGrid(
  window: Candle[],
  params: GridParams,
): GridOptimizeResult | null {
  if (window.length < 10) return null

  let upper = -Infinity
  let lower = Infinity
  for (const c of window) {
    if (c.high > upper) upper = c.high
    if (c.low < lower) lower = c.low
  }
  if (!(upper > lower)) return null

  const anchor = window[window.length - 1].close
  const lo = Math.max(2, Math.floor(params.minGrids))
  const hi = Math.max(lo, Math.floor(params.maxGrids))

  const sweep: GridOptimizeResult['sweep'] = []
  let best: GridSim | null = null
  for (let n = lo; n <= hi; n++) {
    const sim = simulateGrid(window, lower, upper, n, {
      mode: params.mode,
      type: params.type,
      investment: params.investment,
      feeRate: params.feeRate,
    })
    sweep.push({
      gridCount: n,
      totalPnl: sim.totalPnl,
      realizedPnl: sim.realizedPnl,
      trades: sim.completedTrades,
    })
    if (!best || sim.totalPnl > best.totalPnl) best = sim
  }
  if (!best) return null

  return {
    lower,
    upper,
    anchor,
    best,
    sweep,
    breakevenPct: 2 * params.feeRate * 100,
    breakevenAbs: anchor * 2 * params.feeRate,
    market: analyzeMarket(window, lower, upper, anchor),
  }
}

// Rebuild a grid with the same spacing/count but centered on the current
// price — what you would actually deploy live right now.
export function buildCenteredGrid(
  anchor: number,
  spacing: number,
  count: number,
  mode: GridMode,
): number[] {
  const lines: number[] = []
  const half = Math.floor(count / 2)
  if (mode === 'geometric' && anchor > 0) {
    const r = (anchor + spacing) / anchor
    for (let i = 0; i <= count; i++) lines.push(anchor * Math.pow(r, i - half))
  } else {
    for (let i = 0; i <= count; i++) lines.push(anchor + (i - half) * spacing)
  }
  return lines.filter((x) => x > 0)
}

// Tag each line long (below price) / short (above) / mid (nearest to price).
export function classifyLines(lines: number[], anchor: number): GridLine[] {
  let midIdx = 0
  let midDist = Infinity
  lines.forEach((p, i) => {
    const d = Math.abs(p - anchor)
    if (d < midDist) {
      midDist = d
      midIdx = i
    }
  })
  return lines.map((price, i) => ({
    price,
    kind: i === midIdx ? 'mid' : price < anchor ? 'long' : 'short',
  }))
}

// Annualized return from a return measured over `bars` of `timeframe`.
export function annualize(returnPct: number, bars: number, timeframe: string): number {
  const barMs = TF_MS[timeframe] ?? TF_MS['1h']
  const durationMs = bars * barMs
  if (durationMs <= 0) return 0
  return returnPct * (YEAR_MS / durationMs)
}
