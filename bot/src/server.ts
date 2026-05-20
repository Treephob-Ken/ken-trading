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

const __dirname = dirname(fileURLToPath(import.meta.url))
const DASHBOARD_PATH = join(__dirname, '..', 'dashboard', 'index.html')

interface BotEntry {
  id: string
  bot: GridBot
  running: boolean
}

const bots = new Map<string, BotEntry>()

const app = express()
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

const PORT = 3001
createServer(app).listen(PORT, () => {
  log.ok(`Bot dashboard -> http://localhost:${PORT}`)
})
