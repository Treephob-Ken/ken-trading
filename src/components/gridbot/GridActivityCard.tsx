import { useEffect, useState } from 'react'
import InfoTip from '@/components/InfoTip'

// Narrow slice of BotStats this card actually reads. The page passes its full
// stats object through; props are intentionally optional so older bot versions
// (no diagnostics fields yet) render gracefully with "—".

interface ActivityStats {
  asset: string
  startedAt: number
  state: string
  currentPrice: number
  fills: number
  roundtrips: number
  lines: number[]
  lastFillAt?: number | null
  lastRoundtripAt?: number | null
  fillsPerHour?: number
  roundtripsPerHour?: number
  gridPositionPct?: number | null
  nearestLineIdx?: number | null
  distanceToNearestLinePct?: number | null
}

interface Props { stats: ActivityStats }

function fmtRelative(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtRate(perHour: number | undefined): string {
  if (perHour == null || !Number.isFinite(perHour)) return '—'
  if (perHour < 0.5) return '<1 /h'
  if (perHour < 10) return `${perHour.toFixed(1)} /h`
  return `${Math.round(perHour)} /h`
}

export default function GridActivityCard({ stats }: Props) {
  // 1s ticker so "time since last fill" reads as live without re-polling.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const lastFillText = stats.lastFillAt ? fmtRelative(now - stats.lastFillAt) : 'no fills yet'
  const lastRtText = stats.lastRoundtripAt ? fmtRelative(now - stats.lastRoundtripAt) : 'none yet'

  // Roundtrips-per-day projection from the rolling hourly rate.
  const rtPerDay = (stats.roundtripsPerHour ?? 0) * 24
  const projection = rtPerDay >= 1 ? `≈ ${Math.round(rtPerDay)} /day projected` : 'too quiet to project'

  // Grid position label — which zone of the grid is price in?
  const pos = stats.gridPositionPct
  let zoneLabel = '—'
  let zoneTone: 'gain' | 'warn' | 'loss' | 'text' = 'text'
  if (pos != null) {
    if (pos < 25) { zoneLabel = 'bottom 25%'; zoneTone = 'gain' }
    else if (pos < 50) { zoneLabel = 'lower half'; zoneTone = 'text' }
    else if (pos < 75) { zoneLabel = 'upper half'; zoneTone = 'text' }
    else { zoneLabel = 'top 25%'; zoneTone = 'warn' }
  }

  const nearestLineText = stats.nearestLineIdx != null && stats.distanceToNearestLinePct != null
    ? `line ${stats.nearestLineIdx + 1} of ${stats.lines.length} · ${stats.distanceToNearestLinePct.toFixed(2)}% away`
    : '—'

  // Stale-fill warning — if it's been more than 2× the average rt interval and the bot is live.
  const minutesSinceFill = stats.lastFillAt ? (now - stats.lastFillAt) / 60_000 : Infinity
  const rtPerHour = stats.roundtripsPerHour ?? 0
  const expectedMinutesPerRt = rtPerHour > 0 ? 60 / rtPerHour : null
  const isStale = stats.state === 'live'
    && expectedMinutesPerRt != null
    && minutesSinceFill > expectedMinutesPerRt * 2
    && minutesSinceFill > 10

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Grid activity</h3>
        <span className="text-[10px] text-dim">last 1h rolling</span>
      </div>

      {/* Top rates */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-panel-2 px-3 py-2">
          <div className="flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-dim">
            Fills / hour
            <InfoTip term="How often the grid is filling orders, normalized to a per-hour rate over the rolling 1h window (or scaled up for younger bots)." />
          </div>
          <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-text">
            {fmtRate(stats.fillsPerHour)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-panel-2 px-3 py-2">
          <div className="flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-dim">
            Roundtrips / hour
            <InfoTip term="Buy + matching sell pairs that locked in realized PnL. The real money-maker rate." />
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="font-mono text-lg font-bold tabular-nums text-gain">{fmtRate(stats.roundtripsPerHour)}</span>
            <span className="text-[10px] text-dim">{projection}</span>
          </div>
        </div>
      </div>

      {/* Detail rows */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <Row
          k="Last fill"
          info="When the most recent order on this bot filled — buy or sell."
          v={lastFillText}
          tone={isStale ? 'warn' : 'text'}
          sub={isStale ? 'unusually quiet' : undefined}
        />
        <Row
          k="Last roundtrip"
          info="When a buy + matching sell most recently closed for realized PnL."
          v={lastRtText}
        />
        <Row
          k="Grid position"
          info="Where the live price sits between your configured Lower and Upper bounds. Top 25% means most of your buy orders are deep below current price; bottom 25% means most sell orders are far above. The middle is the sweet spot."
          v={pos != null ? `${pos.toFixed(1)}%` : '—'}
          sub={zoneLabel}
          tone={zoneTone}
        />
        <Row
          k="Nearest line"
          info="The closest grid line to the current price. Tells you how soon the next fill might happen."
          v={nearestLineText}
        />
      </dl>

      {/* Grid position bar — visual of where price sits in the lower/upper range */}
      {pos != null && (
        <div className="mt-3">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg">
            <div className="absolute inset-y-0 left-0 right-0 bg-gradient-to-r from-gain/20 via-text/10 to-warn/20" />
            <div
              className="absolute top-0 h-full w-0.5 bg-brand"
              style={{ left: `${pos}%` }}
              title={`Price sits at ${pos.toFixed(1)}% of the grid range`}
            />
          </div>
          <div className="mt-1 flex justify-between text-[9px] font-mono text-dim tabular-nums">
            <span>lower</span>
            <span>price</span>
            <span>upper</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({
  k, info, v, sub, tone = 'text',
}: {
  k: string; info: string; v: string; sub?: string
  tone?: 'gain' | 'loss' | 'warn' | 'text'
}) {
  const cls =
    tone === 'gain' ? 'text-gain' :
    tone === 'loss' ? 'text-loss' :
    tone === 'warn' ? 'text-warn' :
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
