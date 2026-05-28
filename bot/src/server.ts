import express, { type Request, type Response } from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deleteConfig,
  listConfigs,
  loadConfig,
  loadConfigUnsafe,
  loadEnv,
  saveConfig,
  type EnvConfig,
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
  getPositionBrackets,
  listAssets,
  parseTradeRequest,
  placeOrder,
  setAssetLeverage,
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
  getKillSwitchConfig,
  listUsers,
  loadUserCreds,
  saveHLCredentials,
  setKillSwitchConfig,
  userCount,
  validateAgentKeyFormat,
  validateHLUserFormat,
  verifyAgentOnHL,
  verifyPassword,
} from './users.js'
import {
  getKillSwitchStatus,
  isTripped,
  resetForNetworkChange as resetKillSwitchForNetworkChange,
  startKillSwitchWatcher,
  unlock as unlockKillSwitch,
} from './kill-switch.js'
import { runMigrationIfNeeded } from './migrate.js'
import { fundamentalsRouter } from './fundamentals.js'
import {
  buildAssetSourceMap,
  fetchFillsFromHL,
  loadAuditLines,
  pairRoundTrips,
  rangeToBounds,
  summarize,
} from './journal.js'
import { listPausedGridBotIds, listRunningGridBotIds, readGridRuntime, writeGridRuntime } from './grid-runtime.js'
import { isNotifyEnabled, startFillNotifier } from './notify.js'


const __dirname = dirname(fileURLToPath(import.meta.url))
const DASHBOARD_PATH = join(__dirname, '..', 'dashboard', 'index.html')
// React SPA build output (npm run build from repo root)
const PUBLIC_DIR = join(__dirname, '..', 'public')

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

// Restart any grid bots that were running before the process died. Reads the
// runtime sidecar files written by /api/bots/:id/start + /stop, then for each
// bot marked running:true, instantiates a GridBot and calls start({reconcile:
// true}) — which ADOPTS the existing resting orders on Hyperliquid instead of
// canceling them. Safe no-op when no runtime files exist (e.g., very first
// boot or fresh user).
function maybeAutostartGridBots(uid?: string, credsProvider?: () => EnvConfig | null): void {
  const ids = listRunningGridBotIds(uid)
  if (ids.length === 0) return
  const creds = credsProvider ? credsProvider() : (MULTI_USER && uid ? null : loadEnv())
  if (!creds) {
    log.warn(`Cannot autostart grid bots for user ${uid ?? 'single'}: no Hyperliquid credentials.`)
    return
  }
  for (const id of ids) {
    try {
      const cfg = loadConfig(id, uid)
      const map = gridBotsForUser(uid)
      if (map.get(id)?.running) continue   // already resumed via another path
      const clients = createClients(creds)
      const logger = createLogger(id)
      const bot = new GridBot(clients, cfg, logger)
      map.set(id, { id, bot, running: true })
      logger.info('Resuming from saved running state (reconcile mode)')
      bot.start({ reconcile: true }).catch((e: unknown) => {
        logger.err(`Autostart failed: ${(e as Error).message}`)
        const entry = map.get(id)
        if (entry) entry.running = false
        writeGridRuntime(uid, id, false)
      })
    } catch (e) {
      log.err(`Could not autostart grid bot ${id}: ${(e as Error).message}`)
    }
  }
}

// ─── Kill switch wiring ───────────────────────────────────────────────────────

// Stop every running bot for `uid`, cancel all open orders for assets they
// trade, and close every open position at market. Used by the kill switch
// when account drawdown trips the threshold.
async function stopEverythingAndClose(uid: string, creds: EnvConfig): Promise<void> {
  // 1) Stop grid bots
  const gMap = gridBotsForUser(uid)
  for (const entry of gMap.values()) {
    if (entry.running) {
      try { await entry.bot.shutdown() } catch (e) { log.err(`Kill switch: grid shutdown failed for ${entry.id}: ${(e as Error).message}`) }
      entry.running = false
      writeGridRuntime(uid, entry.id, false)
    }
  }
  // 2) Stop signal bots
  for (const sum of listSignalBots(uid)) {
    try { getSignalBot(sum.id, uid).stop() } catch { /* best effort */ }
  }
  // 3) Cancel all orders and close all positions
  try {
    const acct = await getAccountState(undefined, creds)
    for (const pos of acct.allPositions) {
      try {
        await cancelAssetOrders(pos.asset, creds)
        await closePosition(pos.asset, undefined, creds)
        log.warn(`Kill switch: closed ${pos.side} ${pos.size} ${pos.asset}`)
      } catch (e) {
        log.err(`Kill switch: close ${pos.asset} failed: ${(e as Error).message}`)
      }
    }
  } catch (e) {
    log.err(`Kill switch: could not fetch positions: ${(e as Error).message}`)
  }
}

