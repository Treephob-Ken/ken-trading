import { loadEnv } from '../src/config.js'
import { getPortfolio } from '../src/trade.js'

async function main() {
  const env = loadEnv()
  const resp = await getPortfolio(env)
  for (const [period, data] of resp) {
    const av = data.accountValueHistory
    const first = av[0]
    const last = av[av.length - 1]
    console.log(
      `${period.padEnd(12)} points=${String(av.length).padStart(4)}  ` +
      `first=${first ? new Date(first[0]).toISOString() + ' $' + first[1] : '—'}  ` +
      `last=${last ? new Date(last[0]).toISOString() + ' $' + last[1] : '—'}  ` +
      `vlm=${data.vlm}`,
    )
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
