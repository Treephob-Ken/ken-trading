# 🌊 Simple & Clear Trading Guide: Crypto Strategy Lab

Welcome to your **Crypto Strategy Lab**! This platform helps you test indicators, size your positions safely, check for overfitting, and run a **live grid bot** on the Hyperliquid exchange. 

Think of this site as your flight simulator. Before risking real money, you can run simulations (backtests) on real historical data to see what works, what doesn't, and what safety settings to use.

---

## 🧭 Quick Start Checklist
1. **Backtest**: Run strategies on past data to see how much they make and how much they drop.
2. **Validate**: Double-check that your settings aren't just "lucky" on past data (Walk-Forward).
3. **Diversify**: Check that your chosen strategies don't enter the exact same trades (Correlation).
4. **Optimize Grid**: Find the optimal buy/sell grid structures for sideways markets.
5. **Deploy**: Download your configuration and upload it to your live trading bot.

---

## 1. 🔍 The Golden Rule: Trends vs. Ranges

No strategy works in all market conditions. A successful trader chooses the right tool for the current job.

### 🏄‍♂️ The Trend-Follower (Surfing the Wave)
When the market has momentum (either going straight up or straight down), use **Trend-Following** strategies.
* **Strategies**: **EMA Crossover**, **MACD**, **Supertrend**, **Parabolic SAR**.
* **How they work**: They wait for a wave to form, jump on, and ride it.
* **When they fail**: Sideways markets. They get "whipsawed"—buying at the top of a mini-bump and selling at the bottom of a mini-drop, losing money on repeated small cuts.

### 🏓 The Oscillator (Playing Ping-Pong)
When the market is bouncing between a floor (support) and a ceiling (resistance), use **Mean-Reversion** strategies.
* **Strategies**: **RSI Reversal**, **Stochastic**, **Bollinger Bands**, **CCI**.
* **How they work**: They buy when the price is low (oversold) and sell when it is high (overbought).
* **When they fail**: Strong trends. If a coin skyrockets, the oscillator will keep trying to short it, or if it crashes, it will keep buying a falling knife.

> [!TIP]
> Scroll to the **Market Regime Model** at the bottom of the page. It automatically calculates whether the market is currently in a **BULL**, **BEAR**, or **SIDEWAYS** regime using a predictive Markov probability model.

---

## 2. 📊 Backtesting: Your Flight Simulator

Running a backtest downloads real historical data and simulates how a strategy would have performed.

### How to Run a Backtest
1. **Choose your Market**: Under **Market Pair**, search for a coin (e.g. `BTC/USDT` or `ETH/USDT`).
2. **Choose your Timeframe**: Select the candle size. 
   * **15m / 30m** is for fast, active trades.
   * **1h / 4h** is for calmer, swing trades.
3. **Select Date Range**: Click **30D**, **90D**, or **1Y** to load data.
4. **Pick a Strategy**: Select an indicator from the **Strategy** dropdown.
5. **Wiggle the Parameters**: Adjust the slider inputs. Watch the equity curve update instantly!

### Understanding the Results Card
* **Strategy Return**: The total simulated profit or loss of the strategy.
* **Buy & Hold**: How much you would have made if you just bought the coin and did nothing. If your Strategy Return is not higher than Buy & Hold, the strategy has no edge!
* **Max Drawdown**: The worst losing streak. If your Max Drawdown is **-15%**, it means at some point, your account dropped 15% from its highest peak. You must be emotionally and financially prepared to handle this.
* **Sharpe & Sortino Ratios**: Risk-adjusted returns.
  * **Under 1.0**: High risk for low reward. Avoid.
  * **1.0 to 1.9**: Good, solid strategy.
  * **2.0+**: Excellent, institutional-grade. The gains are smooth and stable.

---

## 3. 🛡️ Sizing & Risk: How to Avoid Blowing Up

The secret to staying in the game is never losing too much on any single trade.

