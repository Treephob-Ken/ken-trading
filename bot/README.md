# Hyperliquid Grid Bot

A live grid trading bot for Hyperliquid (testnet + mainnet). Designed to run the grid spec you optimized in the web app against the real Hyperliquid order book.

```
bot/
├── grid.config.json       # the grid you want to run (range, count, size)
├── .env                   # secrets (your keys)
├── src/
│   ├── index.ts           # entry point
│   ├── config.ts          # env + grid config loader
│   ├── hyperliquid.ts     # SDK wrapper
│   ├── grid-bot.ts        # the trading loop
│   └── logger.ts
└── package.json
```

## One-time setup

### 1. Get a Hyperliquid testnet account

1. Open https://app.hyperliquid-testnet.xyz and connect any EVM wallet (MetaMask, Rabby, etc.).
2. **Portfolio → Get USDC** — receive 1,000 test USDC from the faucet.
3. **Settings → API → Generate API Wallet**. Save the **private key** (`0x…64 hex chars`). This is your **agent key**.
4. Click **Approve** to register the agent on-chain. The agent can place/cancel orders but **cannot withdraw** — the worst case if it leaks is wasted gas, not stolen funds.

### 2. Configure the bot

```bash
cd bot
cp .env.example .env
```

Edit `.env`:
- `HL_AGENT_PRIVATE_KEY` — the `0x…` key from step 3
- `HL_USER_ADDRESS` — your main wallet address (the one that approved the agent)
- `HL_NETWORK=testnet` — leave as testnet until you trust the bot

### 3. Set the grid spec

Edit `grid.config.json`. Pull the numbers from the web optimizer:

```json
{
  "asset": "ETH",
  "lower": 2800,
  "upper": 3600,
  "gridCount": 6,
  "mode": "arithmetic",
  "orderSize": 0.01
}
```

- `asset` — Hyperliquid perp symbol: `"ETH"`, `"BTC"`, `"SOL"`, …
- `lower` / `upper` — price range from your optimizer's `Range Low` / `Range High`
- `gridCount` — the **Optimal Grid Count** the optimizer picked
- `mode` — `"arithmetic"` (equal price gaps) or `"geometric"` (equal % gaps)
- `orderSize` — qty per grid line in asset units. **Start tiny** (e.g. `0.01` ETH ≈ $35). Hyperliquid's minimum perp order is $10 notional.

### 4. Install & run

```bash
npm install
npm start
```

You'll see something like:

```
[2026-05-20 10:23:01] · Network: TESTNET
[2026-05-20 10:23:01] · Grid: ETH [2800, 3600] x 6 (arithmetic) sz=0.01
[2026-05-20 10:23:02] · ETH markPx=3142 midPx=3142.5 szDec=4 pxDec=2
[2026-05-20 10:23:02] OK Cancelled 0 pre-existing ETH orders.
[2026-05-20 10:23:02] · Grid lines (7):
[2026-05-20 10:23:02] ·   [0] 2800.00
[2026-05-20 10:23:02] ·   [1] 2933.33
...
[2026-05-20 10:23:03] · -> BUY 0.0100 @ 2800.00 (line 0, oid 78451322)
[2026-05-20 10:23:03] · -> BUY 0.0100 @ 2933.33 (line 1, oid 78451323)
...
[2026-05-20 10:23:04] OK Bot live. 6 resting orders on ETH.
```

## How it works

- On start, the bot cancels any existing orders on `asset`, then places one limit order at every grid line (buys below current price, sells above).
- Subscribes to `userFills` over WebSocket.
- On each fill: places an opposite order one grid line away (buy fill → sell one line up; sell fill → buy one line down).
- P&L per roundtrip comes from Hyperliquid's `closedPnl` field — fees included, matches the web UI exactly.
- Stats line every 30 seconds: realized P&L, fees, completed roundtrips, fills, open orders.
- `Ctrl+C` cancels all open orders before exiting.

## Watching it

Open the same testnet account in https://app.hyperliquid-testnet.xyz alongside the terminal — every order the bot places shows up immediately, and every fill is reflected in both places. That side-by-side view is the fastest way to understand what the bot is doing.

## Safety checklist before mainnet

- [ ] At least a few days of testnet runs without surprises.
- [ ] You understand exactly what happens if price exits the grid (the bot stops trading until price re-enters; one side accumulates inventory).
- [ ] You sized `orderSize` so worst-case drawdown is something you can stomach.
- [ ] You set `HL_NETWORK=mainnet` only when ready. The bot waits 5 seconds first as a sanity check.
- [ ] Your `.env` is in `.gitignore` (it is, via the root config).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Asset X not found on Hyperliquid` | Wrong ticker. Use exactly the Hyperliquid perp name (e.g. `"ETH"`, not `"ETHUSDT"`). |
| `Order rejected: ...` | Often **price too far from market** (Hyperliquid rejects limits >~95% away), **size below $10 min notional**, or **insufficient margin**. |
| Many `crossed on placement` warnings | Your range straddles the current price oddly. Verify `lower < current price < upper`. |
| No fills for a long time | Normal if the market hasn't oscillated. Grids need chop, not trends. Verify `Trend Efficiency` was low in the optimizer. |
