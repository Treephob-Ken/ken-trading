import { useEffect, useState } from 'react'
import InfoTip from '@/components/InfoTip'

// ─── Types ────────────────────────────────────────────────────────────────────
// Mirrors the slice of SignalBotStatus this card actually reads. Kept narrow on
// purpose so the page can pass its existing status object straight through.

interface CardStatus {
  running: boolean
  startedAt: number | null
  config: { timeframe: string; cooldownSec: number; mtfTimeframe?: string; asset: string }
  computedSize?: number | null
  lastSignal: 'buy' | 'sell' | null
  lastSignalAt: number | null
  lastClosedBarTime?: number | null
  mtfTrend?: 'buy' | 'sell' | null
  dailyPnlPct?: number | null
  dailyPaused?: boolean
  lastTradeAt?: number
}

interface Props {
  status: CardStatus
  lastPrice: number | null    // last close from the chart — used to compute "Size now" in USD
}

// ─── Timeframe → milliseconds ─────────────────────────────────────────────────
// Inlined intentionally — no shared util exists and this is the only consumer.

const TF_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
  '12h': 43_200_000, '1d': 86_400_000,
}

function tfMs(tf: string): number { return TF_MS[tf] ?? 0 }

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function fmtRelative(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtUsd(v: number): string {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export default function LiveStatusCard({ status, lastPrice }: Props) {
  // 1s ticker so time-based rows feel alive without re-polling the API.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const uptime = status.startedAt ? fmtDuration(now - status.startedAt) : '—'

  const tf = tfMs(status.config.timeframe)
  // lastClosedBarTime is in seconds (Lightweight Charts convention from
  // mapKlines in bot/src/strategy/market-data.ts), so convert to ms here.
  const lastBarMs = status.lastClosedBarTime ? status.lastClosedBarTime * 1000 : null
  const lastBarText = lastBarMs
    ? fmtRelative(now - lastBarMs)
    : '—'
  // Next bar = next floor of (now / tf) − now. Uses lastClosedBarTime when
  // available so we line up with the exchange's bar boundaries.
  let nextBarText = '—'
  if (tf > 0) {
    const anchor = lastBarMs ?? now
    const next = Math.ceil((now - anchor) / tf) * tf + anchor
    const remaining = next - now
    nextBarText = remaining > 0 ? fmtDuration(remaining) : '<1s'
  }

  const cdMs = status.config.cooldownSec * 1000
  let cooldownText = 'ready'
  let cooldownTone: 'gain' | 'warn' | 'text' = 'gain'
  if (cdMs > 0 && status.lastTradeAt) {
    const sinceLast = now - status.lastTradeAt
    if (sinceLast < cdMs) {
      cooldownText = fmtDuration(cdMs - sinceLast) + ' left'
      cooldownTone = 'warn'
    }
  }

  const mtfChip = status.mtfTrend
    ? status.mtfTrend === 'buy' ? '↑ BUY' : '↓ SELL'
    : null
  const mtfAgrees = mtfChip != null && status.lastSignal != null
    ? status.mtfTrend === status.lastSignal
    : null

  const dailyTone: 'gain' | 'loss' | 'text' =
    status.dailyPnlPct == null ? 'text'
    : status.dailyPnlPct > 0 ? 'gain'
    : status.dailyPnlPct < 0 ? 'loss' : 'text'

  const sizeUsd = status.computedSize && lastPrice ? status.computedSize * lastPrice : null

  const lastSigText = status.lastSignal && status.lastSignalAt
    ? `${status.lastSignal === 'buy' ? '↑ BUY' : '↓ SELL'} · ${fmtRelative(now - status.lastSignalAt)}`
    : 'none yet'
  const lastSigTone = status.lastSignal === 'buy' ? 'gain' : status.lastSignal === 'sell' ? 'loss' : 'text'

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Live status</h3>
        <span className={`flex items-center gap-1.5 text-[10px] ${status.running ? 'text-gain' : 'text-dim'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.running ? 'bg-gain animate-pulse' : 'bg-border'}`} />
          {status.running ? 'running' : 'stopped'}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <Row k="Uptime" info="How long the bot has been running since you last started it." v={uptime} />
        <Row k="Last bar" info="When the last closed bar arrived. The bot only acts on closed bars." v={lastBarText} />
        <Row k="Next bar" info="Time until the next bar closes on this timeframe. The next evaluation happens then." v={nextBarText} tone="brand" />
        <Row k="Cooldown" info="Minimum seconds between auto-trades. While counting down, new signals are skipped." v={cooldownText} tone={cooldownTone} />
        <Row
          k="MTF agree"
          info="The last signal seen on the higher timeframe. Trades that disagree are blocked when MTF is enabled."
          v={mtfChip ? `${mtfChip}${status.config.mtfTimeframe ? ` (${status.config.mtfTimeframe})` : ''}` : '—'}
          sub={mtfAgrees == null ? undefined : mtfAgrees ? '✓ agrees with signal' : '✗ disagrees'}
          tone={mtfAgrees == null ? 'text' : mtfAgrees ? 'gain' : 'warn'}
        />
        <Row
          k="Daily PnL"
          info="Today's equity move vs the UTC-midnight snapshot. New entries pause if the loss limit is hit."
          v={status.dailyPnlPct == null ? '—' : `${status.dailyPnlPct > 0 ? '+' : ''}${status.dailyPnlPct.toFixed(2)}%`}
          sub={status.dailyPaused ? 'PAUSED' : undefined}
          tone={dailyTone}
        />
        <Row
          k="Size now"
          info="The next order's quantity, computed live from your risk/budget settings and the current price."
          v={status.computedSize ? `${status.computedSize.toFixed(6)} ${status.config.asset}` : '—'}
          sub={sizeUsd != null ? fmtUsd(sizeUsd) : undefined}
        />
        <Row
          k="Last signal"
          info="The most recent actionable signal the strategy produced — whether or not it was executed."
          v={lastSigText}
          tone={lastSigTone}
        />
      </dl>
    </div>
  )
}

function Row({
  k, info, v, sub, tone = 'text',
}: {
  k: string; info: string; v: string; sub?: string
  tone?: 'gain' | 'loss' | 'warn' | 'brand' | 'text'
}) {
  const cls =
    tone === 'gain' ? 'text-gain' :
    tone === 'loss' ? 'text-loss' :
    tone === 'warn' ? 'text-warn' :
    tone === 'brand' ? 'text-brand' :
    'text-text'
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-dim">
        {k}
        <InfoTip term={info} />
      </dt>
      <dd className={`font-mono tabular-nums ${cls}`}>
        {v}
        {sub && <span className="ml-1 text-[10px] text-dim">{sub}</span>}
      </dd>
    </div>
  )
}
