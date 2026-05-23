import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  Play,
  Save,
  Square,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { getBotToken, getBotUrl, setBotToken, setBotUrl } from '@/lib/env'

// ── Types (mirrors bot/src/signal-bot.ts) ────────────────────────────────────

interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

interface StrategyMeta {
  id: string
  name: string
  category: string
  description: string
  params: ParamDef[]
}

type TradeSide = 'both' | 'buy' | 'sell'

interface SignalBotConfig {
  symbol: string
  timeframe: string
  strategyId: string
  params: Record<string, number>
  asset: string
  size: number
  slippagePct: number
  cooldownSec: number
  tradeSide: TradeSide
  tpPct?: number
  slPct?: number
}

interface BotSummary {
  id: string
  name: string
  running: boolean
  strategyId: string
  symbol: string
  timeframe: string
}

interface SignalBotStatus {
  id: string
  name: string
  running: boolean
  startedAt: number | null
  config: SignalBotConfig
  lastSignal: 'buy' | 'sell' | null
  lastSignalAt: number | null
  lastClosedBarTime: number | null
  lastEvaluatedAt: number | null
  lastError: string | null
  tradesExecuted: number
}

interface AccountState {
  network: 'testnet' | 'mainnet'
  accountValue: number
  currentPrice: number | null
  position: {
    asset: string
    size: number
    side: 'long' | 'short'
    entryPx: number | null
    unrealizedPnl: number
  } | null
}

interface LogLine {
  ts: string
  level: string
  msg: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']
const POLL_MS = 5000

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString()
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toPrecision(4)
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SignalTraderPage() {
  const [botUrl, setBotUrlState] = useState(getBotUrl())
  const [botToken, setBotTokenState] = useState(getBotToken())

  const [online, setOnline] = useState(false)
  const [strategies, setStrategies] = useState<StrategyMeta[]>([])
  const [bots, setBots] = useState<BotSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<SignalBotStatus | null>(null)
  const [cfg, setCfg] = useState<SignalBotConfig | null>(null)
  const [account, setAccount] = useState<AccountState | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)

  // Manual trade form state
  const [manualSize, setManualSize] = useState<number | ''>('')
  const [manualTpPct, setManualTpPct] = useState<number | ''>('')
  const [manualSlPct, setManualSlPct] = useState<number | ''>('')

  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  // ── API helper ──────────────────────────────────────────────────────────────

  const api = useCallback(
    (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      if (botToken) headers.set('Authorization', `Bearer ${botToken}`)
      return fetch(`${botUrl}${path}`, {
        mode: 'cors',
        credentials: 'include',
        ...init,
        headers,
      })
    },
    [botUrl, botToken],
  )

