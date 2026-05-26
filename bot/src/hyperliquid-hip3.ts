import type { InfoClient } from '@nktkas/hyperliquid'

// HIP-3 perp dexes (builder-deployed perpetuals) live behind the same
// `metaAndAssetCtxs` endpoint as the main dex — but you must pass `dex: <name>`
// to see them. Their assets always have a `${dex}:${coin}` name shape
// (e.g. "xyz:GOLD", "xyz:TSLA").
//
// `info.perpDexs()` returns the dex list as [null, {name:'xyz',...}, ...] where
// index 0 is the main dex (null sentinel) and 1+ are HIP-3 dexes.

export interface DexUniverseEntry {
  name: string
  szDecimals: number
  maxLeverage: number
  isDelisted?: boolean
  dex: string | null
}

export interface AssetCtxLite {
  markPx: number
  midPx: number
  funding: number
  openInterest: number
  prevDayPx: number
  dayNtlVlm: number
  oraclePx: number
}

export interface FullAssetMeta extends DexUniverseEntry {
  index: number
  ctx: AssetCtxLite
}

// "btc" → "BTC"; "XYZ:gold" → "xyz:GOLD"; preserves the dex/coin shape.
export function normalizeAssetName(asset: string): string {
  const t = asset.trim()
  const i = t.indexOf(':')
  if (i < 0) return t.toUpperCase()
  return t.slice(0, i).toLowerCase() + ':' + t.slice(i + 1).toUpperCase()
}

export function dexOf(asset: string): string | null {
  const i = asset.indexOf(':')
  return i < 0 ? null : asset.slice(0, i)
}

// metaAndAssetCtxs is cheap to call but not free; the universe rarely changes
// so a short cache keeps mass-list operations (Scanner) snappy.
const TTL_MS = 60_000

interface CachedDex {
  universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[]
  ctxs: unknown[]
  fetchedAt: number
}

const cache = new Map<string, CachedDex>()

async function fetchDex(info: InfoClient, dex: string | null): Promise<CachedDex> {
  const key = dex ?? ''
  const cached = cache.get(key)
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached
  const result = dex
    ? await info.metaAndAssetCtxs({ dex })
    : await info.metaAndAssetCtxs()
  const fresh: CachedDex = {
    universe: result[0].universe,
    ctxs: result[1] as unknown[],
    fetchedAt: Date.now(),
  }
  cache.set(key, fresh)
  return fresh
}

export function clearHip3Cache(): void {
  cache.clear()
}

// Allow-list of HIP-3 dexes to surface in the dashboard. Hyperliquid has dozens
// of builder-deployed dexes — many are sandbox/test deployments. Default to just
// the major real ones; override via HIP3_DEX_ALLOWLIST=xyz,hb,unit in bot/.env.
function getAllowedDexes(): Set<string> | null {
  const raw = process.env.HIP3_DEX_ALLOWLIST
  if (raw === undefined) return new Set(['xyz'])
  const cleaned = raw.trim()
  if (cleaned === '' || cleaned === '*') return null
  return new Set(cleaned.split(',').map((s) => s.trim()).filter(Boolean))
}

// Names of HIP-3 dexes only (does not include the main perp dex).
// Filters by HIP3_DEX_ALLOWLIST so we don't churn through 50+ junk dexes.
export async function listHip3Dexes(info: InfoClient): Promise<string[]> {
  const result = await info.perpDexs()
  const allow = getAllowedDexes()
  const names: string[] = []
  for (const d of result) {
    if (!d) continue
    if (allow && !allow.has(d.name)) continue
    names.push(d.name)
  }
  return names
}

// Resolve metadata + market ctx for a single asset, auto-routing by dex.
export async function resolveAssetMeta(info: InfoClient, asset: string): Promise<FullAssetMeta> {
  const normalized = normalizeAssetName(asset)
  const dex = dexOf(normalized)
  const c = await fetchDex(info, dex)
  const index = c.universe.findIndex((u) => u.name === normalized)
  if (index < 0) {
    throw new Error(`Asset ${normalized} not found on Hyperliquid (dex=${dex ?? 'main'})`)
  }
  const u = c.universe[index]
  const ctxRaw = c.ctxs[index] as Record<string, string | undefined>
  return {
    name: u.name,
    szDecimals: u.szDecimals,
    maxLeverage: u.maxLeverage,
    isDelisted: u.isDelisted,
    dex,
    index,
    ctx: {
      markPx: Number(ctxRaw.markPx),
      midPx: Number(ctxRaw.midPx ?? ctxRaw.markPx),
      funding: Number(ctxRaw.funding),
      openInterest: Number(ctxRaw.openInterest),
      prevDayPx: Number(ctxRaw.prevDayPx),
      dayNtlVlm: Number(ctxRaw.dayNtlVlm),
      oraclePx: Number(ctxRaw.oraclePx),
    },
  }
}

// List ALL tradable assets across the main perp dex + every HIP-3 dex.
// Used by listAssets() so the dashboard symbol picker sees stocks/commodities.
export async function listAllAssets(info: InfoClient): Promise<DexUniverseEntry[]> {
  const hip3 = await listHip3Dexes(info)
  const all: DexUniverseEntry[] = []

  const main = await fetchDex(info, null)
  for (const u of main.universe) {
    if (u.isDelisted) continue
    all.push({ name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, dex: null })
  }
  for (const dex of hip3) {
    const c = await fetchDex(info, dex)
    for (const u of c.universe) {
      if (u.isDelisted) continue
      all.push({ name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, dex })
    }
  }
  return all
}

// Same as listAllAssets but with full ctx (mark price, OI, etc.). Heavier — only
// call when the caller actually needs market ctxs (Scanner ranking).
export async function listAllAssetsWithCtx(
  info: InfoClient,
): Promise<{ entry: DexUniverseEntry; ctx: AssetCtxLite }[]> {
  const hip3 = await listHip3Dexes(info)
  const out: { entry: DexUniverseEntry; ctx: AssetCtxLite }[] = []

  const buildCtx = (raw: Record<string, string | undefined>): AssetCtxLite => ({
    markPx: Number(raw.markPx),
    midPx: Number(raw.midPx ?? raw.markPx),
    funding: Number(raw.funding),
    openInterest: Number(raw.openInterest),
    prevDayPx: Number(raw.prevDayPx),
    dayNtlVlm: Number(raw.dayNtlVlm),
    oraclePx: Number(raw.oraclePx),
  })

  const main = await fetchDex(info, null)
  main.universe.forEach((u, i) => {
    if (u.isDelisted) return
    out.push({
      entry: { name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, dex: null },
      ctx: buildCtx(main.ctxs[i] as Record<string, string | undefined>),
    })
  })
  for (const dex of hip3) {
    const c = await fetchDex(info, dex)
    c.universe.forEach((u, i) => {
      if (u.isDelisted) return
      out.push({
        entry: { name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, dex },
        ctx: buildCtx(c.ctxs[i] as Record<string, string | undefined>),
      })
    })
  }
  return out
}
