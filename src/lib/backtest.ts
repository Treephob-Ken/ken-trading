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

// Fixed-size mode: every trade risks exactly `initialCapital` dollars.
// P&L from each trade is added to a running cash total.
// Compounding mode (legacy): position size = current equity, grows/shrinks each trade.
export function runBacktest(
  candles: Candle[],
  signals: Signal[],
  initialCapital: number,
  feeRate: number,
  direction: Direction,
  stopLossPct = 0,        // 0 = disabled
  takeProfitPct = 0,      // 0 = disabled
  positionMode: 'fixed' | 'compounding' = 'fixed',
): BacktestResult {
  let equity = initialCapital
  let position: 'flat' | TradeSide = 'flat'
  let entryPrice = 0
  let entryEquity = 0
  let entryTime = 0
  let slPrice = 0
  let tpPrice = 0

  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []

  const pos = (): 'flat' | TradeSide => position

  const markToMarket = (price: number): number => {
    if (pos() === 'flat') return equity
    const afterEntryFee = entryEquity * (1 - feeRate)
    const ratio = price / entryPrice
    const posValue =
      pos() === 'long' ? afterEntryFee * ratio : afterEntryFee * (2 - ratio)
    const clamped = Math.max(0, posValue)
    // Fixed: total wealth = remaining cash + open position value (pre-exit-fee)
    return positionMode === 'fixed' ? equity - entryEquity + clamped : clamped
  }

  const openPos = (side: TradeSide, price: number, time: number) => {
    // Fixed mode: always risk the original capitalFIXED size regardless of current equity
    entryEquity = positionMode === 'fixed' ? initialCapital : equity
    entryPrice = price
    entryTime = time
    position = side
    slPrice =
      stopLossPct > 0
        ? side === 'long'
          ? price * (1 - stopLossPct / 100)
          : price * (1 + stopLossPct / 100)
        : 0
    tpPrice =
      takeProfitPct > 0
        ? side === 'long'
          ? price * (1 + takeProfitPct / 100)
          : price * (1 - takeProfitPct / 100)
        : 0
  }

  const closePos = (price: number, time: number) => {
    if (pos() === 'flat') return
    const afterEntryFee = entryEquity * (1 - feeRate)
    const ratio = price / entryPrice
    const posValue =
      pos() === 'long' ? afterEntryFee * ratio : afterEntryFee * (2 - ratio)
    const realized = Math.max(0, posValue) * (1 - feeRate)
    const pnl = realized - entryEquity
    trades.push({
      side: position as TradeSide,
      entryTime,
      entryPrice,
      entryEquity,
      exitTime: time,
      exitPrice: price,
      pnl,
      pnlPct: (pnl / entryEquity) * 100,
    })
    if (positionMode === 'fixed') {
      equity += pnl   // accumulate P&L; position size never changes
    } else {
      equity = realized
    }
    position = 'flat'
    slPrice = 0
    tpPrice = 0
  }

  // Returns true if SL or TP fired and the position was closed.
  const checkSlTp = (c: Candle): boolean => {
    if (pos() === 'flat' || (slPrice === 0 && tpPrice === 0)) return false
    const isLong = pos() === 'long'

    // Gap-through: open already beyond SL/TP
    if (slPrice > 0 && isLong && c.open <= slPrice) { closePos(c.open, c.time); return true }
    if (tpPrice > 0 && isLong && c.open >= tpPrice) { closePos(c.open, c.time); return true }
    if (slPrice > 0 && !isLong && c.open >= slPrice) { closePos(c.open, c.time); return true }
    if (tpPrice > 0 && !isLong && c.open <= tpPrice) { closePos(c.open, c.time); return true }

    // Intrabar: determine which hit first by proximity to open
    const slHit = slPrice > 0 && (isLong ? c.low <= slPrice : c.high >= slPrice)
    const tpHit = tpPrice > 0 && (isLong ? c.high >= tpPrice : c.low <= tpPrice)

    if (slHit && tpHit) {
      const slDist = Math.abs(c.open - slPrice)
      const tpDist = Math.abs(c.open - tpPrice)
      closePos(slDist <= tpDist ? slPrice : tpPrice, c.time)
      return true
    }
    if (slHit) { closePos(slPrice, c.time); return true }
    if (tpHit) { closePos(tpPrice, c.time); return true }
    return false
  }

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const sig = signals[i]

    // SL/TP fires before the signal on the same candle
    if (checkSlTp(c)) {
      equityCurve.push({ time: c.time, value: markToMarket(c.close) })
      continue
    }

    if (sig === 'buy') {
      if (direction === 'long') {
        if (pos() === 'flat') openPos('long', c.close, c.time)
      } else if (direction === 'short') {
        if (pos() === 'short') closePos(c.close, c.time)
      } else {
        if (pos() === 'short') { closePos(c.close, c.time); openPos('long', c.close, c.time) }
        else if (pos() === 'flat') openPos('long', c.close, c.time)
      }
    } else if (sig === 'sell') {
      if (direction === 'long') {
        if (pos() === 'long') closePos(c.close, c.time)
      } else if (direction === 'short') {
        if (pos() === 'flat') openPos('short', c.close, c.time)
      } else {
        if (pos() === 'long') { closePos(c.close, c.time); openPos('short', c.close, c.time) }
        else if (pos() === 'flat') openPos('short', c.close, c.time)
      }
    }

    equityCurve.push({ time: c.time, value: markToMarket(c.close) })
  }

  const openPosition =
    position === 'flat' ? null : { side: position as TradeSide, entryTime, entryPrice }
  const metrics = computeMetrics(candles, trades, equityCurve, initialCapital)
  return { trades, equity: equityCurve, metrics, openPosition }
}

function computeMetrics(
  candles: Candle[],
  trades: Trade[],
  equity: EquityPoint[],
  initialCapital: number,
): Metrics {
  const finalEquity = equity.length ? equity[equity.length - 1].value : initialCapital
  const totalPnl = finalEquity - initialCapital
  const totalReturnPct = (totalPnl / initialCapital) * 100

  const firstClose = candles[0]?.close ?? 0
  const lastClose = candles[candles.length - 1]?.close ?? 0
  const buyHoldReturnPct = firstClose ? ((lastClose - firstClose) / firstClose) * 100 : 0

  const winners = trades.filter((t) => t.pnl > 0)
  const losers = trades.filter((t) => t.pnl <= 0)
  const wins = winners.length
  const losses = losers.length

  const winRate = trades.length ? (wins / trades.length) * 100 : 0
  const avgWinPct = wins ? winners.reduce((s, t) => s + t.pnlPct, 0) / wins : 0
  const avgLossPct = losses ? losers.reduce((s, t) => s + t.pnlPct, 0) / losses : 0

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
