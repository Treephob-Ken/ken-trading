// Builds the symbol universe shared by both scanners.
// Crypto path: intersects HL-tradeable coin list with Binance USDT pairs ranked
// by 24h volume.
// HIP-3 path: pulls stocks/commodities/forex from the bot's /api/scanner-universe,
// ranked by Hyperliquid open interest (no Binance equivalent).

import type { SymbolInfo } from '@/lib/binance'
import { fetchHLAssets } from '@/lib/hlAssets'

const BINANCE_REST = 'https://data-api.binance.vision/api/v3'

interface Binance24h {
  symbol: string
  quoteVolume: string
}

export type UniverseKind = 'crypto' | 'hip3'

let _cryptoCache: SymbolInfo[] | null = null
let _hip3Cache: SymbolInfo[] | null = null

async function getCryptoUniverse(limit: number): Promise<SymbolInfo[]> {
  if (_cryptoCache && _cryptoCache.length >= limit) return _cryptoCache.slice(0, limit)

  const [hlAssets, tickers] = await Promise.all([
    fetchHLAssets(),
    fetch(`${BINANCE_REST}/ticker/24hr`).then((r) => {
      if (!r.ok) throw new Error(`Binance 24h returned ${r.status}`)
      return r.json() as Promise<Binance24h[]>
    }),
  ])

  const binanceVol = new Map<string, number>()
  for (const t of tickers) {
    if (!t.symbol.endsWith('USDT')) continue
    const base = t.symbol.slice(0, -4)
    binanceVol.set(base, Number(t.quoteVolume))
  }

  // Only consider non-HIP-3 (plain) HL assets — HIP-3 has no Binance pair.
  const ranked = hlAssets
    .filter((a) => !a.symbol.includes(':'))
    .map((a) => ({ ...a, vol: binanceVol.get(a.base) ?? 0 }))
    .filter((a) => a.vol > 0)
    .sort((a, b) => b.vol - a.vol)
    .map(({ symbol, base, quote }) => ({ symbol, base, quote }))

  _cryptoCache = ranked
  return ranked.slice(0, limit)
}

interface Hip3UniverseRow {
  name: string
  dex: string | null
  markPx: number
  openInterest: number
  dayNtlVlm: number
  notionalOI: number
}

async function getHip3Universe(limit: number): Promise<SymbolInfo[]> {
  if (_hip3Cache && _hip3Cache.length >= limit) return _hip3Cache.slice(0, limit)
  const jwt = localStorage.getItem('auth_jwt') ?? ''
  const res = await fetch(`/api/scanner-universe?limit=${limit}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  })
  if (!res.ok) throw new Error(`/api/scanner-universe returned ${res.status}`)
  const rows = (await res.json()) as Hip3UniverseRow[]
  const ranked: SymbolInfo[] = rows.map((r) => ({
    symbol: r.name,
    base: r.name,
    quote: 'USDC',
  }))
  _hip3Cache = ranked
  return ranked.slice(0, limit)
}

export async function getScannerUniverse(
  limit = 30,
  kind: UniverseKind = 'crypto',
): Promise<SymbolInfo[]> {
  return kind === 'hip3' ? getHip3Universe(limit) : getCryptoUniverse(limit)
}

export function clearUniverseCache() {
  _cryptoCache = null
  _hip3Cache = null
}
