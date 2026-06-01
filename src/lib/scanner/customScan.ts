// Custom-strategy scanner — runs a saved Strategy Builder spec across many
// symbols × timeframes and ranks each by a Quality score. Uses the SAME
// evaluator + backtest (with the spec's direction and ATR/% stops) the Builder
// uses, so a row's number matches what you'd see opening that coin in the
// Builder.

import type { Candle } from '@/types'
import type { SymbolInfo } from '@/lib/binance'
import { fetchKlines } from '@/lib/binance'
import { runBacktest } from '@/lib/backtest'
import { evaluateCustomStrategy } from '@/lib/builder/evaluate'
import { smcQuality } from '@/lib/smc/strategyTest'
import type { CustomStrategySpec } from '@/lib/builder/types'

export interface CustomScanOptions {
  timeframes: string[]
  lookbackDays: number
  concurrency?: number
}

export interface CustomScanRow {
  symbol: string
  base: string
  timeframe: string
  trades: number
  winRate: number      // percent 0-100
  returnPct: number
  profitFactor: number
  maxDdPct: number
  quality: number      // 0-100 composite (same scale as the SMC scanner)
}

export interface ScanProgress { done: number; total: number; current?: string }

const MS_PER_DAY = 86_400_000

async function pool<T, R>(items: T[], concurrency: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const runners: Promise<void>[] = []
  for (let k = 0; k < Math.max(1, concurrency); k++) {
    runners.push((async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        out[i] = await worker(items[i], i)
      }
    })())
  }
  await Promise.all(runners)
  return out
}

// Backtest the spec on one candle series — mirrors BuilderPage.runBacktestNow
// (direction + ATR/% stops) so scan numbers match the Builder.
function backtestSpec(spec: CustomStrategySpec, candles: Candle[]) {
  const signals = evaluateCustomStrategy(spec, candles)
  const dir = spec.direction ?? 'long'
  return spec.stopMode === 'atr'
    ? runBacktest(candles, signals, 10_000, 0.001, dir, 0, 0, 'volatility', spec.riskPct ?? 1, spec.atrMult ?? 2, spec.rr ?? 2)
    : runBacktest(candles, signals, 10_000, 0.001, dir, spec.slPct ?? 0, spec.tpPct ?? 0)
}

export async function runCustomScan(
  spec: CustomStrategySpec,
  universe: SymbolInfo[],
  options: CustomScanOptions,
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<CustomScanRow[]> {
  const { timeframes, lookbackDays, concurrency = 6 } = options
  const startTime = Date.now() - lookbackDays * MS_PER_DAY

  const jobs: { sym: SymbolInfo; tf: string }[] = []
  for (const sym of universe) for (const tf of timeframes) jobs.push({ sym, tf })

  const total = jobs.length
  let done = 0
  const rows: CustomScanRow[] = []

  await pool(jobs, concurrency, async (job) => {
    if (signal?.aborted) return null
    try {
      const candles: Candle[] = await fetchKlines({ symbol: job.sym.symbol, interval: job.tf, startTime })
      if (candles.length >= 60) {
        const m = backtestSpec(spec, candles).metrics
        rows.push({
          symbol: job.sym.symbol, base: job.sym.base, timeframe: job.tf,
          trades: m.numTrades, winRate: m.winRate, returnPct: m.totalReturnPct,
          profitFactor: m.profitFactor, maxDdPct: m.maxDrawdownPct,
          quality: smcQuality({ trades: m.numTrades, winRate: m.winRate, returnPct: m.totalReturnPct, profitFactor: m.profitFactor, maxDdPct: m.maxDrawdownPct }),
        })
      }
    } catch {
      // one bad symbol doesn't sink the scan
    }
    done++
    if (done % 5 === 0 || done === total) onProgress?.({ done, total, current: `${job.sym.base} ${job.tf}` })
    return null
  })

  rows.sort((a, b) => (b.quality - a.quality) || (b.trades - a.trades))
  return rows
}
