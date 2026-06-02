import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, RotateCcw } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'

// Mirrors DailyGuardState from bot/src/daily-guard.ts.
interface DailyGuard {
  config: { enabled: boolean; lossUsd: number; profitUsd: number }
  windowStart: number
  day: string | null
  realizedUsd: number | null
  tripped: boolean
  trippedAt: number | null
  reason: string | null
}

const inputCls =
  'w-full rounded-xl border border-border bg-panel-2 px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50'

function money(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  const s = n < 0 ? '-' : n > 0 ? '+' : ''
  return `${s}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
}
function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export default function DailyGuardCard() {
  const [data, setData] = useState<DailyGuard | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [lossUsd, setLossUsd] = useState('30')
  const [profitUsd, setProfitUsd] = useState('30')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)

  const load = () => {
    apiFetch('/api/daily-guard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DailyGuard | null) => {
        if (!d) return
        setData(d)
        setEnabled(d.config.enabled)
        setLossUsd(String(d.config.lossUsd))
        setProfitUsd(String(d.config.profitUsd))
      })
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [])

  const save = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetch('/api/daily-guard/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, lossUsd: Number(lossUsd), profitUsd: Number(profitUsd) }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setData(j)
      setNotice({ text: enabled ? 'Daily guard armed' : 'Daily guard disabled', ok: true })
    } catch (e) {
      setNotice({ text: `Save failed: ${(e as Error).message}`, ok: false })
    } finally {
      setBusy(false)
    }
  }

  const rearm = async () => {
    if (!confirm('Re-arm the daily guard now?\n\nThis clears the trip and starts a fresh window from this moment (today\'s already-realized PnL is set aside). Bots stay stopped — start them manually when ready.')) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetch('/api/daily-guard/rearm', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setData(j)
      setNotice({ text: 'Re-armed — window reset to now', ok: true })
    } catch (e) {
      setNotice({ text: `Re-arm failed: ${(e as Error).message}`, ok: false })
    } finally {
      setBusy(false)
    }
  }

  // Hidden in single-tenant mode (endpoint 404s → data stays null).
  if (!data) return null

  const realized = data.realizedUsd
  const realizedTone = realized == null ? 'text-dim' : realized > 0 ? 'text-gain' : realized < 0 ? 'text-loss' : 'text-text'
  const bannerTone = data.tripped
    ? 'border-warn/40 bg-warn/10 text-warn'
    : data.config.enabled
      ? 'border-gain/30 bg-gain/5 text-gain'
      : 'border-border bg-panel-2 text-dim'

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <div>
          <h2 className="text-sm font-semibold text-text">Daily PnL Guard</h2>
          <p className="mt-0.5 text-xs text-dim">
            A "don't overtrade" reminder. When your <strong>realized</strong> profit/loss for the day
            (from closed trades) hits +${profitUsd} or −${lossUsd}, it <strong>stops all your bots</strong> so
            no new trades fire. Open positions are left on their own SL/TP. Resets at UTC midnight.
          </p>
        </div>
      </div>

      {/* Status banner */}
      <div className={`mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${bannerTone}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${data.tripped ? 'bg-warn animate-pulse' : data.config.enabled ? 'bg-gain' : 'bg-dim'}`} />
        {data.tripped
          ? `Tripped ${fmtTime(data.trippedAt)} — bots stopped (positions left running)`
          : data.config.enabled
            ? 'Armed and watching today\'s realized PnL'
            : 'Disabled — turn on to cap your trading day'}
      </div>

      {/* Tripped detail + re-arm */}
      {data.tripped && (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn/5 p-3">
          <p className="text-xs font-semibold text-warn">{data.reason}</p>
          <p className="mt-1 text-xs text-warn/80">
            Restart bots from their pages when ready. It won't re-stop them today unless you re-arm.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={rearm}
            className="mt-3 flex items-center gap-2 rounded-xl bg-warn px-4 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Re-arm now (fresh window)
          </button>
        </div>
      )}

      {/* Today's realized PnL */}
      <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-border bg-panel-2 p-3 text-xs">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">Realized today</div>
          <div className={`font-mono tabular-nums ${realizedTone}`}>{money(realized)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">Limits</div>
          <div className="font-mono tabular-nums text-text">
            <span className="text-loss">−${lossUsd}</span> / <span className="text-gain">+${profitUsd}</span>
          </div>
        </div>
      </div>

      {/* Caution note */}
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/5 p-3 text-[11px] leading-relaxed text-warn">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <strong>Heads-up:</strong> this only <em>stops the bots</em> — it does not close positions. A bot
          set to exit only on the opposite signal (no Stop-Loss / Take-Profit) would leave its open position
          with <strong>no automatic exit</strong> until you restart it. Use this guard on bots that have an
          Auto SL / TP set, or close positions manually after it trips.
        </span>
      </div>

      {/* Config */}
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
            {enabled ? 'Daily guard ENABLED' : 'Daily guard DISABLED'}
          </span>
          <span className="text-[10px] text-dim">click to toggle</span>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">Daily loss limit ($)</span>
            <input type="number" min="0" step="1" value={lossUsd} disabled={busy}
              onChange={(e) => setLossUsd(e.target.value)} className={inputCls} />
            <span className="text-[10px] text-dim">Stop when down this much (realized). 0 = off.</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">Daily profit target ($)</span>
            <input type="number" min="0" step="1" value={profitUsd} disabled={busy}
              onChange={(e) => setProfitUsd(e.target.value)} className={inputCls} />
            <span className="text-[10px] text-dim">Stop when up this much (realized). 0 = off.</span>
          </label>
        </div>

        {notice && <p className={`text-xs ${notice.ok ? 'text-gain' : 'text-loss'}`}>{notice.text}</p>}

        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
