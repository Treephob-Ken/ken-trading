import { useEffect, useState } from 'react'
import { AlertOctagon, ShieldAlert, Unlock } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'

interface KillSwitchData {
  config: { enabled: boolean; pct: number }
  state: {
    snapshotEquity: number | null
    snapshotAt: number
    currentEquity: number | null
    drawdownPct: number
    tripped: boolean
    trippedAt: number | null
    trippedAtEquity: number | null
    reason: string | null
  }
}

const inputCls = 'w-full rounded-xl border border-border bg-panel-2 px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50'

function money(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export default function RiskControlsCard() {
  const [data, setData] = useState<KillSwitchData | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [pct, setPct] = useState('15')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)

  const load = () => {
    apiFetch('/api/killswitch')
      .then(r => r.ok ? r.json() : null)
      .then((d: KillSwitchData | null) => {
        if (!d) return
        setData(d)
        setEnabled(d.config.enabled)
        setPct(String(d.config.pct))
      })
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [])

  const save = async () => {
    setBusy(true); setNotice(null)
    try {
      const res = await apiFetch('/api/killswitch/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, pct: Number(pct) }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setData(j)
      setNotice({ text: enabled ? 'Kill switch armed' : 'Kill switch disabled', ok: true })
    } catch (e) {
      setNotice({ text: `Save failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  const unlock = async () => {
    if (!confirm('Unlock the kill switch?\n\nThis resets today\'s snapshot to your current equity. Bots stay stopped — start them manually when you\'re ready.')) return
    setBusy(true); setNotice(null)
    try {
      const res = await apiFetch('/api/killswitch/unlock', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setData(j)
      setNotice({ text: 'Unlocked — start bots from their pages', ok: true })
    } catch (e) {
      setNotice({ text: `Unlock failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  if (!data) return null

  const dd = data.state.drawdownPct
  const ddTone = dd <= -data.config.pct ? 'text-loss' : dd < 0 ? 'text-warn' : 'text-gain'
  const armedTone = data.state.tripped
    ? 'border-loss/40 bg-loss/10 text-loss'
    : data.config.enabled
    ? 'border-gain/30 bg-gain/5 text-gain'
    : 'border-border bg-panel-2 text-dim'

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <div>
          <h2 className="text-sm font-semibold text-text">Risk Controls — Kill Switch</h2>
          <p className="mt-0.5 text-xs text-dim">
            Stops every bot, cancels every order, and closes every position the moment your account drops
            more than the configured % below where it started today (UTC midnight).
          </p>
        </div>
      </div>

      <div className={`mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${armedTone}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${data.state.tripped ? 'bg-loss animate-pulse' : data.config.enabled ? 'bg-gain' : 'bg-dim'}`} />
        {data.state.tripped
          ? `Tripped at ${fmtTime(data.state.trippedAt)} — bots stopped, positions closed`
          : data.config.enabled
          ? 'Armed and watching'
          : 'Disabled — turn on to protect against runaway losses'}
      </div>

      {data.state.tripped && (
        <div className="mb-4 rounded-xl border border-loss/40 bg-loss/5 p-3">
          <div className="flex items-start gap-2 text-xs text-loss">
            <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">{data.state.reason}</p>
              <p className="text-loss/80">Review your activity, then click Resume to clear the trip and re-arm.</p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={unlock}
            className="mt-3 flex items-center gap-2 rounded-xl bg-loss px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Unlock className="h-3.5 w-3.5" />
            Resume trading (clear trip)
          </button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-border bg-panel-2 p-3 text-xs">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">Snapshot</div>
          <div className="font-mono tabular-nums text-text">{money(data.state.snapshotEquity)}</div>
          <div className="text-[10px] text-dim">{fmtTime(data.state.snapshotAt || null)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">Current</div>
          <div className="font-mono tabular-nums text-text">{money(data.state.currentEquity)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">Drawdown</div>
          <div className={`font-mono tabular-nums ${ddTone}`}>
            {dd >= 0 ? '+' : ''}{dd.toFixed(2)}% / -{data.config.pct}%
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          disabled={busy}
          className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${
            enabled ? 'border-gain/50 bg-gain/10 text-gain' : 'border-border bg-panel-2 text-dim hover:text-text'
          }`}
        >
          <span className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-gain shadow-[0_0_6px_hsl(var(--gain))]' : 'bg-dim'}`} />
            {enabled ? 'Kill switch ENABLED' : 'Kill switch DISABLED'}
          </span>
          <span className="text-[10px] text-dim">click to toggle</span>
        </button>

        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">
            Daily drawdown limit (%)
          </span>
          <input
            type="number"
            min="1"
            max="90"
            step="1"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            disabled={busy}
            className={inputCls}
          />
          <span className="text-[10px] text-dim">
            Trips if account drops more than this % from today&apos;s UTC-midnight snapshot.
            Recommended range: 10–20%.
          </span>
        </label>

        {notice && (
          <p className={`text-xs ${notice.ok ? 'text-gain' : 'text-loss'}`}>{notice.text}</p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
