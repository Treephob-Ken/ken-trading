import type { Candle, Signal, StrategyId } from '@/types'
import { generateSignals, defaultParams, type StrategyOutput } from './strategies'
import type { RegimeAnalysis } from './markov'

export interface EnsembleConfig {
  mode: 'vote' | 'weighted'
  threshold: number // minimum consensus to trigger
  regimeWeights: boolean // use Markov regime to boost/reduce strategy weights
}

// Group strategies by category for regime weights
const TREND_STRATEGIES: StrategyId[] = ['macd', 'ema', 'sma', 'supertrend', 'psar', 'donchian', 'elliott']
const OSCILLATOR_STRATEGIES: StrategyId[] = ['rsi', 'stochastic', 'stochrsi', 'cci', 'williamsr', 'bollinger']

export interface EnsembleResult {
  signals: Signal[]
  strategyOutputs: Map<StrategyId, StrategyOutput>
}

/**
 * Runs multiple strategies and combines their signals into an ensemble signal.
 * To make the ensemble effective, we track the active state/stance of each strategy
 * (long after a 'buy' signal, short after a 'sell' signal, flat initially).
 */
export function runEnsemble(
  candles: Candle[],
  strategyIds: StrategyId[],
  config: EnsembleConfig,
  regime: RegimeAnalysis | null,
): EnsembleResult {
  const strategyOutputs = new Map<StrategyId, StrategyOutput>()
  const n = candles.length
  const signals: Signal[] = Array(n).fill(null)

  if (strategyIds.length === 0 || n === 0) {
    return { signals, strategyOutputs }
  }

  // 1. Generate outputs for all selected strategies
  for (const id of strategyIds) {
    const out = generateSignals(id, candles, defaultParams(id))
    strategyOutputs.set(id, out)
  }

  // 2. Track the active stance of each strategy over time
  // stance: 1 for long, -1 for short, 0 for flat
  const stances = new Map<StrategyId, number[]>()
  for (const id of strategyIds) {
    const out = strategyOutputs.get(id)!
    const list: number[] = []
    let current = 0 // start flat
    for (let i = 0; i < n; i++) {
      const sig = out.signals[i]
      if (sig === 'buy') {
        current = 1
      } else if (sig === 'sell') {
        current = -1
      }
      list.push(current)
    }
    stances.set(id, list)
  }

  // 3. For each candle, compute the combined score
  let lastEnsembleStance = 0 // start flat

  for (let i = 0; i < n; i++) {
    // Determine weights for each strategy at this candle
    const weights = new Map<StrategyId, number>()
    
    // Get regime at this candle if available
    let currentRegimeIdx = -1
    if (config.regimeWeights && regime && regime.labels && regime.labels[i] !== undefined) {
      currentRegimeIdx = regime.labels[i] // 0 = Bear, 1 = Sideways, 2 = Bull
    }

    for (const id of strategyIds) {
      let weight = 1.0
      if (currentRegimeIdx !== -1) {
        const isTrend = TREND_STRATEGIES.includes(id)
        const isOscillator = OSCILLATOR_STRATEGIES.includes(id)

        if (currentRegimeIdx === 2) {
          // Bull: Trend gets 2x weight
          if (isTrend) weight = 2.0
        } else if (currentRegimeIdx === 0) {
          // Bear: Trend gets 2x weight
          if (isTrend) weight = 2.0
        } else if (currentRegimeIdx === 1) {
          // Sideways: Oscillator gets 2x weight
          if (isOscillator) weight = 2.0
        }
      }
      weights.set(id, weight)
    }

    if (config.mode === 'vote') {
      // Vote mode: count net long vs short strategies
      let longVotes = 0
      let shortVotes = 0
      for (const id of strategyIds) {
        const stance = stances.get(id)![i]
        if (stance === 1) longVotes++
        if (stance === -1) shortVotes++
      }

      // Check if threshold is met
      const threshold = config.threshold
      let nextStance = lastEnsembleStance

      if (longVotes >= threshold && shortVotes < threshold) {
        nextStance = 1
      } else if (shortVotes >= threshold && longVotes < threshold) {
        nextStance = -1
      } else if (longVotes < threshold && shortVotes < threshold) {
        // If neither meets threshold, check if we should go flat or just maintain
        // Standard ensemble goes flat if threshold is not met (consensus lost)
        nextStance = 0
      }

      if (nextStance !== lastEnsembleStance) {
        signals[i] = nextStance === 1 ? 'buy' : nextStance === -1 ? 'sell' : null
        // If transitioning to flat, we need to exit the position.
        // In our backtester, we exit by issuing the opposite signal, or if direction is 'both',
        // we can trigger exit. Wait, the backtester exits a long on 'sell' and a short on 'buy'.
        // If we emit 'sell' to exit a long, we might open a short if direction is 'both'.
        // For simplicity, we just output 'buy' or 'sell' as the active trigger signals.
        lastEnsembleStance = nextStance
      }
    } else {
      // Weighted mode: Σ(weight * stance)
      let totalWeight = 0
      let weightedScore = 0
      for (const id of strategyIds) {
        const stance = stances.get(id)![i]
        const w = weights.get(id)!
        weightedScore += stance * w
        totalWeight += w
      }

      // Check threshold (normalized or absolute)
      // Let's use absolute threshold: e.g., if threshold is 3, weightedScore must be >= 3 or <= -3.
      const threshold = config.threshold
      let nextStance = lastEnsembleStance

      if (weightedScore >= threshold) {
        nextStance = 1
      } else if (weightedScore <= -threshold) {
        nextStance = -1
      } else {
        nextStance = 0
      }

      if (nextStance !== lastEnsembleStance) {
        signals[i] = nextStance === 1 ? 'buy' : nextStance === -1 ? 'sell' : null
        lastEnsembleStance = nextStance
      }
    }
  }

  return { signals, strategyOutputs }
}