function armKillSwitchForUser(uid: string): void {
  startKillSwitchWatcher(uid, {
    stopEverythingAndClose,
    credsProvider: () => { try { return loadUserCreds(uid) } catch { return null } },
  })
}

// ─── Express setup ────────────────────────────────────────────────────────────

const app = express()

// Trust the immediate proxy (cloudflared on localhost) so req.ip reflects the
// real client IP rather than 127.0.0.1. Required for rate limiters keyed by IP.
app.set('trust proxy', 1)

// Security headers — defaults from helmet + a CSP tuned for this app's external
// dependencies. Tweak directives carefully: a too-tight CSP silently breaks
// fetches in the browser.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Tailwind ships a single compiled CSS file but components occasionally
        // inline style attrs for dynamic widths (StatTile bars, etc.).
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        // Whitelist every endpoint the SPA fetches from. Adding a new data
        // source? Add it here or the browser will block it silently.
        connectSrc: [
          "'self'",
          'https://api.hyperliquid.xyz',
          'https://api.hyperliquid-testnet.xyz',
          'wss://api.hyperliquid.xyz',
          'wss://api.hyperliquid-testnet.xyz',
          'https://data-api.binance.vision',
          'wss://data-stream.binance.vision',
        ],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // Loosen these two so LW Charts / inline canvases work without trouble.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
)

// Per-IP brute-force gate on auth endpoints. 10 attempts per 15-min sliding
// window — enough for a forgetful human, far too few for a credential-stuffer.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again in 15 minutes.' },
})

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

// ─── Fundamentals (sentiment + valuation + regime + verdict) ──────────────────
app.use('/api/fundamentals', fundamentalsRouter)

// ─── React SPA (static files) ─────────────────────────────────────────────────
// Serves the Vite build output (react app) before any API routes.
// express.static silently skips this middleware if PUBLIC_DIR doesn't exist yet.
app.use(express.static(PUBLIC_DIR))

// ─── SSE log stream ───────────────────────────────────────────────────────────

const sseClients = new Set<Response>()
onLog((line) => {
  const data = `data: ${JSON.stringify(line)}\n\n`
  for (const res of sseClients) res.write(data)
})

// ─── Legacy dashboard (fallback access while React SPA is being built out) ────

