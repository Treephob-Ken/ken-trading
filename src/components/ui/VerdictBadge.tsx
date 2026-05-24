import { Check, Pause, X } from 'lucide-react'
import type { BacktestResult } from '@/types'
import type { RegimeAnalysis } from '@/lib/markov'
import InfoTip from '@/components/InfoTip'

export type VerdictKind = 'trade' | 'wait' | 'avoid'

export interface VerdictResult {
  kind: VerdictKind
  headline: string
  reasons: string[]
}

// Pure decision function — single source of truth for the Trade/Wait/Avoid call.
// Thresholds chosen for the "capital preservation + consistent profit" persona:
// strong edge AND tolerable drawdown AND enough trades to be statistically real.
export function decideVerdict(
  result: BacktestResult,
  regime: RegimeAnalysis | null,
): VerdictResult {
  const m = result.metrics
  const reasons: string[] = []

  if (m.numTrades === 0) {
    return {
      kind: 'wait',
      headline: 'No signals in this window',
      reasons: ['Try a different strategy, direction, or date range.'],
    }
  }

  if (m.numTrades < 10) {
    reasons.push(`Only ${m.numTrades} trade${m.numTrades === 1 ? '' : 's'} — too few to trust the numbers.`)
  }

  const beatsBenchmark = m.totalReturnPct > m.buyHoldReturnPct
  const profitable = m.totalReturnPct > 5
  const drawdownOk = m.maxDrawdownPct < 25
  const drawdownAggressive = m.maxDrawdownPct >= 25
  const pfStrong = Number.isFinite(m.profitFactor) ? m.profitFactor >= 1.5 : true
  const sharpeOk = Number.isFinite(m.sharpeRatio) ? m.sharpeRatio >= 0.5 : false

  if (profitable) reasons.push(`Returned ${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct.toFixed(1)}% across the window.`)
  else if (m.totalReturnPct > 0) reasons.push(`Marginally profitable (+${m.totalReturnPct.toFixed(1)}%) — edge is thin.`)
  else reasons.push(`Lost ${Math.abs(m.totalReturnPct).toFixed(1)}% in this window.`)

  if (beatsBenchmark) reasons.push(`Beat Buy & Hold by ${(m.totalReturnPct - m.buyHoldReturnPct).toFixed(1)}%.`)
  else reasons.push(`Lagged Buy & Hold by ${(m.buyHoldReturnPct - m.totalReturnPct).toFixed(1)}%.`)

  if (drawdownAggressive) reasons.push(`Max drawdown ${m.maxDrawdownPct.toFixed(1)}% is aggressive — size carefully.`)
  if (Number.isFinite(m.profitFactor) && m.profitFactor < 1) reasons.push(`Profit factor ${m.profitFactor.toFixed(2)} — losses outweigh wins.`)

  if (regime?.currentLabel) {
    reasons.push(`Current regime: ${regime.currentLabel}${regime.conviction != null ? ` (${Math.round(Math.abs(regime.conviction) * 100)}% conviction)` : ''}.`)
  }

  // Decision
  let kind: VerdictKind
  if (profitable && drawdownOk && pfStrong && sharpeOk && beatsBenchmark && m.numTrades >= 10) {
    kind = 'trade'
  } else if (m.totalReturnPct < -5 || (Number.isFinite(m.profitFactor) && m.profitFactor < 0.9) || m.maxDrawdownPct > 40) {
    kind = 'avoid'
  } else {
    kind = 'wait'
  }

  const headline =
    kind === 'trade'
      ? 'Looks tradeable — but size for the drawdown'
      : kind === 'avoid'
      ? "Don't trade this — edge is missing or risk is too high"
      : 'Marginal — wait for a clearer setup'

  return { kind, headline, reasons }
}

const KIND_STYLES: Record<VerdictKind, { ring: string; bg: string; text: string; icon: typeof Check; label: string }> = {
  trade: { ring: 'ring-gain/40', bg: 'bg-gain/10',  text: 'text-gain', icon: Check, label: 'TRADE' },
  wait:  { ring: 'ring-warn/40', bg: 'bg-warn/10',  text: 'text-warn', icon: Pause, label: 'WAIT'  },
  avoid: { ring: 'ring-loss/40', bg: 'bg-loss/10',  text: 'text-loss', icon: X,     label: 'AVOID' },
}

interface Props {
  verdict: VerdictResult
  size?: 'sm' | 'lg'
}

export default function VerdictBadge({ verdict, size = 'lg' }: Props) {
  const s = KIND_STYLES[verdict.kind]
  const Icon = s.icon
  const isLg = size === 'lg'

  return (
    <div className={`rounded-lg border border-border bg-panel-2 ${isLg ? 'p-4' : 'p-3'}`}>
      <div className="mb-2 flex items-center text-[11px] font-medium uppercase tracking-wider text-dim font-display">
        Should I trade this?
        <InfoTip term="Verdict" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold ring-1 ${s.ring} ${s.bg} ${s.text}`}
        >
          <Icon className="h-4 w-4" strokeWidth={3} />
          {s.label}
        </span>
        <span className={`${isLg ? 'text-sm' : 'text-xs'} font-semibold ${s.text}`}>
          {verdict.headline}
        </span>
      </div>
      {verdict.reasons.length > 0 && (
        <ul className="mt-2.5 space-y-1 text-[12px] leading-relaxed text-muted">
          {verdict.reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-dim" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
