// SMC Scanner — runs the SMC engine + entry-rule comparison across many
// symbols × timeframes and ranks each by its best entry rule's expectancy.
// Reuses the exact same compareSmcEntries() the Market Structure page shows,
// so a row's number matches what the user sees clicking through to /structure.

import type { Candle } from '@/types'
import type { SymbolInfo } from '@/lib/binance'
import { fetchKlines } from '@/lib/binance'
import { computeSMC } from '@/lib/smc/engine'
import { compareSmcEntries, type EntryResult } from '@/lib/smc/strategyTest'

export interface SmcScanOptions {
  timeframes: string[]      // e.g. ['1h', '4h']
  lookbackDays: number      // e.g. 120
  swingLength?: number      // default 50
  slPct?: number            // default 1.5
  concurrency?: number      // default 6
}

export interface SmcScanRow {
  symbol: string
  base: string
  timeframe: string
  best: EntryResult         // best entry rule by expectancy (trades > 0 preferred)
  rules: EntryResult[]      // all rules for the tooltip / detail
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

// Pick the best rule: highest expectancy among rules that actually traded;
// falls back to the first rule when nothing traded.
export function bestRule(rules: EntryResult[]): EntryResult {
  const traded = rules.filter(r => r.trades > 0)
  if (traded.length === 0) return rules[0]
  return traded.reduce((a, b) => (b.expectancyR > a.expectancyR ? b : (b.expectancyR === a.expectancyR && b.trades > a.trades ? b : a)))
}

export async function runSmcScan(
  universe: SymbolInfo[],
  options: SmcScanOptions,
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<SmcScanRow[]> {
  const { timeframes, lookbackDays, swingLength = 50, slPct = 1.5, concurrency = 6 } = options
  const startTime = Date.now() - lookbackDays * MS_PER_DAY

  const jobs: { sym: SymbolInfo; tf: string }[] = []
  for (const sym of universe) for (const tf of timeframes) jobs.push({ sym, tf })

  const total = jobs.length
  let done = 0
  const rows: SmcScanRow[] = []

  await pool(jobs, concurrency, async (job) => {
    if (signal?.aborted) return null
    try {
      const candles: Candle[] = await fetchKlines({ symbol: job.sym.symbol, interval: job.tf, startTime })
      if (candles.length >= swingLength + 5) {
        const result = computeSMC(candles, { swingLength })
        const rules = compareSmcEntries(candles, result, slPct)
        rows.push({ symbol: job.sym.symbol, base: job.sym.base, timeframe: job.tf, best: bestRule(rules), rules })
      }
    } catch {
      // one bad symbol doesn't sink the scan
    }
    done++
    if (done % 5 === 0 || done === total) onProgress?.({ done, total, current: `${job.sym.base} ${job.tf}` })
    return null
  })

  // Rank: positive-expectancy rows with more trades first.
  rows.sort((a, b) => {
    const ea = a.best.expectancyR, eb = b.best.expectancyR
    if (eb !== ea) return eb - ea
    return b.best.trades - a.best.trades
  })
  return rows
}
