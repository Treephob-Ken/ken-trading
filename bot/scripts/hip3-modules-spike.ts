// Exercise the new HIP-3 module functions end-to-end (read-only mainnet).
// Run:  cd bot && npx tsx scripts/hip3-modules-spike.ts

import { HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import {
  listAllAssets,
  resolveAssetMeta,
  normalizeAssetName,
  dexOf,
} from '../src/hyperliquid-hip3.js'
import { fetchKlinesHL } from '../src/strategy/hl-market-data.js'

async function main() {
  const transport = new HttpTransport({ isTestnet: false })
  const info = new InfoClient({ transport })

  console.log('\n─── normalizeAssetName ────────────────────────────────')
  for (const s of ['btc', 'BTC', 'XYZ:gold', 'xyz:gold', 'xyz:GOLD', '  XYZ:TSLA  ']) {
    console.log(`  "${s}" → "${normalizeAssetName(s)}"  (dex=${dexOf(normalizeAssetName(s)) ?? 'main'})`)
  }

  console.log('\n─── resolveAssetMeta("xyz:GOLD") ──────────────────────')
  const goldMeta = await resolveAssetMeta(info, 'xyz:GOLD')
  console.log({
    name: goldMeta.name,
    dex: goldMeta.dex,
    index: goldMeta.index,
    szDecimals: goldMeta.szDecimals,
    maxLeverage: goldMeta.maxLeverage,
    markPx: goldMeta.ctx.markPx,
    openInterest: goldMeta.ctx.openInterest,
  })

  console.log('\n─── resolveAssetMeta("btc") ───────────────────────────')
  const btcMeta = await resolveAssetMeta(info, 'btc')
  console.log({
    name: btcMeta.name,
    dex: btcMeta.dex,
    index: btcMeta.index,
    markPx: btcMeta.ctx.markPx,
  })

  console.log('\n─── listAllAssets — count + samples ───────────────────')
  const all = await listAllAssets(info)
  const mainCount = all.filter((a) => a.dex === null).length
  const hip3Count = all.filter((a) => a.dex !== null).length
  console.log(`  total=${all.length}  main=${mainCount}  HIP-3=${hip3Count}`)
  console.log('  HIP-3 examples:', all.filter((a) => a.dex !== null).slice(0, 8).map((a) => a.name))

  console.log('\n─── fetchKlinesHL("xyz:GOLD", "1h", 24) ───────────────')
  const candles = await fetchKlinesHL('xyz:GOLD', '1h', 24)
  console.log(`  got ${candles.length} bars`)
  console.log('  last:', candles[candles.length - 1])

  console.log('\n─── Done ──────────────────────────────────────────────')
}

main().catch((e) => {
  console.error('Spike crashed:', e)
  process.exit(1)
})
