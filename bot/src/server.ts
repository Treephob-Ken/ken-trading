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
  cancelAssetOrders,
  closePosition,
  executeMarketTrade,
  evictClientCache,
  getAccountState,
  getAssetInfo,
  listAssets,
  parseTradeRequest,
  placeOrder,
} from './trade.js'
import {
  createSignalBot,
  deleteSignalBot,
  getSignalBot,
  listSignalBots,
  listSignalBotTrades,
  maybeAutostartSignalBots,
  parseSignalConfig,
} from './signal-bot.js'
import { generateChartData, STRATEGIES } from './strategy/strategies.js'
import { fetchKlines } from './strategy/market-data.js'
import { MULTI_USER, requireAuth, requireAdmin, signToken, verifyToken } from './auth.js'
import {
  createUser,
  deleteUser,
  findUserById,
  findUserByEmail,
  listUsers,
  loadUserCreds,
  saveHLCredentials,
  userCount,
  verifyPassword,
} from './users.js'
import { runMigrationIfNeeded } from './migrate.js'


const __dirname = dirname(fileURLToPath(import.meta.url))
const DASHBOARD_PATH = join(__dirname, '..', 'dashboard', 'index.html')

// ─── Grid bot manager ─────────────────────────────────────────────────────────

interface BotEntry {
  id: string
  bot: GridBot
  running: boolean
}

// Outer key = userId (or '__single__' in single-tenant mode).
const gridBots = new Map<string, Map<string, BotEntry>>()

function gridBotsForUser(uid?: string): Map<string, BotEntry> {
  const key = uid ?? '__single__'
  let m = gridBots.get(key)
  if (!m) { m = new Map(); gridBots.set(key, m) }
  return m
}

// ─── Express setup ────────────────────────────────────────────────────────────

const app = express()

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

