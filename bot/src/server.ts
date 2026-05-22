import express, { type Request, type Response } from 'express'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deleteConfig,
  listConfigs,
  loadConfig,
  loadEnv,
  saveConfig,
  type GridConfig,
} from './config.js'
import { GridBot } from './grid-bot.js'
import { createClients } from './hyperliquid.js'
import { clearLogBuffer, createLogger, getLogBuffer, log, onLog } from './logger.js'
import {
  executeMarketTrade,
  getAccountState,
  listAssets,
  parseTradeRequest,
} from './trade.js'
import {
  maybeAutostartSignalBot,
  parseSignalConfig,
  signalBot,
} from './signal-bot.js'
import { STRATEGIES } from './strategy/strategies.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DASHBOARD_PATH = join(__dirname, '..', 'dashboard', 'index.html')

interface BotEntry {
  id: string
  bot: GridBot
  running: boolean
}

const bots = new Map<string, BotEntry>()

const app = express()

// CORS — this endpoint can place real orders, so the origin allow-list is
// strict. localhost is always allowed (local dev). For remote access (e.g. a
// hosted dashboard reaching the bot through a Cloudflare Tunnel) add the exact
// frontend origin(s) to ALLOWED_ORIGINS, comma-separated. A wildcard is never
// used — that would let any website you visit trade your funds.
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function isAllowedOrigin(origin: string): boolean {
  return LOCALHOST_ORIGIN.test(origin) || EXTRA_ORIGINS.includes(origin)
}

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    // Credentials are reflected so a same-site subdomain dashboard behind
    // Cloudflare Access can send its auth cookie.
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

// Optional shared-secret gate. When BOT_API_TOKEN is set, every /api/* request
// must carry the token — either `Authorization: Bearer <token>` or, for the SSE
// stream (EventSource cannot send headers), a `?token=` query param. This is
// defence-in-depth for the no-Cloudflare-Access fallback (a plain tunnel); with
// Access in front the edge already blocks unauthenticated traffic and this can
// be left unset.
const API_TOKEN = process.env.BOT_API_TOKEN?.trim()
if (API_TOKEN) {
  app.use('/api', (req, res, next) => {
    if (req.method === 'OPTIONS') {
      next()
      return
    }
    const header = req.headers.authorization ?? ''
    const headerToken = header.startsWith('Bearer ') ? header.slice(7) : ''
    const queryToken = typeof req.query.token === 'string' ? req.query.token : ''
    if (headerToken !== API_TOKEN && queryToken !== API_TOKEN) {
      res.status(401).json({ error: 'Unauthorized — missing or invalid API token' })
      return
    }
    next()
  })
}

app.use(express.json())

const sseClients = new Set<Response>()
onLog((line) => {
  const data = `data: ${JSON.stringify(line)}\n\n`
  for (const res of sseClients) res.write(data)
})

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(DASHBOARD_PATH)
})

// ---------- Bot list / CRUD ----------

app.get('/api/bots', (_req: Request, res: Response) => {
  const all = listConfigs().map((cfg) => ({
    id: cfg.id!,
    name: cfg.name ?? cfg.asset,
    asset: cfg.asset,
    gridCount: cfg.gridCount,
    lower: cfg.lower,
    upper: cfg.upper,
    running: bots.get(cfg.id!)?.running ?? false,
  }))
  res.json(all)
})

