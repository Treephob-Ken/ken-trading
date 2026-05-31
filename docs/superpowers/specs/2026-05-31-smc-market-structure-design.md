# SMC Market Structure — Design Spec

**Date:** 2026-05-31
**Status:** Approved for planning
**Author:** Ken + Claude (brainstorming session)

---

## 1. What we're building

A new **Market Structure** page that ports the LuxAlgo *Smart Money Concepts* (SMC)
indicator into the app, renders it on a large chart, and can launch a live signal
bot from a detected setup (deploy-to-bot).

The page reproduces, feature for feature, the LuxAlgo Pine v5 indicator the user
supplied as the reference:

- Internal structure (BOS / CHoCH) — short swing length
- Swing structure (BOS / CHoCH) — long swing length
- Order blocks (internal + swing) as shaded boxes, with mitigation removal
- Equal Highs / Equal Lows (EQH / EQL) with connecting dotted lines + labels
- Fair Value Gaps (FVG) as boxes, with mitigation removal
- Premium / Discount / Equilibrium zones
- Multi-timeframe (Daily / Weekly / Monthly) high-low levels
- Strong / Weak High and Low labels (trailing extremes)
- Optional trend-colored candles

### Goals
- Faithful visual match to the reference image / Pine script.
- Same SMC "brain" feeds **both** the chart and the trading path — no divergence.
- "Deploy to Signal Bot" works like the Backtester's, launching a live bot.
- The bot trades **exactly** what the page shows (web + bot strategy trees stay in sync).

### Non-goals
- No new charting library in phase 1 (stay on Lightweight Charts).
- No changes to existing pages beyond adding the sidebar entry + route.
- Not a profitability claim — this is an analysis + signal tool, not an edge by itself.

### ⚠️ License constraint (load-bearing)
The LuxAlgo SMC script is **CC BY-NC-SA 4.0 (Attribution-NonCommercial-ShareAlike)**.
- Private / personal / invite-only use: permitted.
- **Commercial use (paid product, public SaaS): NOT permitted** without a license from LuxAlgo.
- Any derivative must keep the same license and credit LuxAlgo.

This must be documented in code (header comment crediting LuxAlgo + license) and the
app must not expose this feature in a commercial/paid tier. If the app ever goes
commercial, this feature has to be removed or separately licensed.

---

## 2. Architecture

Two decoupled halves so the trading logic never depends on the drawing code:

```
                 ┌──────────────────────────────────────┐
   candles ───►  │  SMC ENGINE  (pure TS, no DOM)         │ ──► SMCResult
   settings ──►  │  src/lib/smc/engine.ts                 │      (structures,
                 └──────────────────────────────────────┘       boxes, labels,
                          │                    │                 zones, events)
                          ▼                    ▼
        ┌────────────────────────┐   ┌────────────────────────────┐
        │  DRAWING (web)          │   │  TRADING (bot)              │
        │  src/components/smc/    │   │  bot/src/strategy/          │
        │  Lightweight Charts +   │   │  same engine ported →       │
        │  Box + Label primitives │   │  emits buy/sell from events │
        └────────────────────────┘   └────────────────────────────┘
```

The engine is the single source of truth. The web draws its output; the bot trades
its event flags. They share the algorithm via the existing two-tree convention
(`src/lib/**` mirrored into `bot/src/strategy/**`).

---

## 3. Modules

### 3.1 Engine — `src/lib/smc/engine.ts` (+ `types.ts`)

Pure function, NaN-tolerant, no side effects:

```ts
computeSMC(candles: Candle[], settings: SMCSettings): SMCResult
```

`SMCSettings` mirrors the LuxAlgo input groups (all optional with LuxAlgo defaults):
swing length, internal length (5), structure display modes (All/BOS/CHoCH), order
block counts + filter (ATR vs cumulative-mean-range) + mitigation source (Close vs
High/Low), EQH/EQL bars + threshold, FVG threshold + extend, MTF toggles,
premium/discount toggle, monochrome/colored style.

`SMCResult` (shape sketch — exact fields finalized in the plan):

```ts
interface SMCResult {
  trendBias: (1 | -1 | 0)[]          // per-bar swing trend (for trend candles)
  internalBias: (1 | -1 | 0)[]
  structures: StructureBreak[]        // {kind:'BOS'|'CHoCH', scope:'internal'|'swing',
                                       //  bias, level, fromTime, atTime}
  orderBlocks: OrderBlock[]           // {scope, bias, top, bottom, fromTime, mitigated}
  equalLevels: EqualLevel[]           // {kind:'EQH'|'EQL', level, fromTime, toTime}
  fairValueGaps: FVG[]                // {bias, top, bottom, fromTime, toTime}
  zones?: PremiumDiscountZones        // {premium, equilibrium, discount} price bands
  mtfLevels: MTFLevel[]               // {tf:'D'|'W'|'M', kind:'H'|'L', level}
  trailing: { strongHigh, weakHigh, strongLow, weakLow }  // labeled extremes
  events: SMCEvents                   // per-bar boolean flags (see below)
}
```

`SMCEvents` = the per-bar flags from the Pine `alerts` UDT (internal/swing
bullish/bearish BOS + CHoCH, internal/swing bullish/bearish order-block breakout,
equal highs, equal lows, bullish/bearish FVG). These flags are the bridge to
trading and alerts.

Reuses and extends the existing `smcStructure()` in `src/lib/indicators.ts`.

**Porting notes (Pine → TS):** Pine `ta.highest/lowest(size)`, `ta.crossover/under`,
`ta.atr(200)`, `ta.cum`, and the `leg()` state machine all need explicit array
implementations. Pine evaluates the structure functions at swing length and at
internal length (5) every bar — the port walks bars once and maintains pivot/trend
state, matching the Pine `var` semantics already used in `smcStructure()`.