// Static BOT_API_TOKEN gate — only in single-tenant mode.
// Multi-user uses JWT requireAuth middleware on each route instead.
const API_TOKEN = process.env.BOT_API_TOKEN?.trim()
if (API_TOKEN && !MULTI_USER) {
  app.use('/api', (req, res, next) => {
    if (req.method === 'OPTIONS') { next(); return }
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

// ─── SSE log stream ───────────────────────────────────────────────────────────

const sseClients = new Set<Response>()
onLog((line) => {
  const data = `data: ${JSON.stringify(line)}\n\n`
  for (const res of sseClients) res.write(data)
})

// ─── Static dashboard ─────────────────────────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(DASHBOARD_PATH)
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Extract the userId from the request in multi-user mode.
function userId(req: Request): string | undefined {
  return MULTI_USER ? req.user?.sub : undefined
}

// Load the requesting user's HL credentials (multi-user) or undefined (single-tenant).
function userCreds(req: Request) {
  if (!MULTI_USER) return undefined
  const uid = req.user?.sub
  if (!uid) return undefined
  try { return loadUserCreds(uid) } catch { return undefined }
}

// ─── Auth routes ──────────────────────────────────────────────────────────────

const OWNER_EMAIL = (process.env.OWNER_EMAIL ?? '').trim().toLowerCase()
// Comma-separated email whitelist. When set, only these emails may register.
// Leave blank to allow anyone to register (original behaviour).
const ALLOWED_EMAILS: Set<string> = new Set(
  (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
)

app.post('/auth/register', (req: Request, res: Response) => {
  if (!MULTI_USER) { res.status(404).json({ error: 'Multi-user mode is not enabled' }); return }
  const { email, password } = (req.body ?? {}) as Record<string, unknown>
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required' }); return
  }
  if ((password as string).length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' }); return
  }
  // Whitelist check — if ALLOWED_EMAILS is set, reject anyone not on the list
  if (ALLOWED_EMAILS.size > 0 && !ALLOWED_EMAILS.has((email as string).trim().toLowerCase())) {
    res.status(403).json({ error: 'Registration is invite-only. Contact the admin to get access.' }); return
  }
  try {
    if (findUserByEmail(email)) { res.status(409).json({ error: 'Email already registered' }); return }
    const isFirstUser = userCount() === 0
    const isOwnerEmail = OWNER_EMAIL && (email as string).trim().toLowerCase() === OWNER_EMAIL
    const isAdmin = isFirstUser || !!isOwnerEmail
    const user = createUser(email as string, password as string, isAdmin)
    // First admin: migrate legacy single-tenant data and resume any persisted bots.
    if (isFirstUser && isAdmin) {
      runMigrationIfNeeded(user.id)
      void maybeAutostartSignalBots(user.id, () => {
        try { return loadUserCreds(user.id) } catch { return null }
      })
    }
    const token = signToken(user)
    res.json({ token, user: { id: user.id, email: user.email, isAdmin: user.isAdmin } })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/auth/login', (req: Request, res: Response) => {
  if (!MULTI_USER) { res.status(404).json({ error: 'Multi-user mode is not enabled' }); return }
  const { email, password } = (req.body ?? {}) as Record<string, unknown>
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required' }); return
  }
  const row = verifyPassword(email as string, password as string)
  if (!row) { res.status(401).json({ error: 'Invalid email or password' }); return }
  const user = { id: row.id, email: row.email, isAdmin: row.is_admin !== 0 }
  res.json({ token: signToken(user), user })
})

app.get('/auth/me', requireAuth, (req: Request, res: Response) => {
  if (!MULTI_USER) { res.status(404).json({ error: 'Multi-user mode is not enabled' }); return }
  res.json(req.user)
})

// ─── User settings ────────────────────────────────────────────────────────────

app.put('/settings/credentials', requireAuth, (req: Request, res: Response) => {
  if (!MULTI_USER) { res.status(404).json({ error: 'Multi-user mode is not enabled' }); return }
  const uid = req.user!.sub
  const b = (req.body ?? {}) as Record<string, unknown>
  const agentKey = typeof b.agentKey === 'string' ? (b.agentKey as string).trim() : ''
  const hlUser = typeof b.hlUser === 'string' ? (b.hlUser as string).trim() : ''
  const network = b.network === 'testnet' ? 'testnet' as const : 'mainnet' as const
  try {
    saveHLCredentials(uid, agentKey, hlUser, network)
    evictClientCache(hlUser)
    // Push fresh credentials to any signal bots already running for this user.
    const newCreds = (() => { try { return loadUserCreds(uid) } catch { return null } })()
    if (newCreds) {
      for (const sum of listSignalBots(uid)) {
        try { getSignalBot(sum.id, uid).updateCreds(newCreds) } catch { /* best effort */ }
      }
    }
    log.ok(`User ${req.user!.email} updated HL credentials`)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.get('/settings/credentials', requireAuth, (req: Request, res: Response) => {
  if (!MULTI_USER) { res.status(404).json({ error: 'Multi-user mode is not enabled' }); return }
  const user = findUserById(req.user!.sub)
  if (!user) { res.status(404).json({ error: 'User not found' }); return }
  res.json({ hlUser: user.hlUser, hlNetwork: user.hlNetwork, hlConfigured: user.hlConfigured })
})

// ─── Admin routes ─────────────────────────────────────────────────────────────

app.get('/admin/users', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  res.json(listUsers())
})

app.delete('/admin/users/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const id = req.params.id
  if (req.user?.sub === id) { res.status(400).json({ error: 'Cannot delete your own account' }); return }
  deleteUser(id)
  log.ok(`Admin deleted user ${id}`)
  res.json({ ok: true })
})

app.post('/admin/users/:id/kill-bots', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const targetUserId = req.params.id
  const map = gridBotsForUser(targetUserId)
  for (const entry of map.values()) {
    if (entry.running) {
      try { await entry.bot.shutdown() } catch { /* best effort */ }
      entry.running = false
    }
  }
  map.clear()
  for (const sum of listSignalBots(targetUserId)) {
    try { getSignalBot(sum.id, targetUserId).stop() } catch { /* best effort */ }
  }
  log.warn(`Admin killed all bots for user ${targetUserId}`)
  res.json({ ok: true })
})

// ─── Grid bot list / CRUD ─────────────────────────────────────────────────────

app.get('/api/bots', requireAuth, (req: Request, res: Response) => {
  const uid = userId(req)
  const map = gridBotsForUser(uid)
  const all = listConfigs(uid).map((cfg) => ({
    id: cfg.id!,
    name: cfg.name ?? cfg.asset,
    asset: cfg.asset,
    gridCount: cfg.gridCount,
    lower: cfg.lower,
    upper: cfg.upper,
    running: map.get(cfg.id!)?.running ?? false,
  }))
  res.json(all)
})

app.get('/api/bots/:id/config', requireAuth, (req: Request, res: Response) => {
  try {
    res.json(loadConfig(req.params.id, userId(req)))
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

app.put('/api/bots/:id/config', requireAuth, (req: Request, res: Response) => {
  const existingId = req.params.id
  const uid = userId(req)
  if (gridBotsForUser(uid).get(existingId)?.running) {
    res.status(400).json({ error: 'Stop the bot before changing its config.' }); return
  }
  try {
    const cfg = req.body as GridConfig
    cfg.id = cfg.id ?? existingId
    const saved = saveConfig(cfg, existingId, uid)
    log.ok(`Config saved: ${saved.id} (${saved.asset} ${saved.lower}-${saved.upper})`)
    res.json(saved)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.post('/api/bots', requireAuth, (req: Request, res: Response) => {
  try {
    const cfg = req.body as GridConfig
    const saved = saveConfig(cfg, undefined, userId(req))
    log.ok(`Bot created: ${saved.id}`)
    res.json(saved)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.delete('/api/bots/:id', requireAuth, (req: Request, res: Response) => {
  const id = req.params.id
  const uid = userId(req)
  if (gridBotsForUser(uid).get(id)?.running) {
    res.status(400).json({ error: 'Stop the bot before deleting it.' }); return
  }
  gridBotsForUser(uid).delete(id)
  deleteConfig(id, uid)
  clearLogBuffer(id)
  log.ok(`Bot deleted: ${id}`)
  res.json({ ok: true })
})

// ─── Grid bot lifecycle ───────────────────────────────────────────────────────

app.post('/api/bots/:id/start', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id
  const uid = userId(req)
  const map = gridBotsForUser(uid)
  if (map.get(id)?.running) { res.json({ ok: true }); return }
  try {
    const creds = MULTI_USER && uid ? loadUserCreds(uid) : loadEnv()
    const cfg = loadConfig(id, uid)
    const clients = createClients(creds)
    const logger = createLogger(id)
    const bot = new GridBot(clients, cfg, logger)
    map.set(id, { id, bot, running: true })
    res.json({ ok: true })
    bot.start().catch((e: unknown) => {
      logger.err(`Bot crashed: ${(e as Error).message}`)
      const entry = map.get(id)
      if (entry) entry.running = false
    })
  } catch (e) {
    gridBotsForUser(uid).delete(id)
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/bots/:id/stop', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id
  const uid = userId(req)
  const map = gridBotsForUser(uid)
  const entry = map.get(id)
  if (!entry) { res.json({ ok: true }); return }
  try {
    await entry.bot.shutdown()
  } catch (e) {
    log.err(`Shutdown error for ${id}: ${(e as Error).message}`)
  } finally {
    entry.running = false
    map.delete(id)
  }
  res.json({ ok: true })
})

app.get('/api/bots/:id/stats', requireAuth, (req: Request, res: Response) => {
  const id = req.params.id
  const entry = gridBotsForUser(userId(req)).get(id)
  if (!entry || !entry.running) { res.json({ running: false }); return }
  try {
    res.json({ running: true, stats: entry.bot.getStats() })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/bots/:id/logs', requireAuth, (req: Request, res: Response) => {
  res.json(getLogBuffer(req.params.id))
})

// ─── Global log stream ────────────────────────────────────────────────────────

// EventSource can't send headers, so token goes in ?token= query param.
app.get('/api/logs/stream', (req: Request, res: Response) => {
  if (MULTI_USER) {
    const qToken = typeof req.query.token === 'string' ? req.query.token.trim() : ''
    if (!qToken) { res.status(401).end(); return }
    try {
      req.user = verifyToken(qToken)
    } catch {
      res.status(401).end()
      return
    }
  } else if (API_TOKEN) {
    const qToken = typeof req.query.token === 'string' ? req.query.token : ''
    if (qToken !== API_TOKEN) { res.status(401).end(); return }
  }
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

// ─── Direct trade ─────────────────────────────────────────────────────────────

app.get('/api/account', requireAuth, async (req: Request, res: Response) => {
  try {
    const asset = typeof req.query.asset === 'string' ? req.query.asset : undefined
    res.json(await getAccountState(asset, userCreds(req)))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/trade', requireAuth, async (req: Request, res: Response) => {
  let parsed
  try {
    parsed = parseTradeRequest(req.body)
  } catch (e) {
    res.status(400).json({ error: (e as Error).message }); return
  }
  try {
    const result = await executeMarketTrade(parsed, userCreds(req))
    res.json({ ...result, msg: result.message })
  } catch (e) {
    log.err(`API Trade failed: ${(e as Error).message}`)
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/order', requireAuth, async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const asset = typeof b.asset === 'string' ? (b.asset as string).trim().toUpperCase() : ''
  const side = b.side === 'buy' || b.side === 'sell' ? b.side : null
  const sizeRaw = typeof b.size === 'string' ? Number(b.size) : b.size
  const size = typeof sizeRaw === 'number' && sizeRaw > 0 ? sizeRaw : null
  const orderType: 'market' | 'limit' = b.orderType === 'limit' ? 'limit' : 'market'
  if (!asset || !side || !size) {
    res.status(400).json({ error: 'asset, side (buy|sell), and size are required' }); return
  }
  const num = (k: string) => { const v = b[k]; const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && n > 0 ? n : undefined }
  try {
    const result = await placeOrder({
      asset, side, size, orderType,
      limitPrice: num('limitPrice'),
      reduceOnly: Boolean(b.reduceOnly),
      tpPrice: num('tpPrice'),
      slPrice: num('slPrice'),
      tpPct: num('tpPct'),
      slPct: num('slPct'),
      maxSlippagePct: num('maxSlippagePct'),
    }, userCreds(req))
    res.json(result)
  } catch (e) {
    log.err(`Order failed: ${(e as Error).message}`)
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/close', requireAuth, async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const asset = typeof b.asset === 'string' ? (b.asset as string).trim().toUpperCase() : ''
  if (!asset) { res.status(400).json({ error: 'asset is required' }); return }
  const slip = (() => { const v = b.maxSlippagePct; const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && n > 0 ? n : undefined })()
  try {
    const cancelled = await cancelAssetOrders(asset, userCreds(req))
    if (cancelled > 0) log.info(`Cancelled ${cancelled} order(s) before closing ${asset}`)
    const result = await closePosition(asset, slip, userCreds(req))
    if (!result) { res.json({ ok: true, filled: false, message: 'No open position to close' }); return }
    res.json(result)
  } catch (e) {
    log.err(`Close position failed: ${(e as Error).message}`)
    res.status(500).json({ error: (e as Error).message })
  }
})

// ─── Signal bots ──────────────────────────────────────────────────────────────

app.get('/api/strategies', (_req: Request, res: Response) => {
  res.json(STRATEGIES)
})

app.get('/api/assets', requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await listAssets(userCreds(req)))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/asset-info', requireAuth, async (req: Request, res: Response) => {
  const asset = typeof req.query.asset === 'string' ? req.query.asset.trim().toUpperCase() : ''
  if (!asset) { res.status(400).json({ error: 'asset query param required' }); return }
  try {
    res.json(await getAssetInfo(asset, userCreds(req)))
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

app.get('/api/signal/bots', requireAuth, (req: Request, res: Response) => {
  res.json(listSignalBots(userId(req)))
})

app.post('/api/signal/bots', requireAuth, (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { name?: string; config?: unknown }
    const cfg = parseSignalConfig(body.config ?? req.body)
    const uid = userId(req)
    const creds = MULTI_USER && uid ? (() => { try { return loadUserCreds(uid) } catch { return null } })() : null
    const bot = createSignalBot(typeof body.name === 'string' ? body.name : '', cfg, uid, creds)
    log.ok(`Signal bot created: ${bot.id}`)
    res.json(bot.getStatus())
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.get('/api/signal/bots/:id', requireAuth, (req: Request, res: Response) => {
  try {
    res.json(getSignalBot(req.params.id, userId(req)).getStatus())
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

app.put('/api/signal/bots/:id', requireAuth, (req: Request, res: Response) => {
  let bot
  try {
    bot = getSignalBot(req.params.id, userId(req))
  } catch (e) {
    res.status(404).json({ error: (e as Error).message }); return
  }
  try {
    const body = (req.body ?? {}) as { name?: string; config?: unknown }
    if (typeof body.name === 'string') bot.rename(body.name)
    bot.setConfig(parseSignalConfig(body.config ?? req.body))
    res.json(bot.getStatus())
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.delete('/api/signal/bots/:id', requireAuth, (req: Request, res: Response) => {
  try {
    deleteSignalBot(req.params.id, userId(req))
    log.ok(`Signal bot deleted: ${req.params.id}`)
    res.json({ ok: true })
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

app.post('/api/signal/bots/:id/start', requireAuth, (req: Request, res: Response) => {
  try {
    const bot = getSignalBot(req.params.id, userId(req))
    bot.start()
    res.json(bot.getStatus())
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.post('/api/signal/bots/:id/stop', requireAuth, (req: Request, res: Response) => {
  try {
    const bot = getSignalBot(req.params.id, userId(req))
    bot.stop()
    res.json(bot.getStatus())
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

app.get('/api/signal/bots/:id/logs', requireAuth, (req: Request, res: Response) => {
  res.json(getLogBuffer('signal-' + req.params.id))
})

app.get('/api/signal/bots/:id/trades', requireAuth, (req: Request, res: Response) => {
  try {
    res.json(listSignalBotTrades(req.params.id, userId(req)))
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

app.get('/api/signal/bots/:id/chart-data', requireAuth, async (req: Request, res: Response) => {
  try {
    const bot = getSignalBot(req.params.id, userId(req))
    const status = bot.getStatus()
    const cfg = status.config as {
      asset?: string; symbol?: string; timeframe?: string
      strategyId?: string; strategy?: string; params?: Record<string, number>
    }
    const asset = (cfg.asset || (cfg.symbol ?? '').replace(/USDT$/i, '') || 'ETH').toUpperCase()
    const sym = asset + 'USDT'
    const tf = cfg.timeframe || '1h'
    const stratId = (cfg.strategyId ?? cfg.strategy) as Parameters<typeof generateChartData>[0] | undefined
    const params = (cfg.params ?? {}) as Record<string, number>
    const limit = Math.min(Number(req.query.limit) || 500, 1000)
    const candles = await fetchKlines(sym, tf, limit)
    const chartData = stratId ? generateChartData(stratId, candles, params) : { mainLines: [] }
    res.json({
      candles: candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })),
      ...chartData,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ─── Startup ──────────────────────────────────────────────────────────────────

const PORT = 3001

createServer(app).listen(PORT, () => {
  log.ok(`Bot dashboard -> http://localhost:${PORT}`)

  if (MULTI_USER) {
    log.ok('Multi-user mode ENABLED')
    const users = listUsers()
    const owner = users.find((u) => u.isAdmin)
    if (owner) {
      runMigrationIfNeeded(owner.id)
      for (const u of users) {
        maybeAutostartSignalBots(u.id, () => {
          try { return loadUserCreds(u.id) } catch { return null }
        })
      }
    } else {
      log.info('No users yet — register at /auth/register to get started')
    }
  } else {
    maybeAutostartSignalBots()
  }
})
