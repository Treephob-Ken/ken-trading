// Classify a symbol into a market category for the Market filter dropdown.
// Plain tickers (no colon) are crypto. HIP-3 symbols use known coin-name lists
// per category — we hardcode the major buckets since Hyperliquid's API doesn't
// classify these for us.

export type Market = 'crypto' | 'stocks' | 'commodities' | 'forex' | 'index' | 'other'

const COMMODITIES = new Set([
  'GOLD', 'XAG', 'SILVER', 'COPPER', 'ALUMINIUM', 'PLATINUM', 'PALLADIUM',
  'BRENTOIL', 'CL', 'WTI', 'NATGAS', 'NG',
  'CORN', 'WHEAT', 'SOYBEAN', 'COFFEE', 'SUGAR', 'COCOA',
])

const FOREX = new Set([
  'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD', 'CNY', 'CNH',
  'MXN', 'BRL', 'INR', 'KRW', 'TRY', 'ZAR', 'SGD', 'HKD',
  'DXY',
])

const INDICES = new Set([
  'SPX500', 'SPX', 'NDX', 'NASDAQ', 'DJI', 'DOW', 'RUT', 'RUSSELL',
  'VIX', 'XYZ100',
  'EWJ', 'EWY', 'EWT', 'EWZ', // country ETFs lumped under index
])

export function classifyMarket(symbol: string): Market {
  if (!symbol.includes(':')) return 'crypto'
  const coin = symbol.split(':')[1].toUpperCase()
  if (COMMODITIES.has(coin)) return 'commodities'
  if (FOREX.has(coin)) return 'forex'
  if (INDICES.has(coin)) return 'index'
  // Anything else with a colon prefix is a HIP-3 asset that didn't match — most
  // likely a US stock ticker (TSLA, NVDA, AAPL, etc.).
  return 'stocks'
}

export interface MarketOption {
  value: Market | 'all'
  label: string
}

export const MARKET_OPTIONS: MarketOption[] = [
  { value: 'all', label: 'All markets' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'stocks', label: 'Stocks' },
  { value: 'commodities', label: 'Commodities' },
  { value: 'forex', label: 'Forex' },
  { value: 'index', label: 'Indices' },
]

export function filterByMarket<T extends { symbol: string } | { base: string }>(
  items: T[],
  market: Market | 'all',
): T[] {
  if (market === 'all') return items
  return items.filter((s) => {
    const sym = ('symbol' in s ? s.symbol : '') || ('base' in s ? s.base : '')
    return classifyMarket(sym) === market
  })
}
