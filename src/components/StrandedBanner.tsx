// Stranded position banner — shown on a bot's detail panel when the bot is
// stopped but an open position still exists on the exchange for its asset.
// Surfaces the position summary + two actions (Resume / Close) so the user
// can either pick management back up or exit the trade in one click.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Play, X } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'

export interface StrandedPosition {
  side: 'long' | 'short'
  size: number
  entryPx: number | null
  unrealizedPnl: number
  markPx: number | null
}

interface Props {
  asset: string
  botName: string
  botKind: 'signal' | 'grid'
  position: StrandedPosition
  // Endpoint to POST to in order to resume the bot, e.g. /api/signal/bots/:id/start
  resumeEndpoint: string
  onAfterAction?: () => void
}

function fmtPrice(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(6)
}

function fmtUsd(v: number, sign = false): string {
  const s = sign && v >= 0 ? '+' : v < 0 ? '-' : ''
  return `${s}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function StrandedBanner({
  asset,
  botName,
  botKind,
  position,
  resumeEndpoint,
  onAfterAction,
}: Props) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<'resume' | 'close' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Compute % drift from entry — the safety context that lets the user decide
  // whether resuming the bot still makes sense.
  const drift =
    position.entryPx && position.markPx && position.entryPx > 0
      ? ((position.markPx - position.entryPx) / position.entryPx) * 100 *
        (position.side === 'long' ? 1 : -1)
      : null

  const sideTone = position.side === 'long' ? 'text-gain' : 'text-loss'
  const pnlTone = position.unrealizedPnl >= 0 ? 'text-gain' : 'text-loss'

  const onResume = async () => {
    setBusy('resume'); setError(null)
    try {
      const res = await apiFetch(resumeEndpoint, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || `HTTP ${res.status}`)
      }
      onAfterAction?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const onClose = async () => {
    setBusy('close'); setError(null)
    try {
      const res = await apiFetch('/api/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || `HTTP ${res.status}`)
      }
      onAfterAction?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card border border-warn/40 bg-warn/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warn" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-warn">
          Stranded position
        </span>
      </div>

      <p className="mb-3 text-xs text-text leading-relaxed">
        <span className="font-semibold">{botName}</span> is stopped, but{' '}
        <span className="font-mono font-semibold">{asset}</span> still has an open position
        on Hyperliquid.
      </p>

      {/* Position summary line */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        <span className="font-mono">
          <span className="font-mono font-bold text-text">{asset}</span>{' '}
          <span className={`font-bold ${sideTone}`}>{position.side.toUpperCase()}</span>{' '}
          <span className="text-text">{position.size}</span>
        </span>
        <span className="text-dim">
          entry <span className="font-mono text-text">{fmtPrice(position.entryPx)}</span>
        </span>
        <span className="text-dim">
          mark <span className="font-mono text-text">{fmtPrice(position.markPx)}</span>
        </span>
        <span className={`font-mono font-semibold ${pnlTone}`}>
          {fmtUsd(position.unrealizedPnl, true)}
          {drift != null && (
            <span className="ml-1 text-[10px] font-normal">
              ({drift >= 0 ? '+' : ''}{drift.toFixed(2)}%)
            </span>
          )}
        </span>
      </div>

      {/* Context line — drift since entry helps the user judge "still resume safely?" */}
      {drift != null && (
        <p className="mb-3 text-[11px] text-dim leading-snug">
          {drift >= 0 ? 'Trade is in profit.' : 'Trade is underwater.'}{' '}
          Price has moved {drift >= 0 ? '+' : ''}{drift.toFixed(2)}% from entry since the bot stopped.
          Resuming will have the bot manage this position normally; closing exits immediately via reduce-only market order.
        </p>
      )}

      {error && (
        <p className="mb-2 rounded-md border border-loss/30 bg-loss/10 px-2 py-1.5 text-[11px] text-loss">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onResume}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play className="h-3.5 w-3.5" />
          {busy === 'resume' ? 'Resuming…' : 'Resume bot'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg border border-loss/40 bg-loss/10 px-3 py-1.5 text-xs font-semibold text-loss hover:bg-loss/15 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <X className="h-3.5 w-3.5" />
          {busy === 'close' ? 'Closing…' : 'Close position'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/trade')}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-panel-2 px-3 py-1.5 text-xs text-dim hover:text-text"
        >
          Trade page <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <span className="ml-auto self-center text-[10px] text-dim">
          {botKind === 'signal' ? 'Signal bot' : 'Grid bot'}
        </span>
      </div>
    </div>
  )
}
