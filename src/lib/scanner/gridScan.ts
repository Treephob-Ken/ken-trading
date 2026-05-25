// Grid Scanner — for each symbol in the universe, fetches the last 30 days
// of 4h candles and runs the same `optimizeGrid` sweep the Grid Optimizer
// page uses. Reports the built-in MarketFit score plus regime so the user
// can spot symbols currently in the "good for grid" sideways state.

import type { Candle } from '@/types'
import type { SymbolInfo } from '@/lib/binance'
import { fetchKlines } from '@/lib/binance'
import { optimizeGrid, type GridMode, type GridType } from '@/lib/grid'
import { analyzeRegime, type RegimeLabel } from '@/lib/markov'
import type { ScanProgress } from './indicatorScan'

export interface GridScanOptions {
  timeframe: string       // default '4h'
  lookbackDays: number    // default 30
  investment?: number     // default 1000
  feePct?: number         // default 0.05 (0.05%)
  minGrids?: number       // default 5
  maxGrids?: number       // default 30
  mode?: GridMode         // default 'arithmetic'
  type?: GridType         // default 'neutral'
  concurrency?: number    // default 6
}

export interface GridScanRow {
  symbol: string
  base: string
  timeframe: string
  score: number                            // 0–100 from MarketFit
  verdict: 'Excellent' | 'Good' | 'Marginal' | 'Poor'
  regime: RegimeLabel | null
  bestGridCount: number
  totalReturnPct: number                   // simulated PnL over the window
  realizedReturnPct: number
  tradesPerDay: number
  rangePct: number
  atrPct: number
  spacingPct: number
  spacingMultiple: number                  // spacing / breakeven (≥3 desired)
  efficiencyRatio: number                  // Kaufman ER — low = good
  lower: number
  upper: number
  anchor: number
}

const MS_PER_DAY = 86_400_000

async function pool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const runners: Promise<void>[] = []
  for (let k = 0; k < Math.max(1, concurrency); k++) {
    runners.push(
      (async () => {
        while (true) {
          const i = next++
          if (i >= items.length) return
          out[i] = await worker(items[i], i)
        }
      })(),
    )
  }
  await Promise.all(runners)
  return out
}

export async function runGridScan(
  universe: SymbolInfo[],
  options: GridScanOptions,
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<GridScanRow[]> {
  const {
    timeframe = '4h',
    lookbackDays = 30,
    investment = 1000,
    feePct = 0.05,
    minGrids = 5,
    maxGrids = 30,
    mode = 'arithmetic',
    type = 'neutral',
    concurrency = 6,
  } = options

  const startTime = Date.now() - lookbackDays * MS_PER_DAY
  const total = universe.length
  let done = 0
  const rows: GridScanRow[] = []

  await pool(universe, concurrency, async (sym) => {
    if (signal?.aborted) return
    let candles: Candle[] = []
    try {
      candles = await fetchKlines({ symbol: sym.symbol, interval: timeframe, startTime })
    } catch {
      done++
      onProgress?.({ done, total, current: sym.base })
      return
    }

    if (candles.length < 20) {
      done++
      onProgress?.({ done, total, current: sym.base })
      return
    }

    try {
      const result = optimizeGrid(candles, {
        lookback: candles.length,
        minGrids,
        maxGrids,
        mode,
        type,
        investment,
        feeRate: feePct / 100,
      })
      if (result) {
        const regimeAnalysis = analyzeRegime(candles)
        const days = Math.max(1, lookbackDays)
        const spacingMultiple = result.breakevenPct > 0
          ? result.best.spacingPct / result.breakevenPct
          : 0
        rows.push({
          symbol: sym.symbol,
          base: sym.base,
          timeframe,
          score: result.market.score,
          verdict: result.market.verdict,
          regime: regimeAnalysis.currentLabel,
          bestGridCount: result.best.gridCount,
          totalReturnPct: result.best.totalReturnPct,
          realizedReturnPct: result.best.realizedPct,
          tradesPerDay: result.best.completedTrades / days,
          rangePct: result.market.rangePct,
          atrPct: result.market.atrPct,
          spacingPct: result.best.spacingPct,
          spacingMultiple,
          efficiencyRatio: result.market.efficiencyRatio,
          lower: result.lower,
          upper: result.upper,
          anchor: result.anchor,
        })
      }
    } catch {
      // skip on engine failure
    }
    done++
    onProgress?.({ done, total, current: sym.base })
  })

  return rows
}
