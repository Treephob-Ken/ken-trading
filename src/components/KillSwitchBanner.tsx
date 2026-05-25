import { useEffect, useState } from 'react'
import { AlertOctagon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiFetch } from '@/contexts/AuthContext'

interface KillSwitchData {
  state: {
    tripped: boolean
    trippedAt: number | null
    trippedAtEquity: number | null
    snapshotEquity: number | null
    reason: string | null
  }
}

function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

// Shown above every page when the kill switch is tripped. Self-polls every
// 10s so the banner appears/disappears without a refresh.
export default function KillSwitchBanner() {
  const [tripped, setTripped] = useState<KillSwitchData['state'] | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      apiFetch('/api/killswitch')
        .then(r => r.ok ? r.json() : null)
        .then((d: KillSwitchData | null) => {
          if (cancelled) return
          setTripped(d?.state.tripped ? d.state : null)
        })
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 10_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!tripped) return null

  return (
    <div className="border-b border-loss/40 bg-loss/10 px-4 py-2.5">
      <div className="flex items-start gap-3 text-loss">
        <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 animate-pulse" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider">
            🛑 Kill switch tripped at {fmtTime(tripped.trippedAt)}
          </p>
          <p className="mt-0.5 text-xs text-loss/90 truncate">
            {tripped.reason ?? 'Daily drawdown limit exceeded.'} All bots stopped. All positions closed.
          </p>
        </div>
        <Link
          to="/settings"
          className="shrink-0 rounded-lg border border-loss/60 bg-loss/20 px-3 py-1.5 text-xs font-semibold text-loss hover:bg-loss/30 transition-colors"
        >
          Review & resume →
        </Link>
      </div>
    </div>
  )
}
