import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  Play,
  Save,
  Square,
  Wallet,
} from 'lucide-react'
import { getBotToken, getBotUrl, setBotToken, setBotUrl } from '@/lib/env'

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
}

interface SignalBotStatus {
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

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']
const POLL_MS = 5000

function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString()
}

export default function SignalTraderPage() {
  const [botUrl, setBotUrlState] = useState(getBotUrl())
  const [botToken, setBotTokenState] = useState(getBotToken())
  const [online, setOnline] = useState(false)
  const [strategies, setStrategies] = useState<StrategyMeta[]>([])
  const [status, setStatus] = useState<SignalBotStatus | null>(null)
  const [cfg, setCfg] = useState<SignalBotConfig | null>(null)
  const [account, setAccount] = useState<AccountState | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)

  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // All bot requests go through here. `credentials: 'include'` lets a
  // same-site dashboard send its Cloudflare Access cookie; the optional Bearer
  // token covers a plain tunnel with no Access in front.
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

  // Pull strategy catalog, bot status, account and logs from the bot. The
  // bot is the source of truth, so reopening this page always rehydrates.
  const refresh = useCallback(async () => {
    try {
      const statusRes = await api('/api/signal/status')
      if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`)
      const st: SignalBotStatus = await statusRes.json()
      setStatus(st)
      setOnline(true)
      // Don't clobber edits in progress on a stopped bot.
      if (!dirtyRef.current || st.running) setCfg(st.config)

      const [accRes, logRes] = await Promise.all([
        api(`/api/account?asset=${encodeURIComponent(st.config.asset)}`),
        api('/api/signal/logs'),
      ])
      setAccount(accRes.ok ? await accRes.json() : null)
      setLogs(logRes.ok ? await logRes.json() : [])
    } catch {
      setOnline(false)
      setAccount(null)
    }
  }, [api])

  useEffect(() => {
    let cancelled = false
    api('/api/strategies')
      .then((r) => (r.ok ? r.json() : []))
      .then((s) => {
        if (!cancelled) setStrategies(s)
      })
      .catch(() => {})
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [api, refresh])

  const running = status?.running ?? false
  const strategyMeta = strategies.find((s) => s.id === cfg?.strategyId)

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
      const res = await api('/api/signal/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
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
    setBusy(true)
    setNotice(null)
    try {
      const res = await api(`/api/signal/${action}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setNotice({ text: action === 'start' ? 'Signal bot started' : 'Signal bot stopped', ok: true })
      refresh()
    } catch (e) {
      setNotice({ text: `${action} failed: ${(e as Error).message}`, ok: false })
    } finally {
      setBusy(false)
    }
  }

  const manualTrade = async (side: 'buy' | 'sell') => {
    if (!cfg) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: cfg.asset,
          side,
          size: cfg.size,
          maxSlippagePct: cfg.slippagePct,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setNotice({ text: data.msg || 'Order sent', ok: Boolean(data.filled) })
      refresh()
    } catch (e) {
      setNotice({ text: `Trade failed: ${(e as Error).message}`, ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-6 py-5">
      {/* Header */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Activity className={`h-5 w-5 ${running ? 'text-gain animate-pulse' : 'text-dim'}`} />
          <div>
            <h2 className="font-display text-base font-semibold text-text">Signal Trader</h2>
            <p className="text-[11px] text-dim">
              Runs a backtest strategy live and trades its BUY/SELL signals on Hyperliquid.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {account && (
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                account.network === 'mainnet'
                  ? 'border border-loss/40 bg-loss/15 text-loss'
                  : 'border border-brand/40 bg-brand/15 text-brand'
              }`}
            >
              {account.network}
            </span>
          )}
          <span
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${
              running
                ? 'border-gain/40 bg-gain/10 text-gain'
                : online
                  ? 'border-border bg-panel-2 text-muted'
                  : 'border-loss/40 bg-loss/10 text-loss'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                running ? 'bg-gain' : online ? 'bg-warn' : 'bg-loss'
              }`}
            />
            {running ? 'Running' : online ? 'Idle' : 'Bot Offline'}
          </span>
        </div>
      </div>

      {!online && (
        <div className="card flex items-center justify-between gap-3 border-loss/30 bg-loss/5 p-3">
          <span className="text-xs text-loss">
            Cannot reach the bot server. Make sure the bot is running and the URL
            {botToken ? ' / token' : ''} below is correct.
          </span>
          <button
            type="button"
            onClick={refresh}
            className="shrink-0 rounded border border-border bg-panel px-2.5 py-1 text-xs text-text hover:bg-bg"
          >
            Retry
          </button>
        </div>
      )}

      {notice && (
        <div
          className={`card p-2.5 text-xs ${
            notice.ok ? 'border-gain/30 bg-gain/5 text-gain' : 'border-loss/30 bg-loss/5 text-loss'
          }`}
        >
          {notice.text}
        </div>
      )}

      {cfg && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* ---- Strategy configuration ---- */}
          <div className="card flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-text">Strategy</h3>
              {running && (
                <span className="text-[10px] text-warn">Stop the bot to edit</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Binance Symbol">
                <input
                  type="text"
                  disabled={running}
                  value={cfg.symbol}
                  onChange={(e) =>
                    patch({
                      symbol: e.target.value.toUpperCase(),
                      asset: e.target.value.toUpperCase().replace(/USDT$/, ''),
                    })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Timeframe">
                <select
                  disabled={running}
                  value={cfg.timeframe}
                  onChange={(e) => patch({ timeframe: e.target.value })}
                  className={inputCls}
                >
                  {TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Strategy">
              <select
                disabled={running}
                value={cfg.strategyId}
                onChange={(e) => onStrategyChange(e.target.value)}
                className={inputCls}
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.category}
                  </option>
                ))}
              </select>
            </Field>
            {strategyMeta && (
              <p className="text-[11px] leading-relaxed text-dim">{strategyMeta.description}</p>
            )}

            {/* Strategy parameters */}
            {strategyMeta && strategyMeta.params.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {strategyMeta.params.map((d) => (
                  <Field key={d.key} label={d.label}>
                    <input
                      type="number"
                      disabled={running}
                      min={d.min}
                      max={d.max}
                      step={d.step}
                      value={cfg.params[d.key] ?? d.default}
                      onChange={(e) =>
                        patch({ params: { ...cfg.params, [d.key]: Number(e.target.value) } })
                      }
                      className={inputCls}
                    />
                  </Field>
                ))}
              </div>
            )}

            <div className="my-1 h-px bg-border" />

            <div className="grid grid-cols-2 gap-2">
              <Field label="Hyperliquid Asset">
                <input
                  type="text"
                  disabled={running}
                  value={cfg.asset}
                  onChange={(e) => patch({ asset: e.target.value.toUpperCase() })}
                  className={inputCls}
                />
              </Field>
              <Field label="Order Size">
                <input
                  type="number"
                  disabled={running}
                  step="any"
                  min="0"
                  value={cfg.size}
                  onChange={(e) => patch({ size: Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
              <Field label="Max Slippage %">
                <input
                  type="number"
                  disabled={running}
                  step="any"
                  min="0"
                  value={cfg.slippagePct}
                  onChange={(e) => patch({ slippagePct: Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
              <Field label="Cooldown (s)">
                <input
                  type="number"
                  disabled={running}
                  step="1"
                  min="0"
                  value={cfg.cooldownSec}
                  onChange={(e) => patch({ cooldownSec: Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
            </div>

            <Field label="Trade Direction">
              <select
                disabled={running}
                value={cfg.tradeSide}
                onChange={(e) => patch({ tradeSide: e.target.value as TradeSide })}
                className={inputCls}
              >
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

          {/* ---- Status / control / account / manual / log ---- */}
          <div className="flex flex-col gap-4">
            {/* Control + status */}
            <div className="card flex flex-col gap-3 p-4">
              <h3 className="font-display text-sm font-semibold text-text">Bot Control</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={running || busy || !online || dirty}
                  onClick={() => control('start')}
                  title={dirty ? 'Save the configuration first' : undefined}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-gain px-3 py-2.5 text-sm font-bold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 transition-opacity"
                >
                  <Play className="h-4 w-4" />
                  Start
                </button>
                <button
                  type="button"
                  disabled={!running || busy}
                  onClick={() => control('stop')}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-loss px-3 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 transition-opacity"
                >
                  <Square className="h-4 w-4" />
                  Stop
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

            {/* Account */}
            {account && (
              <div className="card flex flex-col gap-2 p-4">
                <div className="flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 text-dim" />
                  <h3 className="font-display text-sm font-semibold text-text">Account</h3>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <Stat label="Equity">${account.accountValue.toFixed(2)}</Stat>
                  <Stat label="Position">
                    {account.position ? (
                      <span className={account.position.side === 'long' ? 'text-gain' : 'text-loss'}>
                        {account.position.side.toUpperCase()} {account.position.size}{' '}
                        {account.position.asset}
                      </span>
                    ) : (
                      <span className="text-dim">Flat</span>
                    )}
                  </Stat>
                  {account.position && (
                    <Stat label="Unrealized PnL">
                      <span
                        className={
                          account.position.unrealizedPnl >= 0 ? 'text-gain' : 'text-loss'
                        }
                      >
                        {account.position.unrealizedPnl >= 0 ? '+' : ''}
                        ${account.position.unrealizedPnl.toFixed(2)}
                      </span>
                    </Stat>
                  )}
                </div>
              </div>
            )}

            {/* Manual trade */}
            <div className="card flex flex-col gap-2 p-4">
              <h3 className="font-display text-sm font-semibold text-text">Manual Trade</h3>
              <p className="text-[10px] text-dim">
                Sends an immediate market order for {cfg.size} {cfg.asset}.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy || !online}
                  onClick={() => manualTrade('buy')}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-gain px-3 py-2 text-xs font-bold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 transition-opacity"
                >
                  <ArrowUpCircle className="h-4 w-4" />
                  Buy {cfg.asset}
                </button>
                <button
                  type="button"
                  disabled={busy || !online}
                  onClick={() => manualTrade('sell')}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-loss px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 transition-opacity"
                >
                  <ArrowDownCircle className="h-4 w-4" />
                  Sell {cfg.asset}
                </button>
              </div>
            </div>

            {/* Activity log */}
            <div className="card flex flex-col gap-1.5 p-4">
              <h3 className="font-display text-sm font-semibold text-text">Activity Log</h3>
              <div className="h-44 overflow-y-auto rounded-md border border-border bg-bg p-2 font-mono text-[10px] leading-relaxed">
                {logs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-dim">
                    No activity yet.
                  </div>
                ) : (
                  [...logs].reverse().map((l, i) => (
                    <div key={i} className="mb-1 last:mb-0 break-words">
                      <span className="text-dim">[{l.ts.slice(11)}]</span>{' '}
                      <span
                        className={
                          l.level === 'ok' || l.level === 'fill'
                            ? 'text-gain'
                            : l.level === 'err'
                              ? 'text-loss'
                              : l.level === 'warn'
                                ? 'text-warn'
                                : 'text-text'
                        }
                      >
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

      {/* Connection */}
      <div className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2">
          <label className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider text-dim">
            Bot URL
          </label>
          <input
            type="text"
            value={botUrl}
            onChange={(e) => {
              setBotUrlState(e.target.value)
              setBotUrl(e.target.value)
            }}
            placeholder="http://localhost:3001"
            className="flex-1 rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-brand"
          />
        </div>
        <div className="flex flex-1 items-center gap-2">
          <label className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider text-dim">
            API Token
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => {
              setBotTokenState(e.target.value)
              setBotToken(e.target.value)
            }}
            placeholder="(optional — for a tunnel without Access)"
            className="flex-1 rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-brand"
          />
        </div>
      </div>
    </main>
  )
}

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
