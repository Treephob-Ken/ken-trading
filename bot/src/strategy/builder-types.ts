// Mirror of src/lib/builder/types.ts — kept in sync by eye, same as other
// strategy types in this directory. Used by the bot's evaluator + the
// /api/builder/strategies endpoints.

export type SeriesId =
  | 'price'
  | 'rsi'
  | 'ema'
  | 'sma'
  | 'macd_line' | 'macd_signal' | 'macd_hist'
  | 'bb_upper' | 'bb_mid' | 'bb_lower'
  | 'adx' | 'plus_di' | 'minus_di'
  | 'stoch_k' | 'stoch_d'

export interface SeriesRef {
  id: SeriesId
  params: Record<string, number>
}

export type SignalEventKind =
  | 'smc_bullish_choch'
  | 'smc_bearish_choch'
  | 'smc_bullish_bos'
  | 'smc_bearish_bos'

export interface SignalEventRef {
  kind: SignalEventKind
  params: Record<string, number>
}

export type CompareOp = '>' | '<' | '>=' | '<=' | '=='
export type CrossOp = 'crossUp' | 'crossDown'
export type StateOp = 'above' | 'below'

export type ConditionBlock =
  | { kind: 'compare'; id: string; series: SeriesRef; op: CompareOp; value: number }
  | { kind: 'cross';   id: string; a: SeriesRef; op: CrossOp; b: SeriesRef }
  | { kind: 'state';   id: string; a: SeriesRef; op: StateOp; b: SeriesRef }
  | { kind: 'event';   id: string; event: SignalEventRef }

export type Combinator = 'ALL' | 'ANY'

export interface ConditionGroup {
  combinator: Combinator
  conditions: ConditionBlock[]
}

export interface CustomStrategySpec {
  id: string
  name: string
  description?: string
  entryLong: ConditionGroup
  exitLong:  ConditionGroup
  entryShort?: ConditionGroup
  exitShort?:  ConditionGroup
  tpPct?: number
  slPct?: number
  createdAt?: number
  updatedAt?: number
}
