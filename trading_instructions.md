# 📈 Crypto Strategy Lab — Simple Trading Manual

Welcome to **Crypto Strategy Lab**! This platform helps you test indicators on historical data, manage risk, analyze market trends, and deploy automated trading bots to the Hyperliquid exchange.

This guide explains how to use the website to build a profitable, safe trading setup.

---

## 🧭 Quick Map of the Web App

The platform is split into two main tools (accessible at the top right of the header):
1. **Strategy Backtester:** For testing indicator-based strategies (e.g. buying when MACD crosses, selling when RSI is overbought).
2. **Grid Optimizer:** For setting up grid bots that buy low and sell high in sideways markets.

---

## 1. How to Backtest a Strategy (Step-by-Step)

A backtest simulates how a strategy would have performed in the past using real historical price candles.

### Step 1: Set Your Market and Timeframe (Sidebar)
* **Market Pair:** Search and select your pair (e.g., `ETHUSDT` or `BTCUSDT`).
* **Timeframe:** Select the candle interval:
  * **Short-Term (15m - 30m):** For quick scalp trading.
  * **Swing Trading (1h - 4h):** For riding medium-term moves (recommended for beginners).
  * **Macro (1d):** For long-term trend analysis.

### Step 2: Choose a Date Range
* Use the presets (**7D**, **30D**, **90D**, **1Y**, or **Max**) to quickly download historical data.
* *Rule of thumb:* Backtest over at least **90 Days** to see how a strategy handles different market phases.

### Step 3: Choose and Configure Your Strategy
* **Select a Strategy:** Choose from 13 different strategies in the dropdown. They are grouped into Trend-Following and Oscillators (explained below).
* **Adjust Parameters:** Each strategy has adjustable parameters. Hover over any parameter name to see its description. Adjusting these will instantly re-run the simulation.

### Step 4: Interpret the Performance Metrics
* **Strategy Return:** The total percentage gain/loss your strategy made.
* **Buy & Hold:** The return if you had just bought the asset and held it. Your strategy should ideally beat Buy & Hold.
* **Sharpe Ratio:** Measures how smooth and reliable your returns are relative to the risk:
  * **< 1.0:** Poor or inconsistent returns.
  * **1.0 to 1.9:** Good, viable strategy.
  * **2.0+:** Institutional-grade (highly stable equity curve).
* **Max Drawdown:** The largest peak-to-trough drop in your capital. If Max Drawdown is 15%, you must be prepared to handle a 15% account drop during bad streaks.

---

## 2. Choosing the Right Strategy (Market Regimes)

No strategy works all the time. You must match your strategy to the current **Market Regime** shown at the bottom of the page.

### 📈 Trending Regimes (Bull or Bear)
* **What happens:** Price moves strongly in one direction.
* **Best Strategies:** Trend-followers (e.g. **EMA Crossover**, **MACD**, **Supertrend**, **Parabolic SAR**, **Donchian Breakouts**, **Elliott Wave**).
* **Avoid:** Oscillators, which will keep trying to sell the top or buy the bottom of a runaway trend.

### ↔️ Sideways Regimes (Range-bound)
* **What happens:** Price bounces up and down between a floor and ceiling.
* **Best Strategies:** Oscillators (e.g. **RSI Reversal**, **Stochastic**, **Stoch RSI**, **CCI**, **Williams %R**, **Bollinger Bands**).
* **Avoid:** Trend-followers, which will get "whipsawed" (buying the highs and selling the lows repeatedly).

---

## 3. Managing Risk & Sizing Positions

Position sizing controls how much capital you risk per trade. In the sidebar, select one of three models:

