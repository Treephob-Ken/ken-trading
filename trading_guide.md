# 📈 Crypto Strategy Lab — Complete Trading Guide

Welcome to the **Crypto Strategy Lab**! This platform is designed to help you analyze market conditions, backtest trading strategies, optimize grid bots, and export configurations to run on your live trading bot. 

This guide breaks down everything in simple terms so you can go from browsing charts to running a professional-grade automated setup.

---

## 🧭 Table of Contents
1. [Core Concepts: Indicators & Market Regimes](#1-core-concepts-indicators--market-regimes)
2. [Step-by-Step Backtesting Workflow](#2-step-by-step-backtesting-workflow)
3. [Position Sizing & Advanced Risk Management](#3-position-sizing--advanced-risk-management)
4. [Market Regime Model & Meta-Model Allocations](#4-market-regime-model--meta-model-allocations)
5. [Multi-Strategy Ensembles & Consensus Voting](#5-multi-strategy-ensembles--consensus-voting)
6. [Walk-Forward Validation & Overfitting Checks](#6-walk-forward-validation--overfitting-checks)
7. [Strategy Correlation Heatmap](#7-strategy-correlation-heatmap)
8. [Grid Optimizer & Running the Live Bot](#8-grid-optimizer--running-the-live-bot)

---

## 1. Core Concepts: Indicators & Market Regimes

No single trading strategy works all the time. Markets constantly switch between two primary states (regimes):

### 1. Trending Markets (Bullish or Bearish)
Price moves strongly in one direction.
* **Best Strategies:** Trend-followers (e.g., **EMA Crossover**, **MACD**, **Supertrend**, **Parabolic SAR**, **Donchian Breakouts**, **Elliott Wave**).
* **Behavior:** They buy when momentum starts and ride the trend. 
* **Risk:** In choppy, sideways markets, they buy the highs and sell the lows, causing a string of small losses (whipsawing).

### 2. Sideways Markets (Range-Bound / Choppy)
Price bounces up and down between a ceiling and a floor.
* **Best Strategies:** Oscillators (e.g., **RSI Reversal**, **Stochastic**, **Stoch RSI**, **CCI**, **Williams %R**, **Bollinger Bands**).
* **Behavior:** They buy when the price is relatively low (oversold) and sell when it is high (overbought).
* **Risk:** In strong trending markets, they will try to short a rocket ship or buy a falling knife, causing massive losses.

> [!TIP]
> The **Market Regime Model** at the bottom of the page analyzes recent candles to automatically label the market as **BULL**, **BEAR**, or **SIDEWAYS** so you can pick the right strategy.

---

## 2. Step-by-Step Backtesting Workflow

A backtest simulates how a strategy would have performed in the past using real historical candles. Here is how to run one:

1. **Select Market Pair:** In the sidebar under **Market Pair**, search for and select your asset (e.g., `ETHUSDT`).
2. **Select Timeframe:** Choose a candle duration. 
   * Use **15m** or **30m** for short-term active trading.
   * Use **1h** or **4h** for medium-term swing trading.
3. **Choose Date Range:** Drag-select or choose a preset like **30D**, **90D**, or **1Y** to load historical candles.
4. **Choose a Strategy:** Pick an indicator script from the **Strategy** dropdown.
5. **Adjust Parameters:** Fine-tune the settings (e.g. adjust the RSI lookback period). The charts and results will update instantly.
6. **Interpret the Results Card:**
   * **Strategy Return:** Total percentage gain or loss.
   * **Buy & Hold:** The return of just buying and holding the asset. Compare this with Strategy Return to see if you have an edge.
   * **Sharpe Ratio:** Measures risk-adjusted return. **Sharpe > 1.0** is good; **> 2.0** is institutional-grade. It tells you if your gains are smooth or highly volatile.
   * **Max Drawdown:** The largest peak-to-trough drop in capital. If your drawdown is 20%, you must be prepared to survive a 20% loss sequence.

---

## 3. Position Sizing & Advanced Risk Management

Automated trading requires strict money management. The sidebar lets you select three different **Position Sizing** styles:

1. **Fixed Size:** Risks the exact same dollar amount on every trade. This is the safest way to learn and prevents your account from blowing up.
2. **Compounding:** Grows your trade size as your account grows. Wins scale up faster, but consecutive losses shrink your size to protect your remaining cash.
3. **Volatility Sizing (Recommended):** Uses the **Average True Range (ATR)** indicator to adjust position size dynamically:
   * **Wild Markets:** Spreads stops wider and shrinks position sizes to keep your dollar risk constant.
   * **Quiet Markets:** Tightens stops and increases position sizes since price swings are smaller.
   * *Settings:* Set **Target Risk %** (commonly 1% to 2% of capital) and **ATR Multiplier** (standard is 1.5× to 2×) to define stop widths.

### 🛡️ Risk Controls
* **Stop Loss %:** Closes a losing trade immediately if the price drops against you by this %. Set to `0` to turn off (not recommended).
* **Take Profit %:** Closes a winning trade to lock in gains when the price targets this % return.

> [!NOTE]
> The **Risk Manager** card at the bottom calculates your **Implied Risk-to-Reward (R:R)** and suggests mathematically optimized Stop Loss and Take Profit levels based on your historical trades.

---

## 4. Market Regime Model & Meta-Model Allocations

This section uses a statistical **Markov Probability Model** to determine what the market is doing:
* **Transition Matrix:** Shows the probability of moving from one regime (Bull, Bear, Sideways) to another on the next candle.
* **Persistence:** The probability that the current trend keeps going. Persistence > 80% indicates a strong, stable trend.
* **Meta-Model Portfolio Allocator:** Based on the current regime, this calculator suggests how to divide your capital. For instance, in a sideways market, it allocates larger weights to Bollinger Bands and Stochastic, and zero weight to trend-following systems.

---

## 5. Multi-Strategy Ensembles & Consensus Voting

Instead of relying on just one indicator, you can activate the **Multi-Strategy Ensemble** to run several indicators at the same time:

1. **Choose Strategies:** Tick the checkboxes of the indicators you want to combine.
2. **Select Mode:**
   * **Vote Mode:** A trade is opened only if a consensus threshold is met (e.g. 3 out of 5 indicators agree).
   * **Weighted Mode:** Indicators are given different weights. If **Regime Weights** is enabled, trend indicators get heavier weight in trending regimes, and oscillators get heavier weight in range regimes.
3. **Combined Signal:** The heatmap shows each indicator's signals. The bottom row shows the combined consensus signal that the backtester uses.

---

## 6. Walk-Forward Validation & Overfitting Checks

A common mistake is "overfitting" — adjusting parameters so perfectly to past candles that it fails to make money on new data because it memorized past noise. The **Walk-Forward Validation** panel tests for this:

1. **How it works:** It splits the historical candles into **5 segments (folds)**. For each segment, it optimizes settings on 80% of the data (In-Sample) and tests it on the remaining 20% (Out-of-Sample).
2. **Out-of-Sample Sharpe:** This measures performance on unseen data. If it is positive and close to the In-Sample Sharpe, the settings are robust.
3. **Overfit Score:**
   * **< 30% (Robust):** Generalizes well; safe to trade.
   * **30% - 60% (Moderate Overfit):** Use caution; widen your stops or select a higher timeframe.
   * **> 60% (High Overfit Risk):** Parameters are over-optimized. Do not deploy.
4. **Parameter Stability Sparkline:** Shows how performance changes when parameters are shifted by ±20%. A flat or rounded peak indicates a stable parameter zone. A sharp, narrow spike means the strategy is fragile.

---

## 7. Strategy Correlation Heatmap

If you run multiple strategies simultaneously, you want to make sure they do not enter the same trades at the same time, doubling your risk:

* **Heatmap Cells:** Displays the Pearson correlation of returns between all 13 strategies.
  * **Red Cells (+0.50 to +1.00):** High positive correlation. Avoid running both; they will double your risk on the same moves.
  * **Green Cells (-0.20 to +0.40):** Uncorrelated. Excellent for diversification.
  * **Blue Cells (<-0.20):** Negatively correlated. Excellent hedging pairs.
* **Best Diversified Portfolio:** The app automatically selects a collection of the highest-performing, least-correlated strategies for optimal risk distribution.

---

## 8. Grid Optimizer & Running the Live Bot

Grid trading profits from sideways fluctuations by placing a grid of buy and sell orders around a set center price. 

### 1. Optimize the Grid
1. Select the **Grid Optimizer** tab.
2. The optimizer sweeps different grid counts (e.g., 5 to 50 grids) and highlights the grid structure that maximizes simulated returns.
3. **Edge Check:** Check the **Spacing ÷ Breakeven** ratio. It must be **≥ 3.0×**. This guarantees that the profit earned per grid fill is at least triple the trading fees.

### 2. Export Configuration
1. Enter your live trading details: **Grid Budget ($)**, **Leverage (1x to 20x)**, and safety **Stop Loss / Take Profit %**.
2. Select **Arithmetic** (equal price steps) or **Geometric** (equal percentage steps).
3. Click **Download grid.config.json**.

### 3. Run the Live Bot on Hyperliquid
1. Ensure your local grid bot is running in your terminal:
   ```bash
   cd bot
   npm install
   npm start
   ```
2. Open the bot's local dashboard at `http://localhost:3001` in your browser.
3. Drag and drop your downloaded `grid.config.json` file into the dashboard.
4. The bot will connect to the Hyperliquid DEX via API, cancel existing orders, and place your optimized grid structures instantly.

> [!WARNING]
> Always verify your API keys and run on **Testnet** before allocating real assets. Grid trading can carry high risk in breakout trends.