app.get('/legacy', (_req: Request, res: Response) => {
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

app.post('/auth/register', authLimiter, (req: Request, res: Response) => {
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
      const credsFn = () => { try { return loadUserCreds(user.id) } catch { return null } }
      void maybeAutostartSignalBots(user.id, credsFn)
      maybeAutostartGridBots(user.id, credsFn)
    }
    armKillSwitchForUser(user.id)
    const token = signToken(user)
    res.json({ token, user: { id: user.id, email: user.email, isAdmin: user.isAdmin } })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/auth/login', authLimiter, (req: Request, res: Response) => {
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

app.put('/settings/credentials', requireAuth, async (req: Request, res: Response) => {
  if (!MULTI_USER) { res.status(404).json({ error: 'Multi-user mode is not enabled' }); return }
  const uid = req.user!.sub
  const b = (req.body ?? {}) as Record<string, unknown>
  const agentKeyRaw = typeof b.agentKey === 'string' ? (b.agentKey as string) : ''
  const hlUserRaw = typeof b.hlUser === 'string' ? (b.hlUser as string) : ''
  const network = b.network === 'testnet' ? 'testnet' as const : 'mainnet' as const
  // Opt-out flag — admin can set to "skip" if HL is unreachable during a
  // recovery scenario. Default behaviour validates live.
  const skipHLCheck = b.skipHLCheck === true

  try {
    // 1) Format checks first — cheap, no network, catches typos and partial pastes immediately.
    const hlUser = validateHLUserFormat(hlUserRaw)
    let derivedAgent: `0x${string}` | null = null
    if (agentKeyRaw.trim()) {
      derivedAgent = validateAgentKeyFormat(agentKeyRaw).address
    }

    // 2) Live HL check — confirms the agent is actually approved before we touch the DB.
    // Only when a new key was provided. Address-only / network-only updates skip it
    // since the existing encrypted key is preserved.
    if (derivedAgent && !skipHLCheck) {
      const verify = await verifyAgentOnHL(derivedAgent, hlUser, network)
      if (!verify.ok) {
        res.status(400).json({ error: verify.reason, derivedAgent })
        return
      }
    }

    // 3) Persist + propagate to running bots.
    // Detect network change BEFORE writing so we can reset network-tagged state.
    const prevUser = findUserById(uid)
    const networkChanged = !!prevUser && prevUser.hlNetwork !== network
    // Switching INTO mainnet exposes real money — pause every running bot
    // (stop + mark) so they don't silently start trading the new network with
    // state captured on the old one. The marker lets us auto-resume them on
    // the next switch BACK to testnet for a smooth round-trip.
    const switchingToMainnet = networkChanged && network === 'mainnet'
    const switchingToTestnet = networkChanged && network === 'testnet'
    let pausedSignalCount = 0
    let pausedGridCount = 0
    let resumedSignalCount = 0
    let resumedGridCount = 0
    if (switchingToMainnet) {
      for (const sum of listSignalBots(uid)) {
        try {
          if (sum.running) {
            if (getSignalBot(sum.id, uid).pauseForNetworkSwitch()) pausedSignalCount++
          }
        } catch { /* best effort */ }
      }
      const gMap = gridBotsForUser(uid)
      for (const entry of gMap.values()) {
        if (entry.running) {
          try { await entry.bot.shutdown() } catch (e) {
            log.err(`Network switch: grid shutdown failed for ${entry.id}: ${(e as Error).message}`)
          }
          entry.running = false
          writeGridRuntime(uid, entry.id, false, true)
          pausedGridCount++
        }
      }
    }
    saveHLCredentials(uid, agentKeyRaw, hlUser, network)
    evictClientCache(hlUser)
    const newCreds = (() => { try { return loadUserCreds(uid) } catch { return null } })()
    if (newCreds) {
      // First-time creds save → start the Telegram fill notifier for this user.
      // Idempotent: per-address dedupe inside notify.ts prevents double-subs.
      void startFillNotifier(newCreds)
      for (const sum of listSignalBots(uid)) {
        try {
          const bot = getSignalBot(sum.id, uid)
          bot.updateCreds(newCreds)
          // Account values (kill-switch snapshot, daily-PnL baseline) are
          // network-specific. Drop them so the bot re-snapshots on the new
          // network instead of comparing testnet equity against mainnet.
          if (networkChanged) bot.resetDailyBaseline()
        } catch { /* best effort */ }
      }
    }
    if (networkChanged) {
      resetKillSwitchForNetworkChange(uid, network)
    }
    // Switching BACK to testnet auto-resumes anything that was paused for the
    // mainnet trip — signal bots check their own marker; grid bots check the
    // runtime sidecar. Start grids with reconcile=true so existing HL orders
    // are adopted instead of cancelled and re-placed.
    if (switchingToTestnet && newCreds) {
      for (const sum of listSignalBots(uid)) {
        try {
          const bot = getSignalBot(sum.id, uid)
          if (bot.isPausedForNetworkSwitch()) {
            bot.start()
            resumedSignalCount++
          }
        } catch { /* best effort */ }
      }
      for (const id of listPausedGridBotIds(uid)) {
        try {
          const cfg = loadConfig(id, uid)
          const clients = createClients(newCreds)
          const logger = createLogger(id)
          const bot = new GridBot(clients, cfg, logger)
          const map = gridBotsForUser(uid)
          map.set(id, { id, bot, running: true })
          writeGridRuntime(uid, id, true, false)
          bot.start({ reconcile: true }).catch((e: unknown) => {
            logger.err(`Bot crashed during auto-resume: ${(e as Error).message}`)
            const entry = map.get(id)
            if (entry) entry.running = false
            writeGridRuntime(uid, id, false, false)
          })
          resumedGridCount++
        } catch (e) {
          log.err(`Network switch: grid auto-resume failed for ${id}: ${(e as Error).message}`)
        }
      }
    }
    const switchNote = networkChanged
      ? ` — network changed to ${network}, account-value baselines reset` +
        (switchingToMainnet
          ? `, paused ${pausedSignalCount} signal + ${pausedGridCount} grid bot(s) for safety`
          : switchingToTestnet
            ? `, auto-resumed ${resumedSignalCount} signal + ${resumedGridCount} grid bot(s) from previous testnet session`
            : '')
      : ''
    log.ok(`User ${req.user!.email} updated HL credentials${derivedAgent ? ` (agent ${derivedAgent.slice(0, 10)}…)` : ' (address/network only)'}${switchNote}`)
    res.json({
      ok: true,
      derivedAgent,
      networkChanged,
      pausedForMainnet: switchingToMainnet
        ? { signalBots: pausedSignalCount, gridBots: pausedGridCount }
        : null,
      resumedOnTestnet: switchingToTestnet
        ? { signalBots: resumedSignalCount, gridBots: resumedGridCount }
        : null,
    })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

// ─── Kill switch ──────────────────────────────────────────────────────────────

app.get('/api/killswitch', requireAuth, (req: Request, res: Response) => {
  if (!MULTI_USER) { res.status(404).json({ error: 'Kill switch requires multi-user mode' }); return }
  const creds = (() => { try { return loadUserCreds(req.user!.sub) } catch { return null } })()
  const net = creds ? (creds.isTestnet ? 'testnet' : 'mainnet') : undefined
  res.json(getKillSwitchStatus(req.user!.sub, net))
})

app.put('/api/killswitch/config', requireAuth, (req: Request, res: Response) => {
  if (!MULTI_USER) { res.status(404).json({ error: 'Kill switch requires multi-user mode' }); return }
  const b = (req.body ?? {}) as Record<string, unknown>
  const enabled = b.enabled === true
  const pctRaw = typeof b.pct === 'string' ? Number(b.pct) : b.pct
  const pct = typeof pctRaw === 'number' && Number.isFinite(pctRaw) ? pctRaw : 15
  try {
    setKillSwitchConfig(req.user!.sub, enabled, pct)
    if (enabled) armKillSwitchForUser(req.user!.sub)
    const creds = (() => { try { return loadUserCreds(req.user!.sub) } catch { return null } })()
    const net = creds ? (creds.isTestnet ? 'testnet' : 'mainnet') : undefined
    res.json(getKillSwitchStatus(req.user!.sub, net))
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.post('/api/killswitch/unlock', requireAuth, async (req: Request, res: Response) => {
  if (!MULTI_USER) { res.status(404).json({ error: 'Kill switch requires multi-user mode' }); return }
  const uid = req.user!.sub
  const creds = (() => { try { return loadUserCreds(uid) } catch { return null } })()
  try {
    const state = await unlockKillSwitch(uid, creds)
    res.json({ config: getKillSwitchConfig(uid), state })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
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
  const all = listConfigs(uid).map((cfg) => {
    const runtime = readGridRuntime(uid, cfg.id!)
    return {
      id: cfg.id!,
      name: cfg.name ?? cfg.asset,
      asset: cfg.asset,
      gridCount: cfg.gridCount,
      lower: cfg.lower,
      upper: cfg.upper,
      running: map.get(cfg.id!)?.running ?? false,
      pausedForNetworkSwitch: runtime?.pausedForNetworkSwitch ?? false,
    }
  })
  res.json(all)
})

app.get('/api/bots/:id/config', requireAuth, (req: Request, res: Response) => {
  try {
    // Use the unsafe variant so a corrupted config (missing/invalid lower or
    // upper) still loads into the form and the user can fix it. The strict
    // loadConfig is still used by /start and /save so a bad config can't be
    // run, just edited.
    res.json(loadConfigUnsafe(req.params.id, userId(req)))
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
  if (MULTI_USER && uid && isTripped(uid)) {
    res.status(423).json({ error: 'Kill switch tripped — unlock in Settings before starting bots' }); return
  }
  const map = gridBotsForUser(uid)
  if (map.get(id)?.running) { res.json({ ok: true }); return }
  try {
    const creds = MULTI_USER && uid ? loadUserCreds(uid) : loadEnv()
    const cfg = loadConfig(id, uid)

    // Pre-flight balance check. The bot would otherwise "start" but most order
    // placements would fail with "insufficient margin" — the bot still shows
    // running but only a fraction of the grid actually lives. Better to refuse
    // with a clear message and let the user lower investment or fund the account.
    if (cfg.investment && cfg.investment > 0) {
      try {
        const acct = await getAccountState(undefined, creds)
        const leverage = Math.max(1, cfg.leverage ?? 1)
        const requiredMargin = cfg.investment / leverage
        if (acct.accountValue < requiredMargin) {
          const net = creds.isTestnet ? 'testnet' : 'mainnet'
          res.status(400).json({
            error:
              `Insufficient ${net} balance: need ~$${requiredMargin.toFixed(2)} ` +
              `(investment $${cfg.investment} / ${leverage}x leverage) but only ` +
              `$${acct.accountValue.toFixed(2)} available. Lower investment in ` +
              `the config or fund the account before starting.`,
          })
          return
        }
      } catch (e) {
        // If we can't reach HL to check, fall through — don't block on a
        // transient API hiccup. The bot will see the same error on first
        // order attempt and surface it in logs.
        log.warn(`Balance preflight skipped for ${id}: ${(e as Error).message}`)
      }
    }

    const clients = createClients(creds)
    const logger = createLogger(id)
    const bot = new GridBot(clients, cfg, logger)
    map.set(id, { id, bot, running: true })
    writeGridRuntime(uid, id, true, false)
    res.json({ ok: true })
    // Always start in reconcile mode — adopts existing HL orders instead of
    // wiping them and replacing with identical orders. Safe for fresh-start
    // cases too: with no open orders, reconcile is a no-op and we place the
    // full grid as usual.
    bot.start({ reconcile: true }).catch((e: unknown) => {
      logger.err(`Bot crashed: ${(e as Error).message}`)
      const entry = map.get(id)
      if (entry) entry.running = false
      // Crash: don't auto-resume on next boot — user needs to investigate.
      writeGridRuntime(uid, id, false, false)
    })
  } catch (e) {
    gridBotsForUser(uid).delete(id)
    writeGridRuntime(uid, id, false, false)
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
    // User-initiated stop clears any paused-for-network-switch marker — they
    // are consciously taking control, don't auto-resume on next testnet switch.
    writeGridRuntime(uid, id, false, false)
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

// Lightweight network probe — used by the dashboard header badge so every
// page shows mainnet/testnet at a glance. Works in both single-tenant
// (reads HL_NETWORK env) and multi-user mode (per-user saved network).
app.get('/api/network', requireAuth, (req: Request, res: Response) => {
  if (MULTI_USER) {
    const user = req.user?.sub ? findUserById(req.user.sub) : null
    res.json({ network: user?.hlNetwork ?? 'mainnet', configured: !!user?.hlConfigured })
    return
  }
  const env = process.env.HL_NETWORK?.trim().toLowerCase()
  res.json({ network: env === 'mainnet' ? 'mainnet' : 'testnet', configured: !!process.env.HL_AGENT_PRIVATE_KEY })
})

app.get('/api/account', requireAuth, async (req: Request, res: Response) => {
  try {
    const asset = typeof req.query.asset === 'string' ? req.query.asset : undefined
    res.json(await getAccountState(asset, userCreds(req)))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Bracket order lookup for one position — returns SL/TP trigger prices if any
// reduce-only trigger orders are open for this asset.
app.get('/api/positions/:asset/brackets', requireAuth, async (req: Request, res: Response) => {
  const asset = String(req.params.asset || '').trim().toUpperCase()
  const sideRaw = typeof req.query.side === 'string' ? req.query.side : ''
  const side: 'long' | 'short' | null = sideRaw === 'long' || sideRaw === 'short' ? sideRaw : null
  if (!asset) { res.status(400).json({ error: 'asset is required' }); return }
  try {
    res.json(await getPositionBrackets(asset, side, userCreds(req)))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Resolve which bot (if any) owns each open position. Heuristic match by
// configured asset — exact only, no fuzzy. Manual = nothing matches.
//
// Returns { [asset]: SourceInfo[] }. An asset can have multiple sources when
// two bots are configured for the same asset (e.g. signal + grid).
//
// Each source is annotated with `stranded: true` when the bot is stopped
// but an open position exists on the exchange for that asset. When stranded,
// a `position` summary is included so the UI can render a banner with
// Resume / Close actions without a second HL roundtrip.
app.get('/api/positions/sources', requireAuth, async (req: Request, res: Response) => {
  const uid = userId(req)

  interface PositionSummary {
    side: 'long' | 'short'
    size: number
    entryPx: number | null
    unrealizedPnl: number
    markPx: number | null
  }
  interface SourceEntry {
    kind: 'signal' | 'grid'
    botId: string
    botName: string
    running: boolean
    strategyId?: string
    gridCount?: number
    stranded?: boolean
    position?: PositionSummary
  }

  const sources: Record<string, SourceEntry[]> = {}

  // Canonicalize an asset key to match what getAccountState returns for the
  // same position. For HIP-3 the canonical shape is `dex:COIN` (lowercase dex);
  // for crypto it's plain uppercase ticker.
  const canon = (raw: string): string => {
    const s = raw.trim()
    if (s.includes(':')) {
      const i = s.indexOf(':')
      return s.slice(0, i).toLowerCase() + ':' + s.slice(i + 1).toUpperCase()
    }
    return s.replace(/USDT$/i, '').toUpperCase()
  }

  // Signal bots
  for (const sum of listSignalBots(uid)) {
    const asset = canon(sum.symbol)
    if (!asset) continue
    if (!sources[asset]) sources[asset] = []
    sources[asset].push({
      kind: 'signal',
      botId: sum.id,
      botName: sum.name,
      running: sum.running,
      strategyId: sum.strategyId,
    })
  }

  // Grid bots
  const gridMap = gridBotsForUser(uid)
  for (const cfg of listConfigs(uid)) {
    const asset = canon(cfg.asset || '')
    if (!asset) continue
    const entry = gridMap.get(cfg.id || '')
    if (!sources[asset]) sources[asset] = []
    sources[asset].push({
      kind: 'grid',
      botId: cfg.id || '',
      botName: cfg.name || `${asset}-GRID`,
      running: entry?.running ?? false,
      gridCount: cfg.gridCount,
    })
  }

  // Annotate stranded entries with the live position summary. Only fetch HL
  // state when there's at least one stopped bot — otherwise no banner could
  // appear anyway, so the extra roundtrip is wasted.
  const hasStopped = Object.values(sources).some((arr) => arr.some((s) => !s.running))
  if (hasStopped) {
    try {
      const creds = userCreds(req)
      const acct = await getAccountState(undefined, creds)
      const posByAsset = new Map<string, PositionSummary>()
      for (const p of acct.allPositions) {
        posByAsset.set(p.asset.toUpperCase(), {
          side: p.side,
          size: p.size,
          entryPx: p.entryPx,
          unrealizedPnl: p.unrealizedPnl,
          markPx: p.markPx ?? null,
        })
      }
      for (const [asset, arr] of Object.entries(sources)) {
        const pos = posByAsset.get(asset)
        if (!pos) continue
        for (const s of arr) {
          if (!s.running) {
            s.stranded = true
            s.position = pos
          }
        }
      }
    } catch (e) {
      log.warn(`positions/sources: HL state fetch failed (${(e as Error).message}); stranded flags skipped`)
    }
  }

  res.json(sources)
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
    // Manual trades always use the asset's max leverage on HL (cross). This
    // keeps the position-size panel's math accurate (it sizes from maxLev)
    // and prevents accidental low-leverage orders that would otherwise need
    // far more margin than the UI shows. Skipped for reduce-only closes.
    const reduceOnly = Boolean(b.reduceOnly)
    let appliedLeverage: number | null = null
    if (!reduceOnly) {
      const info = await getAssetInfo(asset, userCreds(req))
      const maxLev = info?.maxLeverage
      if (maxLev && maxLev > 0) {
        const lev = await setAssetLeverage(asset, maxLev, true, userCreds(req))
        appliedLeverage = lev.appliedLeverage
      }
    }
    const result = await placeOrder({
      asset, side, size, orderType,
      limitPrice: num('limitPrice'),
      reduceOnly,
      tpPrice: num('tpPrice'),
      slPrice: num('slPrice'),
      tpPct: num('tpPct'),
      slPct: num('slPct'),
      maxSlippagePct: num('maxSlippagePct'),
    }, userCreds(req))
    res.json({ ...result, ...(appliedLeverage ? { appliedLeverage } : {}) })
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
  const raw = typeof req.query.asset === 'string' ? req.query.asset.trim() : ''
  // Preserve colon-prefix dex names; only uppercase plain crypto tickers.
  const asset = raw.includes(':') ? raw : raw.toUpperCase()
  if (!asset) { res.status(400).json({ error: 'asset query param required' }); return }
  try {
    res.json(await getAssetInfo(asset, userCreds(req)))
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

// HIP-3 scanner universe — returns the top-N HIP-3 assets ranked by HL open
// interest. Used by the Scanner's "Stocks & Commodities" tab (HIP-3 markets
// have no Binance volume to rank against). No auth — universe data is public.
app.get('/api/scanner-universe', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
  try {
    const { listAllAssetsWithCtx } = await import('./hyperliquid-hip3.js')
    const { getClients } = await import('./trade.js')
    const { info } = getClients(userCreds(req))
    const all = await listAllAssetsWithCtx(info)
    const hip3 = all
      .filter((a) => a.entry.dex !== null)
      .map((a) => ({
        name: a.entry.name,
        dex: a.entry.dex,
        markPx: a.ctx.markPx,
        openInterest: a.ctx.openInterest,
        dayNtlVlm: a.ctx.dayNtlVlm,
        notionalOI: a.ctx.openInterest * a.ctx.markPx,
      }))
      .sort((a, b) => b.notionalOI - a.notionalOI)
      .slice(0, limit)
    res.json(hip3)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// Public candle proxy — same routing logic the signal bot uses (Binance for
// plain crypto tickers, Hyperliquid candleSnapshot for HIP-3 colon-prefixed
// symbols like xyz:GOLD). No auth: candle data is public anyway.
app.get('/api/candles', async (req: Request, res: Response) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : ''
  const interval = typeof req.query.interval === 'string' ? req.query.interval.trim() : '1h'
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000)
  if (!symbol) { res.status(400).json({ error: 'symbol query param required' }); return }
  try {
    const candles = await fetchKlines(symbol, interval, limit)
    res.json(candles)
  } catch (e) {
    res.status(502).json({ error: (e as Error).message })
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
  const uid = userId(req)
  if (MULTI_USER && uid && isTripped(uid)) {
    res.status(423).json({ error: 'Kill switch tripped — unlock in Settings before starting bots' }); return
  }
  try {
    const bot = getSignalBot(req.params.id, uid)
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

// Returns the bot's trade history for chart marker rendering. Reads from HL's
// fill history (so it survives bot restarts / deploys), filtered to this bot's
// asset. Falls back to the in-memory list if creds aren't set.
app.get('/api/signal/bots/:id/trades', requireAuth, async (req: Request, res: Response) => {
  try {
    const bot = getSignalBot(req.params.id, userId(req))
    const cfg = bot.getStatus().config as { asset?: string; symbol?: string }
    const asset = (cfg.asset || (cfg.symbol ?? '').replace(/USDT$/i, '') || '').toUpperCase()
    const creds = MULTI_USER ? userCreds(req) : loadEnv()
    if (!creds || !asset) {
      res.json(listSignalBotTrades(req.params.id, userId(req)))
      return
    }
    const to = Date.now()
    const from = to - 365 * 24 * 60 * 60 * 1000
    const srcMap = buildAssetSourceMap(userId(req))
    const fills = await fetchFillsFromHL(creds, from, to, srcMap)
    const trades = fills
      .filter((f) => f.asset === asset)
      .map((f) => ({
        time: f.time,
        side: f.side,
        asset: f.asset,
        size: f.size,
        price: f.price,
        filled: true,
      }))
    res.json(trades)
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

// All-time PnL stats for a single signal bot. Pairs HL fills into round-trips
// and filters by the bot's asset (the journal attributes one bot per asset).
app.get('/api/signal/bots/:id/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const creds = MULTI_USER ? userCreds(req) : loadEnv()
    if (!creds) { res.status(400).json({ error: 'Hyperliquid credentials are not set. Add them in Settings.' }); return }
    const bot = getSignalBot(req.params.id, userId(req))
    const cfg = bot.getStatus().config as { asset?: string; symbol?: string }
    const asset = (cfg.asset || (cfg.symbol ?? '').replace(/USDT$/i, '') || '').toUpperCase()
    if (!asset) { res.status(400).json({ error: 'Bot has no asset configured' }); return }

    const to = Date.now()
    const from = to - 365 * 24 * 60 * 60 * 1000   // 1 year — HL's typical retention window
    const srcMap = buildAssetSourceMap(userId(req))
    const fills = await fetchFillsFromHL(creds, from, to, srcMap)
    const trips = pairRoundTrips(fills).filter((t) => t.asset === asset)

    const wins = trips.filter((t) => t.closedPnl > 0).length
    const losses = trips.filter((t) => t.closedPnl < 0).length
    const netPnl = trips.reduce((sum, t) => sum + t.closedPnl, 0)
    const winRate = trips.length > 0 ? (wins / trips.length) * 100 : 0

    res.json({ netPnl, roundTrips: trips.length, wins, losses, winRate })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
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
    const rawAsset = cfg.asset || (cfg.symbol ?? '').replace(/USDT$/i, '') || 'ETH'
    // HIP-3 (colon) names go straight to fetchKlines (which routes to HL's
    // candleSnapshot). Plain crypto names get the legacy `${ASSET}USDT` shape
    // so Binance keeps working.
    const isHip3 = rawAsset.includes(':')
    const asset = isHip3 ? rawAsset : rawAsset.toUpperCase()
    const sym = isHip3 ? asset : asset + 'USDT'
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

// ─── Journal (Trade Log) ──────────────────────────────────────────────────────
// Read-only views over Hyperliquid fills + the local audit log. All four routes
// take optional ?from=&to= (ms since epoch) or ?range=24h|7d|30d (defaults 24h).

function parseRange(req: Request): { from: number; to: number; range: '24h' | '7d' | '30d' } {
  const r = typeof req.query.range === 'string' ? req.query.range : undefined
  const fromQ = Number(req.query.from)
  const toQ = Number(req.query.to)
  if (Number.isFinite(fromQ) && Number.isFinite(toQ) && fromQ < toQ) {
    return { from: fromQ, to: toQ, range: '24h' }
  }
  return rangeToBounds(r)
}

app.get('/api/journal/audit', requireAuth, (req: Request, res: Response) => {
  try {
    const { from, to } = parseRange(req)
    res.json(loadAuditLines(userId(req), from, to))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/journal/fills', requireAuth, async (req: Request, res: Response) => {
  try {
    const creds = MULTI_USER ? userCreds(req) : loadEnv()
    if (!creds) { res.status(400).json({ error: 'Hyperliquid credentials are not set. Add them in Settings.' }); return }
    const { from, to } = parseRange(req)
    const srcMap = buildAssetSourceMap(userId(req))
    const fills = await fetchFillsFromHL(creds, from, to, srcMap)
    res.json(fills)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/journal/roundtrips', requireAuth, async (req: Request, res: Response) => {
  try {
    const creds = MULTI_USER ? userCreds(req) : loadEnv()
    if (!creds) { res.status(400).json({ error: 'Hyperliquid credentials are not set. Add them in Settings.' }); return }
    const { from, to } = parseRange(req)
    const srcMap = buildAssetSourceMap(userId(req))
    const fills = await fetchFillsFromHL(creds, from, to, srcMap)
    res.json(pairRoundTrips(fills))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/journal/summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const creds = MULTI_USER ? userCreds(req) : loadEnv()
    if (!creds) { res.status(400).json({ error: 'Hyperliquid credentials are not set. Add them in Settings.' }); return }
    const { from, to, range } = parseRange(req)
    const srcMap = buildAssetSourceMap(userId(req))
    const fills = await fetchFillsFromHL(creds, from, to, srcMap)
    const trips = pairRoundTrips(fills)
    // openValue: notional of currently-open positions. Pulled from account
    // state for whichever asset has any positions. Cheap call we already do
    // elsewhere — but to keep this route fast we just sum the start-position
    // signal in the latest fill per asset. Good-enough approximation; precise
    // value lives on /api/account.
    let openValue = 0
    const latestPerAsset = new Map<string, { pos: number; px: number }>()
    for (const f of fills) {
      const signed = f.side === 'buy' ? +f.size : -f.size
      const next = (latestPerAsset.get(f.asset)?.pos ?? f.startPosition) + signed
      latestPerAsset.set(f.asset, { pos: next, px: f.price })
    }
    for (const { pos, px } of latestPerAsset.values()) openValue += Math.abs(pos) * px
    res.json(summarize(fills, trips, range, openValue))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ─── SPA catch-all ────────────────────────────────────────────────────────────
// For any GET that isn't /api or /auth, send the React app's index.html so
// React Router can handle client-side navigation (e.g. /backtest, /signal).
// Falls back to the vanilla dashboard if the React build doesn't exist yet.
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    res.status(404).end(); return
  }
  const indexPath = join(PUBLIC_DIR, 'index.html')
  res.sendFile(indexPath, (err) => {
    if (err) res.sendFile(DASHBOARD_PATH)
  })
})

// ─── Startup ──────────────────────────────────────────────────────────────────

const PORT = 3001
// Bind to localhost by default — cloudflared connects locally on the same VPS,
// so the public IP doesn't need to expose 3001. Override with HOST=0.0.0.0 if
// you ever run the bot in a setup where the proxy is on a different host.
const HOST = process.env.HOST?.trim() || '127.0.0.1'

createServer(app).listen(PORT, HOST, async () => {
  log.ok(`Bot dashboard -> http://${HOST}:${PORT}`)

  if (isNotifyEnabled()) log.ok('Telegram notifications ENABLED (TELEGRAM_BOT_TOKEN + CHAT_ID set)')

  if (MULTI_USER) {
    log.ok('Multi-user mode ENABLED')
    const users = listUsers()
    const owner = users.find((u) => u.isAdmin)
    if (owner) {
      runMigrationIfNeeded(owner.id)
      for (const u of users) {
        const credsFn = () => { try { return loadUserCreds(u.id) } catch { return null } }
        maybeAutostartSignalBots(u.id, credsFn)
        maybeAutostartGridBots(u.id, credsFn)
        armKillSwitchForUser(u.id)
        // One userFills subscription per user — fires Telegram on every close.
        void startFillNotifier(credsFn())
      }
    } else {
      log.info('No users yet — register at /auth/register to get started')
    }
  } else {
    maybeAutostartSignalBots()
    maybeAutostartGridBots()
    // Single-tenant mode: creds come from process.env via loadEnv().
    try {
      const { loadEnv } = await import('./config.js')
      void startFillNotifier(loadEnv())
    } catch (e) {
      log.warn(`Single-tenant Telegram notifier skipped: ${(e as Error).message}`)
    }
  }
})
