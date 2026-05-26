// Check testnet account state for both main perp and xyz HIP-3 dex.
// Run: cd bot && npx tsx scripts/hip3-margin-check.ts

import 'dotenv/config'
import { HttpTransport, InfoClient } from '@nktkas/hyperliquid'

async function main() {
  const user = (process.env.HL_USER_ADDRESS ?? '') as `0x${string}`
  if (!user) { console.error('HL_USER_ADDRESS missing'); process.exit(1) }
  const isTestnet = (process.env.HL_NETWORK ?? 'testnet') === 'testnet'
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet }) })

  console.log(`\nUser: ${user}  Network: ${isTestnet ? 'testnet' : 'mainnet'}`)

  console.log('\n─── Main perp dex (clearinghouseState) ────────────────')
  const main = await info.clearinghouseState({ user })
  console.log(`  account value: $${main.marginSummary.accountValue}`)
  console.log(`  total margin used: $${main.marginSummary.totalMarginUsed}`)
  console.log(`  withdrawable: $${main.withdrawable}`)
  console.log(`  open positions: ${main.assetPositions.length}`)

  console.log('\n─── xyz HIP-3 dex (clearinghouseState with dex) ───────')
  try {
    const xyz = await info.clearinghouseState({ user, dex: 'xyz' })
    console.log(`  account value: $${xyz.marginSummary.accountValue}`)
    console.log(`  total margin used: $${xyz.marginSummary.totalMarginUsed}`)
    console.log(`  withdrawable: $${xyz.withdrawable}`)
    console.log(`  open positions: ${xyz.assetPositions.length}`)
    if (Number(xyz.marginSummary.accountValue) < 5) {
      console.log('\n  ⚠ xyz dex has < $5 — orders will fail with "Insufficient margin".')
      console.log('  Fund by transferring testnet USDC from main to xyz on the Hyperliquid UI.')
    } else {
      console.log('\n  ✓ Sufficient margin in xyz dex.')
    }
  } catch (e) {
    console.log(`  Error: ${(e as Error).message}`)
  }
}

main().catch((e) => { console.error('Crashed:', e); process.exit(1) })
