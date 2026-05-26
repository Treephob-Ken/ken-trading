// One-off testnet funding script.
//
// Transfers USDC from your main perp account into the xyz HIP-3 dex on testnet
// so the signal bot can trade xyz:GOLD. Requires your MAIN wallet private key
// (the one that holds your testnet USDC) — NOT the agent key.
//
// SECURITY:
//   - The key is read from stdin (no shell history, no process arg list).
//   - It is never written to disk or logged.
//   - Sanity check: we verify the key derives to HL_USER_ADDRESS from bot/.env.
//   - The script transfers a FIXED $30 USDC and exits. No keepalive.
//   - You can delete this file after running it.
//
// Run:
//   cd bot
//   npx tsx scripts/fund-xyz-testnet.ts
//
// Then paste your main wallet 0x... private key when prompted and press Enter.

import 'dotenv/config'
import { createInterface } from 'node:readline'
import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import { privateKeyToAccount } from 'viem/accounts'

const AMOUNT = '30' // USD
const DEST_DEX = 'xyz'

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a) }))
}

async function findUsdcToken(info: InfoClient): Promise<string> {
  // Find USDC's testnet token identifier — format is `${name}:${tokenId}` where
  // tokenId is the hex hash from spot meta tokens. USDC is always the base
  // unit of account so it's always present.
  const spot = await info.spotMeta()
  const usdc = spot.tokens.find((t) => t.name === 'USDC')
  if (!usdc) throw new Error('USDC not found in spotMeta — testnet may have a different layout')
  return `USDC:${usdc.tokenId}`
}

async function main() {
  const expectedUser = (process.env.HL_USER_ADDRESS ?? '').toLowerCase()
  if (!expectedUser) { console.error('HL_USER_ADDRESS missing in bot/.env'); process.exit(1) }
  if ((process.env.HL_NETWORK ?? '').toLowerCase() !== 'testnet') {
    console.error('bot/.env says HL_NETWORK != testnet — refusing to run.')
    console.error('This script is intentionally testnet-only for safety.')
    process.exit(1)
  }

  const transport = new HttpTransport({ isTestnet: true })
  const info = new InfoClient({ transport })

  console.log('\nThis will transfer $30 testnet USDC from your main perp dex → xyz HIP-3 dex.')
  console.log(`Expected wallet: ${expectedUser}`)
  console.log('\nPaste your MAIN wallet private key (0x… 66 chars) and press Enter.')
  console.log('It will not be echoed cleanly on Windows terminals — just paste + Enter.')
  const keyRaw = (await prompt('> ')).trim()
  const key = (keyRaw.startsWith('0x') ? keyRaw : `0x${keyRaw}`) as `0x${string}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error('That does not look like a 32-byte hex private key. Aborting.')
    process.exit(1)
  }

  const account = privateKeyToAccount(key)
  if (account.address.toLowerCase() !== expectedUser) {
    console.error(`Key derives to ${account.address}, but bot/.env says ${expectedUser}.`)
    console.error('Refusing to transfer with a mismatched wallet.')
    process.exit(1)
  }
  console.log(`✓ Key matches ${expectedUser}\n`)

  const exchange = new ExchangeClient({ wallet: account, transport, isTestnet: true })

  console.log('Looking up testnet USDC token ID…')
  const token = await findUsdcToken(info)
  console.log(`  token = ${token}`)

  console.log(`\nSubmitting sendAsset(${AMOUNT} USDC, main → ${DEST_DEX})…`)
  try {
    const result = await exchange.sendAsset({
      destination: account.address,
      sourceDex: '',         // main perp dex
      destinationDex: DEST_DEX,
      token,
      amount: AMOUNT,
    })
    console.log('  response:', JSON.stringify(result, null, 2))
  } catch (e) {
    console.error('  FAIL:', (e as Error).message)
    process.exit(1)
  }

  console.log('\nVerifying new balance…')
  const xyz = await info.clearinghouseState({ user: account.address, dex: DEST_DEX })
  console.log(`  xyz dex accountValue: $${xyz.marginSummary.accountValue}`)
  console.log(`  xyz dex withdrawable: $${xyz.withdrawable}`)
  console.log('\nDone. You can delete this script now if you want.')
}

main().catch((e) => { console.error('Crashed:', e); process.exit(1) })
