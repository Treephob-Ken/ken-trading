import InfoTip from '@/components/InfoTip'

interface AssetCtx {
  midPx?: number
  markPx?: number
  funding?: number       // hourly rate, signed
  openInterest?: number
  prevDayPx?: number
  dayNtlVlm?: number
  oraclePx?: number
  maxLeverage?: number
}

interface Props {
  asset: string | null
  ctx: AssetCtx | null
}

function fmtCompactUsd(v?: number): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(2)}`
}

function fmtCompactUnit(v?: number): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

// Hyperliquid funding is paid continuously, quoted as an hourly rate.
// Annualized = hourly × 24 × 365.
function fmtFunding(hourly?: number): { hourlyPct: string; apr: string; tone: 'gain' | 'loss' | 'neutral' } {
  if (hourly == null || !Number.isFinite(hourly)) {
    return { hourlyPct: '—', apr: '—', tone: 'neutral' }
  }
  const hourlyPct = (hourly * 100).toFixed(4) + '%'
  const apr = (hourly * 24 * 365 * 100).toFixed(1) + '%'
  const tone: 'gain' | 'loss' | 'neutral' = hourly > 0 ? 'loss' : hourly < 0 ? 'gain' : 'neutral'
  return { hourlyPct: (hourly > 0 ? '+' : '') + hourlyPct, apr: (hourly > 0 ? '+' : '') + apr, tone }
}

// Minutes until the next HL funding payment (top of every UTC hour).
function minutesToNextFunding(): number {
  const now = new Date()
  const next = new Date(now)
  next.setUTCMinutes(0, 0, 0)
  next.setUTCHours(next.getUTCHours() + 1)
  return Math.max(0, Math.round((next.getTime() - now.getTime()) / 60_000))
}

export default function AssetInfoCard({ asset, ctx }: Props) {
  if (!asset) {
    return (
      <div className="card p-4">
        <h3 className="mb-1 text-sm font-semibold text-text">Asset Info</h3>
        <p className="text-[11px] text-dim">Pick an asset above to see funding, volume, and market stats.</p>
      </div>
    )
  }

  const fund = fmtFunding(ctx?.funding)
  const change24h =
    ctx?.markPx != null && ctx?.prevDayPx != null && ctx.prevDayPx > 0
      ? ((ctx.markPx - ctx.prevDayPx) / ctx.prevDayPx) * 100
      : null
  const changeTone = change24h == null ? 'text-text' : change24h > 0 ? 'text-gain' : change24h < 0 ? 'text-loss' : 'text-text'
  const oiUsd = ctx?.openInterest != null && ctx?.markPx != null ? ctx.openInterest * ctx.markPx : undefined
  const oracleSpread =
    ctx?.markPx != null && ctx?.oraclePx != null && ctx.oraclePx > 0
      ? ((ctx.markPx - ctx.oraclePx) / ctx.oraclePx) * 100
      : null

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">
          {asset}/USDC <span className="text-[11px] font-normal text-dim">market</span>
        </h3>
        <span className="rounded-md border border-border bg-panel-2 px-2 py-0.5 font-mono text-[10px] tabular-nums text-dim">
          {ctx?.maxLeverage ? `${ctx.maxLeverage}× max` : '—'}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <Row
          k="Funding (1h)"
          info="Hyperliquid funding is paid every hour. Positive = longs pay shorts; negative = shorts pay longs. The annualized rate is shown below in parentheses."
          v={fund.hourlyPct}
          sub={`${fund.apr} APR`}
          tone={fund.tone}
        />
        <Row
          k="Next funding"
          info="Time until the next hourly funding payment, settled on the open position size at that moment."
          v={`${minutesToNextFunding()}m`}
          sub="hourly · UTC"
        />
        <Row
          k="24h change"
          info="Mark price now vs 24h ago, in percent."
          v={change24h == null ? '—' : `${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%`}
          tone={change24h == null ? 'neutral' : change24h > 0 ? 'gain' : change24h < 0 ? 'loss' : 'neutral'}
        />
        <Row
          k="24h volume"
          info="Total notional traded across the entire HL perp market for this asset in the last 24 hours."
          v={fmtCompactUsd(ctx?.dayNtlVlm)}
        />
        <Row
          k="Open interest"
          info="Total size held in open positions across all traders. High OI = lots of skin in the game."
          v={fmtCompactUnit(ctx?.openInterest)}
          sub={oiUsd != null ? fmtCompactUsd(oiUsd) : undefined}
        />
        <Row
          k="Oracle vs mark"
          info="Oracle is the external reference price. Mark is what HL uses for PnL and liquidations. A wide gap can signal a fast move or thin book."
          v={oracleSpread == null ? '—' : `${oracleSpread > 0 ? '+' : ''}${oracleSpread.toFixed(3)}%`}
          tone={oracleSpread == null ? 'neutral' : Math.abs(oracleSpread) > 0.05 ? 'warn' : 'neutral'}
        />
      </dl>

      {/* Quick tape line */}
      {ctx?.markPx != null && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[10px] text-dim">
          <span>Mark</span>
          <span className={`font-mono tabular-nums ${changeTone}`}>${ctx.markPx.toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
        </div>
      )}
    </div>
  )
}

function Row({
  k,
  info,
  v,
  sub,
  tone = 'neutral',
}: {
  k: string
  info: string
  v: string
  sub?: string
  tone?: 'gain' | 'loss' | 'warn' | 'neutral'
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
