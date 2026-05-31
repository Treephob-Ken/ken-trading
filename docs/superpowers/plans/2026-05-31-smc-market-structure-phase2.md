# SMC Market Structure — Phase 2 Implementation Plan

> Follows the Phase 1 plan. Spec: `docs/superpowers/specs/2026-05-31-smc-market-structure-design.md`.

**Goal:** Add **order blocks** (shaded boxes) and **EQH/EQL** (equal highs/lows) to the Market Structure page.

**Architecture:** Extend the pure `computeSMC()` engine to also detect swing order blocks + equal highs/lows (unit-tested). Render EQH/EQL with existing line+marker APIs. Render order blocks with a custom Lightweight Charts v5 series primitive (canvas boxes).

**License:** LuxAlgo SMC, CC BY-NC-SA (non-commercial). Headers already in `src/lib/smc/`.

---

## Risk-ordered sequencing (why this order)

I cannot self-screenshot this app, so each visual check costs a user round-trip. To make failures unambiguous, detection is proven (tested + shown as text) BEFORE the canvas boxes I can't see:

1. **Engine detects OBs + EQH/EQL — unit tested.** Pure, high confidence, zero visual risk.
2. **Render EQH/EQL (dotted line + label)** — same proven pattern as Phase 1 structure lines.
3. **List order blocks as TEXT** in the events panel — confirms *detection* independently of box drawing.
4. **Then** build the OB box primitive against an already-trusted engine.

→ **Deploy checkpoint 1** after step 3 (EQH/EQL visible + OB detection confirmed as text).
→ **Deploy checkpoint 2** after step 4 (boxes).

---

## Order-block detection (port of LuxAlgo `storeOrdeBlock`/`deleteOrderBlocks`)

Volatility-parsed extremes per bar:
```
vol = ATR(200)                      // src/lib/indicators.ts atr(h,l,c,200)
highVol = (high - low) >= 2*vol
parsedHigh = highVol ? low : high
parsedLow  = highVol ? high : low
```
On each SWING structure break (we already detect these), store an order block:
- Bullish break: among bars [pivotBarIndex, breakBarIndex), find the index with the MIN parsedLow. OB = { top: parsedHigh[idx], bottom: parsedLow[idx], fromTime: time[idx], bias:'bullish' }.
- Bearish break: find MAX parsedHigh. OB = { top: parsedHigh[idx], bottom: parsedLow[idx], fromTime: time[idx], bias:'bearish' }.

Mitigation (remove an OB) — default HIGHLOW source:
- Bullish OB removed once any later bar's `low < OB.bottom`.
- Bearish OB removed once any later bar's `high > OB.top`.

Keep only the most recent `orderBlockCount` (default 5) un-mitigated blocks.

## EQH/EQL detection (port of LuxAlgo `drawEqualHighLow`)

Use a length-`equalLength` (default 3) pivot pass (same `leg()` machine, size 3). Track the previous equal-high pivot and equal-low pivot. When a NEW same-type pivot forms within `threshold * ATR(200)` of the previous one:
- new high pivot within threshold of prior high pivot → **EQH**: { kind:'EQH', level, fromTime: prevPivotTime, toTime: thisPivotTime }
- new low pivot within threshold of prior low pivot → **EQL** (mirror).
`threshold` default 0.1.

---

## Types added to `src/lib/smc/types.ts`
```ts
export interface OrderBlock {
  bias: 'bullish' | 'bearish'
  top: number
  bottom: number
  fromTime: number   // unix seconds of the OB candle
}
export interface EqualLevel {
  kind: 'EQH' | 'EQL'
  level: number
  fromTime: number   // prior equal pivot time
  toTime: number     // confirming equal pivot time
}
```
`SMCSettings` gains: `orderBlockCount` (default 5), `equalLength` (default 3), `equalThreshold` (default 0.1).
`SMCResult` gains: `orderBlocks: OrderBlock[]`, `equalLevels: EqualLevel[]`.

---

## Tasks

1. **Types** — extend `types.ts` (above). `tsc --noEmit`. Commit.
2. **Engine: order blocks** — extend `computeSMC` to compute parsed highs/lows + store/mitigate/cap OBs. Tests: a bullish break on a dip-then-rally series yields ≥1 bullish OB with `bottom <= top`; a fully-retraced series mitigates (removes) the OB. Commit.
3. **Engine: EQH/EQL** — add length-3 pivot pass + threshold compare. Tests: a double-top within threshold yields an EQH; spaced-apart highs yield none. Commit.
4. **Render EQH/EQL + OB text list + toggles** — in `SMCChart`, draw each EqualLevel as a dotted 2-point line series + a marker label ('EQH'/'EQL'); in `MarketStructurePage`, list order blocks in the events panel (bias, top–bottom) and add show/hide toggles. Build. Commit. **DEPLOY CHECKPOINT 1.**
5. **OB box primitive** — `src/components/smc/primitives/orderBlockPrimitive.ts` implementing `ISeriesPrimitive`. Attach via `series.attachPrimitive`. Build. Commit. **DEPLOY CHECKPOINT 2.**
6. **Verify + finish** — `npm test`, `npm run build`, merge.

### Primitive gotchas (get right on attempt 1 — can't self-verify)
- **Right edge:** `timeToCoordinate(futureTime)` returns `null`; paint the box's right edge to the pane bitmap width, not an extended time. Left edge uses the real OB candle time.
- **Pixel ratios:** inside `target.useBitmapCoordinateSpace(scope => …)`, multiply media coords by `scope.horizontalPixelRatio` / `scope.verticalPixelRatio`.
- **z-order:** `zOrder()` returns `'bottom'` so boxes sit behind candles.
- **Redraw:** save `requestUpdate` from `attached({requestUpdate})` and implement `updateAllViews()`, else boxes vanish on pan/zoom/data change.
