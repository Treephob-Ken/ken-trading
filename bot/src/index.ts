import { loadEnv, loadGridConfig } from './config.js'
import { GridBot } from './grid-bot.js'
import { createClients } from './hyperliquid.js'
import { log } from './logger.js'

async function main() {
  const env = loadEnv()
  const cfg = loadGridConfig()

  log.info(`Network: ${env.isTestnet ? 'TESTNET' : 'MAINNET'}`)
  log.info(`User: ${env.user}`)
  log.info(
    `Grid: ${cfg.asset} [${cfg.lower}, ${cfg.upper}] x ${cfg.gridCount} (${cfg.mode}) sz=${cfg.orderSize}`,
  )

  if (!env.isTestnet) {
    log.warn('Running on MAINNET — real money. Press Ctrl+C in 5s to abort.')
    await new Promise((r) => setTimeout(r, 5000))
  }

  const clients = createClients(env)
  const bot = new GridBot(clients, cfg)
  await bot.start()

  const shutdown = async () => {
    try {
      await bot.shutdown()
    } catch (e) {
      log.err(`Shutdown error: ${(e as Error).message}`)
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e: unknown) => {
  log.err(`Fatal: ${(e as Error).message}`)
  console.error(e)
  process.exit(1)
})
