// One-off spike: confirm @nktkas/hyperliquid v0.32.2 supports HIP-3.
// Read-only mainnet calls. Safe to delete after Phase A.
//
// Run with:  cd bot && npx tsx scripts/hip3-spike.ts

import { HttpTransport, InfoClient } from '@nktkas/hyperliquid'

async function main() {
  const transport = new HttpTransport({ isTestnet: false })
  const info = new InfoClient({ transport })

  console.log('\n─── Test 1: info.perpDexs() ───────────────────────────')
  let perpDexs: unknown
  try {
    // @ts-expect-error — checking whether the SDK exposes this method at all
    perpDexs = await info.perpDexs()
    console.log('OK — perpDexs returned:')
    console.log(JSON.stringify(perpDexs, null, 2).slice(0, 2000))
  } catch (e) {
    console.log('FAIL — info.perpDexs() not available on SDK:', (e as Error).message)
  }

  console.log('\n─── Test 2: info.metaAndAssetCtxs({ dex: "xyz" }) ─────')
  let xyzMeta: unknown
  try {
    // @ts-expect-error — checking whether the SDK accepts the dex parameter
    xyzMeta = await info.metaAndAssetCtxs({ dex: 'xyz' })
    const arr = xyzMeta as [{ universe: { name: string }[] }, unknown]
    const names = arr[0]?.universe?.map((u) => u.name) ?? []
    console.log(`OK — xyz universe has ${names.length} assets`)
    console.log('First 20 names:', names.slice(0, 20))
    const interesting = names.filter((n) =>
      /^(GOLD|XAG|SPX500|TSLA|NVDA|AAPL|AMZN|GOOGL|META|MSFT|AMD|COIN|NFLX)$/i.test(n),
    )
    console.log('Recognised stocks/commodities found:', interesting)
  } catch (e) {
    console.log('FAIL — metaAndAssetCtxs({ dex: "xyz" }) failed:', (e as Error).message)
  }

  console.log('\n─── Test 3: candleSnapshot for xyz:GOLD ───────────────')
  try {
    const now = Date.now()
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
    const candles = await info.candleSnapshot({
      coin: 'xyz:GOLD',
      interval: '1h',
      startTime: sevenDaysAgo,
      endTime: now,
    })
    console.log(`OK — got ${candles.length} 1h bars for xyz:GOLD`)
    if (candles.length > 0) {
      console.log('First bar:', candles[0])
      console.log('Last  bar:', candles[candles.length - 1])
    }
  } catch (e) {
    console.log('FAIL — candleSnapshot for xyz:GOLD failed:', (e as Error).message)
  }

  console.log('\n─── Test 4: candleSnapshot for xyz:TSLA ───────────────')
  try {
    const now = Date.now()
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
    const candles = await info.candleSnapshot({
      coin: 'xyz:TSLA',
      interval: '1h',
      startTime: sevenDaysAgo,
      endTime: now,
    })
    console.log(`OK — got ${candles.length} 1h bars for xyz:TSLA`)
    if (candles.length > 0) {
      console.log('Last bar:', candles[candles.length - 1])
    }
  } catch (e) {
    console.log('FAIL — candleSnapshot for xyz:TSLA failed:', (e as Error).message)
  }

  console.log('\n─── Done ──────────────────────────────────────────────')
}

main().catch((e) => {
  console.error('Spike crashed:', e)
  process.exit(1)
})
