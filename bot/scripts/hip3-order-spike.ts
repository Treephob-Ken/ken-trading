// B.0 spike — HIP-3 asset-ID routing on testnet.
//
// Step 1: inspect — what HIP-3 dexes/assets exist on testnet, what's the
//   smallest order we can place, what's the current mid?
// Step 2 (manual, gated): place a far-from-mid limit order using the computed
//   asset ID, confirm it appears in openOrders under the right `coin`, cancel.
//
// Run:  cd bot && npx tsx scripts/hip3-order-spike.ts            (inspect)
//       cd bot && npx tsx scripts/hip3-order-spike.ts --place    (live test)

import 'dotenv/config'
import {
  ExchangeClient,
  HttpTransport,
  InfoClient,
} from '@nktkas/hyperliquid'
import { privateKeyToAccount } from 'viem/accounts'

const DO_PLACE = process.argv.includes('--place')
const ASSET = 'xyz:GOLD'

function computeAssetId(perpDexIndex: number, indexInMeta: number): number {
  return 100000 + perpDexIndex * 10000 + indexInMeta
}

async function main() {
  const transport = new HttpTransport({ isTestnet: true })
  const info = new InfoClient({ transport })

  console.log('\n─── Step 1: enumerate testnet perp dexes ──────────────')
  const dexes = await info.perpDexs()
  console.log(`perpDexs returned ${dexes.length} entries (null = main dex)`)
  dexes.forEach((d, i) => {
    if (d) console.log(`  [${i}] name="${d.name}" fullName="${d.fullName}" deployer=${d.deployer.slice(0, 10)}…`)
    else   console.log(`  [${i}] (main perp dex)`)
  })

  console.log('\n─── Step 2: find xyz dex if present ──────────────────')
  const xyzIdx = dexes.findIndex((d) => d?.name === 'xyz')
  if (xyzIdx < 0) {
    console.log('No "xyz" dex on testnet. Listing all HIP-3 dexes instead:')
    for (let i = 0; i < dexes.length; i++) {
      const d = dexes[i]
      if (!d) continue
      try {
        const result = await info.metaAndAssetCtxs({ dex: d.name })
        const names = result[0].universe.map((u) => u.name).filter((n) => !!n)
        console.log(`  dex[${i}] "${d.name}": ${names.length} assets, first 6: ${names.slice(0, 6).join(', ')}`)
      } catch (e) {
        console.log(`  dex[${i}] "${d.name}": meta failed — ${(e as Error).message}`)
      }
    }
    console.log('\nNote: spike cannot place a xyz:GOLD order if xyz dex is absent on testnet.')
    return
  }
  console.log(`xyz dex found at perpDexs index ${xyzIdx}`)

  console.log('\n─── Step 3: lookup xyz:GOLD index_in_meta ─────────────')
  const xyzMeta = await info.metaAndAssetCtxs({ dex: 'xyz' })
  const universe = xyzMeta[0].universe
  const ctxs = xyzMeta[1]
  const goldIdx = universe.findIndex((u) => u.name === 'xyz:GOLD')
  if (goldIdx < 0) {
    console.log('xyz:GOLD not found in testnet xyz dex universe. First few names:', universe.slice(0, 10).map((u) => u.name))
    return
  }
  const goldUni = universe[goldIdx]
  const goldCtx = ctxs[goldIdx] as { markPx?: string; midPx?: string }
  const assetId = computeAssetId(xyzIdx, goldIdx)
  const midPx = Number(goldCtx.midPx ?? goldCtx.markPx ?? 0)
  console.log(`  index_in_meta=${goldIdx}, szDecimals=${goldUni.szDecimals}, maxLeverage=${goldUni.maxLeverage}`)
  console.log(`  midPx=${midPx}  (testnet xyz:GOLD)`)
  console.log(`  COMPUTED asset_id = 100000 + ${xyzIdx}*10000 + ${goldIdx} = ${assetId}`)

  if (!DO_PLACE) {
    console.log('\nInspection only. Re-run with --place to test order placement.')
    return
  }

  // ─── Step 4: actually place a far-from-price limit order ───
  const agentKey = process.env.HL_AGENT_PRIVATE_KEY as `0x${string}` | undefined
  if (!agentKey) {
    console.error('HL_AGENT_PRIVATE_KEY missing in bot/.env')
    process.exit(1)
  }
  const account = privateKeyToAccount(agentKey)
  const exchange = new ExchangeClient({ wallet: account, transport, isTestnet: true })

  // Far-below-mid buy: pick a price ~10% below mid so it cannot fill.
  // Min size: 10^-szDecimals.
  const minSize = Math.pow(10, -goldUni.szDecimals)
  // HL prices have two rules: max 5 sig figs AND max (6 - szDecimals) decimals.
  // For szDecimals=4 that's 2 decimal places, AND 5 sig figs total.
  // For gold ~$4562, 50% below = $2281 — round to integer (4 sig figs).
  const pxFar = Math.round(midPx * 0.5) // safely won't fill, 4 sig figs ✓
  const targetNotionalAtOrderPx = 25
  let size = Math.max(minSize, targetNotionalAtOrderPx / pxFar)
  size = Number(size.toFixed(goldUni.szDecimals))

  console.log('\n─── Step 4: place a far-from-price BUY limit ──────────')
  console.log(`  asset_id=${assetId}  side=BUY  px=${pxFar}  size=${size}  notional≈$${(pxFar * size).toFixed(2)}`)
  console.log('  Submitting…')

  let oid: number | null = null
  try {
    const result = await exchange.order({
      orders: [{
        a: assetId,
        b: true, // buy
        p: String(pxFar),
        s: String(size),
        r: false,
        t: { limit: { tif: 'Gtc' } },
      }],
      grouping: 'na',
    })
    console.log('  ORDER response:', JSON.stringify(result, null, 2))
    const status = result.response?.data?.statuses?.[0]
    if (status && typeof status === 'object' && 'resting' in status) {
      oid = status.resting.oid
      console.log(`  OK — resting oid=${oid}`)
    } else if (status && typeof status === 'object' && 'error' in status) {
      console.log(`  HL rejected:`, status.error)
    }
  } catch (e) {
    console.error('  exchange.order threw:', (e as Error).message)
  }

  // ─── Step 5: verify the order shows up under xyz:GOLD ───
  console.log('\n─── Step 5: openOrders snapshot ───────────────────────')
  try {
    const userAddr = process.env.HL_USER_ADDRESS as `0x${string}`
    const open = await info.openOrders({ user: userAddr, dex: 'xyz' })
    const ours = open.filter((o) => o.oid === oid)
    if (ours.length === 0) {
      console.log(`  No order with oid=${oid} found in xyz openOrders (${open.length} total).`)
      console.log('  Showing all openOrders coins:', [...new Set(open.map((o) => o.coin))])
    } else {
      console.log(`  FOUND under coin="${ours[0].coin}"  (expected "xyz:GOLD")`)
      console.log(`  ${ours[0].coin === 'xyz:GOLD' ? '✓ ASSET ROUTING CORRECT' : '✗ MISMATCH — DO NOT PROCEED'}`)
    }
  } catch (e) {
    console.error('  openOrders failed:', (e as Error).message)
  }

  // ─── Step 6: cancel ───
  if (oid != null) {
    console.log('\n─── Step 6: cancel ────────────────────────────────────')
    try {
      const cancelResult = await exchange.cancel({
        cancels: [{ a: assetId, o: oid }],
      })
      console.log('  cancel response:', JSON.stringify(cancelResult, null, 2))
    } catch (e) {
      console.error('  exchange.cancel threw:', (e as Error).message)
      console.log(`  MANUAL CLEANUP NEEDED: oid=${oid} on asset_id=${assetId}`)
    }
  }

  console.log('\n─── Done ──────────────────────────────────────────────')
}

main().catch((e) => {
  console.error('Spike crashed:', e)
  process.exit(1)
})
