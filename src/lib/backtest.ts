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
import { atr } from '@/lib/indicators'

// Fixed-size mode: every trade risks exactly `initialCapital` dollars.
// P&L from each trade is added to a running cash total.
// Compounding mode (legacy): position size = current equity, grows/shrinks each trade.
// Volatility mode: position size is sized so that a stop loss of (ATR * atrMultiplier) risks (initialCapital * targetRiskPct).
export function runBacktest(
  candles: Candle[],
  signals: Signal[],
  initialCapital: number,
  feeRate: number,
  direction: Direction,
  stopLossPct = 0,        // 0 = disabled
  takeProfitPct = 0,      // 0 = disabled
  positionMode: 'fixed' | 'compounding' | 'volatility' = 'fixed',
  targetRiskPct = 2,
  atrMultiplier = 1.5,
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

  // Calculate ATR for the candles (period 14)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const closes = candles.map((c) => c.close)
  const atrValues = atr(highs, lows, closes, 14)

  const markToMarket = (price: number): number => {
    if (pos() === 'flat') return equity
    const afterEntryFee = entryEquity * (1 - feeRate)
    const ratio = price / entryPrice
    const posValue =
      pos() === 'long' ? afterEntryFee * ratio : afterEntryFee * (2 - ratio)
    const clamped = Math.max(0, posValue)
    // Fixed / Volatility: total wealth = remaining cash + open position value (pre-exit-fee)
    return positionMode === 'compounding' ? clamped : equity - entryEquity + clamped
  }

  const openPos = (side: TradeSide, price: number, time: number, currentAtrVal: number) => {
    if (positionMode === 'volatility') {
      // Fallback to 2% of price if ATR is NaN
      const currentAtr = !Number.isNaN(currentAtrVal) && currentAtrVal > 0 
        ? currentAtrVal 
        : price * 0.02 / atrMultiplier
      const stopLossDist = currentAtr * atrMultiplier
      const targetRisk = initialCapital * (targetRiskPct / 100)
      
      // Sizing: risk / stopLossDist = quantity of tokens. position value in USD = quantity * price
      entryEquity = (targetRisk / stopLossDist) * price
      // Cap at current equity to avoid exceeding account value
      entryEquity = Math.min(entryEquity, equity)
      
      entryPrice = price
      entryTime = time
      position = side
      
      slPrice = side === 'long' ? price - stopLossDist : price + stopLossDist
      tpPrice =
        takeProfitPct > 0
          ? side === 'long'
            ? price * (1 + takeProfitPct / 100)
            : price * (1 - takeProfitPct / 100)
          : 0
    } else {
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
    if (positionMode === 'compounding') {
      equity = realized
    } else {
      equity += pnl   // fixed and volatility accumulate P&L; position size is computed dynamically next trade
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
    const currentAtrVal = atrValues[i]

    // SL/TP fires before the signal on the same candle
    if (checkSlTp(c)) {
      equityCurve.push({ time: c.time, value: markToMarket(c.close) })
      continue
    }

    if (sig === 'buy') {
      if (direction === 'long') {
        if (pos() === 'flat') openPos('long', c.close, c.time, currentAtrVal)
      } else if (direction === 'short') {
        if (pos() === 'short') closePos(c.close, c.time)
      } else {
        if (pos() === 'short') { closePos(c.close, c.time); openPos('long', c.close, c.time, currentAtrVal) }
        else if (pos() === 'flat') openPos('long', c.close, c.time, currentAtrVal)
      }
    } else if (sig === 'sell') {
      if (direction === 'long') {
        if (pos() === 'long') closePos(c.close, c.time)
      } else if (direction === 'short') {
        if (pos() === 'flat') openPos('short', c.close, c.time, currentAtrVal)
      } else {
        if (pos() === 'long') { closePos(c.close, c.time); openPos('short', c.close, c.time, currentAtrVal) }
        else if (pos() === 'flat') openPos('short', c.close, c.time, currentAtrVal)
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

  const dt = candles.length > 1 ? candles[1].time - candles[0].time : 86400

  // --- Quant Upgrades: Advanced Risk Metrics ---
  // 1. Sharpe & Sortino ratios (crypto is 24/7/365, so we use 365 daily bars or annualize based on timeframe)
  let sharpeRatio = 0
  let sortinoRatio = 0
  
  if (equity.length > 1) {
    const returns: number[] = []
    for (let i = 1; i < equity.length; i++) {
      const prevVal = equity[i - 1].value
      returns.push(prevVal > 0 ? (equity[i].value - prevVal) / prevVal : 0)
    }
    
    // Calculate timeframe/bars per year
    const barsPerYear = dt > 0 ? (365 * 24 * 3600) / dt : 365
    
    // Mean daily/bar return
    const sum = returns.reduce((acc, r) => acc + r, 0)
    const mean = sum / returns.length
    
    // Std deviation of daily/bar returns
    const varSum = returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0)
    const std = returns.length > 1 ? Math.sqrt(varSum / (returns.length - 1)) : 0
    
    if (std > 0) {
      sharpeRatio = (mean / std) * Math.sqrt(barsPerYear)
    }
    
    // Downside deviation (only negative returns relative to 0 target)
    const downsideVarSum = returns.reduce((acc, r) => acc + (r < 0 ? Math.pow(r, 2) : 0), 0)
    const downsideStd = returns.length > 0 ? Math.sqrt(downsideVarSum / returns.length) : 0
    if (downsideStd > 0) {
      sortinoRatio = (mean / downsideStd) * Math.sqrt(barsPerYear)
    }
  }

  // 2. Calmar Ratio & Return-to-Drawdown
  const returnToDrawdown = maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : 0
  let calmarRatio = 0
  if (maxDrawdownPct > 0 && candles.length > 1) {
    const startTime = candles[0].time
    const endTime = candles[candles.length - 1].time
    const durationSeconds = endTime - startTime
    const years = durationSeconds > 0 ? durationSeconds / (365 * 24 * 3600) : 0
    
    // Annualized return (using simple compounding or linear if years < 1)
    let annualizedReturnPct = totalReturnPct
    if (years > 0) {
      const finalValRatio = finalEquity / initialCapital
      if (finalValRatio > 0) {
        annualizedReturnPct = (Math.pow(finalValRatio, 1 / years) - 1) * 100
      } else {
        annualizedReturnPct = -100
      }
    }
    calmarRatio = annualizedReturnPct / maxDrawdownPct
  }

  // 3. Expectancy
  const expectancy = trades.length ? (winRate / 100) * avgWinPct + (1 - winRate / 100) * avgLossPct : 0

  // 4. Avg holding bars
  let totalHoldingBars = 0
  if (dt > 0) {
    for (const t of trades) {
      totalHoldingBars += (t.exitTime - t.entryTime) / dt
    }
  }
  const avgHoldingBars = trades.length ? totalHoldingBars / trades.length : 0

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
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    returnToDrawdown,
    expectancy,
    avgHoldingBars,
  }
}
