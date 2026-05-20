import express, { type Request, type Response } from 'express'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, loadGridConfig, type GridConfig } from './config.js'
import { GridBot } from './grid-bot.js'
import { createClients } from './hyperliquid.js'
import { getLogBuffer, log, onLog } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dirname, '..', 'grid.config.json')
const DASHBOARD_PATH = join(__dirname, '..', 'dashboard', 'index.html')

const app = express()
app.use(express.json())

let bot: GridBot | null = null
let botRunning = false
const sseClients = new Set<Response>()

// Broadcast every log line to all SSE clients
onLog((line) => {
  const data = `data: ${JSON.stringify(line)}\n\n`
  for (const res of sseClients) res.write(data)
})

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(DASHBOARD_PATH)
})

app.get('/api/config', (_req: Request, res: Response) => {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as GridConfig
  res.json(cfg)
})

app.post('/api/config', (req: Request, res: Response) => {
  if (botRunning) {
    res.status(400).json({ error: 'Stop the bot before changing config.' })
    return
  }
  const cfg = req.body as GridConfig
  if (!cfg.asset || !cfg.lower || !cfg.upper || !cfg.gridCount || !cfg.orderSize) {
    res.status(400).json({ error: 'Invalid config — missing required fields.' })
    return
  }
  if (cfg.upper <= cfg.lower) {
    res.status(400).json({ error: 'upper must be greater than lower.' })
    return
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
  log.ok(`Config updated: ${cfg.asset} [${cfg.lower}, ${cfg.upper}] x${cfg.gridCount}`)
  res.json({ ok: true })
})

app.get('/api/status', (_req: Request, res: Response) => {
  res.json({ running: botRunning, logs: getLogBuffer() })
})

app.post('/api/start', async (_req: Request, res: Response) => {
  if (botRunning) {
    res.json({ ok: true })
    return
  }
  try {
    const env = loadEnv()
    const cfg = loadGridConfig()
    const clients = createClients(env)
    bot = new GridBot(clients, cfg)
    botRunning = true
    res.json({ ok: true })
    // start is async and long-running; errors after response are logged
    bot.start().catch((e: unknown) => {
      log.err(`Bot crashed: ${(e as Error).message}`)
      botRunning = false
      bot = null
    })
  } catch (e) {
    botRunning = false
    bot = null
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/stop', async (_req: Request, res: Response) => {
  if (!bot) {
    botRunning = false
    res.json({ ok: true })
    return
  }
  try {
    await bot.shutdown()
  } catch (e) {
    log.err(`Shutdown error: ${(e as Error).message}`)
  } finally {
    bot = null
    botRunning = false
  }
  res.json({ ok: true })
})

// SSE endpoint — streams log lines to the dashboard
app.get('/api/logs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  sseClients.add(res)

  // Send buffered history on connect
  for (const line of getLogBuffer()) {
    res.write(`data: ${JSON.stringify(line)}\n\n`)
  }

  req.on('close', () => sseClients.delete(res))
})

const PORT = 3001
createServer(app).listen(PORT, () => {
  log.ok(`Bot dashboard → http://localhost:${PORT}`)
})
