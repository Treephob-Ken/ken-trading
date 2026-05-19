import type {
  BacktestResult,
  Candle,
  Direction,
  EquityPoint,
  Metrics,
  Signal,
  Trade,
  TradeSide,
} from '@/types'

// Long/short backtest. The account is always fully invested while in a
// position. Equity is tracked as a fraction of account value so the same
// model works for longs and shorts. `feeRate` is a fraction charged on both
// entry and exit (e.g. 0.001 = 0.1%).
export function runBacktest(
  candles: Candle[],
  signals: Signal[],
  initialCapital: number,
  feeRate: number,
  direction: Direction,
): BacktestResult {
  let equity = initialCapital
  let position: 'flat' | TradeSide = 'flat'
  let entryPrice = 0
  let entryEquity = 0
  let entryTime = 0

  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []

  // Mark-to-market account value at a given price.
  const markToMarket = (price: number): number => {
    if (position === 'flat') return equity
    const afterEntryFee = entryEquity * (1 - feeRate)
    const ratio = price / entryPrice
    const value =
      position === 'long' ? afterEntryFee * ratio : afterEntryFee * (2 - ratio)
    return Math.max(0, value)
  }

  const openPos = (side: TradeSide, price: number, time: number) => {
    entryEquity = equity
    entryPrice = price
    entryTime = time
    position = side
  }

  const closePos = (price: number, time: number) => {
    if (position === 'flat') return
    const realized = markToMarket(price) * (1 - feeRate)
    const pnl = realized - entryEquity
    trades.push({
      side: position,
      entryTime,
      entryPrice,
      entryEquity,
      exitTime: time,
      exitPrice: price,
      pnl,
      pnlPct: (pnl / entryEquity) * 100,
    })
    equity = realized
    position = 'flat'
  }

  // Read through a function so TS keeps the full union type (the variable is
  // only ever reassigned inside the openPos/closePos closures).
  const pos = (): 'flat' | TradeSide => position

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const sig = signals[i]

    if (sig === 'buy') {
      if (direction === 'long') {
        if (pos() === 'flat') openPos('long', c.close, c.time)
      } else if (direction === 'short') {
        if (pos() === 'short') closePos(c.close, c.time)
      } else {
        // both — always reverse into a long
        if (pos() === 'short') {
          closePos(c.close, c.time)
          openPos('long', c.close, c.time)
        } else if (pos() === 'flat') {
          openPos('long', c.close, c.time)
        }
      }
    } else if (sig === 'sell') {
      if (direction === 'long') {
        if (pos() === 'long') closePos(c.close, c.time)
      } else if (direction === 'short') {
        if (pos() === 'flat') openPos('short', c.close, c.time)
      } else {
        if (pos() === 'long') {
          closePos(c.close, c.time)
          openPos('short', c.close, c.time)
        } else if (pos() === 'flat') {
          openPos('short', c.close, c.time)
        }
      }
    }

    equityCurve.push({ time: c.time, value: markToMarket(c.close) })
  }

  const openPosition =
    position === 'flat' ? null : { side: position, entryTime, entryPrice }
  const metrics = computeMetrics(candles, trades, equityCurve, initialCapital)
  return { trades, equity: equityCurve, metrics, openPosition }
}

function computeMetrics(
  candles: Candle[],
  trades: Trade[],
  equity: EquityPoint[],
  initialCapital: number,
): Metrics {
  const finalEquity = equity.length
    ? equity[equity.length - 1].value
    : initialCapital
  const totalPnl = finalEquity - initialCapital
  const totalReturnPct = (totalPnl / initialCapital) * 100

  const firstClose = candles[0]?.close ?? 0
  const lastClose = candles[candles.length - 1]?.close ?? 0
  const buyHoldReturnPct = firstClose
    ? ((lastClose - firstClose) / firstClose) * 100
    : 0

  const winners = trades.filter((t) => t.pnl > 0)
  const losers = trades.filter((t) => t.pnl <= 0)
  const wins = winners.length
  const losses = losers.length

  const winRate = trades.length ? (wins / trades.length) * 100 : 0
  const avgWinPct = wins ? winners.reduce((s, t) => s + t.pnlPct, 0) / wins : 0
  const avgLossPct = losses
    ? losers.reduce((s, t) => s + t.pnlPct, 0) / losses
    : 0

  const grossProfit = winners.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0))
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  let peak = -Infinity
  let maxDrawdownPct = 0
  for (const point of equity) {
    if (point.value > peak) peak = point.value
    if (peak > 0) {
      const dd = ((peak - point.value) / peak) * 100
      if (dd > maxDrawdownPct) maxDrawdownPct = dd
    }
  }

  const pcts = trades.map((t) => t.pnlPct)
  const bestTradePct = pcts.length ? Math.max(...pcts) : 0
  const worstTradePct = pcts.length ? Math.min(...pcts) : 0

  return {
    initialCapital,
    finalEquity,
    totalReturnPct,
    totalPnl,
    buyHoldReturnPct,
    numTrades: trades.length,
    wins,
    losses,
    winRate,
    avgWinPct,
    avgLossPct,
    profitFactor,
    maxDrawdownPct,
    bestTradePct,
    worstTradePct,
    longTrades: trades.filter((t) => t.side === 'long').length,
    shortTrades: trades.filter((t) => t.side === 'short').length,
  }
}
