# Portfolio Page Redesign — Design

**Date:** 2026-05-31
**Page:** `src/pages/PortfolioPage.tsx`
**Goal:** Make the Portfolio page a genuine "how am I doing overall?" tracker — true account trend, prominent max drawdown, rich per-bot performance, and Power BI–style cross-filtering. Full visual overhaul using ui-ux-pro-max design language, within the existing dark theme tokens.

---

## 1. Problem with the current page

- The "equity curve" is **cumulative realized PnL** within the selected range, reset to 0 each period. It is *not* the real account value, so it can't answer "is my account growing?"
- Max drawdown exists but is buried as small text in the equity-curve header.
- "By Bot" is a tiny top-5 table — weak for judging which bots to scale or kill.
- No interactivity: you can't focus the page on a single bot.

## 2. Core principle — two honest data layers

The page is split into two clearly labelled layers that come from **different data sources and will not reconcile** (this is expected and must be surfaced, not hidden):

| Layer | Source | What it includes |
|---|---|---|
| **Account layer** (hero + trend) | Hyperliquid `info.portfolio({ user })` → `accountValueHistory` / `pnlHistory` | Real account value: unrealized PnL, funding, deposits/withdrawals |
| **Realized layer** (bots, assets, daily, calendar, trades) | Closed round-trips (`pairRoundTrips` / `summarizePortfolio`) | Only closed-trade realized PnL |

**Rule:** the account-layer total and the realized-layer totals will differ. Label them explicitly — e.g. "Account value · All" vs "Realized · by bot" — so the user never wonders why the numbers don't add up.

## 3. Layout (three stacked layers)

### Layer 1 — Account health hero (new)
A prominent band at the top:
- **Account value now** (large) + **% return** for the selected trend period
- **Max drawdown** — promoted to its own stat tile; now a *true account-value* drawdown (peak-to-trough on `accountValueHistory`), not the realized approximation
- **Win rate** + trade count (realized — labelled)
- Large **account-equity area chart** = the true "am I growing?" line

**Trend-period toggle (its own control): Day · Week · Month · All.**
Rationale: HL only stores `day / week / month / allTime`. The page's existing range buttons (24h/7d/30d/90d/1y/all) have no HL equivalent for 90d/1y, which would render identically to "all". So the trend chart gets its **own** Day/Week/Month/All toggle mapped 1:1 to HL periods. The existing range buttons remain and drive **only** the detail sections (Layer 3).

### Layer 2 — Bot leaderboard (replaces the tiny "By Bot" table)
Each bot as a ranked card (best → worst by realized PnL):
- Realized PnL, win-rate bar, trade count
- A **mini equity sparkline** = that bot's cumulative realized PnL
- That bot's own **max drawdown**

This is also the **cross-filter control** (see §4).

### Layer 3 — Detail (kept, restyled)
Preserved with identical data wiring, restyled to match:
- Daily PnL bars
- PnL calendar (GitHub-contributions grid)
- By-Asset table
- Closed-trades list (50-row cap + "use Logs page" hint)

## 4. Power BI–style cross-filtering

**Default ("All bots"):**
- Hero = true account value (HL); trend = real account-equity line
- All detail visuals show everything

**Click a bot card → that bot becomes the active filter:**
- Selected card highlighted; others dimmed
- Hero stats swap to **that bot's** realized numbers (PnL, win rate, max drawdown)
- Trend chart swaps to **that bot's realized equity curve** (cumulative realized PnL), header relabelled (e.g. "Realized equity · GridBot BTC")
- Daily PnL bars, PnL calendar, By-Asset table, Closed-trades list all **re-filter to that bot**
- A "× Clear filter" chip appears; click the chip or the same bot again → back to All

**Honest caveat:** HL's account-value line is account-wide and cannot be split per bot. When a bot is selected the trend line therefore switches to *that bot's realized-PnL curve*. The header label makes the switch explicit.

**Instant interaction (the Power BI feel):** all round-trip data is already loaded client-side (`trips`). Selecting a bot re-filters and recomputes the realized layer **client-side — no server round-trip, no spinner**. Only the "All bots" account-value line comes from the server (cached 60s).

## 5. Data / backend changes

### New endpoint: `GET /api/portfolio/equity?period=day|week|month|all`
- `requireAuth`; resolves creds like `/api/portfolio`.
- Calls `info.portfolio({ user })`, picks the period:
  - `day → "day"`, `week → "week"`, `month → "month"`, `all → "allTime"`
  - Use **combined** account value (`day/week/month/allTime`), not perp-only — matches "what's my account worth"; near-identical for this perps-only bot.
- Returns:
  ```
  {
    period,
    points: [{ t: number(ms), value: number }],   // from accountValueHistory
    pnlPoints: [{ t, value }],                     // from pnlHistory
    startValue, currentValue,
    returnPct,                                     // (current - start) / start * 100
    maxDrawdown, maxDrawdownPct                    // peak-to-trough on accountValueHistory
  }
  ```
- Cache 60s per `user|period` (mirror `portfolioCache`).
- **Implementation step 1 (de-risk):** make one live `info.portfolio()` call first to confirm point count / timestamp cadence per period and that combined (not perp) is the right series.

### Extend `summarizePortfolio` (`bot/src/journal.ts`)
- Add a **per-bot daily series** so the frontend can draw sparklines + compute per-bot drawdown without extra fetches. Shape: `byBot[i].dailySeries: DailyBucket[]` (or a parallel map keyed by source). Cumulative is derived client-side.
- Keep all existing fields (back-compatible).

### Client-side realized recompute (frontend)
- The realized layer (daily series, calendar, by-asset, cumulative equity, drawdown, win rate) is recomputed **from the already-loaded `trips`** filtered by the active bot. This powers instant cross-filtering. For "All" it matches the server summary.

## 6. Frontend changes (`src/pages/PortfolioPage.tsx`)
- Rebuild around the three layers and the cross-filter state (`selectedBot: string | null`).
- Use **ui-ux-pro-max** for the visual language (cards, spacing, typography, chart styling) within existing tokens (`gain` / `loss` / `brand` / `panel` / `text` / `dim`).
- Reuse Lightweight Charts v5 (already used). Sparklines: small Lightweight Charts or lightweight inline SVG — decided at build time.

## 7. Existing wiring to PRESERVE (must not regress in the overhaul)
- Range buttons + `localStorage('portfolio_range')` persistence
- `fetchAll(range)` → `/api/portfolio` + `/api/portfolio/trips`
- Four snapshot fetches (24h/7d/30d/all) + Refresh button behaviour
- Equity & daily-PnL Lightweight Charts lifecycle (create/remove on data change, resize listener cleanup)
- PnlCalendar grid (week × weekday), month labels, win/loss/best/worst footer, legend
- Closed-trades 50-row cap + "use Logs page" hint
- `money` / `pct` / `sourceLabel` formatters from `@/lib/journal`

## 8. Out of scope (YAGNI)
- Recording our own local equity snapshots (HL portfolio endpoint already provides history)
- Per-bot account-value (unrealized) trend — HL data is account-wide only
- Deposit/withdrawal annotations on the equity line
- Changes to the Logs/Trade pages

## 9. Risks
- HL `portfolio` granularity is day/week/month/allTime only → trend toggle matches that exactly (resolved by design).
- Two non-reconciling totals on one page → resolved by explicit labelling.
- "Full overhaul" risk of regressing working features → §7 checklist guards against it.
