import { loadEnv, type EnvConfig } from './config.js'
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

// ─── Client management ────────────────────────────────────────────────────────

// Single-tenant: one singleton built from process.env on first use.
let singletonClients: HLClients | null = null

// Multi-tenant: one entry per user, keyed by HL user address.
// The key is the user address (public) so two sessions with the same wallet share a client.
const userClientCache = new Map<string, HLClients>()

// Return the right HLClients: per-user when creds are provided, otherwise the
// module-level singleton (single-tenant mode). Both paths are lazy-initialized.
export function getClients(creds?: EnvConfig | null): HLClients {
  if (creds) {
    const key = creds.user
    let c = userClientCache.get(key)
    if (!c) {
      c = createClients(creds)
      userClientCache.set(key, c)
    }
    return c
  }
  if (!singletonClients) singletonClients = createClients(loadEnv())
  return singletonClients
}

// Evict a user's cached client — call when their credentials are updated.
export function evictClientCache(hlUser: string): void {
  userClientCache.delete(hlUser)
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

  const cleanAsset = (asset as string).trim().toUpperCase()
  assertAssetAllowed(cleanAsset)
  return { asset: cleanAsset, side: side as 'buy' | 'sell', size: sizeNum as number, maxSlippagePct: slip }
}

// Place an aggressively-priced IOC limit order so it behaves like a market
// order. The limit is capped at `maxSlippagePct` past mid so a thin or stale
// book can never fill us at an arbitrarily bad price.
export async function executeMarketTrade(
  req: TradeRequest,
  creds?: EnvConfig | null,
): Promise<TradeResult> {
  const { info, exchange } = getClients(creds)
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
  filled: boolean
  resting: boolean
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
export async function placeOrder(
  params: {
    asset: string
    side: 'buy' | 'sell'
    size: number
    orderType: 'market' | 'limit'
    limitPrice?: number
    reduceOnly?: boolean
    tpPrice?: number
    slPrice?: number
    tpPct?: number
    slPct?: number
    maxSlippagePct?: number
  },
  creds?: EnvConfig | null,
): Promise<PlaceOrderResult> {
  const {
    asset, side, size, orderType, limitPrice,
    reduceOnly = false, tpPrice, slPrice, tpPct, slPct, maxSlippagePct,
  } = params
  const { info, exchange } = getClients(creds)
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

  if (result.filled && result.filledSize > 0) {
    const avgPx = result.avgPx ?? meta.midPx
    const effectiveTp = tpPct
      ? (side === 'buy' ? avgPx * (1 + tpPct / 100) : avgPx * (1 - tpPct / 100))
      : tpPrice
    const effectiveSl = slPct
      ? (side === 'buy' ? avgPx * (1 - slPct / 100) : avgPx * (1 + slPct / 100))
      : slPrice

    if (effectiveTp || effectiveSl) {
      const closeSide: 'buy' | 'sell' = side === 'buy' ? 'sell' : 'buy'
      const closeQty = roundSize(result.filledSize, meta)
      const limitMul = closeSide === 'sell' ? 0.95 : 1.05

      if (effectiveTp && effectiveTp > 0) {
        try {
          await exchange.order({
            orders: [{ a: meta.index, b: closeSide === 'buy', p: roundPrice(effectiveTp * limitMul, meta), s: closeQty, r: true, t: { trigger: { triggerPx: roundPrice(effectiveTp, meta), isMarket: true, tpsl: 'tp' } } }],
            grouping: 'na',
          })
          result.tpPlaced = true
          log.ok(`TP placed @ ${effectiveTp.toFixed(2)}${tpPct ? ` (+${tpPct}% from fill)` : ''}`)
        } catch (e) { log.warn(`TP placement failed: ${(e as Error).message}`) }
      }

      if (effectiveSl && effectiveSl > 0) {
        try {
          await exchange.order({
            orders: [{ a: meta.index, b: closeSide === 'buy', p: roundPrice(effectiveSl * limitMul, meta), s: closeQty, r: true, t: { trigger: { triggerPx: roundPrice(effectiveSl, meta), isMarket: true, tpsl: 'sl' } } }],
            grouping: 'na',
          })
          result.slPlaced = true
          log.ok(`SL placed @ ${effectiveSl.toFixed(2)}${slPct ? ` (-${slPct}% from fill)` : ''}`)
        } catch (e) { log.warn(`SL placement failed: ${(e as Error).message}`) }
      }
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────

export async function getAssetInfo(
  asset: string,
  creds?: EnvConfig | null,
): Promise<{
  asset: string; midPx: number; markPx: number
  szDecimals: number; minSz: number; minNotional: number; maxLeverage: number
}> {
  const { info } = getClients(creds)
  const meta = await getAssetMeta(info, asset.trim().toUpperCase())
  const minSz = Math.pow(10, -meta.szDecimals)
  return { asset: meta.name, midPx: meta.midPx, markPx: meta.markPx, szDecimals: meta.szDecimals, minSz, minNotional: minSz * meta.midPx, maxLeverage: meta.maxLeverage }
}

export async function listAssets(creds?: EnvConfig | null): Promise<string[]> {
  const { info } = getClients(creds)
  const [meta] = await info.metaAndAssetCtxs()
  return meta.universe
    .filter((u) => !u.isDelisted)
    .map((u) => u.name)
    .sort()
}

export interface PositionInfo {
  asset: string
  size: number
  side: 'long' | 'short'
  entryPx: number | null
  unrealizedPnl: number
  // Pro-trader metrics — populated by getAccountState when meta is available.
  // Optional so existing single-tenant callers don't break.
  liquidationPx?: number | null
  leverage?: number          // current effective leverage on this position
  marginUsed?: number         // USDC posted as collateral for this position
  positionValue?: number      // current notional value in USDC (size × markPx)
  markPx?: number             // current HL mark price for the asset
}

export interface AccountState {
  network: 'testnet' | 'mainnet'
  user: string
  accountValue: number
  withdrawable: number
  currentPrice: number | null
  position: PositionInfo | null
  allPositions: PositionInfo[]
}

export async function getAccountState(
  asset?: string,
  creds?: EnvConfig | null,
): Promise<AccountState> {
  const c = getClients(creds)
  const state = await c.info.clearinghouseState({ user: c.user })

  // Fetch the meta + price context once; needed for markPx on every position.
  // One extra HL roundtrip but it returns the whole universe so we can read
  // every asset's mark price without N more calls.
  let markPxByAsset = new Map<string, number>()
  try {
    const [meta, ctxs] = await c.info.metaAndAssetCtxs()
    meta.universe.forEach((u, i) => {
      const ctx = ctxs[i]
      if (ctx) markPxByAsset.set(u.name, Number(ctx.markPx ?? ctx.midPx ?? 0))
    })
  } catch { /* if this fails, mark prices stay empty — positions still render with entryPx only */ }

  function enrich(ap: typeof state.assetPositions[number]): PositionInfo {
    const szi = Number(ap.position.szi)
    const p = ap.position as typeof ap.position & {
      liquidationPx?: string | null
      marginUsed?: string | null
      positionValue?: string | null
      leverage?: { type: string; value: number }
    }
    const markPx = markPxByAsset.get(p.coin) ?? null
    return {
      asset: p.coin,
      size: Math.abs(szi),
      side: szi > 0 ? 'long' : 'short',
      entryPx: p.entryPx ? Number(p.entryPx) : null,
      unrealizedPnl: Number(p.unrealizedPnl),
      liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null,
      leverage: p.leverage?.value,
      marginUsed: p.marginUsed ? Number(p.marginUsed) : undefined,
      positionValue: p.positionValue ? Number(p.positionValue) : (markPx ? Math.abs(szi) * markPx : undefined),
      markPx: markPx ?? undefined,
    }
  }

  let currentPrice: number | null = null
  let position: AccountState['position'] = null
  if (asset) {
    const want = asset.trim().toUpperCase()
    currentPrice = markPxByAsset.get(want) ?? null
    if (currentPrice === null) {
      try {
        const priceMeta = await getAssetMeta(c.info, want)
        currentPrice = priceMeta.midPx
      } catch { /* skip if asset not found */ }
    }
    const ap = state.assetPositions.find((p) => p.position.coin === want)
    if (ap && Number(ap.position.szi) !== 0) {
      position = enrich(ap)
    }
  }

  const allPositions: PositionInfo[] = state.assetPositions
    .filter((ap) => Number(ap.position.szi) !== 0)
    .map(enrich)

  return {
    network: c.isTestnet ? 'testnet' : 'mainnet',
    user: c.user,
    accountValue: Number(state.marginSummary.accountValue),
    withdrawable: Number(state.withdrawable),
    currentPrice,
    position,
    allPositions,
  }
}

export async function cancelAssetOrders(
  asset: string,
  creds?: EnvConfig | null,
): Promise<number> {
  const { info, exchange, user } = getClients(creds)
  const meta = await getAssetMeta(info, asset)
  const open = await info.openOrders({ user })
  const mine = (open as Array<{ coin: string; oid: number }>).filter((o) => o.coin === asset)
  if (mine.length === 0) return 0
  await exchange.cancel({ cancels: mine.map((o) => ({ a: meta.index, o: o.oid })) })
  log.info(`Cancelled ${mine.length} open order(s) for ${asset}`)
  return mine.length
}

export interface PositionBrackets {
  slPx: number | null  // stop-loss trigger price (lower for longs, higher for shorts)
  tpPx: number | null  // take-profit trigger price
}

/**
 * Walks the user's open orders looking for reduce-only trigger (stop) orders
 * for `asset`. The Hyperliquid SDK marks bracket orders with `triggerCondition`
 * and `isTrigger`. Returns the SL and TP trigger prices if found.
 *
 * Heuristic for distinguishing SL from TP when only `triggerPx` is exposed:
 * compare the trigger price to the position's entry/mark — for a long, a
 * trigger below mark = SL, above = TP. The caller passes the position side.
 */
export async function getPositionBrackets(
  asset: string,
  side: 'long' | 'short' | null,
  creds?: EnvConfig | null,
): Promise<PositionBrackets> {
  const { info, user } = getClients(creds)
  const want = asset.trim().toUpperCase()
  const open = (await info.openOrders({ user })) as Array<{
    coin: string
    oid: number
    triggerPx?: string | null
    triggerCondition?: string | null
    isTrigger?: boolean
    reduceOnly?: boolean
    isPositionTpsl?: boolean
  }>
  const triggers = open.filter(
    (o) =>
      o.coin === want &&
      (o.isTrigger === true || o.isPositionTpsl === true) &&
      o.reduceOnly === true &&
      o.triggerPx,
  )
  if (triggers.length === 0 || !side) return { slPx: null, tpPx: null }

  // Need a reference price to classify trigger as SL vs TP when the SDK doesn't
  // expose the tpsl tag directly. We use mark price as the reference.
  let refPx: number | null = null
  try {
    const meta = await getAssetMeta(info, want)
    refPx = meta.midPx
  } catch { /* fine, we'll fall back to price comparison */ }

  let sl: number | null = null
  let tp: number | null = null
  for (const t of triggers) {
    const px = Number(t.triggerPx)
    if (!Number.isFinite(px)) continue
    if (side === 'long') {
      // For a long: SL is below current price, TP is above.
      if (refPx !== null) {
        if (px < refPx) sl = sl === null ? px : Math.max(sl, px)  // closest SL below
        else tp = tp === null ? px : Math.min(tp, px)             // closest TP above
      }
    } else {
      // For a short: SL is above current price, TP is below.
      if (refPx !== null) {
        if (px > refPx) sl = sl === null ? px : Math.min(sl, px)
        else tp = tp === null ? px : Math.max(tp, px)
      }
    }
  }
  return { slPx: sl, tpPx: tp }
}

export async function closePosition(
  asset: string,
  maxSlippagePct?: number,
  creds?: EnvConfig | null,
): Promise<PlaceOrderResult | null> {
  const state = await getAccountState(asset, creds)
  if (!state.position) return null
  const { side, size } = state.position
  const closeSide: 'buy' | 'sell' = side === 'long' ? 'sell' : 'buy'
  log.info(`Closing ${side} ${size} ${asset} with reduce-only ${closeSide}`)
  return placeOrder({ asset, side: closeSide, size, orderType: 'market', reduceOnly: true, maxSlippagePct }, creds)
}
