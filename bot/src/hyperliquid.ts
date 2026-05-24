import {
  ExchangeClient,
  HttpTransport,
  InfoClient,
  SubscriptionClient,
  WebSocketTransport,
} from '@nktkas/hyperliquid'
import { privateKeyToAccount } from 'viem/accounts'
import type { EnvConfig } from './config.js'

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

// Look up the asset's index, size decimals, and current price. The grid bot
// places all orders using these numbers, so this is the only place we touch
// Hyperliquid's metadata APIs.
export async function getAssetMeta(
  info: InfoClient,
  asset: string,
): Promise<AssetMeta> {
  const result = await info.metaAndAssetCtxs()
  const meta = result[0]
  const ctxs = result[1]
  const index = meta.universe.findIndex((u) => u.name === asset)
  if (index < 0) throw new Error(`Asset ${asset} not found on Hyperliquid`)
  const u = meta.universe[index]
  const ctx = ctxs[index]
  const markPx = Number(ctx.markPx)
  const midPx = Number(ctx.midPx ?? ctx.markPx)
  // Perp price precision: up to (6 - szDecimals) decimals AND max 5 sig figs.
  const pxDecimals = Math.max(0, 6 - u.szDecimals)
  return { index, name: asset, szDecimals: u.szDecimals, pxDecimals, markPx, midPx, maxLeverage: u.maxLeverage }
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
