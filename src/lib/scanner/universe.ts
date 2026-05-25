// Builds the symbol universe shared by both scanners.
// Intersects the HL-tradeable coin list with Binance USDT pairs ranked by
// 24h volume, then keeps the top N (default 30) most liquid combos.

import type { SymbolInfo } from '@/lib/binance'
import { fetchHLAssets } from '@/lib/hlAssets'

const BINANCE_REST = 'https://data-api.binance.vision/api/v3'

interface Binance24h {
  symbol: string
  quoteVolume: string
}

let _cache: SymbolInfo[] | null = null

export async function getScannerUniverse(limit = 30): Promise<SymbolInfo[]> {
  if (_cache && _cache.length >= limit) return _cache.slice(0, limit)

  const [hlAssets, tickers] = await Promise.all([
    fetchHLAssets(),
    fetch(`${BINANCE_REST}/ticker/24hr`).then((r) => {
      if (!r.ok) throw new Error(`Binance 24h returned ${r.status}`)
      return r.json() as Promise<Binance24h[]>
    }),
  ])

  // Index Binance USDT tickers by base asset → quote volume.
  const binanceVol = new Map<string, number>()
  for (const t of tickers) {
    if (!t.symbol.endsWith('USDT')) continue
    const base = t.symbol.slice(0, -4)
    binanceVol.set(base, Number(t.quoteVolume))
  }

  const ranked = hlAssets
    .map((a) => ({ ...a, vol: binanceVol.get(a.base) ?? 0 }))
    .filter((a) => a.vol > 0)
    .sort((a, b) => b.vol - a.vol)
    .map(({ symbol, base, quote }) => ({ symbol, base, quote }))

  _cache = ranked
  return ranked.slice(0, limit)
}

export function clearUniverseCache() {
  _cache = null
}
