import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type GridMode = 'arithmetic' | 'geometric'

export interface GridConfig {
  asset: string
  lower: number
  upper: number
  gridCount: number
  mode: GridMode
  orderSize: number
}

export interface EnvConfig {
  agentKey: `0x${string}`
  user: `0x${string}`
  isTestnet: boolean
}

function required(key: string): string {
  const v = process.env[key]
  if (!v) {
    console.error(`Missing required env var: ${key}`)
    console.error('Copy bot/.env.example to bot/.env and fill it in.')
    process.exit(1)
  }
  return v
}

export function loadEnv(): EnvConfig {
  const agentKey = required('HL_AGENT_PRIVATE_KEY')
  const user = required('HL_USER_ADDRESS')
  const network = process.env.HL_NETWORK ?? 'testnet'
  if (!agentKey.startsWith('0x') || agentKey.length !== 66) {
    console.error('HL_AGENT_PRIVATE_KEY must be a 0x-prefixed 64-hex-char private key')
    process.exit(1)
  }
  if (!user.startsWith('0x') || user.length !== 42) {
    console.error('HL_USER_ADDRESS must be a 0x-prefixed 40-hex-char address')
    process.exit(1)
  }
  return {
    agentKey: agentKey as `0x${string}`,
    user: user as `0x${string}`,
    isTestnet: network !== 'mainnet',
  }
}

export function loadGridConfig(): GridConfig {
  const path = join(__dirname, '..', 'grid.config.json')
  const cfg = JSON.parse(readFileSync(path, 'utf8')) as GridConfig
  if (!(cfg.upper > cfg.lower)) throw new Error('upper must be > lower')
  if (cfg.gridCount < 2) throw new Error('gridCount must be >= 2')
  if (cfg.orderSize <= 0) throw new Error('orderSize must be > 0')
  return cfg
}

export function buildLines(cfg: GridConfig): number[] {
  const { lower, upper, gridCount, mode } = cfg
  const lines: number[] = []
  if (mode === 'geometric' && lower > 0) {
    const r = Math.pow(upper / lower, 1 / gridCount)
    for (let i = 0; i <= gridCount; i++) lines.push(lower * Math.pow(r, i))
  } else {
    const step = (upper - lower) / gridCount
    for (let i = 0; i <= gridCount; i++) lines.push(lower + step * i)
  }
  return lines
}
