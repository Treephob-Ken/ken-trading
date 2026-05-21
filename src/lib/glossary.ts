// Central glossary of technical trading terms.
// Used by the InfoTip component to show hover explanations.

export const GLOSSARY: Record<string, string> = {
  // ── Risk metrics ───────────────────────────────────────────────────────
  'Sharpe Ratio':
    'Return per unit of total risk. Above 1.0 is good, above 2.0 is excellent. Measures how smooth your equity curve is relative to its gains.',
  'Sortino Ratio':
    "Like Sharpe but only penalizes downside moves. Higher is better — doesn't punish big upside spikes.",
  'Calmar Ratio':
    'Annual return divided by max drawdown. How much gain for each unit of worst-case pain. Above 1.0 is decent.',
  'Return / Drawdown':
    'Total return divided by max drawdown. A quick measure of reward vs pain.',
  'Max Drawdown':
    'The largest peak-to-trough drop in your equity. The worst losing streak you would have experienced.',
  'Win Rate':
    "Percentage of trades that were profitable. High win rate doesn't guarantee profit if losses are larger than wins.",
  'Profit Factor':
    'Gross profit ÷ gross loss. Above 1.0 means profitable. Above 2.0 is strong.',
  'Expectancy':
    'The average amount you expect to make per trade. (Win Rate × Avg Win) − (Loss Rate × Avg Loss).',
  'Avg Holding':
    'Average number of bars a trade is held. Short = scalping, long = swing trading.',

  // ── Risk management ────────────────────────────────────────────────────
  'Kelly Criterion':
    'The mathematically optimal fraction of capital to risk per trade for maximum long-term growth. Half-Kelly is safer in practice.',
  'R:R':
    'Risk-to-Reward ratio. How much you stand to gain versus how much you risk. 2:1 means potential gain is 2× the risk.',
  'Stop Loss':
    'An automatic order that closes your position if price moves against you by a set %. Limits your maximum loss per trade.',
  'Take Profit':
    'An automatic order that closes your position when it reaches a target profit level.',

  // ── Position sizing ────────────────────────────────────────────────────
  'Fixed Size':
    'Same dollar amount per trade regardless of wins or losses. Realistic and protects against ruin.',
  'Compounding':
    'Position size grows with your equity. Wins compound faster, but losses also hit harder.',
  'Volatility Targeting':
    'Adjusting position size based on current volatility so you risk the same dollar amount per trade regardless of how choppy the market is.',
  'Target Risk %':
    'The percentage of your capital you want to risk per trade. Lower = safer, higher = more aggressive. 2% is common.',
  'ATR Multiplier':
    'Scale factor multiplied by the ATR value to define target risk buffers, stop-loss limits, or position risk bands.',

  // ── Indicators & strategies ────────────────────────────────────────────
  'ATR':
    'Average True Range — measures how much an asset moves per bar. Used for volatility-based stop placement and position sizing.',
  'EMA':
    'Exponential Moving Average — a smoothed average that reacts faster to recent prices than a simple average.',
  'SMA':
    'Simple Moving Average — the plain arithmetic mean of the last N closing prices.',
  'RSI':
    'Relative Strength Index — oscillator between 0–100 that measures momentum. Below 30 = oversold, above 70 = overbought.',
  'MACD':
    'Moving Average Convergence/Divergence — a momentum indicator that shows the relationship between two EMAs.',
  'Bollinger Bands':
    'A volatility envelope around a moving average. Price touching the upper band = overbought, lower band = oversold.',
  'Supertrend':
    'An ATR-based trend filter that flips between bullish and bearish. Popular for staying on the right side of a trend.',
  'Parabolic SAR':
    "Wilder's stop-and-reverse system. Dots above price = bearish, below = bullish. Tightens over time like a trailing stop.",
  'Donchian':
    "Breakout channel based on the highest high and lowest low of the last N bars. The Turtle Traders' system.",
  'Stochastic':
    'An oscillator comparing closing price to its range over a period. Crosses above 20 = buy, below 80 = sell.',
  'CCI':
    'Commodity Channel Index — measures deviation from the average. Above +100 = overbought, below −100 = oversold.',
  'Williams %R':
    'A momentum oscillator from 0 to −100. Above −20 = overbought, below −80 = oversold.',
  'Elliott Wave':
    'A theory that markets move in 5-wave impulse patterns followed by 3-wave corrections. Used for structure analysis.',

  // ── Markov / Regime ────────────────────────────────────────────────────
  'Markov Model':
    'A statistical model that predicts future states based only on the current state, not the full history.',
  'Regime':
    'The current market state — Bull (trending up), Bear (trending down), or Sideways (range-bound).',
  'Transition Matrix':
    'A 3×3 table showing the probability of moving from one regime to another. Each row sums to 100%.',
  'Stationary Distribution':
    "The long-run probability of being in each regime if you wait long enough. The market's \"default\" mix.",
  'Persistence':
    'The probability that the current regime continues for one more candle. High = strong, stable trend.',
  'Conviction':
    'P(next = Bull) − P(next = Bear). Ranges from −100% (certain bear) to +100% (certain bull).',

  // ── Ensemble & validation ──────────────────────────────────────────────
  'Ensemble':
    'Combining multiple strategies into one signal. Like asking several experts instead of just one.',
  'Vote Mode':
    'Each strategy gets one vote (buy/sell). Signal fires only when enough strategies agree.',
  'Weighted Mode':
    'Each strategy has a weight (boosted by regime). The combined score determines the signal.',
  'Walk-Forward':
    "Validating a strategy on data it hasn't seen. Trains on past data, tests on future data, slides forward.",
  'Overfit':
    'When a strategy works on historical data but fails live because it memorized noise instead of real patterns.',
  'In-Sample':
    'The data used to optimize a strategy. Good in-sample results mean nothing without out-of-sample confirmation.',
  'Out-of-Sample':
    "Data the strategy has never seen during optimization. Performance here is what matters for real trading.",
  'Parameter Stability':
    'How much the results change when you wiggle the parameters ±20%. Flat = robust. Spiky = fragile / overfit.',

  // ── Multi-timeframe ────────────────────────────────────────────────────
  'Multi-Timeframe':
    'Analyzing the same asset on different timeframes. Higher TF sets the direction, lower TF times the entry.',
  'Confluence':
    'When multiple independent signals agree on the same direction. More confluence = higher conviction.',

  // ── Grid trading ───────────────────────────────────────────────────────
  'Arithmetic Grid':
    'Grid lines spaced by equal price gaps. Simple but less efficient for volatile assets.',
  'Geometric Grid':
    'Grid lines spaced by equal percentage gaps. Better for volatile assets because spacing scales with price.',
  'Kaufman ER':
    'Kaufman Efficiency Ratio — net price change ÷ total path. 0 = pure chop (good for grids), 1 = pure trend (bad).',
  'Grid Suitability':
    'A 0–100 score measuring how well the market suits grid trading. High = choppy (good), low = trending (bad).',
  'Breakeven Spacing':
    'The minimum grid spacing needed to cover round-trip trading fees. Below this, every trade loses money.',
  'Realized APR':
    'Annualized return from completed roundtrips only, excluding unrealized inventory.',
  'Lookback':
    'How many recent bars are used to determine the grid range and optimize the grid count.',
  'Leverage':
    'Borrowing to increase position size. 3× means a 1% move = 3% gain or loss on your margin.',
  'Grid Count':
    'The number of individual buy/sell price levels in the grid. More grids capture smaller moves but split your investment into smaller order sizes.',
  'Investment':
    'The total capital allocated to the grid bot. This capital is divided across the grid levels for placing buy and sell orders.',

  // ── Correlation & meta ─────────────────────────────────────────────────
  'Correlation':
    'How similarly two strategies move. +1 = identical, 0 = independent, −1 = opposite. Low = good diversification.',
  'Meta-Model':
    'A higher-level system that decides which strategies to use and how much capital each gets, based on market regime.',
  'Drawdown Circuit Breaker':
    'An automatic rule that reduces positions or stops trading when cumulative losses exceed a safety threshold.',
  'Fractional Kelly':
    'Using a fraction (typically 25–50%) of the full Kelly bet to reduce volatility while keeping most of the growth.',

  // ── Strategy parameters & dynamic settings ─────────────────────────────
  'Fast EMA':
    'Short-term Exponential Moving Average period. Tracks rapid price changes and short-term momentum.',
  'Slow EMA':
    'Long-term Exponential Moving Average period. Establishes the macro trend direction and support/resistance.',
  'Signal EMA':
    'Exponential Moving Average of the MACD line itself. Used to trigger crossover buy/sell signals.',
  'Fast SMA':
    'Short-term Simple Moving Average period. Tracks average price changes.',
  'Slow SMA':
    'Long-term Simple Moving Average period. Standard baseline indicator for the macro trend.',
  'ATR Period':
    'Lookback window in candles for calculating the Average True Range volatility index.',
  'Acceleration Step':
    'The rate at which the Parabolic SAR trailing stop increments toward the price as the trend progresses.',
  'Max Acceleration':
    'The maximum cap on the Parabolic SAR acceleration step, preventing the stop from locking too close to price.',
  'Channel Period':
    'Lookback window for finding the highest high and lowest low to define Donchian Channel breakout levels.',
  'RSI Period':
    'The candle period used to measure the velocity and magnitude of directional price movements.',
  'Oversold Level':
    'The lower boundary of an oscillator (typically 30) below which price is statistically considered oversold.',
  'Overbought Level':
    'The upper boundary of an oscillator (typically 70) above which price is statistically considered overbought.',
  '%K Period':
    'The lookback period used for the main fast line of the Stochastic Oscillator.',
  '%K Smoothing':
    'The smoothing factor (simple moving average period) applied to the raw %K line.',
  '%D Period':
    'The moving average period applied to the %K line to construct the slow %D signal line.',
  'Stoch Period':
    'The lookback period used to compute the Stochastic index on top of RSI values.',
  '%D Smoothing':
    'Smoothing factor applied to the Stochastic RSI %D signal line.',
  'CCI Period':
    'Lookback period for the Commodity Channel Index. Measures price deviation from its statistical average.',
  '%R Period':
    'The lookback period used to compute Williams %R over the high-low boundary.',
  'Period':
    'The core lookback period used to calculate moving averages or bands.',
  'Std Dev Multiplier':
    'The number of standard deviations defining the width of the Bollinger Bands volatility channel.',
  'ZigZag Threshold %':
    'The minimum percentage price change required to identify a new pivot high or low in wave analysis.',
  'Market Pair':
    'The cryptocurrency pair (e.g. ETH/USDT) whose historical price data is simulated.',
  'Timeframe':
    'The duration of each individual price candle (e.g. 15m, 1h, 1d) on the chart.',
  'Date Range':
    'The historical start and end dates used for downloading candle data and backtesting.',
  'Strategy':
    'The specific technical analysis script used to generate buy/sell signals.',
  'Parameters':
    'Adjustable inputs that fine-tune indicator calculations and buy/sell rules.',
  'Position Direction':
    'Select whether the strategy should only execute Long positions, Short positions, or Both.',
  'Capital':
    'The starting balance in USDT used as the initial base for backtest simulations.',
  'Fee %':
    'The exchange trading fee rate per trade. Standard spot trading fee on Binance is 0.1%.',
  'Stop Loss %':
    'Safety trigger that automatically closes a trade at a loss if the price moves against you by this %.',
  'Take Profit %':
    'Safety trigger that automatically closes a trade at a profit if the price reaches this %.',
  // Extra terms added
  'Side': 'Whether the position is a buy/long (profits from rising prices) or a sell/short (profits from falling prices).',
  'Entry': 'The date, time, and trigger conditions under which the position was opened.',
  'Entry Price': 'The price of the asset at the moment the position was opened.',
  'Exit': 'The date, time, and trigger conditions under which the position was closed.',
  'Exit Price': 'The price of the asset at the moment the position was closed.',
  'P&L': 'Profit and Loss — the net financial gain or loss of the trade, in dollar terms, after deducting fees.',
  'Return': 'The percentage change in price or equity for this specific trade, calculated as profit divided by entry value.',
  'Range High': 'The highest price level in the grid range. The bot will not place orders above this level.',
  'Range Low': 'The lowest price level in the grid range. The bot will not place orders below this level.',
  'Range Size': 'The height of the grid window (Range High − Range Low) in price and percentage terms.',
  'Optimal Grid Count': 'The grid count that generated the highest historical return in the optimizer sweep.',
  'Grid Spacing': 'The gap between adjacent buy and sell orders. Spacing is arithmetic (absolute price) or geometric (percentage).',
  'Completed Roundtrips': 'The number of times a buy order and a corresponding sell order were both filled, securing a grid profit.',
  'Order Fills': 'The total number of order fills (buys and sells combined) executed during the backtest.',
  'Realized Grid Profit': 'Profit locked in from completed roundtrips, excluding any floating value of current open positions.',
  'Unrealized PnL': 'Floating profit or loss of the inventory currently held by the bot as the market moves.',
  'Total PnL': 'The sum of realized grid profit and floating unrealized profit or loss, minus trading fees.',
  'Fees Paid': 'Total trading fees paid to the exchange for all filled orders.',
  'Roundtrips / Day': 'The average number of completed buy-sell roundtrips per day. Higher means more frequent trading.',
  'Spacing ÷ Breakeven': 'Grid spacing divided by the breakeven spacing. Higher is better (we want at least 3.0x) so fees don\'t eat your profits.',
  'Net Profit / Roundtrip': 'The percentage profit earned on a single completed buy-sell cycle after subtracting exchange fees.',
  'Current ATR': 'The Average True Range over the most recent 14 candles, measuring immediate short-term volatility.',
  'Average ATR': 'The average value of the Average True Range over the entire lookback window, representing historical volatility.',
  'Suggested Spacing': 'Volatility-adjusted grid spacing. If current volatility is high, it widens spacing; if low, it tightens it.',
  'Spacing Scale Factor': 'The ratio of current ATR to historical average ATR. Used to dynamically scale grid spacing to match changing volatility.',
}