  // ── Data fetching ───────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    const id = selectedIdRef.current
    if (!id) return
    try {
      const st: SignalBotStatus = await api(`/api/signal/bots/${id}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      setStatus(st)
      setOnline(true)
      // Don't clobber in-progress edits unless the bot is running (running = source of truth).
      if (!dirtyRef.current || st.running) setCfg(st.config)

      const [accRes, logRes] = await Promise.all([
        api(`/api/account?asset=${encodeURIComponent(st.config.asset)}`),
        api(`/api/signal/bots/${id}/logs`),
      ])
      setAccount(accRes.ok ? await accRes.json() : null)
      setLogs(logRes.ok ? await logRes.json() : [])
    } catch {
      setOnline(false)
      setAccount(null)
    }
  }, [api])

  // Load strategies + bot list on mount / when connection settings change.
  useEffect(() => {
    let cancelled = false

    Promise.all([
      api('/api/strategies').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      api('/api/signal/bots').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([strats, botList]: [StrategyMeta[], BotSummary[]]) => {
      if (cancelled) return
      setStrategies(strats)
      setBots(botList)
      if (botList.length > 0 && !selectedIdRef.current) {
        setSelectedId(botList[0].id)
      }
      if (botList.length > 0) setOnline(true)
    })

    return () => { cancelled = true }
  }, [api])

  // Poll the selected bot.
  useEffect(() => {
    if (!selectedId) return
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [selectedId, refresh])

  // ── Derived ─────────────────────────────────────────────────────────────────

  const running = status?.running ?? false
  const strategyMeta = strategies.find((s) => s.id === cfg?.strategyId)
  const refPrice = account?.currentPrice ?? null

  // Approximate TP/SL prices for the manual-trade display labels.
  const approxTp = (side: 'buy' | 'sell') => {
    if (!refPrice || typeof manualTpPct !== 'number' || manualTpPct <= 0) return null
    return side === 'buy' ? refPrice * (1 + manualTpPct / 100) : refPrice * (1 - manualTpPct / 100)
  }
  const approxSl = (side: 'buy' | 'sell') => {
    if (!refPrice || typeof manualSlPct !== 'number' || manualSlPct <= 0) return null
    return side === 'buy' ? refPrice * (1 - manualSlPct / 100) : refPrice * (1 + manualSlPct / 100)
  }

  // Unrealized PnL % for the position panel.
  const pnlPct =
    account?.position?.entryPx && account.position.entryPx > 0
      ? (account.position.unrealizedPnl / (account.position.entryPx * account.position.size)) * 100
      : null

  // ── Mutations ────────────────────────────────────────────────────────────────

  const patch = (p: Partial<SignalBotConfig>) => {
    setCfg((c) => (c ? { ...c, ...p } : c))
    setDirty(true)
  }

  const onStrategyChange = (id: string) => {
    const meta = strategies.find((s) => s.id === id)
    if (!meta) return
    const params: Record<string, number> = {}
    for (const d of meta.params) params[d.key] = d.default
    patch({ strategyId: id, params })
  }

  const saveConfig = async () => {
    if (!cfg) return
    setBusy(true)
    setNotice(null)
    try {
      let res: Response
      if (selectedId) {
        // Update existing bot.
        res = await api(`/api/signal/bots/${selectedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: cfg }),
        })
      } else {
        // Create the first bot.
        res = await api('/api/signal/bots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${cfg.strategyId.toUpperCase()} ${cfg.symbol}`, config: cfg }),
        })
      }
      const data: SignalBotStatus = await res.json().catch(() => ({}) as SignalBotStatus)
      if (!res.ok) throw new Error((data as unknown as { error: string }).error || `HTTP ${res.status}`)
      if (!selectedId && data.id) {
        setSelectedId(data.id)
        setBots((prev) => [...prev, { id: data.id, name: data.name, running: false, strategyId: cfg.strategyId, symbol: cfg.symbol, timeframe: cfg.timeframe }])
      }
      setDirty(false)
      setNotice({ text: 'Configuration saved', ok: true })
      refresh()
    } catch (e) {
      setNotice({ text: `Save failed: ${(e as Error).message}`, ok: false })
    } finally {
      setBusy(false)
    }
  }

  const control = async (action: 'start' | 'stop') => {
    if (!selectedId) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api(`/api/signal/bots/${selectedId}/${action}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
      setNotice({ text: action === 'start' ? 'Bot started' : 'Bot stopped', ok: true })
      refresh()
    } catch (e) {
      setNotice({ text: `${action} failed: ${(e as Error).message}`, ok: false })
    } finally {
      setBusy(false)
    }
  }

  // Manual trade → POST /api/order (supports tpPct/slPct bracket orders).
  const manualTrade = async (side: 'buy' | 'sell') => {
    if (!cfg) return
    setBusy(true)
    setNotice(null)
    const size = typeof manualSize === 'number' && manualSize > 0 ? manualSize : cfg.size
    try {
      const body: Record<string, unknown> = {
        asset: cfg.asset,
        side,
        size,
        orderType: 'market',
        maxSlippagePct: cfg.slippagePct,
      }
      if (typeof manualTpPct === 'number' && manualTpPct > 0) body.tpPct = manualTpPct
      if (typeof manualSlPct === 'number' && manualSlPct > 0) body.slPct = manualSlPct
      const res = await api('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
      const d = data as { message?: string; filled?: boolean }
      setNotice({ text: d.message || 'Order sent', ok: Boolean(d.filled) })
      refresh()
    } catch (e) {
      setNotice({ text: `Trade failed: ${(e as Error).message}`, ok: false })
    } finally {
      setBusy(false)
    }
  }

  // Close position → POST /api/close (cancels stale TP/SL first, then closes).
  const closePos = async () => {
    if (!account?.position || !cfg) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api('/api/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: account.position.asset, maxSlippagePct: cfg.slippagePct }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
      const d = data as { message?: string }
      setNotice({ text: d.message || 'Position closed', ok: true })
      refresh()
    } catch (e) {
      setNotice({ text: `Close failed: ${(e as Error).message}`, ok: false })
    } finally {
      setBusy(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-6 py-5">

      {/* ── Status header ── */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Activity className={`h-5 w-5 ${running ? 'text-gain animate-pulse' : 'text-dim'}`} />
          <div>
            <h2 className="font-display text-base font-semibold text-text">Signal Trader</h2>
            <p className="text-[11px] text-dim">
              Runs a strategy live and trades its signals on Hyperliquid.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Bot selector — show when there are multiple bots */}
          {bots.length > 1 && (
            <select
              value={selectedId ?? ''}
              onChange={(e) => { setSelectedId(e.target.value); setDirty(false) }}
              className="rounded border border-border bg-panel px-2 py-1 font-mono text-[11px] text-text outline-none focus:border-brand"
            >
              {bots.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          {account && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${account.network === 'mainnet' ? 'border border-loss/40 bg-loss/15 text-loss' : 'border border-brand/40 bg-brand/15 text-brand'}`}>
              {account.network}
            </span>
          )}
          <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${running ? 'border-gain/40 bg-gain/10 text-gain' : online ? 'border-border bg-panel-2 text-muted' : 'border-loss/40 bg-loss/10 text-loss'}`}>
            <span className={`h-2 w-2 rounded-full ${running ? 'bg-gain' : online ? 'bg-warn' : 'bg-loss'}`} />
            {running ? 'Running' : online ? 'Idle' : 'Offline'}
          </span>
        </div>
      </div>

      {/* ── Offline banner ── */}
      {!online && (
        <div className="card flex items-center justify-between gap-3 border-loss/30 bg-loss/5 p-3">
          <span className="text-xs text-loss">
            Cannot reach the bot server. Make sure it is running and the URL{botToken ? ' / token' : ''} below is correct.
          </span>
          <button type="button" onClick={() => { refresh(); api('/api/signal/bots').then((r) => r.ok ? r.json() : []).then((list: BotSummary[]) => { setBots(list); if (list.length && !selectedId) setSelectedId(list[0].id); if (list.length) setOnline(true) }).catch(() => {}) }} className="shrink-0 rounded border border-border bg-panel px-2.5 py-1 text-xs text-text hover:bg-bg">
            Retry
          </button>
        </div>
      )}

      {/* ── Notice ── */}
      {notice && (
        <div className={`card p-2.5 text-xs ${notice.ok ? 'border-gain/30 bg-gain/5 text-gain' : 'border-loss/30 bg-loss/5 text-loss'}`}>
          {notice.text}
        </div>
      )}

      {/* ── Open position panel ── */}
      {account?.position ? (
        <div className={`card p-4 ${account.position.side === 'long' ? 'border-gain/40 bg-gain/5' : 'border-loss/40 bg-loss/5'}`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {account.position.side === 'long'
                ? <TrendingUp className="h-5 w-5 text-gain shrink-0" />
                : <TrendingDown className="h-5 w-5 text-loss shrink-0" />}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${account.position.side === 'long' ? 'bg-gain/20 text-gain' : 'bg-loss/20 text-loss'}`}>
                    {account.position.side.toUpperCase()}
                  </span>
                  <span className="font-display text-sm font-semibold text-text">
                    {account.position.size} {account.position.asset}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px]">
                  {account.position.entryPx && (
                    <span className="text-dim">
                      Entry <span className="font-mono text-text">${fmtPrice(account.position.entryPx)}</span>
                    </span>
                  )}
                  {account.currentPrice && (
                    <span className="text-dim">
                      Mark <span className="font-mono text-text">${fmtPrice(account.currentPrice)}</span>
                    </span>
                  )}
                  <span className={`font-mono font-semibold ${account.position.unrealizedPnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                    {account.position.unrealizedPnl >= 0 ? '+' : ''}${account.position.unrealizedPnl.toFixed(2)}
                    {pnlPct !== null && (
                      <span className="ml-1 text-[10px] font-normal opacity-80">({fmtPct(pnlPct)})</span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={busy || !online}
              onClick={closePos}
              className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-2 text-xs font-semibold text-text transition-colors hover:border-loss/50 hover:bg-loss/10 hover:text-loss disabled:cursor-not-allowed disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" />
              Close Position
            </button>
          </div>
        </div>
      ) : account ? (
        <div className="card flex items-center gap-2.5 border-border/50 p-3">
          <span className="h-2 w-2 rounded-full bg-border" />
          <span className="text-[11px] text-dim">No open position</span>
          {refPrice && cfg && (
            <span className="ml-auto font-mono text-[11px] text-muted">
              {cfg.asset} ${fmtPrice(refPrice)}
            </span>
          )}
        </div>
      ) : null}

      {/* ── Account equity strip ── */}
      {account && (
        <div className="card flex items-center gap-2 p-3">
          <Wallet className="h-3.5 w-3.5 shrink-0 text-dim" />
          <span className="text-[11px] text-dim">Equity</span>
          <span className="font-mono text-sm font-semibold text-text">${account.accountValue.toFixed(2)}</span>
        </div>
      )}

      {/* ── Main two-column grid ── */}
      {(cfg || !selectedId) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* ── Left: strategy config ── */}
          <div className="card flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-text">Strategy</h3>
              {running && <span className="text-[10px] text-warn">Stop the bot to edit</span>}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Binance Symbol">
                <input
                  type="text"
                  disabled={running}
                  value={cfg?.symbol ?? ''}
                  onChange={(e) => patch({ symbol: e.target.value.toUpperCase(), asset: e.target.value.toUpperCase().replace(/USDT$/, '') })}
                  className={inputCls}
                />
              </Field>
              <Field label="Timeframe">
                <select disabled={running} value={cfg?.timeframe ?? '1h'} onChange={(e) => patch({ timeframe: e.target.value })} className={inputCls}>
                  {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Strategy">
              <select disabled={running} value={cfg?.strategyId ?? ''} onChange={(e) => onStrategyChange(e.target.value)} className={inputCls}>
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {s.category}</option>
                ))}
              </select>
            </Field>
            {strategyMeta && <p className="text-[11px] leading-relaxed text-dim">{strategyMeta.description}</p>}

            {strategyMeta && strategyMeta.params.length > 0 && cfg && (
              <div className="grid grid-cols-2 gap-2">
                {strategyMeta.params.map((d) => (
                  <Field key={d.key} label={d.label}>
                    <input
                      type="number"
                      disabled={running}
                      min={d.min} max={d.max} step={d.step}
                      value={cfg.params[d.key] ?? d.default}
                      onChange={(e) => patch({ params: { ...cfg.params, [d.key]: Number(e.target.value) } })}
                      className={inputCls}
                    />
                  </Field>
                ))}
              </div>
            )}

            <div className="my-0.5 h-px bg-border" />

            {/* Execution settings */}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Hyperliquid Asset">
                <input type="text" disabled={running} value={cfg?.asset ?? ''} onChange={(e) => patch({ asset: e.target.value.toUpperCase() })} className={inputCls} />
              </Field>
              <Field label="Signal Order Size">
                <input type="number" disabled={running} step="any" min="0" value={cfg?.size ?? 0} onChange={(e) => patch({ size: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Max Slippage %">
                <input type="number" disabled={running} step="any" min="0" value={cfg?.slippagePct ?? 2} onChange={(e) => patch({ slippagePct: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Cooldown (s)">
                <input type="number" disabled={running} step="1" min="0" value={cfg?.cooldownSec ?? 60} onChange={(e) => patch({ cooldownSec: Number(e.target.value) })} className={inputCls} />
              </Field>
            </div>

            {/* Auto TP/SL for signal trades */}
            <div className="rounded-md border border-border bg-bg/40 p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-dim">Auto TP / SL on Signal Trades</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Take Profit %">
                  <input
                    type="number" disabled={running} step="0.1" min="0"
                    value={cfg?.tpPct ?? ''}
                    placeholder="0 = off"
                    onChange={(e) => patch({ tpPct: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Stop Loss %">
                  <input
                    type="number" disabled={running} step="0.1" min="0"
                    value={cfg?.slPct ?? ''}
                    placeholder="0 = off"
                    onChange={(e) => patch({ slPct: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className={inputCls}
                  />
                </Field>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-dim">
                Bracket orders placed from the <strong className="text-muted">actual fill price</strong> after each signal. Stale orders from the previous trade are cancelled automatically.
              </p>
            </div>

            <Field label="Trade Direction">
              <select disabled={running} value={cfg?.tradeSide ?? 'both'} onChange={(e) => patch({ tradeSide: e.target.value as TradeSide })} className={inputCls}>
                <option value="both">Both — buy and sell signals</option>
                <option value="buy">Buy signals only</option>
                <option value="sell">Sell signals only</option>
              </select>
            </Field>

            <button
              type="button"
              disabled={running || busy || !dirty}
              onClick={saveConfig}
              className="mt-1 flex items-center justify-center gap-1.5 rounded-md border border-border bg-panel-2 py-2 text-xs font-semibold text-text transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />
              {dirty ? 'Save Configuration' : 'Saved'}
            </button>
          </div>

          {/* ── Right: control + manual trade + log ── */}
          <div className="flex flex-col gap-4">

            {/* Bot control */}
            <div className="card flex flex-col gap-3 p-4">
              <h3 className="font-display text-sm font-semibold text-text">Bot Control</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={running || busy || !online || dirty || !selectedId}
                  onClick={() => control('start')}
                  title={dirty ? 'Save the configuration first' : undefined}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-gain px-3 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="h-4 w-4" /> Start
                </button>
                <button
                  type="button"
                  disabled={!running || busy}
                  onClick={() => control('stop')}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-loss px-3 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Square className="h-4 w-4" /> Stop
                </button>
              </div>
              {dirty && !running && (
                <p className="text-[10px] text-warn">Unsaved changes — save before starting.</p>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <Stat label="Last signal">
                  {status?.lastSignal ? (
                    <span className={status.lastSignal === 'buy' ? 'text-gain' : 'text-loss'}>
                      {status.lastSignal.toUpperCase()} @ {fmtTime(status.lastSignalAt)}
                    </span>
                  ) : (
                    <span className="text-dim">None yet</span>
                  )}
                </Stat>
                <Stat label="Last checked">{fmtTime(status?.lastEvaluatedAt ?? null)}</Stat>
                <Stat label="Trades executed">{status?.tradesExecuted ?? 0}</Stat>
                <Stat label="Started">{fmtTime(status?.startedAt ?? null)}</Stat>
              </div>
              {status?.lastError && (
                <p className="rounded border border-loss/30 bg-loss/5 p-1.5 text-[10px] text-loss">
                  Last error: {status.lastError}
                </p>
              )}
            </div>

            {/* Manual trade */}
            <div className="card flex flex-col gap-3 p-4">
              <h3 className="font-display text-sm font-semibold text-text">Manual Trade</h3>

              {/* Size + TP/SL inputs */}
              <div className="grid grid-cols-3 gap-2">
                <Field label="Size">
                  <input
                    type="number" step="any" min="0"
                    placeholder={cfg ? String(cfg.size) : ''}
                    value={manualSize}
                    onChange={(e) => setManualSize(e.target.value === '' ? '' : Number(e.target.value))}
                    className={inputCls}
                  />
                </Field>
                <Field label="TP %">
                  <input
                    type="number" step="0.1" min="0" placeholder="0 = off"
                    value={manualTpPct}
                    onChange={(e) => setManualTpPct(e.target.value === '' ? '' : Number(e.target.value))}
                    className={inputCls}
                  />
                </Field>
                <Field label="SL %">
                  <input
                    type="number" step="0.1" min="0" placeholder="0 = off"
                    value={manualSlPct}
                    onChange={(e) => setManualSlPct(e.target.value === '' ? '' : Number(e.target.value))}
                    className={inputCls}
                  />
                </Field>
              </div>

              {/* Approximate price preview */}
              {refPrice && cfg && (
                <div className="grid grid-cols-2 gap-2 text-[10px] text-dim">
                  <div>
                    BUY: TP {approxTp('buy') ? <span className="font-mono text-gain">≈${fmtPrice(approxTp('buy')!)}</span> : '—'} · SL {approxSl('buy') ? <span className="font-mono text-loss">≈${fmtPrice(approxSl('buy')!)}</span> : '—'}
                  </div>
                  <div>
                    SELL: TP {approxTp('sell') ? <span className="font-mono text-gain">≈${fmtPrice(approxTp('sell')!)}</span> : '—'} · SL {approxSl('sell') ? <span className="font-mono text-loss">≈${fmtPrice(approxSl('sell')!)}</span> : '—'}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-dim">
                Bracket orders are placed from the <strong className="text-muted">actual fill price</strong>.
                {refPrice && <span className="ml-1 font-mono text-muted">Mid: ${fmtPrice(refPrice)}</span>}
              </p>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy || !online || !cfg}
                  onClick={() => manualTrade('buy')}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-gain px-3 py-2 text-xs font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUpCircle className="h-4 w-4" />
                  Buy {cfg?.asset ?? ''}
                </button>
                <button
                  type="button"
                  disabled={busy || !online || !cfg}
                  onClick={() => manualTrade('sell')}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-loss px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowDownCircle className="h-4 w-4" />
                  Sell {cfg?.asset ?? ''}
                </button>
              </div>
            </div>

            {/* Activity log */}
            <div className="card flex flex-col gap-1.5 p-4">
              <h3 className="font-display text-sm font-semibold text-text">Activity Log</h3>
              <div className="h-44 overflow-y-auto rounded-md border border-border bg-bg p-2 font-mono text-[10px] leading-relaxed">
                {logs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-dim">No activity yet.</div>
                ) : (
                  [...logs].reverse().map((l, i) => (
                    <div key={i} className="mb-1 last:mb-0 break-words">
                      <span className="text-dim">[{l.ts.slice(11)}]</span>{' '}
                      <span className={
                        l.level === 'ok' || l.level === 'fill' ? 'text-gain'
                        : l.level === 'err' ? 'text-loss'
                        : l.level === 'warn' ? 'text-warn'
                        : 'text-text'
                      }>
                        {l.msg}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Connection settings ── */}
      <div className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2">
          <label className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider text-dim">Bot URL</label>
          <input
            type="text"
            value={botUrl}
            onChange={(e) => { setBotUrlState(e.target.value); setBotUrl(e.target.value) }}
            placeholder="http://localhost:3001"
            className="flex-1 rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-brand"
          />
        </div>
        <div className="flex flex-1 items-center gap-2">
          <label className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider text-dim">API Token</label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => { setBotTokenState(e.target.value); setBotToken(e.target.value) }}
            placeholder="(optional — for a tunnel without Access)"
            className="flex-1 rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-brand"
          />
        </div>
      </div>
    </main>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const inputCls =
  'w-full rounded border border-border bg-bg px-2 py-1.5 font-mono text-xs text-text outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-50'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-dim">{label}</span>
      {children}
    </label>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-dim">{label}</span>
      <span className="text-right font-mono text-text">{children}</span>
    </>
  )
}
