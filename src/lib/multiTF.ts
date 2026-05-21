import type { Candle } from '@/types'
import { fetchKlines } from './binance'
import { analyzeRegime, type RegimeAnalysis } from './markov'

export const TF_HIERARCHY: Record<string, string> = {
  '1m': '5m',
  '5m': '15m',
  '15m': '1h',
  '30m': '4h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
}

export interface MultiTFResult {
  higherTF: string
  higherRegime: RegimeAnalysis
  currentRegime: RegimeAnalysis
  confluence: 'aligned' | 'conflicting' | 'neutral'
  filterRecommendation: string
  suggestedGridType: 'long' | 'short' | 'neutral'
}

/**
 * Evaluates the alignment between the current timeframe and the higher timeframe.
 */
export async function getMultiTFConfluence(
  symbol: string,
  currentTimeframe: string,
  currentCandles: Candle[],
): Promise<MultiTFResult | null> {
  const higherTF = TF_HIERARCHY[currentTimeframe]
  if (!higherTF || currentCandles.length < 30) return null

  const currentRegime = analyzeRegime(currentCandles)

  try {
    // Fetch recent candles for the higher timeframe
    const higherCandles = await fetchKlines({
      symbol,
      interval: higherTF,
    })

    if (higherCandles.length < 30) return null

    const higherRegime = analyzeRegime(higherCandles)

    const curr = currentRegime.currentLabel
    const high = higherRegime.currentLabel

    let confluence: 'aligned' | 'conflicting' | 'neutral' = 'neutral'
    let filterRecommendation = 'No bias. Trade both directions.'
    let suggestedGridType: 'long' | 'short' | 'neutral' = 'neutral'

    if (curr === 'Bull' && high === 'Bull') {
      confluence = 'aligned'
      filterRecommendation = 'Strong buy bias. Long positions preferred.'
      suggestedGridType = 'long'
    } else if (curr === 'Bear' && high === 'Bear') {
      confluence = 'aligned'
      filterRecommendation = 'Strong sell bias. Short positions preferred.'
      suggestedGridType = 'short'
    } else if (curr === 'Sideways' && high === 'Sideways') {
      confluence = 'aligned'
      filterRecommendation = 'Range-bound market. Grid and oscillators preferred.'
      suggestedGridType = 'neutral'
    } else if (
      (curr === 'Bull' && high === 'Bear') ||
      (curr === 'Bear' && high === 'Bull')
    ) {
      confluence = 'conflicting'
      filterRecommendation = 'High conflict. Reduce sizes or stay flat.'
      suggestedGridType = 'neutral'
    } else {
      confluence = 'neutral'
      filterRecommendation = 'Neutral/mixed regime. Normal risk parameters.'
      suggestedGridType = curr === 'Bull' ? 'long' : curr === 'Bear' ? 'short' : 'neutral'
    }

    return {
      higherTF,
      higherRegime,
      currentRegime,
      confluence,
      filterRecommendation,
      suggestedGridType,
    }
  } catch (e) {
    console.error('Failed to fetch higher timeframe candles in confluence module:', e)
    return null
  }
}
