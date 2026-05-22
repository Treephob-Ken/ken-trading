// Binance public market data — REST only (no API key, no WebSocket). The
// signal bot polls candles on an interval rather than streaming.

import type { Candle } from './strategies.js'

const REST = 'https://data-api.binance.vision/api/v3'

function mapKlines(raw: unknown[][]): Candle[] {
  return raw.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }))
}

// Most recent `limit` candles for a symbol/interval. The final candle is the
// currently-forming (not yet closed) bar.
export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 500,
): Promise<Candle[]> {
  const url = `${REST}/klines?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}&limit=${Math.min(limit, 1000)}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Binance returned ${res.status} for ${symbol} ${interval}`)
  }
  return mapKlines((await res.json()) as unknown[][])
}