app.get('/api/bots/:id/config', (req: Request, res: Response) => {
  try {
    res.json(loadConfig(req.params.id))
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

// Create or update a config. Body should be a full GridConfig.
// If :id matches an existing config we overwrite it; otherwise we create.
app.put('/api/bots/:id/config', (req: Request, res: Response) => {
  const existingId = req.params.id
  if (bots.get(existingId)?.running) {
    res.status(400).json({ error: 'Stop the bot before changing its config.' })
    return
  }
  try {
    const cfg = req.body as GridConfig
    cfg.id = cfg.id ?? existingId
    const saved = saveConfig(cfg, existingId)
    log.ok(`Config saved: ${saved.id} (${saved.asset} ${saved.lower}-${saved.upper})`)
    res.json(saved)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

// Create new — body has full config minus id (server will assign).
app.post('/api/bots', (req: Request, res: Response) => {
  try {
    const cfg = req.body as GridConfig
    const saved = saveConfig(cfg)
    log.ok(`Bot created: ${saved.id}`)
    res.json(saved)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.delete('/api/bots/:id', (req: Request, res: Response) => {
  const id = req.params.id
  if (bots.get(id)?.running) {
    res.status(400).json({ error: 'Stop the bot before deleting it.' })
    return
  }
  bots.delete(id)
  deleteConfig(id)
  clearLogBuffer(id)
  log.ok(`Bot deleted: ${id}`)
  res.json({ ok: true })
})

// ---------- Bot lifecycle ----------

app.post('/api/bots/:id/start', async (req: Request, res: Response) => {
  const id = req.params.id
  if (bots.get(id)?.running) {
    res.json({ ok: true })
    return
  }
  try {
    const env = loadEnv()
    const cfg = loadConfig(id)
    const clients = createClients(env)
    const logger = createLogger(id)
    const bot = new GridBot(clients, cfg, logger)
    bots.set(id, { id, bot, running: true })
    res.json({ ok: true })
    bot.start().catch((e: unknown) => {
      logger.err(`Bot crashed: ${(e as Error).message}`)
      const entry = bots.get(id)
      if (entry) entry.running = false
    })
  } catch (e) {
    bots.delete(id)
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/bots/:id/stop', async (req: Request, res: Response) => {
  const id = req.params.id
  const entry = bots.get(id)
  if (!entry) {
    res.json({ ok: true })
    return
  }
  try {
    await entry.bot.shutdown()
  } catch (e) {
    log.err(`Shutdown error for ${id}: ${(e as Error).message}`)
  } finally {
    entry.running = false
    bots.delete(id)
  }
  res.json({ ok: true })
})

app.get('/api/bots/:id/stats', (req: Request, res: Response) => {
  const id = req.params.id
  const entry = bots.get(id)
  if (!entry || !entry.running) {
    res.json({ running: false })
    return
  }
  try {
    res.json({ running: true, stats: entry.bot.getStats() })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/bots/:id/logs', (req: Request, res: Response) => {
  res.json(getLogBuffer(req.params.id))
})

// ---------- Global log stream ----------

app.get('/api/logs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

// ---------- Direct Trade Signal Execution ----------

// Account snapshot — network, balance, and the open position for ?asset=.
app.get('/api/account', async (req: Request, res: Response) => {
  try {
    const asset = typeof req.query.asset === 'string' ? req.query.asset : undefined
    res.json(await getAccountState(asset))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Place a market-like (IOC) order. Validation failures return 400; exchange
// or network failures return 500.
app.post('/api/trade', async (req: Request, res: Response) => {
  let parsed
  try {
    parsed = parseTradeRequest(req.body)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
    return
  }
  try {
    const result = await executeMarketTrade(parsed)
    res.json({ ...result, msg: result.message })
  } catch (e) {
    log.err(`API Trade failed: ${(e as Error).message}`)
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- Signal Trading Bot ----------

// Strategy catalog — lets the web app render the strategy picker and its
// parameter inputs without duplicating the strategy definitions.
app.get('/api/strategies', (_req: Request, res: Response) => {
  res.json(STRATEGIES)
})

// Tradeable Hyperliquid assets — populates the web UI currency picker.
app.get('/api/assets', async (_req: Request, res: Response) => {
  try {
    res.json(await listAssets())
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/signal/status', (_req: Request, res: Response) => {
  res.json(signalBot.getStatus())
})

app.get('/api/signal/logs', (_req: Request, res: Response) => {
  res.json(getLogBuffer('signal'))
})

// Save the signal bot config (only allowed while the bot is stopped).
app.put('/api/signal/config', (req: Request, res: Response) => {
  let cfg
  try {
    cfg = parseSignalConfig(req.body)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
    return
  }
  try {
    signalBot.setConfig(cfg)
    log.ok(`Signal config saved: ${cfg.strategyId} on ${cfg.symbol} ${cfg.timeframe}`)
    res.json(signalBot.getStatus())
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.post('/api/signal/start', (_req: Request, res: Response) => {
  try {
    signalBot.start()
    res.json(signalBot.getStatus())
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/signal/stop', (_req: Request, res: Response) => {
  signalBot.stop()
  res.json(signalBot.getStatus())
})

const PORT = 3001
createServer(app).listen(PORT, () => {
  log.ok(`Bot dashboard -> http://localhost:${PORT}`)
  maybeAutostartSignalBot()
})