### Position Sizing Modes
* **Fixed Size**: Every trade uses the exact same dollar amount. This is the safest setting for beginners.
* **Compounding**: Wins increase your trade sizes; losses decrease them. Your profits snowball, but so can your drawdowns.
* **Volatility Sizing (Recommended)**: Uses the **ATR (Average True Range)** indicator. 
  * If the market gets highly volatile and erratic, it automatically **widens your stops** and **shrinks your trade size** so you risk the same dollar value.
  * If the market gets calm and quiet, it **tightens your stops** and **increases your trade size**.
  * Set your **Target Risk %** to **1% to 2%** of your capital per trade.

### Risk Controls
* **Stop Loss %**: The absolute exit door. If a trade goes against you by this %, it closes immediately. **Always set a Stop Loss!**
* **Take Profit %**: Closes the trade at a target profit. 
* **Risk Manager suggestion**: The app's **Risk Manager** card at the bottom looks at your historical trade statistics and suggests optimal Stop Loss and Take Profit levels that match your strategy's win rate.

---

## 4. 🔬 Advanced Health Checks: Walk-Forward & Correlation

Before putting real capital at risk, run these checks to ensure your strategy is robust, not just lucky.

### walk-forward Validation (The Overfit Filter)
"Overfitting" is when you adjust your settings so perfectly to past data that they fail in real life because they memorized noise. 
* The **Walk-Forward Validation** panel splits historical data into 5 segments. It optimizes settings on the first part (In-Sample) and tests them on unseen data (Out-of-Sample).
* **Robust**: Out-of-Sample results are positive and steady. Safe to trade!
* **Overfit**: Out-of-Sample results are bad. The settings are fragile and should not be used.

### Strategy Correlation (The Diversification Test)
If you trade multiple strategies, make sure they aren't entering the exact same positions, doubling your risk.
* Check the **Strategy Correlation Matrix** heatmap.
* **Green / Blue cells (low or negative correlation)**: Strategies behave differently. Perfect for running together.
* **Red cells (high correlation)**: Strategies do the same thing. Do not run both at the same time.

---

## 5. ⚙️ The Grid Optimizer: Printing Money Sideways

Grid trading doesn't care if the price goes up or down. It places a grid of buy and sell orders around the current price. When the price dips, it buys; when it bounces, it sells.

### Grid Spacing Rules
* **Arithmetic Grid**: Spaced by equal dollar steps. Good for stable, low-priced assets.
* **Geometric Grid**: Spaced by equal percentages. Highly recommended for crypto, as a 2% move at $3,000 is much larger than a 2% move at $2,000.
* **The Fee Test**: Check the **Spacing ÷ Breakeven** ratio in the Grid Optimizer card. It **must be at least 3.0×**. If it is lower, your grid spacing is too tight, and trading fees will eat up all your profits!

---

## 6. 🚀 Step-by-Step Live Bot Deployment

Once you have optimized your strategy and grid parameters, it's time to run the live bot.

### Step 1: Run your Bot Dashboard locally
Open your terminal and start your bot:
```bash
cd bot
npm install
npm start
```
This launches your local trading backend and bot server.

### Step 2: Download your Configuration
1. In the **Grid Optimizer** on the website, configure your live settings:
   * **Investment ($)**: The capital you want to commit.
   * **Leverage**: e.g., `1x` (no leverage, safest) to `3x`.
   * **Stop Loss / Take Profit**: Safety exits.
2. Click the **Download grid.config.json** button in the sidebar.

### Step 3: Start Trading on Hyperliquid
1. Go to `http://localhost:3001` in your web browser.
2. Drag and drop your downloaded `grid.config.json` file into the dashboard.
3. Click **Start Bot**.
4. The bot will automatically connect to the Hyperliquid exchange, place the grid orders, and begin tracking your profits in real time!

> [!WARNING]
> Always run your bot on **Testnet** (mock trading) first. Ensure your API keys are correct, and verify that the grid bounds match your current expectations before deploying real funds.