### 3.2 Drawing — `src/components/smc/`
- `SMCChart.tsx` — owns the Lightweight Charts instance, candles, and overlays.
- `primitives/BoxPrimitive.ts` — Lightweight Charts v5 `ISeriesPrimitive` that draws
  filled rectangles spanning a time range × price range (order blocks, FVGs, zones)
  on the pane canvas. Handles right-extension (`extend.right`).
- `primitives/LabelPrimitive.ts` — draws text labels anchored at (time, price) or at a
  bar-index midpoint (BOS/CHoCH/EQH/EQL/Strong-Weak/zone tags).
- Structure & EQH/EQL lines use the chart line API / price lines where they suffice;
  dotted EQH/EQL connectors may use the box/line primitive for styling parity.

### 3.3 Page — `src/pages/MarketStructurePage.tsx`
- Route `/structure`; new entry in `Sidebar.tsx` NAV_ITEMS + icon; route in `App.tsx`.
- Symbol/timeframe picker reusing the app's lifted `symbol`/`timeframe` + `SymbolSearch`.
- Settings panel mirroring LuxAlgo's groups (collapsible; sensible defaults so it works
  out of the box).
- `SMCChart` as the centerpiece (large, responsive — uses the `shrink-0` + `min-h`
  pattern so it never collapses, incl. iPad Safari).
- Events list: most recent fired events (CHoCH/BOS/OB tap/EQH/EQL) with time + price.
- Deploy-to-bot card (see §4).

### 3.4 Bot sync — `bot/src/strategy/`
- The engine is ported into `bot/src/strategy/smc-engine.ts` (mirror of the web engine).
- The bot's `smc` strategy is extended (phase 4) to accept which `SMCEvents` flag(s)
  trigger entry (e.g. swing bullish CHoCH, bullish order-block tap), keeping the
  current swing-BOS/CHoCH behavior as the default.

---

## 4. Trade integration (deploy-to-bot)

Mirrors the Backtester exactly:

1. The page builds a payload:
   `{ strategyId: 'smc', params: { swingLength, mode, ... }, symbol, timeframe, riskUsd/slPct/tpPct, ... }`.
2. "Deploy to Signal Bot" → `sessionStorage.setItem('pending_signal_bot_config', JSON.stringify(payload))` → `navigate('/signal')`.
3. `SignalBotsPage` reads `pending_signal_bot_config` and pre-fills the new-bot form (existing behavior — no change needed for the basic `smc` strategy).

For richer triggers (order-block tap, internal vs swing) the payload carries an SMC
event selector consumed by the extended bot strategy (phase 4).

---

## 5. Data flow

`MarketStructurePage` fetches candles via the existing path (`fetchKlines` — Binance
for `XXXUSDT`, HL `candleSnapshot` for HIP-3 `dex:coin`, branching on
`symbol.includes(':')`), runs `computeSMC()` in a `useMemo`, and passes the result to
`SMCChart` + events list + deploy payload. Any control change re-runs instantly, same
pattern as the Backtester.

---

## 6. Error handling
- Engine returns an empty `SMCResult` when `candles.length` is below the minimum for
  the chosen swing/internal lengths; the page shows a "not enough data" note.
- All engine math is NaN-tolerant (early bars produce no structure rather than throwing).
- Primitive draw routines guard against `na`/missing coordinates (LuxAlgo uses `na`
  boxes/lines heavily; the TS port treats those as "skip draw").
- Candle-fetch failures surface the same way as other pages (error card).

---

## 7. Testing
The decoupled, pure engine is the high-value test target — a wrong indicator means
false signals on real money.
- Unit tests on `computeSMC()` against fixtures: synthetic series with a known CHoCH,
  a known BOS, a known order block, EQH/EQL within threshold, and an FVG.
- Edge cases: too few bars, all-flat series, single big gap.
- A regression fixture captures a known-good `SMCResult` for a recorded candle slice so
  future refactors can't silently change output.
- Drawing primitives get a light smoke test (renders without throwing); visual parity is
  verified by eye against the reference during each phase.

---

## 8. Phasing

| Phase | Delivers | Why this order |
|---|---|---|
| **1** | Engine skeleton + `/structure` page + candles + swing structure (BOS/CHoCH labels) + strong/weak high-low | The recognizable skeleton; proves the page, data, and label primitive |
| **2** | Order blocks (boxes + mitigation) + EQH/EQL | The hard box primitive + the most-used SMC objects |
| **3** | Fair value gaps + premium/discount zones + MTF levels + trend candles | Completes visual parity with LuxAlgo |
| **4** | `SMCEvents` → alerts + deploy-to-bot wiring (+ bot engine port + event selector) | The "trade it" half, once the visuals are trusted |

Each phase is independently shippable and reviewable.

---

## 9. Risks / open questions
- **Lightweight Charts box/label fidelity.** If the custom primitives can't match
  LuxAlgo closely enough, the engine is decoupled so *only* the drawing layer swaps
  (e.g. to KLineCharts) — logic and trading path untouched.
- **Performance.** LuxAlgo caps at 500 boxes/lines/labels; the port must cap and reuse
  primitives, and respect `content-visibility` patterns already in the app.
- **Bot/web drift.** The two engine copies must stay identical; a shared fixture test
  run in both trees guards this.
- **Bundle size.** The main JS bundle is already ~1 MB; consider lazy-loading the
  Market Structure page (`React.lazy`) so it doesn't bloat first load.
