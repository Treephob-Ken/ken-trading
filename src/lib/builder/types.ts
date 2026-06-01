// Custom Strategy Builder — type definitions.
//
// A custom strategy is a JSON-serialisable spec built from "condition blocks"
// that get combined with AND/OR into entry / exit lists. The evaluator turns
// the spec into a per-bar signal stream that drops straight into the existing
// backtest engine (same shape as the built-in strategies).
//
// v1 is intentionally flat (no nested logic groups): entry/exit lists each
// have a single combinator (ALL or ANY) applied to a flat array of blocks.
// 95% of real strategies fit that shape; nested AND/OR can come later.

import type { Signal } from '@/types'

// ── Indicator catalogue ──────────────────────────────────────────────────────
// "Series" identifies a single time-aligned numeric stream we can compare
// against. Most indicators have a single output (RSI), some have several
// (MACD: line/signal/hist; Bollinger: upper/mid/lower; Stochastic: K/D).
// We treat each output as its own SeriesId so a condition can target it
// directly. `price` is a virtual series that resolves to the candle's close.

export type SeriesId =
  | 'price'
  | 'rsi'
  | 'ema'
  | 'sma'
  | 'macd_line' | 'macd_signal' | 'macd_hist'
  | 'bb_upper' | 'bb_mid' | 'bb_lower'
  | 'adx' | 'plus_di' | 'minus_di'
  | 'stoch_k' | 'stoch_d'
  | 'volume' | 'volume_ma' | 'atr'

export interface SeriesRef {
  id: SeriesId
  // Parameter overrides for the underlying indicator. `price` ignores params.
  // RSI: { length }, EMA/SMA: { length }, MACD: { fast, slow, signal },
  // Bollinger: { length, mult }, ADX/+DI/-DI: { length }, Stochastic: { kLen, dLen }.
  params: Record<string, number>
}

// ── Signal events (from existing strategies) ─────────────────────────────────
// A "signal event" is a discrete trigger emitted by a built-in strategy.
// For v1 we expose SMC's BOS/CHoCH directly (most asked) and the generic
// "buy/sell fired on bar N" event for every other strategy.

export type SignalEventKind =
  // SMC structure events (mirror smcStructure() classifications)
  | 'smc_bullish_choch'
  | 'smc_bearish_choch'
  | 'smc_bullish_bos'
  | 'smc_bearish_bos'

export interface SignalEventRef {
  kind: SignalEventKind
  params: Record<string, number>  // e.g. SMC: { swingLength }
}

// ── Condition blocks ─────────────────────────────────────────────────────────
// A ConditionBlock is one atomic predicate on the current bar. The evaluator
// returns true/false for each block per bar.

export type CompareOp = '>' | '<' | '>=' | '<=' | '=='
export type CrossOp = 'crossUp' | 'crossDown'
export type StateOp = 'above' | 'below'

export type ConditionBlock =
  // Compare a series value to a constant: RSI(14) < 30
  | {
      kind: 'compare'
      id: string
      series: SeriesRef
      op: CompareOp
      value: number
    }
  // Cross of one series over another: EMA(50) crossUp EMA(200)
  | {
      kind: 'cross'
      id: string
      a: SeriesRef
      op: CrossOp
      b: SeriesRef
    }
  // Series state relative to another series (cheaper than cross — checks
  // current state, not transition): Price above EMA(200)
  | {
      kind: 'state'
      id: string
      a: SeriesRef
      op: StateOp
      b: SeriesRef
    }
  // A discrete event fired by a built-in strategy on the current bar.
  | {
      kind: 'event'
      id: string
      event: SignalEventRef
    }

// ── Strategy spec ────────────────────────────────────────────────────────────
// Entry / exit groups. Each list of blocks is combined with a single
// combinator (`ALL` = and; `ANY` = or). Empty list = disabled (no entry /
// no exit). Exits include the stops by default in v1, so they are %-based
// position closes handled by the bot, not part of the condition tree.

export type Combinator = 'ALL' | 'ANY'

export interface ConditionGroup {
  combinator: Combinator
  conditions: ConditionBlock[]
}

export interface CustomStrategySpec {
  // Unique among saved presets. UUID assigned at save time.
  id: string
  name: string
  description?: string

  // Trade direction. 'long' uses entryLong/exitLong; 'short' uses
  // entryShort/exitShort; 'both' is always-in-market — the opposite entry
  // flips the position, so exit groups are ignored (stops close trades).
  // Missing = 'long' (back-compat with specs saved before this field).
  direction?: 'long' | 'short' | 'both'

  entryLong: ConditionGroup
  exitLong:  ConditionGroup

  entryShort?: ConditionGroup
  exitShort?:  ConditionGroup

  // %-based stops applied to every position the bot opens. Optional; the
  // strategy still runs without them but the bot will treat the position as
  // "no auto-stop" — the user can manage manually via the brackets panel.
  tpPct?: number
  slPct?: number

  // Stop sizing. 'pct' (default) = fixed tpPct/slPct above. 'atr' = stop a
  // distance of (ATR(atrLength) × atrMult) from entry, take-profit at `rr`×
  // that distance (risk:reward). riskPct = % of capital risked per trade when
  // ATR sizing (volatility position mode). Used by the Builder backtest; live
  // bot deploy still uses %-stops until ATR stops are wired bot-side.
  stopMode?: 'pct' | 'atr'
  atrLength?: number
  atrMult?: number
  rr?: number
  riskPct?: number

  // Bookkeeping (set server-side on save).
  createdAt?: number
  updatedAt?: number
}

// ── Re-export ────────────────────────────────────────────────────────────────
// Convenience alias for callers — emphasises that the spec compiles to the
// same Signal stream the rest of the app already understands.
export type CustomSignals = Signal[]
