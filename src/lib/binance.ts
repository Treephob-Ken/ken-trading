import type { Candle } from '@/types'

// Binance public market-data endpoints (CORS-enabled, no API key required).
const REST = 'https://data-api.binance.vision/api/v3'
const WS = 'wss://data-stream.binance.vision/ws'

export const MAX_BARS = 20000

export interface SymbolInfo {
  symbol: string
  base: string
  quote: string
}

// All actively trading spot pairs, sorted with the major quote assets first.
export async function fetchSymbols(): Promise<SymbolInfo[]> {
  const res = await fetch(`${REST}/exchangeInfo`)
  if (!res.ok) throw new Error(`Binance returned ${res.status}`)
  const data = (await res.json()) as {
    symbols: {
      symbol: string
      status: string
      baseAsset: string
      quoteAsset: string
      isSpotTradingAllowed: boolean
    }[]
  }
  const quoteRank: Record<string, number> = {
    USDT: 0,
    FDUSD: 1,
    USDC: 2,
    BTC: 3,
    ETH: 4,
  }
  return data.symbols
    .filter((s) => s.status === 'TRADING' && s.isSpotTradingAllowed)
    .map((s) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }))
    .sort((a, b) => {
      const ra = quoteRank[a.quote] ?? 9
      const rb = quoteRank[b.quote] ?? 9
      if (ra !== rb) return ra - rb
      return a.symbol.localeCompare(b.symbol)
    })
}

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

export interface KlineQuery {
  symbol: string
  interval: string
  startTime?: number // ms epoch
  endTime?: number // ms epoch
}

// Fetches candles. With no startTime, returns the most recent 1000 bars
// (optionally up to endTime). With a startTime, pages forward through the
// range until endTime, capped at MAX_BARS.
export async function fetchKlines(q: KlineQuery): Promise<Candle[]> {
  const base = `${REST}/klines?symbol=${q.symbol}&interval=${q.interval}`

  if (q.startTime == null) {
    const url = base + '&limit=1000' + (q.endTime ? `&endTime=${q.endTime}` : '')
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        `Binance returned ${res.status}. The pair or date range may be unavailable.`,
      )
    }
    return mapKlines((await res.json()) as unknown[][])
  }

  const out: Candle[] = []
  const end = q.endTime ?? Date.now()
  let cursor = q.startTime

  while (cursor < end && out.length < MAX_BARS) {
    const url = `${base}&startTime=${cursor}&endTime=${end}&limit=1000`
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        `Binance returned ${res.status}. The pair or date range may be unavailable.`,
      )
    }
    const batch = mapKlines((await res.json()) as unknown[][])
    if (batch.length === 0) break
    out.push(...batch)
    const lastOpenMs = batch[batch.length - 1].time * 1000
    cursor = lastOpenMs + 1
    if (batch.length < 1000) break
  }

  // De-duplicate by candle time (page boundaries can overlap).
  const seen = new Set<number>()
  return out
    .filter((c) => {
      if (seen.has(c.time)) return false
      seen.add(c.time)
      return true
    })
    .slice(0, MAX_BARS)
}

export interface LiveKline {
  candle: Candle
  closed: boolean
}

export function subscribeKline(
  symbol: string,
  interval: string,
  onMsg: (k: LiveKline) => void,
  onStatus?: (open: boolean) => void,
): () => void {
  const ws = new WebSocket(`${WS}/${symbol.toLowerCase()}@kline_${interval}`)

  ws.onopen = () => onStatus?.(true)
  ws.onclose = () => onStatus?.(false)
  ws.onerror = () => onStatus?.(false)
  ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data as string)
      const k = d.k
      if (!k) return
      onMsg({
        candle: {
          time: Math.floor(Number(k.t) / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
        },
        closed: Boolean(k.x),
      })
    } catch {
      /* ignore malformed frame */
    }
  }

  return () => {
    try {
      ws.close()
    } catch {
      /* already closed */
    }
  }
}
