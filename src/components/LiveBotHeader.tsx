import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleDot, Square } from 'lucide-react'

export type BotState = 'running' | 'stopped' | 'error'

interface Props {
  /** Display name of the bot. */
  name: string
  state: BotState
  /** Optional asset/timeframe summary line. */
  summary?: string
  /** When the bot was started (epoch ms) — shown as relative uptime. */
  startedAt?: number | null
  /** Last signal direction, if any. */
  lastSignal?: 'buy' | 'sell' | null
  /** When the last signal fired (epoch ms). */
  lastSignalAt?: number | null
  /** Most recent error message, if any. */
  lastError?: string | null
  /** Number of trades executed during this session. */
  tradesExecuted?: number
  /** All-time stats for this bot (filtered by asset over HL fill history). */
  allTimeNetPnl?: number | null
  allTimeRoundTrips?: number | null
  allTimeWinRate?: number | null
}

function relativeTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const STATE_STYLES: Record<BotState, { ring: string; text: string; bg: string; dot: string; pulse: boolean; label: string }> = {
  running: { ring: 'ring-gain/40', text: 'text-gain', bg: 'bg-gain/10',  dot: 'bg-gain', pulse: true,  label: 'RUNNING' },
  stopped: { ring: 'ring-dim/40',  text: 'text-dim',  bg: 'bg-panel-2',  dot: 'bg-dim',  pulse: false, label: 'STOPPED' },
  error:   { ring: 'ring-loss/40', text: 'text-loss', bg: 'bg-loss/10',  dot: 'bg-loss', pulse: true,  label: 'ERROR'   },
}

/**
 * Header card for a live trading bot — always-visible status snapshot.
 * Shows pulse-dot status pill, name, summary line, uptime, last signal, and
 * surfaces any current error inline. Designed to read at a glance: green pulse
 * = healthy and trading, amber/red = needs attention.
 */
export default function LiveBotHeader({
  name,
  state,
  summary,
  startedAt,
  lastSignal,
  lastSignalAt,
  lastError,
  tradesExecuted,
  allTimeNetPnl,
  allTimeRoundTrips,
  allTimeWinRate,
}: Props) {
  const s = STATE_STYLES[state]

  const pnlTone: 'gain' | 'loss' | undefined =
    allTimeNetPnl == null ? undefined
    : allTimeNetPnl > 0 ? 'gain'
    : allTimeNetPnl < 0 ? 'loss'
    : undefined
  const pnlLabel = allTimeNetPnl == null
    ? null
    : `${allTimeNetPnl >= 0 ? '+$' : '−$'}${Math.abs(allTimeNetPnl).toFixed(2)} all-time`

  return (
    <div className={`card overflow-hidden ${s.bg}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {/* Pulse status pill */}
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${s.ring} ${s.text}`}>
          <span className="relative flex h-2 w-2">
            {s.pulse && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${s.dot}`} />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${s.dot}`} />
          </span>
          {s.label}
        </span>

        {/* Name + summary */}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-base font-bold text-text font-display">{name}</h2>
          {summary && <p className="truncate text-[11px] text-dim">{summary}</p>}
        </div>

        {/* Metric chips — only render the ones with data */}
        <div className="flex flex-wrap items-center gap-2">
          {state === 'running' && startedAt && (
            <Chip icon={<CircleDot className="h-3 w-3" />} label={`Up ${relativeTime(startedAt).replace(' ago', '')}`} />
          )}
          {state === 'stopped' && !lastError && (
            <Chip icon={<Square className="h-3 w-3" />} label="Idle" />
          )}
          {typeof tradesExecuted === 'number' && (
            <Chip label={`${tradesExecuted} trade${tradesExecuted === 1 ? '' : 's'} this session`} />
          )}
          {typeof allTimeRoundTrips === 'number' && allTimeRoundTrips > 0 && (
            <Chip label={`${allTimeRoundTrips} round-trip${allTimeRoundTrips === 1 ? '' : 's'}`} />
          )}
          {pnlLabel && (
            <Chip tone={pnlTone} label={pnlLabel} />
          )}
          {typeof allTimeWinRate === 'number' && typeof allTimeRoundTrips === 'number' && allTimeRoundTrips > 0 && (
            <Chip label={`${allTimeWinRate.toFixed(1)}% wins`} />
          )}
          {lastSignal && (
            <Chip
              tone={lastSignal === 'buy' ? 'gain' : 'loss'}
              icon={lastSignal === 'buy' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              label={`Last ${lastSignal.toUpperCase()} ${relativeTime(lastSignalAt)}`}
            />
          )}
        </div>
      </div>

      {/* Error banner — full-width strip under the header when present */}
      {lastError && (
        <div className="flex items-start gap-2 border-t border-loss/30 bg-loss/5 px-4 py-2 text-[11px] text-loss">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-relaxed">{lastError}</span>
        </div>
      )}
    </div>
  )
}

function Chip({ icon, label, tone }: { icon?: React.ReactNode; label: string; tone?: 'gain' | 'loss' }) {
  const cls =
    tone === 'gain'
      ? 'border-gain/30 bg-gain/10 text-gain'
      : tone === 'loss'
      ? 'border-loss/30 bg-loss/10 text-loss'
      : 'border-border bg-panel text-muted'
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-mono tabular-nums ${cls}`}>
      {icon}
      {label}
    </span>
  )
}
