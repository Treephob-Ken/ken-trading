import { loadEnv } from './config.js'
import {
  createClients,
  getAssetMeta,
  roundPrice,
  roundSize,
  type HLClients,
} from './hyperliquid.js'
import { log } from './logger.js'
import {
  assertAssetAllowed,
  assertNotionalAllowed,
  assertRateLimit,
  recordTrade,
} from './limits.js'

// Clients are expensive to build (wallet + transports) and hold a WS
// connection, so we create them once and reuse across requests.
let shared: HLClients | null = null

function clients(): HLClients {
  if (!shared) shared = createClients(loadEnv())
  return shared
}

const DEFAULT_SLIPPAGE_PCT = 2
const MAX_SLIPPAGE_PCT = 10

export interface TradeRequest {
  asset: string
  side: 'buy' | 'sell'
  size: number
  maxSlippagePct?: number
}

export interface TradeResult {
  ok: boolean
  filled: boolean
  asset: string
  side: 'buy' | 'sell'
  requestedSize: number
  filledSize: number
  avgPx: number | null
  limitPx: number
  midPx: number
  message: string
  raw: unknown
}

// Validate a raw request body into a typed TradeRequest. Throws on bad input
// so callers can surface a 400 with a precise reason.
export function parseTradeRequest(body: unknown): TradeRequest {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Request body must be a JSON object')
  }
  const { asset, side, size, maxSlippagePct } = body as Record<string, unknown>

  if (typeof asset !== 'string' || asset.trim() === '') {
    throw new Error('asset must be a non-empty string')
  }
  if (side !== 'buy' && side !== 'sell') {
    throw new Error("side must be 'buy' or 'sell'")
  }
  const sizeNum = typeof size === 'string' ? Number(size) : size
  if (typeof sizeNum !== 'number' || !Number.isFinite(sizeNum) || sizeNum <= 0) {
    throw new Error('size must be a positive number')
  }

  let slip = DEFAULT_SLIPPAGE_PCT
  if (maxSlippagePct !== undefined) {
    const s = typeof maxSlippagePct === 'string' ? Number(maxSlippagePct) : maxSlippagePct
    if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) {
      throw new Error('maxSlippagePct must be a positive number')
    }
    slip = Math.min(s, MAX_SLIPPAGE_PCT)
  }

  const cleanAsset = asset.trim().toUpperCase()
  assertAssetAllowed(cleanAsset)
  return { asset: cleanAsset, side, size: sizeNum, maxSlippagePct: slip }
}

// Place an aggressively-priced IOC limit order so it behaves like a market
// order. The limit is capped at `maxSlippagePct` past mid so a thin or stale
// book can never fill us at an arbitrarily bad price.
export async function executeMarketTrade(req: TradeRequest): Promise<TradeResult> {
  const { info, exchange } = clients()
  const meta = await getAssetMeta(info, req.asset)
  const slip = (req.maxSlippagePct ?? DEFAULT_SLIPPAGE_PCT) / 100

  const rawPx = req.side === 'buy' ? meta.midPx * (1 + slip) : meta.midPx * (1 - slip)
  const limitPx = roundPrice(rawPx, meta)
  const sizeStr = roundSize(req.size, meta)
  if (Number(sizeStr) <= 0) {
    throw new Error(
      `size ${req.size} rounds to 0 at ${meta.szDecimals} decimals for ${req.asset}`,
    )
  }

  // Hard safety caps — enforced server-side regardless of the caller.
  const notionalUsd = Number(sizeStr) * meta.midPx
  assertNotionalAllowed(notionalUsd)
  assertRateLimit()

  log.info(
    `Trade: ${req.side.toUpperCase()} ${sizeStr} ${req.asset} ` +
      `IOC @ ${limitPx} (mid ${meta.midPx}, slip ${req.maxSlippagePct}%)`,
  )

  const orderRes = await exchange.order({
    orders: [
      {
        a: meta.index,
        b: req.side === 'buy',
        p: limitPx,
        s: sizeStr,
        r: false,
        t: { limit: { tif: 'Ioc' } },
      },
    ],
    grouping: 'na',
  })

  const status = orderRes.response.data.statuses[0]
  const base = {
    asset: req.asset,
    side: req.side,
    requestedSize: req.size,
    limitPx: Number(limitPx),
    midPx: meta.midPx,
    raw: status,
  }

  if (status && typeof status === 'object' && 'filled' in status) {
    const f = status.filled
    log.ok(`Trade filled: ${f.totalSz} ${req.asset} @ ${f.avgPx}`)
    recordTrade({
      asset: req.asset,
      side: req.side,
      requestedSize: req.size,
      filled: true,
      filledSize: Number(f.totalSz),
      avgPx: Number(f.avgPx),
      notionalUsd,
    })
    return {
      ...base,
      ok: true,
      filled: true,
      filledSize: Number(f.totalSz),
      avgPx: Number(f.avgPx),
      message: `Filled ${f.totalSz} ${req.asset} @ ${f.avgPx}`,
    }
  }

  // IOC with no fill — book was empty or too far from our capped limit.
  const desc = typeof status === 'string' ? status : JSON.stringify(status)
  log.warn(`Trade not filled (${desc})`)
  recordTrade({
    asset: req.asset,
    side: req.side,
    requestedSize: req.size,
    filled: false,
    filledSize: 0,
    avgPx: null,
    notionalUsd,
  })
  return {
    ...base,
    ok: true,
    filled: false,
    filledSize: 0,
    avgPx: null,
    message: `Not filled: ${desc}. Try a higher slippage tolerance.`,
  }
}

