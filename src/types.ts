export interface Candle {
  time: number // unix seconds
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

// Which side(s) the backtest is allowed to take.
export type Direction = 'long' | 'short' | 'both'

export type TradeSide = 'long' | 'short'

export interface Trade {
  side: TradeSide
  entryTime: number
  entryPrice: number
  entryEquity: number
  exitTime: number
  exitPrice: number
  pnl: number
  pnlPct: number
}

export interface EquityPoint {
  time: number
  value: number
}

export interface Metrics {
  initialCapital: number
  finalEquity: number
  totalReturnPct: number
  totalPnl: number
  buyHoldReturnPct: number
  numTrades: number
  wins: number
  losses: number
  winRate: number
  avgWinPct: number
  avgLossPct: number
  profitFactor: number
  maxDrawdownPct: number
  bestTradePct: number
  worstTradePct: number
  longTrades: number
  shortTrades: number
  sharpeRatio: number
  sortinoRatio: number
  calmarRatio: number
  returnToDrawdown: number
  expectancy: number
  avgHoldingBars: number
}

export interface BacktestResult {
  trades: Trade[]
  equity: EquityPoint[]
  metrics: Metrics
  openPosition: { side: TradeSide; entryTime: number; entryPrice: number } | null
}
