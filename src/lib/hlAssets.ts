import { useState, useEffect } from 'react'
import type { SymbolInfo } from './binance'

// Module-level cache: first successful fetch is reused by every caller.
// Both BacktesterPage and GridPage call useHLAssets() — only one HTTP request fires.
let _cache: SymbolInfo[] | null = null

// HL-tradeable assets. `symbol` stays as Binance's `{BASE}USDT` because the
// candle endpoint requires it; `quote` is shown to the user, so we set it to
// the actual Hyperliquid settlement currency (USDC).
const FALLBACK: SymbolInfo[] = [
  { symbol: 'ETHUSDT',  base: 'ETH',  quote: 'USDC' },
  { symbol: 'BTCUSDT',  base: 'BTC',  quote: 'USDC' },
  { symbol: 'SOLUSDT',  base: 'SOL',  quote: 'USDC' },
  { symbol: 'BNBUSDT',  base: 'BNB',  quote: 'USDC' },
  { symbol: 'XRPUSDT',  base: 'XRP',  quote: 'USDC' },
]

export async function fetchHLAssets(): Promise<SymbolInfo[]> {
  if (_cache) return _cache
  const jwt = localStorage.getItem('auth_jwt') ?? ''
  const res = await fetch('/api/assets', {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  })
  if (!res.ok) throw new Error(`/api/assets returned ${res.status}`)
  const names: string[] = await res.json()
  // HIP-3 assets (e.g. "xyz:GOLD") carry their dex prefix and have no Binance
  // pair; keep the raw name as both `symbol` and `base`. Plain crypto names get
  // the legacy `{BASE}USDT` shape so Binance fetches still work.
  _cache = names.map((n) => {
    if (n.includes(':')) {
      return { symbol: n, base: n, quote: 'USDC' }
    }
    return { symbol: `${n}USDT`, base: n, quote: 'USDC' }
  })
  return _cache
}

export function useHLAssets(): { symbols: SymbolInfo[]; loading: boolean } {
  const [symbols, setSymbols] = useState<SymbolInfo[]>(FALLBACK)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchHLAssets()
      .then((list) => { if (!cancelled) { setSymbols(list); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { symbols, loading }
}
