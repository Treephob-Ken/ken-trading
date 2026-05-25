# คู่มือการใช้งาน — Ken's Hyperliquid Trading Workbench

ที่อยู่: https://bot.garlic-trading.net
อัพเดท: 2026-05-25

---

## สารบัญ (Table of Contents)

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [Login / Register](#2-login--register)
3. [Settings — ตั้ง HL keys + Risk Controls](#3-settings)
4. [Backtester — ทดสอบกลยุทธ์กับข้อมูลในอดีต](#4-backtester)
5. [Grid Optimizer — หาพารามิเตอร์ grid ที่ดีที่สุด](#5-grid-optimizer)
6. [Scanner — สแกนหา coin/strategy ที่ดีที่สุดอัตโนมัติ](#6-scanner)
7. [Grid Bots — เปิด/จัดการ grid bot จริง](#7-grid-bots)
8. [Signal Bots — เปิด/จัดการ signal bot จริง](#8-signal-bots)
9. [Trade — เทรดมือ + ดู positions](#9-trade)
10. [Fundamentals — ภาพใหญ่ตลาด BTC](#10-fundamentals)
11. [Logs — log สดทุกบอท](#11-logs)
12. [Quick Reference (cheat sheet)](#12-quick-reference)
13. [Mainnet Pre-flight Checklist](#13-mainnet-pre-flight-checklist)

---

# 1. ภาพรวมระบบ

แอปนี้คือ "trading workbench" สำหรับ Hyperliquid perps มี 3 ชั้น:

### ชั้น 1 — Analyzer (วิเคราะห์)
- **Backtester** — ทดสอบ strategy บน data ในอดีต
- **Grid Optimizer** — หาค่า grid ที่ดี
- **Scanner** — สแกนหลายเหรียญพร้อมกัน
- **Fundamentals** — ภาพใหญ่ตลาด BTC (macro view)

### ชั้น 2 — Live Trading (เทรดจริง)
- **Grid Bots** — bot ทำ grid trading อัตโนมัติ
- **Signal Bots** — bot ตาม indicator signal
- **Trade** — เปิดออเดอร์เอง + ดู positions

### ชั้น 3 — Operations (จัดการ)
- **Logs** — ดู log สดของทุกบอท
- **Settings** — HL keys + Risk Controls (kill switch, slippage gate)
- **Login** — ระบบ multi-user, JWT auth

### Flow แนะนำ:
```
Fundamentals → Scanner → Backtester/Grid Optimizer → Deploy to Bot → Logs
   (ภาพใหญ่)    (หา coin)    (จูนพารามิเตอร์)         (เทรดจริง)    (ดูสด)
```

---

# 2. Login / Register

## ทำอะไร
หน้าแรกที่เจอถ้ายังไม่ login multi-user mode จะแสดง overlay สำหรับ register/login

## ใช้ยังไง

### Register (ครั้งแรกเท่านั้น)
1. Tab "Register"
2. Email + Password (อย่างน้อย 8 ตัว)
3. คลิก Register → JWT จะเก็บใน localStorage 7 วัน

### Login (ครั้งต่อๆ ไป)
1. Tab "Login"
2. Email + Password → กด Login

## ระวังอะไร
- **Email ต้องอยู่ใน `ALLOWED_EMAILS`** ใน `bot/.env` ตอนนี้ล็อกที่ ken2540@gmail.com
- **คน register คนแรกได้สิทธิ์ admin** — อย่าให้คนอื่นมา register ก่อน
- **Token หมดอายุ 7 วัน** ต้อง login ใหม่

## Trouble shooting

| ปัญหา | สาเหตุ | แก้ |
|---|---|---|
| "Email not allowed" | ไม่อยู่ใน whitelist | แก้ `bot/.env` `ALLOWED_EMAILS` |
| Login แล้วเด้งกลับ | JWT expired | clear localStorage + login ใหม่ |
| Settings ว่างเปล่า | ยังไม่ใส่ HL keys | ไป Settings ก่อนทำอะไร |

---

# 3. Settings

## ทำอะไร
ตั้งค่าสำคัญ 3 อย่าง:
1. **HL Credentials** — agent key + wallet address + network (testnet/mainnet)
2. **Risk Controls** — Kill Switch + Slippage Gate
3. ดู account สถานะ

## ส่วนที่ 1: HL Credentials

### ใช้ยังไง
1. ไปที่ Hyperliquid web app → API → Generate Agent Wallet
2. **Copy "Private Key"** (มี 0x + 64 hex)
3. **Copy "Wallet Address"** = wallet ที่มีเงินจริง (0x + 40 hex)
4. เลือก network: **Testnet** (ลอง) หรือ **Mainnet** (เงินจริง)
5. คลิก Save → ระบบจะ validate กับ HL จริงๆ ก่อน (< 1 วินาที)

### Gotcha สำคัญ
- **Agent key คนละอันกับ wallet private key!** Agent key ใช้แค่ trade ไม่ใช่ withdraw
- **อย่าใส่ wallet private key** เด็ดขาด — โปรเจคนี้ไม่ต้องการ
- **AES-256-GCM encrypted** บน disk → ปลอดภัย แต่ถ้า `KEY_ENCRYPTION_SECRET` หาย = key หายตลอดกาล

### เปลี่ยน network (testnet ↔ mainnet)
ระบบจะ:
1. ตรวจว่าเปลี่ยน network
2. **ไปทาง mainnet**: หยุดบอททั้งหมดอัตโนมัติ (safety)
3. **ไปทาง testnet**: บอทที่หยุดจากการเปลี่ยนไปเมนเน็ตจะ auto-resume
4. รีเซ็ต kill switch + daily loss baseline
5. UI badge เปลี่ยนสี (testnet = เหลือง, mainnet = เขียว)

## ส่วนที่ 2: Risk Controls

### Kill Switch
**ปุ่มหยุดฉุกเฉินทั้งบัญชี** ถ้าขาดทุนเกินกำหนด → หยุดทุกบอท + ปิดทุก position

ตั้งค่า:
- **Enable** = on/off
- **Threshold %** = ถ้าวันนี้ขาดทุนเกิน X% ของ equity ตอน UTC midnight → trip
- **Reset** ทุก UTC midnight ใหม่
- ถ้า trip → ต้องกด **Unlock** เอง

**แนะนำ:**
- mainnet วันแรก: 10-15%
- ใช้คล่อง: 20-25%

### Slippage Gate
**กรอง order ที่จะเปิดถ้าราคา HL ห่างจากราคา signal เกินกำหนด**

ตั้งค่า:
- **Max divergence %** = ระยะห่างสูงสุด HL mid vs signal price
- **แนะนำ:** 1-3%

ใช้กับ signal bot เท่านั้น (grid bot ไม่ใช้)

### Network Badge
มุมซ้ายล่าง sidebar — บอก network ปัจจุบัน
- **เหลือง** = Testnet (ปลอดภัย ฝึก)
- **เขียว** = Mainnet (เงินจริง ระวัง!)

## วิธีอ่าน
- มี account value + withdrawable แสดง → confirm ว่า credentials ถูก
- ถ้าค่าเป็น 0 → check key อีกครั้ง

## ระวังอะไร
- ❌ อย่าแชร์ agent key
- ❌ อย่าเปลี่ยน network ระหว่างบอททำงาน (ระบบจัดให้ แต่ avoid เพื่อความปลอดภัย)
- ✅ test บน testnet ก่อนเสมอ

---

# 4. Backtester

## ทำอะไร
ตอบคำถาม: **"strategy นี้เคยทำกำไรได้แค่ไหนในอดีต?"**

ทดสอบ 14 strategies บนข้อมูล Binance candles ย้อนหลัง พร้อม Monte Carlo, regime breakdown, walk-forward validation

## Layout หน้า

```
┌─────────────────────────────────────────────────────────┐
│ [Symbol] [Timeframe] [Date range] [Strategy] [Params]   │  ← Controls
├─────────────────────────────────────────────────────────┤
│ [Confidence Strip] — ผ่าน/ไม่ผ่าน 6 มิติ                  │
├──────────────────┬──────────────────────────────────────┤
│ [Equity curve]   │ [Trades table]                       │
│ [Indicator chart]│ [Metrics: Sharpe, drawdown, etc.]    │
├──────────────────┴──────────────────────────────────────┤
│ [Monte Carlo] [Regime breakdown] [Walk-forward] [MTF]   │
└─────────────────────────────────────────────────────────┘
```

## Controls (เลือกอะไรก่อน)

### Symbol + Timeframe
- เลือก coin (BTC, ETH, SOL, etc.)
- timeframe: 1m / 5m / 15m / 1h / 4h / 1d
- **แนะนำ:** เริ่มที่ 4h สำหรับ swing, 1h สำหรับ scalp

### Date Range
- **ช่วงข้อมูล** ใช้ test — ยิ่งยาว ยิ่ง robust
- **แนะนำ:** อย่างน้อย 6 เดือน, ดีสุด 1-2 ปี
- ระวัง: ช่วงสั้นเกินอาจ overfit

### Strategy (14 ตัว)
รวม MACD, EMA cross, RSI, Bollinger, Supertrend, PSAR, Stochastic, CCI, Williams %R, Donchian, Ichimoku-ish, etc.

### Direction
- **Both** = long + short
- **Long only** = ซื้อ-ขายอย่างเดียว
- **Short only** = short-cover อย่างเดียว

### SL / TP (optional)
ถ้าใส่ → คำนวณกำไรสมจริง (มี stop)

## Confidence Strip (ส่วนที่สำคัญที่สุด!)

แถบ 6 มิติ ตอบ "strategy นี้น่าเชื่อถือมั้ย?":

| มิติ | ผ่าน = | ไม่ผ่าน = |
|---|---|---|
| **Profitable** | total return > 0 | ขาดทุน |
| **Sharpe > 1** | Sharpe ratio ≥ 1 | ผันผวนเกินกำไร |
| **Beats Buy & Hold** | ชนะถือเฉยๆ | แพ้ถือเฉยๆ |
| **Enough trades** | ≥ 30 trades | sample เล็กไป |
| **Drawdown OK** | DD < 30% | DD ใหญ่เกิน |
| **Recent perf OK** | 90 วันล่าสุดยังกำไร | เริ่มแตก |

→ **ต้องผ่าน ≥ 4/6** ก่อนคิดจะ deploy

## Metrics ที่ต้องเข้าใจ

### Total Return %
กำไรรวมเป็น % ของ initial capital ($10,000)

### Sharpe Ratio
**Sharpe = (return − risk-free) ÷ volatility**

| Sharpe | Verdict |
|---|---|
| > 2 | ⭐ ดีมาก (ระวัง overfit) |
| 1-2 | ✅ ดี |
| 0-1 | 🟡 พอใช้ |
| < 0 | ❌ ขาดทุน |

### Max Drawdown
ลงต่ำสุดจาก peak

| Max DD | OK? |
|---|---|
| < 15% | ✅ ดี |
| 15-30% | 🟡 ทนได้ |
| > 30% | ❌ เครียดเกิน |

### Win Rate
% ของเทรดที่กำไร — **อย่ามองคนเดียว** ต้องดู profit factor ด้วย
- 40% win rate + 3:1 RR = ดี
- 80% win rate + 1:5 RR = แย่

### Profit Factor
รวมกำไร ÷ รวมขาดทุน
- > 1.5 = ดี
- 1.0-1.5 = พอใช้
- < 1 = ขาดทุน

## Components ใน Backtester

### Equity Curve
กราฟกำไรสะสมเทียบ Buy & Hold (รีเบสจาก 0)
- เส้นเขียว = strategy
- เส้นเทา = buy & hold

**ดูยังไง:**
- 📈 ขึ้นเรียบ = สวย
- 📊 ขึ้นๆ ลงๆ แต่ trend ขึ้น = ปกติ
- 📉 ลงนาน = ระวัง regime ผิด

### Trades Table
ดูทุก trade ที่บอททำ:
- Entry/Exit time + price
- Side (long/short)
- Profit/loss
- Hold duration

### Indicator Chart
ดูสัญญาณ + indicator overlays บน candle chart
- ดูว่า signal มา**ก่อน** entry มั้ย
- ดูว่า indicator ตรงกับ logic ที่คิดมั้ย

### Monte Carlo Simulation
"ถ้าโชคไม่ดี/โชคดี จะเป็นไง?"

สุ่มลำดับ trade ใหม่ 1,000 ครั้ง → ดู:
- Median outcome
- Worst case (5th percentile)
- Best case (95th percentile)

**ใช้ตัดสินใจ size:** ตั้ง position ให้ tolerate worst case ได้

### Regime Breakdown
แบ่ง backtest period เป็น 3 regime (Bull / Sideways / Bear) ด้วย Markov model

ดูว่า strategy ทำงานดีใน regime ไหน:
- ✅ ทุก regime กำไร = robust
- ⚠️ ดีแค่ regime เดียว = อันตราย ต้องเลือกใช้ตามตลาด

### Walk-Forward Validation
แบ่งข้อมูลเป็น chunks: train (in-sample) → test (out-of-sample) → roll

ดู **overfit score:**
- ใกล้ 0 = OOS ใกล้ IS = strategy ของจริง
- ใกล้ 100 = OOS ห่วยกว่า IS มาก = overfit

### Multi-Timeframe (MTF)
เช็คว่า trend timeframe ใหญ่กว่าสนับสนุนหรือเปล่า
- 1h signal + 4h trend ตรง = high confidence
- 1h signal vs 4h ตรงข้าม = avoid

### Parameter Sensitivity (Robustness)
ปั่นพารามิเตอร์ ±20% ดู Sharpe เปลี่ยนแค่ไหน

| Stability score | Verdict |
|---|---|
| 80-100 | ✅ Robust — safe deploy |
| 50-79 | 🟡 Moderate |
| < 50 | ❌ Overfit |

### Kelly Suggests
ปุ่มแนะนำ position size ตาม Kelly Criterion:
**f* = (W × R − L) ÷ R**
- W = win rate
- R = avg win / avg loss
- L = 1 − W

แนะนำใช้ **Half Kelly** เสมอ (ครึ่งของที่ Kelly บอก) — ลดความผันผวน

## Deploy to Bot
ปุ่มล่างสุด → ส่งค่า strategy + params + symbol ไปสร้าง signal bot ใหม่ จะถาม:
- Trade direction
- Risk USD + SL %
- Cooldown
- Daily loss limit

## วิธีใช้ — workflow แนะนำ

```
1. Fundamentals → เลือก market regime (bullish/bearish/neutral)
2. Backtester → เลือก coin + strategy
3. test 3 timeframes (1h, 4h, 1d) ดูตัวไหน Sharpe ดีสุด
4. ดู Confidence Strip ต้องผ่าน ≥ 4/6
5. ดู Walk-Forward overfit ต้อง < 30
6. ดู Robustness ต้อง 80+
7. ดู Regime — strategy ทำงานทุก regime ไหม
8. คลิก "Kelly Suggests" → ดูแค่อ้างอิง ใช้ Half Kelly
9. Deploy to bot → ส่งไป Signal Bots
```

## Common mistakes

| Mistake | แก้ |
|---|---|
| Test ช่วงสั้น 1 เดือน | ใช้อย่างน้อย 6 เดือน |
| ดูแค่ total return | ต้องดู Sharpe + drawdown ด้วย |
| ไม่เช็ค Walk-Forward | overfit แล้วเปิด live = แตก |
| ใช้ Full Kelly | ครึ่ง Kelly ปลอดภัยกว่าเยอะ |
| ไม่ test กับเหรียญ/timeframe อื่น | strategy ที่จริงต้อง robust |

---

# 5. Grid Optimizer

## ทำอะไร
ตอบคำถาม: **"ค่า grid อะไร (range/count/spacing) ที่ดีที่สุดสำหรับเหรียญนี้ตอนนี้?"**

Sweep พารามิเตอร์ grid หลายร้อยชุด → จัดอันดับ → แนะนำชุดที่ดีที่สุด

## Layout

```
┌─────────────────────────────────────────────────┐
│ [Symbol] [Lookback] [Investment] [Optimize!]    │
├─────────────────────────────────────────────────┤
│ [Market Fitness Score] [Verdict: Excellent/...]  │
├──────────────────────┬──────────────────────────┤
│ [Grid Chart]         │ [Sweep table — 50 grids] │
│ - Price + grid lines │ - sorted by total PnL    │
├──────────────────────┴──────────────────────────┤
│ [Stats: spacing, efficiency, ATR, etc.]          │
└─────────────────────────────────────────────────┘
```

## Controls

### Symbol
เลือก coin — ปกติเลือกที่ Scanner แนะนำ

### Lookback
จำนวน bars ย้อนหลังที่ใช้ optimize
- **แนะนำ:** 180 bars บน 4h = 30 วัน

### Investment
งบ USDC ที่จะ deploy
- **แนะนำ:** เริ่มที่ $50-100 บน mainnet

### Fee Rate
ใส่ตรงกับ HL = 0.045% taker

### Type / Mode
- **Type:** neutral / long-biased / short-biased
- **Mode:** arithmetic (เส้นห่างเท่ากัน) / geometric (% เท่ากัน)
- **แนะนำ:** Neutral + Arithmetic

## Market Fitness Score (สำคัญที่สุด!)

ตัวเลข 0-100 บอกว่า**ตอนนี้** ตลาดเหมาะกับ grid แค่ไหน

สูตร: (efficiency ratio + ATR% + range%) ปรับเป็น 0-100

| Score | Verdict | กลยุทธ์ |
|---|---|---|
| 75-100 | 🟢 Excellent | deploy ได้เต็มที่ |
| 60-74 | ✅ Good | deploy ได้ size ปกติ |
| 45-59 | 🟡 OK | deploy size เล็ก |
| 30-44 | 🟠 Caution | รอดูก่อน |
| < 30 | ❌ Skip | grid bot ไม่เหมาะ |

## Verdict (วาทกรรม)

ระบบจะเขียนคำอธิบายเป็น plain English เช่น:
- "Excellent grid setup — sideways market with consistent volatility"
- "Caution — trending market, grid will accumulate losing inventory"

## Sweep Table

ตารางแสดง ~50 grid configs ที่ test แล้ว เรียงตาม total PnL

Columns:
- **# Grids** — จำนวนเส้น
- **Spacing %** — ระยะห่างระหว่างเส้น
- **Completed roundtrips** — buy-sell pairs ที่จบ
- **Realized PnL** — กำไรจาก fills
- **Unrealized PnL** — กำไรจาก position ที่ค้าง
- **Total PnL** — รวม
- **Spacing × breakeven** — ระยะห่าง ÷ ค่าธรรมเนียม

**กฎ:** spacing × breakeven ≥ 3 = ปลอดภัย (กำไรพอจ่ายค่าธรรมเนียม)

## Grid Chart

แสดงราคา candles + grid lines แนวนอน + best fit overlay

**ดูยังไง:**
- ราคาเด้งทะลุเส้นบ่อย = grid ทำงาน
- ราคาไหลออกนอกกรอบเร็ว = grid พัง

## Stats Box

### Spacing %
ระยะห่างเฉลี่ยระหว่างเส้น

| Spacing | Verdict |
|---|---|
| < 0.5% | กระชั้นไป — ค่าธรรมเนียมกินกำไรหมด |
| 0.5-2% | sweet spot |
| > 2% | กว้างไป — กำไรน้อย trade เกิดยาก |

### Trades per day
ทำเทรดได้กี่ครั้งต่อวัน:
- ≥ 2 = ดี
- 1-2 = พอใช้
- < 1 = ตลาดเงียบเกิน

### Efficiency Ratio (Kaufman)
0-1 — ราคาวิ่งตรงจุดแค่ไหน
- ใกล้ 0 = วิ่งวนๆ (ดีต่อ grid)
- ใกล้ 1 = วิ่งทางเดียว (เลวต่อ grid)

### ATR %
ความผันผวนเฉลี่ย
- < 1% = นิ่งเกิน
- 1-3% = sweet spot
- > 3% = ผันผวนสูง — กว้าง spacing

### Range %
ช่วงราคา max-min ของ lookback / ราคาปัจจุบัน
- > 20% = ช่วงกว้าง = ดี
- < 10% = แคบเกิน = profit น้อย

## วิธีใช้ — workflow

```
1. Scanner → เลือก coin ที่ verdict "Excellent" หรือ "Good"
2. Grid Optimizer หน้านี้ → ใส่ coin นั้น
3. Investment = เงินที่จะ deploy
4. Optimize → รอ ~2 วินาที
5. ดู Market Fitness Score → ต้อง ≥ 60
6. ดู verdict → ต้องเขียนเชิงบวก
7. คลิก row ที่ดีที่สุด (top ของ table)
8. ตรวจ:
   - spacing × breakeven ≥ 3
   - trades/day ≥ 1
   - ราคา position อยู่ใน grid (กลาง ๆ ดีสุด)
9. คลิก "Deploy to bot" → ไปสร้าง grid bot
```

## Common mistakes

| Mistake | แก้ |
|---|---|
| Investment ใหญ่เกิน balance | ลด ให้ < withdrawable × 80% |
| Grid count 30+ | order size/เส้นเล็กไป — เริ่ม 5-10 |
| Range แคบกว่า 5% | ราคาหลุดเร็ว — กว้างขึ้น |
| Lookback < 100 bars | sample เล็กไป |
| ใช้ตอน trending market | optimizer จะ overfit ช่วงเทรนด์ |

---

# 6. Scanner

## ทำอะไร
ตอบคำถาม: **"ตอนนี้ coin ไหน + strategy ไหน + timeframe ไหน ดีที่สุด?"**

2 tabs:
1. **Indicator Scanner** — สแกน strategy บน ~30 coin × 2 timeframes × 14 strategies = **840 backtests**
2. **Grid Scanner** — สแกน grid fitness บน ~30 coin

## Symbol Universe (30 coin)
ใช้ intersection ของ:
- **HL `/api/assets`** = coin ที่ HL trade ได้
- **Binance top 30 by 24h volume** = liquid

→ ได้ ~30 coin liquid + tradeable
Cache ใน session, refresh ด้วยปุ่ม

---

## Tab 1: Indicator Scanner

### Filters

- **Min trades** (default 5) — กรอง strategy ที่ trade น้อย (lucky)
- **Direction** — long/short/both
- **Timeframes** — 1h ✅ 4h ✅ (กด chip toggle)
- **Strategies** — เปิด/ปิด 14 ตัว

### Best Pick Hero Card

ที่ด้านบน → row อันดับ 1
- เหรียญ + timeframe + strategy
- Total return %
- "Pick" badge (grade: great/good/ok/caution/skip)
- Plain English reason

### Top 3 Cards
อันดับ 1-3 ในรูปแบบ card ขนาดเล็ก

### Results Table

Columns:
| Rank | Symbol | TF | Strategy | Return % | Trades | Win Rate | Max DD | Sharpe | Pick badge | → |

**กดเรียงคอลัมน์ใดก็ได้** click ที่ header

**Pick badge สี:**
- 🟢 Great — เกือบทุก metric ดี
- 🔵 Good — ดี แต่มี caveat
- 🟡 OK — ใช้ได้
- 🟠 Caution — มีปัญหา
- 🔴 Skip — อย่าใช้

### ลูกศร (▶) — Deploy to Backtester
คลิก ▶ → ไปหน้า Backtester พร้อม symbol/timeframe/strategy preset

---

## Tab 2: Grid Scanner

### Filters

- **Regime** — only Sideways / all
- **Min spacing × breakeven** (default 3)
- **Min trades/day** (default 1)

### Results Table

Columns:
| Rank | Symbol | Score | Verdict | Regime | Trades/day | Range% | ATR% | Spacing × | → |

**Score** = Market Fitness 0-100 (เหมือนใน Grid Optimizer)

**Verdict:**
- Excellent (75+) 🟢
- Good (60-74) 🔵
- OK (45-59) 🟡
- Caution (30-44) 🟠
- Skip (<30) 🔴

**Regime:**
- Sideways ⭐ = grid ดีสุด
- Markup/Markdown = grid อาจขาดทุน
- Accumulation/Distribution = wait

### ▶ Deploy to Grid Optimizer
คลิก → ไป Grid Optimizer พร้อม symbol preset → optimize → deploy

---

## วิธีใช้ — workflow

### หา trade ของวัน
```
1. เปิด Scanner → tab Indicator
2. คลิก Scan → รอ ~10 วินาที (840 backtests)
3. ดู Best Pick — Pick badge ต้อง Great หรือ Good
4. คลิก ▶ → ไป Backtester
5. ใน Backtester → ดู Confidence Strip
6. ถ้าผ่าน → Deploy to bot
```

### หา grid coin
```
1. tab Grid
2. กรอง Regime = Sideways
3. คลิก Scan → ~3 วินาที
4. ดู top — verdict Excellent
5. คลิก ▶ → ไป Grid Optimizer
6. Optimize → Deploy to bot
```

## Persistence

- **Scan results เก็บใน sessionStorage** → สลับหน้าแล้วกลับมายังอยู่
- **Filters เก็บใน localStorage** → ค้างข้ามวัน
- **Refresh tab** → ผลรีเซ็ต (sessionStorage)

## ระวังอะไร

- ผล scan อิงข้อมูลในอดีต — ไม่ใช่ predicted future
- Indicator scanner default 90 วัน → trending coin จะดูดีเพราะตลาดวิ่งทางเดียว
- ตรวจกับ Fundamentals + Confidence Strip เสมอก่อน deploy

---

# 7. Grid Bots

## ทำอะไร
จัดการ grid bots ที่รันบน HL จริง

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [+ New]    [Bot list]                                       │
│   • SOL-GRID-5 RUNNING                                      │
│   • ALGO-GRID-8 STOPPED                                     │
├─────────────────────────────────────────────────────────────┤
│ [Selected bot: SOL-GRID-5]                                  │
│ [Edit form] | [Live stats] | [Chart] | [Activity log]       │
└─────────────────────────────────────────────────────────────┘
```

## สร้างบอทใหม่

### Step 1: คลิก + New
ฟอร์มเปิด — ใส่ค่า:

### Asset
เลือก coin (HL tradeable)

### Grid Range
- **Lower Price** = ราคาต่ำสุดของกริด
- **Upper Price** = ราคาสูงสุดของกริด
- กฎ: lower < ราคาปัจจุบัน < upper (start in range)

### Grid Count
จำนวนเส้น (5-50)
- **แนะนำ:** 5-10 บน mainnet

### Mode
- Arithmetic — เส้นห่างเท่ากัน
- Geometric — % เท่ากัน

### Sizing — Budget Mode (แนะนำ)
- **Budget (USDC)** = เงินที่ใช้
- **Leverage** = 1-50
- ระบบคำนวณ orderSize ให้

### Sizing — Manual
- **Order Size (contracts)** = ขนาดต่อเส้นเป๊ะๆ
- ใช้ถ้ารู้จริงๆ

### Risk Calculator (Optional)
**Input:** Risk USD + SL % below lower
**Output:** Suggested budget + SL/TP prices

→ คลิก "Apply to Budget + SL/TP" เพื่อนำค่าไปใส่ฟอร์ม

### Safety (Manual prices)
- **SL Price** = ปิด position ถ้าราคาต่ำกว่านี้
- **TP Price** = ปิด position ถ้าราคาสูงกว่านี้
- **Trigger Price** = อย่าเริ่ม grid จนกว่าราคาจะถึงนี่

### Bot Name
auto-name `BTC-GRID-10` ถ้าไม่ใส่

## Live Stats (เมื่อบอท running)

### P&L Box
- **Realized** = กำไรจาก fills เสร็จ
- **Unrealized** = กำไรจาก position ค้าง
- **Total** = รวม + APR%
- **Fees Paid** = สะสม

### Orders Box
- **Open Orders** = ออเดอร์ค้างบน HL
- **Fills** = ฟิลสะสม
- **Order Size** = ขนาดต่อเส้น
- **Budget** = งบที่ใช้

### Grid Activity
- **Fills/hour** — อัตรา fill
- **Roundtrips/hour** — อัตราจบรอบ
- **Grid Position %** — ราคาอยู่ตรงไหนในกริด (0 = lower, 100 = upper)
- **Nearest line** — เส้นใกล้ที่สุด + % ห่าง

### Safety Box
- **Stop Loss** + ระยะห่าง + "ON EXCHANGE" badge
- **Take Profit** + ระยะห่าง
- **Liquidation** — ราคา liq จากค่า leverage

⚠️ **ระวัง:** ถ้า liquidation อยู่ในกริด → ลด leverage

## Chart
ราคา candles + grid lines + SL/TP overlay
สลับ timeframe ได้

## Activity Log
log line ล่าสุด 119 entries

## ปุ่ม Start / Stop / Delete

### Start
1. ตรวจ pre-flight balance — withdrawable ≥ budget/leverage
2. เริ่มบอท → reconcile mode (ดึง orders จาก HL ถ้ามี)
3. วาง SL/TP บน exchange **ก่อน** วาง grid orders
4. วาง grid orders ทุกเส้น

### Stop
- ยกเลิกออเดอร์ทั้งหมด
- **ไม่ปิด position** อัตโนมัติ — ไปปิดเองที่ Trade page
- state เปลี่ยนเป็น stopped, ค้างใน config

### Delete
- ลบ config ถาวร
- ออเดอร์บน HL ต้อง stop ก่อน หรือยกเลิกเอง

## ⏸ Paused / Stranded Badges

### ⏸ Paused (สีเหลือง)
- หยุดเพราะคุณ switch network → mainnet
- จะ auto-resume เมื่อ switch กลับ testnet

### Stranded (สีส้ม)
- บอท stopped แต่มี position ค้าง
- มี banner เตือนใต้บอท list ให้กด Resume / Close

## Multi-Bot Conflict Banner

แสดง**บนหน้า** ถ้ามี ≥ 2 bot บน coin เดียวกัน (Signal + Grid + Manual)
- HL = one-way mode → 1 coin = 1 position
- บอทจะแย่งกัน → fee bleed
- หยุดเหลือ 1 ตัว

## Deploy after Server Restart

ระบบจะ auto-resume ทุก bot ที่ running ตอน restart:
1. อ่าน config + runtime sidecar
2. เรียก `start({ reconcile: true })`
3. ดึง resting orders จาก HL → adopt มาเป็นของ bot
4. วาง SL/TP ใหม่ (เพราะ oid เดิมอาจหาย)
5. continue ปกติ

## Common mistakes

| Mistake | แก้ |
|---|---|
| Leverage 20x+ liq อยู่ในกริด | ลด leverage 5-10x |
| Grid range 50% ของราคา | ใช้ Optimizer หา range |
| Grid count 30+ | order size เล็ก HL reject → ลด count |
| Lower > current price | ออเดอร์เป็น SELL ทั้งหมด คล้าย short |
| ลืม SL | ตั้ง SL ต่ำกว่า lower 3-5% |

---

# 8. Signal Bots

## ทำอะไร
จัดการ signal bots ที่รัน strategy + เปิด/ปิด position อัตโนมัติ

## Layout (เหมือน Grid Bots)

```
┌──────────────────────────────────────────┐
│ [+ New]   [Bot list]                     │
│   • ETH-MACD-1H                          │
│   • BTC-EMA-4H                           │
├──────────────────────────────────────────┤
│ [Selected bot]                           │
│ [Edit] [Live stats] [Chart] [Trades]     │
└──────────────────────────────────────────┘
```

## สร้างบอทใหม่

### Symbol (Binance) + Asset (HL)
- Symbol = `ETHUSDT` (Binance ใช้ดูข้อมูล)
- Asset = `ETH` (HL ใช้ trade)

### Timeframe
- 1m / 5m / 15m / 30m / 1h / 4h / 1d
- **แนะนำ:** 1h หรือ 4h (poll 30s)

### Strategy + Params
- เลือก 1 ใน 14 strategies
- ใส่พารามิเตอร์ (default values มี)

### Trade Side
- **Both** = long & short (flip)
- **Long only** = buy เปิด, sell ปิด
- **Short only** = sell เปิด, buy ปิด

### Sizing
- **Risk Mode** (แนะนำ): Risk USD + SL %
- **Budget Mode**: Investment + Leverage
- **Manual**: Size

### SL / TP
- **SL %** = วาง stop จาก fill price
- **TP %** = วาง take profit

### Slippage
- **Max Slippage %** = reject ถ้า fill ห่างจาก mid เกิน
- **Max Divergence %** = reject signal ถ้า HL mid ห่างจาก Binance close เกิน

### Cooldown
วินาทีระหว่าง 2 trades — กัน whipsaw

### MTF Filter (Optional)
- ใช้ trend timeframe ใหญ่กว่าเป็นตัวกรอง
- ถ้า signal ขัด trend ใหญ่ → skip

### Ensemble (Optional)
- เลือก > 1 strategy
- ตั้ง threshold = ขั้นต่ำที่ต้อง vote เห็นด้วย

### Daily Loss Limit %
- snapshot equity ตอน UTC midnight
- ถ้าขาดทุนเกิน → pause until next midnight

### Bot Name
auto-name `ETH-MACD-1H`

## Live Stats

### P&L Box
- **Realized** จาก trades ปิด
- **Total** + **APR%**
- **Trades**

### Signal Funnel ⭐ (สำคัญที่สุด!)

ตอบคำถาม: "ทำไม bot ไม่ trade?"

```
SEEN → EXECUTED (% pass-through)
[bar เขียวยาว = healthy]

ด่านกรอง:
- MTF blocked: X (กรอง trend ขัด)
- Cooldown: X (เปิดถี่ไป)
- Daily pause: X (loss limit)
- Ensemble: X (vote ไม่ผ่าน)
- Slippage: X (ราคาห่าง)
```

ใช้ debug:
| ภาพ | แปลว่า |
|---|---|
| SEEN 0, EX 0 | ตลาดยังไม่มี signal |
| SEEN 10, EX 1, Cooldown 9 | cooldown สั้นไป |
| SEEN 5, EX 0, MTF 5 | strategy ขัดตลาด |
| SEEN 8, EX 2, Ensemble 6 | threshold สูงไป |

### Trades Table
log ทุก trade — entry/exit/size/PnL

### Chart
candles + signal arrows + indicator overlay

### Activity Log
log line สด

## Logic การเปิด/ปิด

### Buy & Sell mode (Long & Short)
| Signal | Position | Action |
|---|---|---|
| BUY | Flat | open LONG |
| BUY | SHORT | close short → open long (flip) |
| SELL | Flat | open SHORT |
| SELL | LONG | close long → open short (flip) |

### Long Only mode
| Signal | Position | Action |
|---|---|---|
| BUY | Flat | open LONG |
| BUY | LONG | skip (already long) |
| SELL | LONG | close (no short) |

### Short Only mode
| Signal | Position | Action |
|---|---|---|
| SELL | Flat | open SHORT |
| SELL | SHORT | skip |
| BUY | SHORT | close (no long) |

### Position ปิดได้ 4 ทาง
1. Signal ตรงข้าม
2. SL trigger (HL ทำเอง)
3. TP trigger (HL ทำเอง)
4. Manual Stop button

## ปุ่ม Start / Stop / Delete
เหมือน Grid Bots

## วิธีใช้ — workflow

```
1. Backtester / Scanner → หา strategy ที่ดี
2. คลิก Deploy to Bot
3. ตั้ง trade side, SL/TP, daily limit
4. Start → priming bar (รอบแรกข้าม)
5. รอ signal บน bar ถัดไป
6. ดู Signal Funnel debug ถ้าไม่ trade
7. ดู Trades + chart ตามผล
```

## Common mistakes

| Mistake | แก้ |
|---|---|
| Timeframe 1m + cooldown 0 | over-trading → ใช้ 15m+ cooldown 300+ |
| ไม่ตั้ง SL | risk unlimited → ตั้ง SL เสมอ |
| ไม่ตั้ง Daily limit | bot ขุดบ่อ → ตั้ง 5-10% |
| Run 2 bots same asset | conflict → ดู banner เตือน |
| Ensemble threshold ต่ำเกิน | trade บ่อยเกิน |

---

# 9. Trade

## ทำอะไร
1. เปิด/ปิดออเดอร์ด้วยมือ
2. ดู positions ทั้งหมด
3. ดู source ของแต่ละ position (signal/grid/manual)
4. ดู position detail พร้อม chart + SL/TP/liq lines

## Layout

```
┌─────────────────────────────────────────────────────┐
│ [Account]      [Open Positions list]                │
│  Value/Free    • SOL/USDC LONG +2.50 [Grid] ▶       │
│                • ETH/USDC SHORT -1.20 [Signal] ▶    │
├─────────────────────────────────────────────────────┤
│ [Place Order]  [Position Detail]                    │
│  Asset + side  Chart + SL/TP/Liq overlay            │
│  Size + SL/TP  Stats: ROE, distance to liq, R:R     │
└─────────────────────────────────────────────────────┘
```

## Account Card (บนซ้าย)

3 ตัวเลข:
- **Account Value** = total worth incl. unrealized
- **Withdrawable** = ถอนได้ทันที (free margin)
- **Margin Used** = ติดเป็นหลักประกัน

อาจมี **Testnet ⚠ / Mainnet** badge

## Place Order Panel (ขวา)

### Asset
search ETH/USDC, BTC/USDC, etc.

### Price + Slippage
- Price = HL mid (live)
- Max Slippage % = reject ถ้า fill ห่างเกิน

### Sizing Mode
- **Risk-based** (แนะนำ): Risk USD + SL %
- **Fixed USDC**: ใส่ notional ตรงๆ

### Risk-based mode
- Risk $ + SL % + TP % (optional)
- ระบบโชว์ position size, qty, margin, SL/TP prices, R:R ratio

### Fixed USDC mode
- USDC amount
- Quick size buttons: 25/50/75/Max
- **SL %** + **TP %** (optional) — ใส่ถ้าต้อง bracket

### Buy / Sell buttons
- ส่ง market order ทันที
- ระบบวาง SL/TP บน HL อัตโนมัติถ้ามี
- Toast แจ้งผล: `✓ BUY 1.5 ETH (SL ✓, TP ✓)`

## Open Positions Card (กลางบน)

แสดงทุก position พร้อม:
- Asset/USDC + side badge
- Size + entry + leverage
- Unrealized PnL
- **Source chips** = บอทไหนเป็นเจ้าของ
  - 🤖 Signal · MACD
  - 📊 Grid · 5
  - ✋ Manual

**Source chip คลิกได้** — ไปหน้าบอทนั้น

### Stranded badge
ถ้าบอท stopped + position ค้าง → chip สีเหลือง "stranded"

### Close All Positions
ถ้ามี > 1 position → ปุ่มสีแดง confirm ครั้งเดียว ปิดพร้อมกัน

## Position Detail Card (ตัวเลือกล่าง)

คลิก position บน list → แสดง detail

### 6 Stat Tiles
1. **Unrealized PnL** + ROE% on margin
2. **Price move %** since entry
3. **Distance to liquidation** (warn < 5%)
4. **Stop loss** + distance
5. **Take profit** + distance
6. **Risk:Reward** + time held

### Quick Info Row
- Notional, Margin used, Leverage

### Chart
candles 1h + entry line (สีเขียว/แดง) + SL line (เส้นประแดง) + TP line (เส้นประเขียว) + Liq line (เส้นจุดส้ม)

## Multi-Bot Conflict Banner
ถ้ามี ≥ 2 bot บน coin เดียวกัน → banner แดงบนสุด

## วิธีใช้

### เปิด trade เร็ว
```
1. เลือก Asset
2. ดู Price + Max Leverage
3. Sizing Risk-based — Risk $20 + SL 2%
4. ใส่ TP 4% (R:R 2:1)
5. Buy → confirm
6. ดู Position Detail หลัง fill — SL/TP ✓
```

### ปิด trade ด่วน
```
1. เห็น Position บน list
2. คลิก Close → confirm
3. ระบบ cancel SL/TP เก่า → market close reduce-only
```

## ระวังอะไร

- ❌ Close ระหว่าง bot running → bot อาจ re-open ใน tick ถัดไป
- ❌ Stop ตั้งไกลเกิน 10% — ขาดทุนใหญ่ก่อน trigger
- ✅ ใช้ source chip ดู ownership ก่อนปิด
- ✅ ใช้ Risk-based mode → loss = Risk $ เป๊ะๆ

---

# 10. Fundamentals

## ทำอะไร
ภาพใหญ่ตลาด BTC — sentiment, valuation, regime, leverage, positioning

## Verdict Card (บนสุด)
สรุปเป็น stance:
- **Strongly Bullish** → trade aggressive long
- **Cautiously Bullish** → long size เล็ก
- **Neutral** → grid bot only
- **Cautiously Bearish** → ลด exposure
- **Strongly Bearish** → cash / short

อ่าน **narrative** ใต้ stance — มี reasoning

## Chip Row (5 มิติ)
แต่ละ chip + arrow trend 7 วัน

| Chip | Bullish | Bearish |
|---|---|---|
| Sentiment (F&G) | < 30 fear | > 75 greed |
| Valuation (MVRV) | < 1.0 cheap | > 3.7 euphoric |
| Regime (Wyckoff) | Markup/Accum | Markdown/Distrib |
| Leverage (Funding) | balanced | > 30% APR |
| Breadth (OI) | rising w/ price | rising w/ falling |

## 8 Cards (รายละเอียดทุก metric)

### 1. Fear & Greed (F&G)
0-100 scale, history 1 ปี
- < 25 = capitulation (buy zone)
- > 75 = euphoria (avoid)

### 2. MVRV
Market Cap ÷ Realized Cap
- < 1 = deep value
- 1-mean = cheap
- mean ± 15% = fair
- > 3.7 = top zone

### 3. Regime (Wyckoff)
BTC candles + EMA50/EMA200
- Price > EMA50 > EMA200 = **Markup** (long pullback)
- Price < EMA50 < EMA200 = **Markdown** (short rally)
- Sideways = **Accumulation** or **Distribution**

### 4. Funding + OI
**Funding APR:**
- > 30% = hot, squeeze risk
- 15-30% = warm
- -10 to 15% = neutral
- < -10% = shorts paying

**OI:**
- ขึ้น + ราคาขึ้น = healthy
- ขึ้น + ราคาลง = bearish acceleration
- ลง + ราคาขึ้น = short squeeze (อาจไม่ยั่งยืน)

### 5. Dominance
- > 60% BTC.D = BTC season
- 50-60% = mixed
- 45-50% = alt holding
- < 45% = alt season

### 6. Volatility
RV30 / RV7 / ATR%
- < 25% = Calm
- 25-50% = Normal
- 50-80% = Elevated (widen SL)
- > 80% = Extreme (avoid)

### 7. Cycle (Mayer + Pi Cycle)
**Mayer Multiple** = price ÷ 200DMA
- < 0.8 = Cheap
- 0.8-1.8 = Fair
- 1.8-2.4 = Hot
- > 2.4 = Cycle Top

**Pi Cycle:** 111DMA × 2 ตัด 350DMA = top warning (3 ครั้งใน 12 ปี)

### 8. Smart Money
**Long/Short Ratio** (Binance top traders):
- > 1.6 = crowded long (squeeze risk)
- < 0.8 = lean short (contrarian buy)

**Coinbase Premium** = CB price − Binance price (% of price)
- > +0.15% = US institutional buying
- < -0.15% = US outflow / Asia-led

## วิธีอ่าน — สูตร 7-step

```
1. Verdict + Stance → big picture
2. Mayer + Pi Cycle → macro (where in cycle)
3. F&G + MVRV → sentiment + valuation
4. Regime → current phase (Markup/Markdown/...)
5. Funding + OI → leverage warning
6. Volatility → sizing rule
7. Smart Money → cross-check
```

**Decision rule:** ถ้า ≥ 6/11 indicators เอนทางเดียวกัน = high-confidence

## ใช้ตอนไหน

- **ก่อนเริ่มวัน:** ดู verdict → ตัดสินใจกล้า/ระวัง
- **ก่อน deploy bot:** ดู volatility → จัด SL
- **ก่อน aggressive trade:** ดู ทุก 11 indicators
- **เมื่อสงสัยตลาด:** ดู Pi Cycle + MVRV → ระยะ cycle

---

# 11. Logs

## ทำอะไร
ดู log สดทุก bot ผ่าน Server-Sent Events (SSE) — real-time

## Layout

```
┌─────────────────────────────────────────┐
│ [Filter by bot] [Filter by level] [Pause]│
├─────────────────────────────────────────┤
│ 2026-05-25 10:23:01 [SOL-GRID-5] info    │
│   BUY 1.06 @ $85.23 (line 3)             │
│ 2026-05-25 10:23:15 [ETH-MACD-1H] fill   │
│   ✓ SHORT 0.5 ETH placed @ $3052         │
│ ...                                      │
└─────────────────────────────────────────┘
```

## Log Levels

| Level | สี | ใช้ตอน |
|---|---|---|
| `info` | ขาว | event ทั่วไป |
| `ok` | เขียว | success |
| `fill` | ฟ้า | order filled |
| `warn` | เหลือง | warning, retry |
| `err` | แดง | error, failed |

## วิธีใช้

### Debug บอทไม่ trade
ดู signal funnel ก่อน → ถ้ามี events ผ่าน strategy แต่ block ที่ slippage/cooldown → ดู logs

### Debug error
filter level = err → เห็นทุก error message

### Monitor live
ปล่อยหน้า logs เปิดไว้ตอน trading — ดูทุก fill real-time

## ระวังอะไร
- Logs เก็บใน memory ของ bot — restart server → log หาย
- เก็บไม่เกิน 119 lines/bot
- ไม่ใช่ persistent — ถ้าต้องการ history → ดู trade-audit.log

---

# 12. Quick Reference

## Macro Decision Table (จาก Fundamentals)

| Score | Verdict | Position size | Strategy |
|---|---|---|---|
| ≥ 9/11 bullish | Strongly Bullish | Full size, aggressive long | Signal + Grid |
| 6-8 bullish | Cautiously Bullish | Half size, long bias | Signal mainly |
| 4-6 mixed | Neutral | Tiny size or grid only | Grid bot only |
| 6-8 bearish | Cautiously Bearish | Half size, short bias | Short or cash |
| ≥ 9 bearish | Strongly Bearish | Cash, or short | No new longs |

## Strategy Health Checklist (Backtester)

- [ ] Total return > 0
- [ ] Sharpe ≥ 1
- [ ] Beats Buy & Hold
- [ ] ≥ 30 trades
- [ ] Max drawdown < 30%
- [ ] Recent 90 days still profitable
- [ ] Walk-Forward overfit < 30
- [ ] Robustness ≥ 80
- [ ] Works across multiple regimes

**Pass ≥ 7/9 → deploy**

## Grid Bot Health Checklist

- [ ] Market Fitness ≥ 60
- [ ] Verdict: Excellent or Good
- [ ] Regime: Sideways
- [ ] Spacing × breakeven ≥ 3
- [ ] Trades/day ≥ 1
- [ ] Liquidation outside grid range
- [ ] SL below lower bound 3-5%
- [ ] TP above upper bound 3-5%
- [ ] Order size/line ≥ $10 (HL min)

**Pass ≥ 7/9 → deploy**

## Signal Bot Health Checklist

- [ ] Backtester Sharpe ≥ 1
- [ ] Confidence Strip ≥ 4/6 pass
- [ ] Walk-Forward overfit < 30
- [ ] SL % set
- [ ] TP % set (or rule for exit)
- [ ] Cooldown ≥ 60s (or matches timeframe)
- [ ] Daily loss limit set
- [ ] No other bot on same asset
- [ ] Strategy proven on multiple coins

**Pass ≥ 7/9 → deploy**

## ค่าตั้ง default แนะนำ (Mainnet วันแรก)

```
Risk USD:           $1-2 per trade
SL %:               2-5%
TP %:               4-10%
Daily loss limit:   5-10%
Kill switch:        10-15%
Leverage:           3-5x (grid), 5-10x (signal)
Grid count:         5-10
Slippage gate:      2-3%
Cooldown:           300s (5 min) for 1h timeframe
                    900s (15 min) for 4h timeframe
```

---

# 13. Mainnet Pre-flight Checklist

ก่อนเปิด mainnet ครั้งแรก:

### ระดับเงิน
- [ ] Fund mainnet $10-20 USDC เท่านั้น
- [ ] Withdrawable ≥ Budget × 1.5 (buffer สำหรับ fees + slippage)

### Safety
- [ ] Kill switch enabled threshold 10-15%
- [ ] Slippage gate enabled 2-3%
- [ ] Daily loss limit ตั้งทุก bot

### Bots
- [ ] เริ่ม 1 bot เท่านั้น (ไม่ใช่ทั้งฝูง)
- [ ] เลือก coin ราคาต่ำ (ALGO, DOGE, XRP) — szDecimals ดี
- [ ] grid count 3-5 (ไม่ใช่ 10+)
- [ ] Leverage 3-5x สำหรับ grid
- [ ] SL/TP ทั้งคู่ตั้งให้แน่ใจ

### Verification
- [ ] เปิด Trade page ดู position หลังบอทเริ่ม
- [ ] เปิด HL web UI เปรียบเทียบ — ออเดอร์ตรงกันมั้ย
- [ ] รอ 5-10 fills แรก — ทุกตัวมี SL/TP บน exchange?
- [ ] ดู Logs ไม่มี err

### Network safety
- [ ] อย่า switch network ขณะบอท running (ระบบจัดให้ แต่ avoid)
- [ ] Test pause/resume บน testnet ก่อนใช้บน mainnet

### Backup
- [ ] Copy `KEY_ENCRYPTION_SECRET` เก็บที่ปลอดภัย (หายแล้วหายเลย)
- [ ] Snapshot `bot/data/users.db` ทุกสัปดาห์

---

## ตัวอย่าง workflow รวม — เปิด live trade ครั้งแรก

```
[Day 1] Research
   ↓ Fundamentals → ดู macro = Cautiously Bullish
   ↓ Scanner Indicator → DOGE-MACD-1h, Pick=Good
   ↓ Backtester → Sharpe 1.5, DD 12%, Walk-forward overfit 18
   ↓ Confidence Strip → 5/6 pass
   ✓ Strategy approved

[Day 2] Testnet
   ↓ Deploy to Signal Bot (testnet)
   ↓ Risk $5 + SL 3% + TP 6% + Daily 8%
   ↓ Cooldown 600s
   ↓ Start → รอ 24h
   ✓ บอททำงานปกติ ไม่มี error

[Day 3] Mainnet
   ↓ Settings → switch testnet → mainnet
   ↓ Fund mainnet $20 USDC
   ↓ Kill switch 15% on
   ↓ Slippage gate 2%
   ↓ Bot ที่ paused → start manually (ตรวจอีกครั้ง)
   ✓ Bot running บน mainnet

[Day 4] Monitor
   ↓ Logs page เปิดทิ้งไว้
   ↓ Trade page ดู positions
   ↓ Settings → check kill switch ไม่ trip
   ↓ ทุก fill → ดู SL/TP บน HL web UI
   ✓ 5 fills ผ่าน ✓
```

---

**คู่มือนี้อัพเดท: 2026-05-25**

มีคำถามเพิ่ม? เปิด session ใหม่ และพิมพ์ context สั้นๆ — Claude มี memory ของโปรเจค + คู่มือนี้
