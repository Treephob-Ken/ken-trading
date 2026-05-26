import { useEffect, useState } from 'react'
import { apiFetch } from '@/contexts/AuthContext'
import InfoTip from '@/components/InfoTip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PositionInfo {
  asset: string; size: number; side: 'long' | 'short'
  entryPx: number | null; unrealizedPnl: number
  liquidationPx?: number | null
  leverage?: number
  marginUsed?: number
  positionValue?: number
  markPx?: number
}

interface AccountState {
  position: PositionInfo | null
  allPositions: PositionInfo[]
  currentPrice: number | null
}

interface PositionBrackets {
  slPx: number | null
  tpPx: number | null
}

interface Props {
  asset: string                          // e.g. "ZEC"
  pollMs?: number                        // defaults to 5_000
  onMarkPrice?: (px: number | null) => void  // surface mark price to parent for other cards
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

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

// ─── Card ─────────────────────────────────────────────────────────────────────

export default function LivePositionCard({ asset, pollMs = 5_000, onMarkPrice }: Props) {
  const [position, setPosition] = useState<PositionInfo | null>(null)
  const [brackets, setBrackets] = useState<PositionBrackets | null>(null)
  const [openSince, setOpenSince] = useState<number | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())

  // 1s tick for time-in-trade
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Poll account → grab this asset's position
  useEffect(() => {
    if (!asset) return
    let cancelled = false

    async function load() {
      try {
        const r = await apiFetch(`/api/account?asset=${encodeURIComponent(asset)}`)
        if (!r.ok) return
        const d = (await r.json()) as AccountState
        if (cancelled) return
        const a = asset.toUpperCase()
        const p = d.allPositions.find((x) => x.asset.toUpperCase() === a) ?? null
        // Reset open-since when a new position appears (or asset changes)
        setPosition((prev) => {
          if (!p) { setOpenSince(null); return null }
          if (!prev || prev.side !== p.side) setOpenSince(Date.now())
          return p
        })
        onMarkPrice?.(p?.markPx ?? d.currentPrice ?? null)
      } catch { /* tolerate */ }
    }

    async function loadBrackets() {
      try {
        // Only meaningful when we have a position with a side
        const p = position
        if (!p) { setBrackets(null); return }
        const r = await apiFetch(`/api/positions/${encodeURIComponent(asset)}/brackets?side=${p.side}`)
        if (!r.ok) return
        const d = (await r.json()) as PositionBrackets
        if (!cancelled) setBrackets(d)
      } catch { /* tolerate */ }
    }

    load()
    loadBrackets()
    const id = setInterval(() => { load(); loadBrackets() }, pollMs)
    return () => { cancelled = true; clearInterval(id) }
  // We deliberately re-poll when position.side flips so brackets refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, pollMs, position?.side])

  // ── No position state ─────────────────────────────────────────────────────
  if (!position) {
    return (
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Live position</h3>
          <span className="text-[10px] text-dim">{asset.toUpperCase()}</span>
        </div>
        <p className="text-[11px] text-dim leading-relaxed">
          No open position — waiting for the next signal.
        </p>
      </div>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const entry = position.entryPx ?? 0
  const mark = position.markPx ?? position.entryPx ?? 0
  const notional = position.positionValue ?? (position.size * mark)
  const pnlPct = entry > 0 && position.marginUsed
    ? (position.unrealizedPnl / position.marginUsed) * 100
    : null
  const pnlTone = position.unrealizedPnl > 0 ? 'text-gain' : position.unrealizedPnl < 0 ? 'text-loss' : 'text-text'

  const slPx = brackets?.slPx ?? null
  const tpPx = brackets?.tpPx ?? null

  // Loss / gain in $ when SL or TP is hit. Reduce-only at SL/TP price.
  const slLossUsd = slPx != null
    ? position.side === 'long'
      ? (slPx - entry) * position.size
      : (entry - slPx) * position.size
    : null
  const tpGainUsd = tpPx != null
    ? position.side === 'long'
      ? (tpPx - entry) * position.size
      : (entry - tpPx) * position.size
    : null

  const distToSlPct = slPx != null && mark > 0
    ? position.side === 'long'
      ? ((mark - slPx) / mark) * 100
      : ((slPx - mark) / mark) * 100
    : null
  const distToTpPct = tpPx != null && mark > 0
    ? position.side === 'long'
      ? ((tpPx - mark) / mark) * 100
      : ((mark - tpPx) / mark) * 100
    : null

  const liqDistPct = position.liquidationPx && mark > 0
    ? position.side === 'long'
      ? ((mark - position.liquidationPx) / mark) * 100
      : ((position.liquidationPx - mark) / mark) * 100
    : null
  const liqTone = liqDistPct == null ? 'text-text'
    : liqDistPct > 25 ? 'text-gain'
      : liqDistPct > 10 ? 'text-warn'
        : 'text-loss'

  const timeInTrade = openSince ? fmtDuration(now - openSince) : '—'

  const sideBadge = position.side === 'long'
    ? <span className="rounded-md bg-gain/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-gain">LONG</span>
    : <span className="rounded-md bg-loss/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-loss">SHORT</span>

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Live position</h3>
        <div className="flex items-center gap-2">
          {sideBadge}
          <span className="text-[10px] text-dim">{position.asset.toUpperCase()}</span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <Row
          k="Size"
          info="Notional value of this position in USDC at the current mark price."
          v={fmtUsd(notional)}
          sub={`${position.size.toFixed(6)} ${position.asset}`}
        />
        <Row
          k="PnL"
          info="Unrealized profit or loss in USDC. Percent is on margin (ROE)."
          v={`${position.unrealizedPnl >= 0 ? '+' : ''}${fmtUsd(position.unrealizedPnl)}`}
          sub={pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` : undefined}
          cls={pnlTone}
        />
        <Row
          k="Entry"
          info="Average fill price when the position was opened."
          v={fmtPrice(entry)}
        />
        <Row
          k="Mark"
          info="Hyperliquid mark price right now — used for PnL and liquidation."
          v={fmtPrice(mark)}
        />
        <Row
          k="Stop loss"
          info="The SL bracket order resting on the exchange. Closes the position if price hits it."
          v={slPx != null ? fmtPrice(slPx) : 'off'}
          sub={slPx != null && distToSlPct != null && slLossUsd != null
            ? `${distToSlPct >= 0 ? '−' : '+'}${Math.abs(distToSlPct).toFixed(2)}% · ${slLossUsd >= 0 ? '+' : ''}${fmtUsd(slLossUsd)}`
            : undefined}
          cls={slPx == null ? 'text-warn' : 'text-loss'}
        />
        <Row
          k="Take profit"
          info="The TP bracket order resting on the exchange. Closes the position if price hits it."
          v={tpPx != null ? fmtPrice(tpPx) : 'off'}
          sub={tpPx != null && distToTpPct != null && tpGainUsd != null
            ? `${distToTpPct >= 0 ? '+' : '−'}${Math.abs(distToTpPct).toFixed(2)}% · ${tpGainUsd >= 0 ? '+' : ''}${fmtUsd(tpGainUsd)}`
            : undefined}
          cls={tpPx == null ? 'text-dim' : 'text-gain'}
        />
        <Row
          k="Margin / Lev"
          info="USDC margin locked and the effective leverage on this position."
          v={`${fmtUsd(position.marginUsed)}${position.leverage ? `  ·  ${position.leverage}×` : ''}`}
        />
        <Row
          k="Liquidation"
          info="Price at which this position is force-closed. Distance below 10% is dangerous."
          v={position.liquidationPx ? fmtPrice(position.liquidationPx) : '—'}
          sub={liqDistPct != null ? `${liqDistPct.toFixed(1)}% away` : undefined}
          cls={liqTone}
        />
        <Row
          k="Time in trade"
          info="How long this position has been open (resets if side flips)."
          v={timeInTrade}
        />
      </dl>
    </div>
  )
}

function Row({
  k, info, v, sub, cls = 'text-text',
}: {
  k: string; info: string; v: string; sub?: string; cls?: string
}) {
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
