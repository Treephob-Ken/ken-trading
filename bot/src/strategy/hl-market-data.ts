// Hyperliquid public candle data — used as an alternative to Binance for
// HIP-3 assets (colon-prefixed names like "xyz:GOLD", "xyz:TSLA") which have
// no Binance equivalent. Read-only, no auth, mainnet only.

import { HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import type { Candle } from './strategies.js'
import { normalizeAssetName } from '../hyperliquid-hip3.js'

let publicInfo: InfoClient | null = null

function getPublicInfo(): InfoClient {
  if (!publicInfo) {
    const transport = new HttpTransport({ isTestnet: false })
    publicInfo = new InfoClient({ transport })
  }
  return publicInfo
}

type HLInterval =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '8h' | '12h'
  | '1d' | '3d' | '1w' | '1M'

const INTERVAL_MS: Record<HLInterval, number> = {
  '1m': 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '8h': 8 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
  '1M': 30 * 24 * 60 * 60_000,
}

function isHLInterval(s: string): s is HLInterval {
  return s in INTERVAL_MS
}

export async function fetchKlinesHL(
  symbol: string,
  interval: string,
  limit = 500,
): Promise<Candle[]> {
  if (!isHLInterval(interval)) throw new Error(`Unsupported HL interval: ${interval}`)
  const ms = INTERVAL_MS[interval]
  const end = Date.now()
  // pad by 2 bars so we always get at least `limit` bars back
  const start = end - ms * (limit + 2)
  // HL is case-sensitive on the dex prefix — `XYZ:COIN` returns a 500. Old
  // signal-bot configs (created pre-C.2) persisted uppercased names, so
  // normalize defensively here.
  const coin = normalizeAssetName(symbol)
  const info = getPublicInfo()
  const raw = await info.candleSnapshot({
    coin,
    interval,
    startTime: start,
    endTime: end,
  })
  return raw.map((c) => ({
    time: Math.floor(c.t / 1000),
    open: Number(c.o),
    high: Number(c.h),
    low: Number(c.l),
    close: Number(c.c),
    volume: Number(c.v),
  }))
}
