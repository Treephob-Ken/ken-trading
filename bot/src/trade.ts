import { loadEnv, type EnvConfig } from './config.js'
import {
  createClients,
  getAssetMeta,
  roundPrice,
  roundSize,
  type HLClients,
} from './hyperliquid.js'
import {
  dexOf,
  listAllAssets,
  listHip3Dexes,
  normalizeAssetName,
  resolveAssetMeta,
} from './hyperliquid-hip3.js'
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
  try {
    assertNotionalAllowed(notionalUsd)
    assertRateLimit()
  } catch (e) {
    recordTrade({
      asset: req.asset, side: req.side, requestedSize: req.size,
      filled: false, filledSize: 0, avgPx: null, notionalUsd,
      reason: (e as Error).message,
    })
    throw e
  }

  log.info(
    `Trade: ${req.side.toUpperCase()} ${sizeStr} ${req.asset} ` +
      `IOC @ ${limitPx} (mid ${meta.midPx}, slip ${req.maxSlippagePct}%)`,
  )

  const orderRes = await exchange.order({
    orders: [
      {
        a: meta.assetId,
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
    reason: desc,
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

  // Run all pre-checks together so a rejection here lands in the audit log
  // with a reason — otherwise these throws would be invisible in the UI.
  const sizeStr = roundSize(size, meta)
  const notionalUsd = Number(sizeStr) * meta.midPx
  try {
    assertAssetAllowed(asset)
    if (Number(sizeStr) <= 0) {
      throw new Error(`size ${size} rounds to 0 at ${meta.szDecimals} decimals for ${asset}`)
    }
    assertNotionalAllowed(notionalUsd)
    assertRateLimit()
  } catch (e) {
    recordTrade({
      asset, side, requestedSize: size,
      filled: false, filledSize: 0, avgPx: null,
      notionalUsd: Number.isFinite(notionalUsd) ? notionalUsd : 0,
      reason: (e as Error).message,
    })
    throw e
  }

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
    orders: [{ a: meta.assetId, b: side === 'buy', p: pxStr, s: sizeStr, r: reduceOnly, t: { limit: { tif } } }],
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
    recordTrade({ asset, side, requestedSize: size, filled: false, filledSize: 0, avgPx: null, notionalUsd, resting: true })
    result = { ...base, ok: true, filled: false, resting: true, orderId: r.oid, filledSize: 0, avgPx: null, tpPlaced: false, slPlaced: false, message: `Limit placed @ ${pxStr} (oid ${r.oid})` }
  } else {
    const desc = typeof status === 'string' ? status : JSON.stringify(status)
    log.warn(`Not filled: ${desc}`)
    recordTrade({ asset, side, requestedSize: size, filled: false, filledSize: 0, avgPx: null, notionalUsd, reason: desc })
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

      // grouping='positionTpsl' tells Hyperliquid these are TP/SL brackets
      // attached to the position (rather than standalone trigger orders).
      // Required for `tpsl: 'tp'` to be accepted — with grouping='na' HL
      // silently rejects the TP leg while accepting the SL.

      if (effectiveTp && effectiveTp > 0) {
        try {
          const triggerPx = roundPrice(effectiveTp, meta)
          const limitPx = roundPrice(effectiveTp * limitMul, meta)
          await exchange.order({
            orders: [{ a: meta.assetId, b: closeSide === 'buy', p: limitPx, s: closeQty, r: true, t: { trigger: { triggerPx, isMarket: true, tpsl: 'tp' } } }],
            grouping: 'positionTpsl',
          })
          result.tpPlaced = true
          log.ok(`TP placed @ ${effectiveTp.toFixed(2)}${tpPct ? ` (+${tpPct}% from fill)` : ''}`)
        } catch (e) {
          // Surface the full HL rejection — the catch silently hides errors
          // that look like "Order has invalid price" / "trigger condition met".
          const msg = (e as Error).message
          log.warn(`TP placement failed (asset=${asset}, side=${closeSide}, triggerPx=${roundPrice(effectiveTp, meta)}, qty=${closeQty}): ${msg}`)
        }
      }

      if (effectiveSl && effectiveSl > 0) {
        try {
          const triggerPx = roundPrice(effectiveSl, meta)
          const limitPx = roundPrice(effectiveSl * limitMul, meta)
          await exchange.order({
            orders: [{ a: meta.assetId, b: closeSide === 'buy', p: limitPx, s: closeQty, r: true, t: { trigger: { triggerPx, isMarket: true, tpsl: 'sl' } } }],
            grouping: 'positionTpsl',
          })
          result.slPlaced = true
          log.ok(`SL placed @ ${effectiveSl.toFixed(2)}${slPct ? ` (-${slPct}% from fill)` : ''}`)
        } catch (e) {
          const msg = (e as Error).message
          log.warn(`SL placement failed (asset=${asset}, side=${closeSide}, triggerPx=${roundPrice(effectiveSl, meta)}, qty=${closeQty}): ${msg}`)
        }
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
  // Extended market stats — used by the Trade page Asset Info card.
  funding: number          // hourly funding rate (signed, e.g. 0.0000125 = 0.00125%/h)
  openInterest: number     // total OI in base units
  prevDayPx: number        // closing price 24h ago
  dayNtlVlm: number        // 24h notional volume in USD
  oraclePx: number         // oracle price
}> {
  const { info } = getClients(creds)
  const normalized = normalizeAssetName(asset)
  const m = await resolveAssetMeta(info, normalized)
  const minSz = Math.pow(10, -m.szDecimals)
  return {
    asset: normalized,
    midPx: m.ctx.midPx,
    markPx: m.ctx.markPx,
    szDecimals: m.szDecimals,
    minSz,
    minNotional: minSz * m.ctx.midPx,
    maxLeverage: m.maxLeverage,
    funding: m.ctx.funding,
    openInterest: m.ctx.openInterest,
    prevDayPx: m.ctx.prevDayPx,
    dayNtlVlm: m.ctx.dayNtlVlm,
    oraclePx: m.ctx.oraclePx,
  }
}

export async function listAssets(creds?: EnvConfig | null): Promise<string[]> {
  const { info } = getClients(creds)
  const all = await listAllAssets(info)
  return all.map((u) => u.name).sort()
}

// Same as listAssets but tagged with the dex name (null = main perp dex).
// The web app uses this to classify symbols into crypto vs stocks vs commodities.
export interface ListedAsset {
  name: string
  dex: string | null
}
export async function listAssetsTagged(creds?: EnvConfig | null): Promise<ListedAsset[]> {
  const { info } = getClients(creds)
  const all = await listAllAssets(info)
  return all
    .map((u) => ({ name: u.name, dex: u.dex }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface PositionInfo {
  asset: string
  // null for main perp dex, dex name (e.g. "xyz") for HIP-3 positions.
  dex?: string | null
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

// Per-dex margin summary. HIP-3 dexes have independent margin from main perp,
// so the UI surfaces them separately rather than aggregating.
export interface DexBalance {
  dex: string | null   // null = main perp dex
  accountValue: number
  withdrawable: number
  totalMarginUsed: number
}

export interface AccountState {
  network: 'testnet' | 'mainnet'
  user: string
  // Main perp dex values (kept for backward compat with existing dashboard widgets).
  accountValue: number
  withdrawable: number
  currentPrice: number | null
  position: PositionInfo | null
  // Merged across main + HIP-3 dexes — every position tagged with .dex.
  allPositions: PositionInfo[]
  // Per-dex margin summary so the UI can show main and xyz balances side-by-side.
  dexBalances?: DexBalance[]
}

export async function getAccountState(
  asset?: string,
  creds?: EnvConfig | null,
): Promise<AccountState> {
  const c = getClients(creds)

  // Build mark-price + position views for every dex (main + HIP-3) in parallel.
  // We surface main-dex `accountValue` and `withdrawable` as top-level fields for
  // backward compat; per-dex breakdown is in dexBalances.
  const hip3Dexes = await listHip3Dexes(c.info)
  const dexes: (string | null)[] = [null, ...hip3Dexes]

  const perDex = await Promise.all(
    dexes.map(async (dex) => {
      const stateP = dex
        ? c.info.clearinghouseState({ user: c.user, dex })
        : c.info.clearinghouseState({ user: c.user })
      const ctxP = dex
        ? c.info.metaAndAssetCtxs({ dex })
        : c.info.metaAndAssetCtxs()
      const [state, [meta, ctxs]] = await Promise.all([stateP, ctxP])
      const markPx = new Map<string, number>()
      meta.universe.forEach((u, i) => {
        const ctx = ctxs[i]
        if (ctx) markPx.set(u.name, Number(ctx.markPx ?? ctx.midPx ?? 0))
      })
      return { dex, state, markPx }
    }),
  )

  function enrich(ap: { position: Record<string, unknown> }, dex: string | null, markPx: Map<string, number>): PositionInfo {
    const p = ap.position as {
      coin: string
      szi: string
      entryPx?: string | null
      unrealizedPnl: string
      liquidationPx?: string | null
      marginUsed?: string | null
      positionValue?: string | null
      leverage?: { type: string; value: number }
    }
    const szi = Number(p.szi)
    const mark = markPx.get(p.coin) ?? null
    return {
      asset: p.coin,
      dex,
      size: Math.abs(szi),
      side: szi > 0 ? 'long' : 'short',
      entryPx: p.entryPx ? Number(p.entryPx) : null,
      unrealizedPnl: Number(p.unrealizedPnl),
      liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null,
      leverage: p.leverage?.value,
      marginUsed: p.marginUsed ? Number(p.marginUsed) : undefined,
      positionValue: p.positionValue ? Number(p.positionValue) : (mark ? Math.abs(szi) * mark : undefined),
      markPx: mark ?? undefined,
    }
  }

  const main = perDex.find((d) => d.dex === null)!

  // Per-dex margin breakdown.
  const dexBalances: DexBalance[] = perDex.map((d) => ({
    dex: d.dex,
    accountValue: Number(d.state.marginSummary.accountValue),
    withdrawable: Number(d.state.withdrawable),
    totalMarginUsed: Number(d.state.marginSummary.totalMarginUsed),
  }))

  // Merge positions across every dex.
  const allPositions: PositionInfo[] = []
  for (const d of perDex) {
    for (const ap of d.state.assetPositions) {
      if (Number(ap.position.szi) === 0) continue
      allPositions.push(enrich(ap as { position: Record<string, unknown> }, d.dex, d.markPx))
    }
  }

  // Single-asset focus (used by the manual Trade page when an asset is selected).
  let currentPrice: number | null = null
  let position: AccountState['position'] = null
  if (asset) {
    const want = normalizeAssetName(asset)
    const assetDex = dexOf(want)
    const sourceDex = perDex.find((d) => d.dex === assetDex) ?? main
    currentPrice = sourceDex.markPx.get(want) ?? null
    if (currentPrice === null) {
      try {
        const priceMeta = await getAssetMeta(c.info, want)
        currentPrice = priceMeta.midPx
      } catch { /* skip if asset not found */ }
    }
    position = allPositions.find((p) => p.asset === want) ?? null
  }

  return {
    network: c.isTestnet ? 'testnet' : 'mainnet',
    user: c.user,
    accountValue: Number(main.state.marginSummary.accountValue),
    withdrawable: Number(main.state.withdrawable),
    currentPrice,
    position,
    allPositions,
    dexBalances,
  }
}

export async function cancelAssetOrders(
  asset: string,
  creds?: EnvConfig | null,
): Promise<number> {
  const { info, exchange, user } = getClients(creds)
  const normalized = normalizeAssetName(asset)
  const meta = await getAssetMeta(info, normalized)
  // HIP-3 open orders only show up when openOrders is queried with the dex param.
  const open = meta.dex
    ? await info.openOrders({ user, dex: meta.dex })
    : await info.openOrders({ user })
  const mine = (open as Array<{ coin: string; oid: number }>).filter((o) => o.coin === normalized)
  if (mine.length === 0) return 0
  await exchange.cancel({ cancels: mine.map((o) => ({ a: meta.assetId, o: o.oid })) })
  log.info(`Cancelled ${mine.length} open order(s) for ${normalized}`)
  return mine.length
}

// Set the leverage for an asset on Hyperliquid. Cross by default — matches
// what grid-bot does at startup. Safe to call before every order; HL is a
// no-op when the asset is already at the requested leverage. Logged-and-
// swallowed on failure so a leverage hiccup never blocks the order itself.
export async function setAssetLeverage(
  asset: string,
  leverage: number,
  isCross: boolean,
  creds?: EnvConfig | null,
): Promise<{ ok: boolean; appliedLeverage: number; error?: string }> {
  if (!(leverage > 0)) return { ok: false, appliedLeverage: 0, error: 'leverage must be > 0' }
  const { info, exchange } = getClients(creds)
  const normalized = normalizeAssetName(asset)
  const meta = await getAssetMeta(info, normalized)
  const capped = Math.min(Math.floor(leverage), meta.maxLeverage || leverage)
  try {
    await exchange.updateLeverage({ asset: meta.index, isCross, leverage: capped })
    return { ok: true, appliedLeverage: capped }
  } catch (e) {
    const msg = (e as Error).message
    log.warn(`Could not set leverage to ${capped}x for ${normalized}: ${msg}`)
    return { ok: false, appliedLeverage: capped, error: msg }
  }
}

// Snapshot OIDs of all currently open orders for an asset. Call this BEFORE
// placing a new entry+bracket; pair with cancelOrdersByOid() afterwards to
// cancel only the old/stale orders without touching the new SL/TP brackets.
export async function snapshotAssetOrderOids(
  asset: string,
  creds?: EnvConfig | null,
): Promise<number[]> {
  const { info, user } = getClients(creds)
  const normalized = normalizeAssetName(asset)
  const meta = await getAssetMeta(info, normalized)
  const open = meta.dex
    ? await info.openOrders({ user, dex: meta.dex })
    : await info.openOrders({ user })
  return (open as Array<{ coin: string; oid: number }>)
    .filter((o) => o.coin === normalized)
    .map((o) => o.oid)
}

// Cancel a specific set of OIDs for an asset. Returns the count actually
// cancelled. Silently skips IDs that are no longer on the book.
export async function cancelOrdersByOid(
  asset: string,
  oids: number[],
  creds?: EnvConfig | null,
): Promise<number> {
  if (oids.length === 0) return 0
  const { info, exchange, user } = getClients(creds)
  const normalized = normalizeAssetName(asset)
  const meta = await getAssetMeta(info, normalized)
  const open = meta.dex
    ? await info.openOrders({ user, dex: meta.dex })
    : await info.openOrders({ user })
  const stillOpen = new Set(
    (open as Array<{ coin: string; oid: number }>)
      .filter((o) => o.coin === normalized)
      .map((o) => o.oid),
  )
  const toCancel = oids.filter((oid) => stillOpen.has(oid))
  if (toCancel.length === 0) return 0
  await exchange.cancel({ cancels: toCancel.map((oid) => ({ a: meta.assetId, o: oid })) })
  log.info(`Cancelled ${toCancel.length} stale order(s) for ${normalized}`)
  return toCancel.length
}

export interface PositionBrackets {
  slPx: number | null  // stop-loss trigger price (lower for longs, higher for shorts)
  tpPx: number | null  // take-profit trigger price
}

// Cancel only the reduce-only TP/SL trigger orders for an asset. Leaves
// regular limit orders alone — used by the UI "Cancel brackets" button so
// a user can manage SL/TP without touching unrelated orders.
export async function cancelPositionBrackets(
  asset: string,
  creds?: EnvConfig | null,
): Promise<number> {
  const { info, exchange, user } = getClients(creds)
  const normalized = normalizeAssetName(asset)
  const meta = await getAssetMeta(info, normalized)
  // frontendOpenOrders exposes isTrigger / reduceOnly fields that the basic
  // openOrders endpoint silently strips.
  const open = await info.frontendOpenOrders(meta.dex ? { user, dex: meta.dex } : { user })
  const mine = (open as Array<{
    coin: string; oid: number
    isTrigger?: boolean; reduceOnly?: boolean; isPositionTpsl?: boolean
  }>).filter((o) => o.coin === normalized && (o.isTrigger || o.isPositionTpsl) && o.reduceOnly)
  if (mine.length === 0) return 0
  await exchange.cancel({ cancels: mine.map((o) => ({ a: meta.assetId, o: o.oid })) })
  log.info(`Cancelled ${mine.length} bracket order(s) for ${normalized}`)
  return mine.length
}

// Replace the live SL/TP brackets on an existing position with new trigger
// prices. Cancels any existing brackets first, then places fresh ones sized
// to the current position. Pass `null` to skip a leg (e.g. SL only).
export async function replacePositionBrackets(
  asset: string,
  slPrice: number | null,
  tpPrice: number | null,
  creds?: EnvConfig | null,
): Promise<{ slPlaced: boolean; tpPlaced: boolean; cancelled: number; positionSize: number }> {
  const { info, exchange, user } = getClients(creds)
  const normalized = normalizeAssetName(asset)
  const meta = await getAssetMeta(info, normalized)

  // Read the live position so we know side + size for the reduce-only legs.
  const cs = meta.dex
    ? await info.clearinghouseState({ user, dex: meta.dex })
    : await info.clearinghouseState({ user })
  type AssetPos = { position: { coin: string; szi: string } }
  const positions = (cs.assetPositions ?? []) as AssetPos[]
  const found = positions.find((p) => p.position.coin === normalized)
  const szi = Number(found?.position.szi ?? 0)
  if (!szi || !Number.isFinite(szi) || szi === 0) {
    throw new Error(`No open ${normalized} position to attach brackets to`)
  }
  const side: 'buy' | 'sell' = szi > 0 ? 'buy' : 'sell'
  const closeSide: 'buy' | 'sell' = side === 'buy' ? 'sell' : 'buy'
  const closeQty = roundSize(Math.abs(szi), meta)
  if (Number(closeQty) <= 0) throw new Error(`Position size ${szi} rounds to 0 for ${normalized}`)

  // Drop the old brackets so we don't end up with overlapping triggers.
  const cancelled = await cancelPositionBrackets(normalized, creds)

  const limitMul = closeSide === 'sell' ? 0.95 : 1.05
  let slPlaced = false
  let tpPlaced = false

  if (tpPrice && tpPrice > 0) {
    try {
      const triggerPx = roundPrice(tpPrice, meta)
      const limitPx = roundPrice(tpPrice * limitMul, meta)
      await exchange.order({
        orders: [{ a: meta.assetId, b: closeSide === 'buy', p: limitPx, s: closeQty, r: true, t: { trigger: { triggerPx, isMarket: true, tpsl: 'tp' } } }],
        grouping: 'positionTpsl',
      })
      tpPlaced = true
      log.ok(`TP placed @ ${tpPrice.toFixed(4)} for ${normalized}`)
    } catch (e) {
      log.warn(`TP placement failed for ${normalized}: ${(e as Error).message}`)
    }
  }

  if (slPrice && slPrice > 0) {
    try {
      const triggerPx = roundPrice(slPrice, meta)
      const limitPx = roundPrice(slPrice * limitMul, meta)
      await exchange.order({
        orders: [{ a: meta.assetId, b: closeSide === 'buy', p: limitPx, s: closeQty, r: true, t: { trigger: { triggerPx, isMarket: true, tpsl: 'sl' } } }],
        grouping: 'positionTpsl',
      })
      slPlaced = true
      log.ok(`SL placed @ ${slPrice.toFixed(4)} for ${normalized}`)
    } catch (e) {
      log.warn(`SL placement failed for ${normalized}: ${(e as Error).message}`)
    }
  }

  return { slPlaced, tpPlaced, cancelled, positionSize: Math.abs(szi) }
}

/**
 * Walks the user's open orders looking for reduce-only trigger orders
 * (TP / SL) for `asset` and returns their trigger prices.
 *
 * IMPORTANT: uses `frontendOpenOrders`, not `openOrders`. The basic
 * `openOrders` endpoint returns `OpenOrderSchema` which does NOT include
 * `isTrigger`, `isPositionTpsl`, `triggerPx`, `triggerCondition`, or
 * `reduceOnly` — so a filter against those fields silently returns
 * nothing even when triggers exist on the exchange. The frontend
 * variant returns `FrontendOpenOrderSchema` with all of them.
 *
 * Classification (SL vs TP) works in two layers:
 *  1. `triggerCondition` string from HL ("Stop Market", "Take Profit
 *     Market", "Price below 123.4", "Price above 123.4") — when present,
 *     that's the authoritative signal.
 *  2. Fallback: compare triggerPx to a reference price (position entry,
 *     else mid). For a long, trigger below ref = SL, above = TP. For a
 *     short, the inverse.
 */
export async function getPositionBrackets(
  asset: string,
  side: 'long' | 'short' | null,
  creds?: EnvConfig | null,
): Promise<PositionBrackets> {
  const { info, user } = getClients(creds)
  const want = normalizeAssetName(asset)
  const wantDex = dexOf(want)
  const open = (wantDex
    ? await info.frontendOpenOrders({ user, dex: wantDex })
    : await info.frontendOpenOrders({ user })) as Array<{
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

  // Reference price for fallback classification. Prefer the position's entry
  // price (stable across the trade), then mark price, then mid. If all fail,
  // we still try to classify via triggerCondition text.
  let refPx: number | null = null
  try {
    const state = await getAccountState(want, creds)
    if (state.position?.entryPx) refPx = state.position.entryPx
    else if (state.position?.markPx) refPx = state.position.markPx
    else if (state.currentPrice) refPx = state.currentPrice
  } catch { /* fall through to meta */ }
  if (refPx === null) {
    try {
      const meta = await getAssetMeta(info, want)
      refPx = meta.midPx
    } catch { /* fine, we'll fall back to triggerCondition only */ }
  }

  let sl: number | null = null
  let tp: number | null = null
  for (const t of triggers) {
    const px = Number(t.triggerPx)
    if (!Number.isFinite(px)) continue
    // First try the triggerCondition text — it carries the user-facing label.
    const cond = (t.triggerCondition ?? '').toLowerCase()
    let kind: 'sl' | 'tp' | null = null
    if (cond.includes('stop')) kind = 'sl'
    else if (cond.includes('take profit') || cond.includes('takeprofit')) kind = 'tp'
    // Fallback: classify by price direction relative to the reference.
    if (kind === null && refPx !== null) {
      if (side === 'long')  kind = px < refPx ? 'sl' : 'tp'
      else                  kind = px > refPx ? 'sl' : 'tp'
    }
    if (kind === 'sl') {
      // Pick the closest SL to entry (largest below for long, smallest above for short)
      if (sl === null) sl = px
      else sl = side === 'long' ? Math.max(sl, px) : Math.min(sl, px)
    } else if (kind === 'tp') {
      // Pick the closest TP to entry
      if (tp === null) tp = px
      else tp = side === 'long' ? Math.min(tp, px) : Math.max(tp, px)
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