// ─────────────────────────── Unified order (market + limit) ───────────────────────────

export interface PlaceOrderResult {
  ok: boolean
  filled: boolean    // market/IOC fill happened
  resting: boolean   // GTC limit placed and waiting
  orderId: number | null
  asset: string
  side: 'buy' | 'sell'
  requestedSize: number
  filledSize: number
  avgPx: number | null
  limitPx: number | null
  midPx: number
  tpPlaced: boolean
  slPlaced: boolean
  message: string
}

// Place a market (IOC) or limit (GTC) order with optional TP/SL stops.
// TP/SL stops are placed immediately after a market fill using the same
// tpsl pattern as the grid bot: `isMarket:true` trigger orders, reduce-only.
export async function placeOrder(params: {
  asset: string
  side: 'buy' | 'sell'
  size: number
  orderType: 'market' | 'limit'
  limitPrice?: number
  reduceOnly?: boolean
  tpPrice?: number
  slPrice?: number
  maxSlippagePct?: number
}): Promise<PlaceOrderResult> {
  const {
    asset, side, size, orderType, limitPrice,
    reduceOnly = false, tpPrice, slPrice, maxSlippagePct,
  } = params
  const { info, exchange } = clients()
  const meta = await getAssetMeta(info, asset)

  assertAssetAllowed(asset)

  const sizeStr = roundSize(size, meta)
  if (Number(sizeStr) <= 0) {
    throw new Error(`size ${size} rounds to 0 at ${meta.szDecimals} decimals for ${asset}`)
  }
  const notionalUsd = Number(sizeStr) * meta.midPx
  assertNotionalAllowed(notionalUsd)
  assertRateLimit()

  let pxStr: string
  let tif: 'Ioc' | 'Gtc'

  if (orderType === 'market') {
    const slip = (maxSlippagePct ?? DEFAULT_SLIPPAGE_PCT) / 100
    const rawPx = side === 'buy' ? meta.midPx * (1 + slip) : meta.midPx * (1 - slip)
    pxStr = roundPrice(rawPx, meta)
    tif = 'Ioc'
  } else {
    if (!limitPrice || !(limitPrice > 0)) throw new Error('limitPrice is required for limit orders')
    pxStr = roundPrice(limitPrice, meta)
    tif = 'Gtc'
  }

  log.info(
    `${orderType.toUpperCase()} ${side.toUpperCase()} ${sizeStr} ${asset} @ ${pxStr}` +
      ` (${tif}${reduceOnly ? ' reduce-only' : ''})`,
  )

  const orderRes = await exchange.order({
    orders: [{ a: meta.index, b: side === 'buy', p: pxStr, s: sizeStr, r: reduceOnly, t: { limit: { tif } } }],
    grouping: 'na',
  })

  const status = orderRes.response.data.statuses[0]
  const base = { asset, side, requestedSize: size, limitPx: Number(pxStr), midPx: meta.midPx }
  let result: PlaceOrderResult

  if (status && typeof status === 'object' && 'filled' in status) {
    const f = status.filled
    log.ok(`Filled: ${f.totalSz} ${asset} @ ${f.avgPx}`)
    recordTrade({ asset, side, requestedSize: size, filled: true, filledSize: Number(f.totalSz), avgPx: Number(f.avgPx), notionalUsd })
    result = { ...base, ok: true, filled: true, resting: false, orderId: null, filledSize: Number(f.totalSz), avgPx: Number(f.avgPx), tpPlaced: false, slPlaced: false, message: `Filled ${f.totalSz} ${asset} @ ${f.avgPx}` }
  } else if (status && typeof status === 'object' && 'resting' in status) {
    const r = status.resting
    log.ok(`Resting limit: oid ${r.oid} @ ${pxStr}`)
    recordTrade({ asset, side, requestedSize: size, filled: false, filledSize: 0, avgPx: null, notionalUsd })
    result = { ...base, ok: true, filled: false, resting: true, orderId: r.oid, filledSize: 0, avgPx: null, tpPlaced: false, slPlaced: false, message: `Limit placed @ ${pxStr} (oid ${r.oid})` }
  } else {
    const desc = typeof status === 'string' ? status : JSON.stringify(status)
    log.warn(`Not filled: ${desc}`)
    recordTrade({ asset, side, requestedSize: size, filled: false, filledSize: 0, avgPx: null, notionalUsd })
    result = { ...base, ok: true, filled: false, resting: false, orderId: null, filledSize: 0, avgPx: null, tpPlaced: false, slPlaced: false, message: `Not filled: ${desc}` }
  }

  // Chain TP/SL stops after a market fill.
  // Both are reduce-only trigger orders using `isMarket:true`.
  // TP uses tpsl:'tp' (fires in the favourable direction); SL uses tpsl:'sl'.
  // limitMul places the IOC limit slightly past the trigger to guarantee fill.
  if (result.filled && result.filledSize > 0 && (tpPrice || slPrice)) {
    const closeSide: 'buy' | 'sell' = side === 'buy' ? 'sell' : 'buy'
    const closeQty = roundSize(result.filledSize, meta)
    const limitMul = closeSide === 'sell' ? 0.95 : 1.05

    if (tpPrice && tpPrice > 0) {
      try {
        await exchange.order({
          orders: [{ a: meta.index, b: closeSide === 'buy', p: roundPrice(tpPrice * limitMul, meta), s: closeQty, r: true, t: { trigger: { triggerPx: roundPrice(tpPrice, meta), isMarket: true, tpsl: 'tp' } } }],
          grouping: 'na',
        })
        result.tpPlaced = true
        log.ok(`TP stop placed @ ${tpPrice}`)
      } catch (e) { log.warn(`TP placement failed: ${(e as Error).message}`) }
    }

    if (slPrice && slPrice > 0) {
      try {
        await exchange.order({
          orders: [{ a: meta.index, b: closeSide === 'buy', p: roundPrice(slPrice * limitMul, meta), s: closeQty, r: true, t: { trigger: { triggerPx: roundPrice(slPrice, meta), isMarket: true, tpsl: 'sl' } } }],
          grouping: 'na',
        })
        result.slPlaced = true
        log.ok(`SL stop placed @ ${slPrice}`)
      } catch (e) { log.warn(`SL placement failed: ${(e as Error).message}`) }
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────

// The Hyperliquid perp universe — asset names available to trade. The web UI
// uses this to populate its currency picker so a user can't type an asset that
// Hyperliquid doesn't list.
export async function listAssets(): Promise<string[]> {
  const { info } = clients()
  const [meta] = await info.metaAndAssetCtxs()
  return meta.universe
    .filter((u) => !u.isDelisted)
    .map((u) => u.name)
    .sort()
}

export interface AccountState {
  network: 'testnet' | 'mainnet'
  user: string
  accountValue: number
  withdrawable: number
  position: {
    asset: string
    size: number
    side: 'long' | 'short'
    entryPx: number | null
    unrealizedPnl: number
  } | null
}

// Snapshot of the agent account: network, balance, and the open position for
// `asset` (if any). Used by the web app to show what's live before trading.
export async function getAccountState(asset?: string): Promise<AccountState> {
  const c = clients()
  const state = await c.info.clearinghouseState({ user: c.user })

  let position: AccountState['position'] = null
  if (asset) {
    const want = asset.trim().toUpperCase()
    const ap = state.assetPositions.find((p) => p.position.coin === want)
    if (ap) {
      const szi = Number(ap.position.szi)
      if (szi !== 0) {
        position = {
          asset: want,
          size: Math.abs(szi),
          side: szi > 0 ? 'long' : 'short',
          entryPx: ap.position.entryPx ? Number(ap.position.entryPx) : null,
          unrealizedPnl: Number(ap.position.unrealizedPnl),
        }
      }
    }
  }

  return {
    network: c.isTestnet ? 'testnet' : 'mainnet',
    user: c.user,
    accountValue: Number(state.marginSummary.accountValue),
    withdrawable: Number(state.withdrawable),
    position,
  }
}
