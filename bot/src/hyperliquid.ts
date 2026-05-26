import {
  ExchangeClient,
  HttpTransport,
  InfoClient,
  SubscriptionClient,
  WebSocketTransport,
} from '@nktkas/hyperliquid'
import { privateKeyToAccount } from 'viem/accounts'
import type { EnvConfig } from './config.js'
import { resolveAssetMeta } from './hyperliquid-hip3.js'

export interface HLClients {
  info: InfoClient
  exchange: ExchangeClient
  subs: SubscriptionClient
  user: `0x${string}`
  isTestnet: boolean
}

export function createClients(env: EnvConfig): HLClients {
  const account = privateKeyToAccount(env.agentKey)
  const httpTransport = new HttpTransport({ isTestnet: env.isTestnet })
  const wsTransport = new WebSocketTransport({ isTestnet: env.isTestnet })

  const info = new InfoClient({ transport: httpTransport })
  const exchange = new ExchangeClient({
    wallet: account,
    transport: httpTransport,
    isTestnet: env.isTestnet,
  })
  const subs = new SubscriptionClient({ transport: wsTransport })

  return { info, exchange, subs, user: env.user, isTestnet: env.isTestnet }
}

export interface AssetMeta {
  index: number
  name: string
  szDecimals: number
  pxDecimals: number
  markPx: number
  midPx: number
  maxLeverage: number
}

// Look up the asset's index, size decimals, and current price. Routes through
// the HIP-3 resolver so colon-prefixed names like "xyz:GOLD" hit the right dex.
export async function getAssetMeta(
  info: InfoClient,
  asset: string,
): Promise<AssetMeta> {
  const m = await resolveAssetMeta(info, asset)
  const pxDecimals = Math.max(0, 6 - m.szDecimals)
  return {
    index: m.index,
    name: m.name,
    szDecimals: m.szDecimals,
    pxDecimals,
    markPx: m.ctx.markPx,
    midPx: m.ctx.midPx,
    maxLeverage: m.maxLeverage,
  }
}

// Round a price to satisfy Hyperliquid's 5-sig-fig + decimal-place limits.
export function roundPrice(price: number, meta: AssetMeta): string {
  if (!(price > 0)) throw new Error(`Invalid price: ${price}`)
  const sigFigs = 5
  const exp = Math.floor(Math.log10(price)) + 1
  const decimalsBySigFigs = Math.max(0, sigFigs - exp)
  const decimals = Math.min(meta.pxDecimals, decimalsBySigFigs)
  return price.toFixed(decimals)
}

export function roundSize(size: number, meta: AssetMeta): string {
  return size.toFixed(meta.szDecimals)
}