1. **Fixed Size:** Risks the exact same dollar amount on every trade. Safe, simple, and protects you from big losing streaks.
2. **Compounding:** Scale your trade size up as you win and down as you lose. Wins grow faster, but losses hit harder.
3. **Volatility Sizing (Recommended):** Uses the **Average True Range (ATR)** to measure how wildly the market is moving:
   * **High Volatility:** Spreads your stops wider and shrinks your position size to keep your actual dollar risk constant.
   * **Low Volatility:** Places tighter stops and increases position size to take advantage of calmer price swings.
   * *Required settings:* Enter your **Target Risk %** (typically 1% to 2% of capital) and **ATR Multiplier** (standard is 1.5× to 2×).

### 🛡️ Risk Controls & the Risk Manager
* **Stop Loss %:** Automatically closes a trade if the market moves against you by this percentage.
* **Take Profit %:** Automatically locks in profit when the target is reached.
* **The Risk Manager Panel:** Found below the performance chart, it analyzes your historical trades and calculates your **Implied Risk-to-Reward (R:R)**. It suggests the mathematical Stop Loss and Take Profit levels that maximize your win rate and expectancy.

---

## 4. Advanced Optimization Features

### 🧩 Multi-TF Confluence
Shows trend signals from higher timeframes. For example, if you trade the **15m chart**, the **1h and 4h trend signals** should ideally align with your trade direction to provide higher probability setups.

### 🌐 Strategy Correlation Heatmap
When running multiple strategies together, make sure they aren't entering the same trades (which doubles your risk):
* **Red cells (+0.5 to +1.0):** Strategies are highly correlated. Run only one of them.
* **Green/Blue cells (< 0.2):** Strategies are uncorrelated or negatively correlated. Run them together for optimal diversification.
* **Best Diversified Portfolio:** The app automatically lists the top performing, least-correlated strategies. Click **Select** on any recommendation to apply it instantly.

### 🗳️ Multi-Strategy Ensembles
Combine multiple indicators into one signal:
* **Vote Mode:** Trades are placed only when a threshold of strategies agree (e.g. 3 out of 5 strategies vote buy).
* **Weighted Mode:** Gives different weights to strategies. Turn on **Regime Weights** to automatically increase oscillator weights in sideways markets, and increase trend weights in trending markets.

### 🧪 Walk-Forward Validation (Overfitting Check)
To avoid "overfitting" (settings that look great on past data but fail on live markets):
* The app splits historical data into **5 folds**, optimizing settings on 80% (In-Sample) and testing on the other 20% (Out-of-Sample).
* Check the **Overfit Score**:
  * **< 30% (Robust):** Generalizes well, safe to deploy.
  * **30% - 60% (Moderate):** Widen stops or use a larger timeframe.
  * **> 60% (High Risk):** Settings are over-optimized. Change parameters.

---

## 5. Deploying a Live Grid Bot to Hyperliquid

Grid trading places a grid of buy and sell orders. It thrives in **Sideways Regimes**.

### Step 1: Optimize the Grid
1. Select the **Grid Optimizer** tab at the top.
2. Under **Grid Suitability**, check the verdict. Do not run grids if the market is trending.
3. Check the **Spacing ÷ Breakeven** ratio. It **must be ≥ 3.0×**. This ensures your grid spacing is large enough to out-earn exchange fees.

### Step 2: Set Sizing and Safety Limits
1. Enter your **Budget** (e.g., 500 USDC) and **Leverage** (1x to 20x).
2. Set **Stop Loss (SL)** and **Take Profit (TP)** values to protect against breakout spikes.
3. Enable **Wait for price to enter range** if the current price is outside your grid boundaries.

### Step 3: Export and Run
1. Click **Download grid.config.json** in the web app.
2. In your terminal, run the local bot server:
   ```bash
   cd bot
   npm install
   npm start
   ```
3. Open `http://localhost:3001` in your browser.
4. Drag and drop your downloaded `grid.config.json` into the dashboard.
5. The bot connects to Hyperliquid perps via API, cancels old orders, and begins matching resting buy and sell orders.

> [!WARNING]
> Always run your bot on **Testnet** first. Ensure you have configured your agent API key in the bot's `.env` file correctly, and only switch to `mainnet` when you have verified the bot's behavior over several days.
