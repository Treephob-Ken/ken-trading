// Translates scanner rows into a plain-English grade + reason. Used by
// both scan tabs so the page itself explains *why* a row is good or bad,
// instead of leaving the user to interpret the raw numbers.

import type { IndicatorScanRow } from './indicatorScan'
import type { GridScanRow } from './gridScan'

export type Grade = 'great' | 'good' | 'ok' | 'caution' | 'skip'

export interface Verdict {
  grade: Grade
  label: string         // short chip text, e.g. 'Strong'
  reason: string        // one-line plain-English explanation
}

// Plain-English haircut applied to backtest return. Real-money trading loses
// some of the edge to slippage, funding, and bad luck. 50% is a rough but
// honest rule of thumb. Capped at -100%.
export function realisticEstimatePct(backtestPct: number): number {
  if (backtestPct <= 0) return backtestPct
  return Math.max(-100, backtestPct * 0.5)
}

// One-line warning when the result shouldn't be trusted at face value.
// Returns null if there's no specific concern. Kept short on purpose.
export function realismWarning(opts: {
  totalReturnPct: number
  lookbackDays?: number
  sharpeRatio?: number
  looksAhead?: boolean
}): string | null {
  if (opts.looksAhead) return 'This strategy cheats with future info — ignore the numbers'
  if (opts.lookbackDays !== undefined && opts.lookbackDays < 60) {
    return `Only tested on ${opts.lookbackDays} days — may not repeat on a different month`
  }
  if (opts.sharpeRatio !== undefined && opts.sharpeRatio > 3) {
    return 'Score looks too good to be true — re-check on a longer lookback'
  }
  if (opts.totalReturnPct > 200) {
    return 'Huge return — likely a lucky window, not a repeatable edge'
  }
  return null
}

export function gradeColor(g: Grade): string {
  switch (g) {
    case 'great':   return 'text-gain'
    case 'good':    return 'text-brand'
    case 'ok':      return 'text-text'
    case 'caution': return 'text-warn'
    case 'skip':    return 'text-loss'
  }
}

export function gradeBg(g: Grade): string {
  switch (g) {
    case 'great':   return 'border-gain/40 bg-gain/10 text-gain'
    case 'good':    return 'border-brand/40 bg-brand/10 text-brand'
    case 'ok':      return 'border-border bg-panel-2 text-text'
    case 'caution': return 'border-warn/40 bg-warn/10 text-warn'
    case 'skip':    return 'border-loss/40 bg-loss/10 text-loss'
  }
}

// ── Indicator Scanner ─────────────────────────────────────────────────────
// Grades a row based on its Quality Score (0–100) which already combines
// risk-adjusted return, beats-buy-hold, trade count quality, realistic guess,
// HTF confluence, and funding penalty. The reason string explains in plain
// words WHY the row got that score so the user can sanity-check it.
export function gradeIndicatorRow(r: IndicatorScanRow): Verdict {
  // Look-ahead trumps everything else — the numbers are not real.
  if (r.looksAhead) {
    return {
      grade: 'skip',
      label: 'Looks fake',
      reason: 'This strategy uses future info to "predict" the past — backtest is not realistic',
    }
  }
  if (r.totalReturnPct <= 0) {
    return {
      grade: 'skip',
      label: 'Skip',
      reason: `Lost ${Math.abs(r.totalReturnPct).toFixed(1)}% in the test — strategy didn't fit this market`,
    }
  }
  if (r.numTrades < 5) {
    return {
      grade: 'caution',
      label: 'Too few trades',
      reason: `Only ${r.numTrades} trades — result may be a lucky one-off`,
    }
  }

  // Score-driven grade. Falls back to old return-based thresholds when
  // Quality Score isn't available (e.g. legacy persisted rows).
  const score = typeof r.qualityScore === 'number' ? r.qualityScore : null

  let grade: Grade
  let label: string
  if (score !== null) {
    if (score >= 75)       { grade = 'great';   label = 'Strong' }
    else if (score >= 55)  { grade = 'good';    label = 'Good' }
    else if (score >= 35)  { grade = 'ok';      label = 'OK' }
    else if (score >= 15)  { grade = 'caution'; label = 'Marginal' }
    else                    { grade = 'skip';    label = 'Skip' }
  } else {
    if (r.totalReturnPct >= 20 && r.numTrades >= 10 && r.winRate >= 45) {
      grade = 'great'; label = 'Strong'
    } else if (r.totalReturnPct >= 8 && r.numTrades >= 8) {
      grade = 'good'; label = 'Good'
    } else if (r.totalReturnPct >= 3) {
      grade = 'ok'; label = 'OK'
    } else {
      grade = 'caution'; label = 'Marginal'
    }
  }

  // Plain-language reason — listing the most important drivers.
  const parts: string[] = []
  if (r.totalReturnPct > r.buyHoldReturnPct) parts.push(`beats buy-hold`)
  else parts.push(`lost to buy-hold (${r.totalReturnPct.toFixed(1)}% vs ${r.buyHoldReturnPct.toFixed(1)}%)`)

  const calmar = r.calmar
  if (typeof calmar === 'number' && Number.isFinite(calmar)) {
    if (calmar >= 2) parts.push(`strong risk-reward (calmar ${calmar.toFixed(1)})`)
    else if (calmar >= 1) parts.push(`fair risk-reward (calmar ${calmar.toFixed(1)})`)
    else parts.push(`weak risk-reward (calmar ${calmar.toFixed(1)})`)
  }

  if (r.confluence === 'aligned') parts.push(`higher TF agrees`)
  else if (r.confluence === 'conflicting') parts.push(`higher TF disagrees`)

  if (typeof r.fundingApr === 'number' && Number.isFinite(r.fundingApr)) {
    if (r.fundingApr > 50) parts.push(`crowded longs (funding +${r.fundingApr.toFixed(0)}% APR)`)
    else if (r.fundingApr < -50) parts.push(`crowded shorts (funding ${r.fundingApr.toFixed(0)}% APR)`)
  }

  return { grade, label, reason: parts.join(' · ') }
}

// ── Grid Scanner ──────────────────────────────────────────────────────────
export function gradeGridRow(r: GridScanRow): Verdict {
  if (r.totalReturnPct < 0) {
    return {
      grade: 'skip',
      label: 'Skip',
      reason: `Simulated ${r.totalReturnPct.toFixed(1)}% loss — fees ate the gains`,
    }
  }
  if (r.regime !== 'Sideways') {
    return {
      grade: 'caution',
      label: 'Trending — risky',
      reason: `${r.regime} regime — grid will bleed if the trend continues`,
    }
  }
  if (r.spacingMultiple < 1.5) {
    return {
      grade: 'skip',
      label: 'Spacing too thin',
      reason: `Only ${r.spacingMultiple.toFixed(1)}× over breakeven — fees will swallow profits`,
    }
  }

  const parts: string[] = []
  if (r.totalReturnPct >= 8) parts.push(`strong +${r.totalReturnPct.toFixed(1)}% return`)
  else if (r.totalReturnPct >= 3) parts.push(`decent +${r.totalReturnPct.toFixed(1)}% return`)
  else parts.push(`small +${r.totalReturnPct.toFixed(1)}% return`)

  if (r.spacingMultiple >= 20) parts.push(`huge ${r.spacingMultiple.toFixed(0)}× fee margin`)
  else if (r.spacingMultiple >= 5) parts.push(`${r.spacingMultiple.toFixed(0)}× fee margin`)
  else parts.push(`tight ${r.spacingMultiple.toFixed(1)}× fee margin`)

  if (r.tradesPerDay < 0.5) {
    const gap = 1 / Math.max(0.01, r.tradesPerDay)
    parts.push(`but slow (~${gap.toFixed(0)} days between trades)`)
  } else if (r.tradesPerDay >= 2) {
    parts.push(`${r.tradesPerDay.toFixed(1)} trades/day`)
  }

  let grade: Grade
  let label: string
  if (r.totalReturnPct >= 8 && r.spacingMultiple >= 3 && r.tradesPerDay >= 1) {
    grade = 'great'; label = 'Strong'
  } else if (r.totalReturnPct >= 3 && r.spacingMultiple >= 3) {
    grade = r.tradesPerDay >= 1 ? 'good' : 'ok'
    label = r.tradesPerDay >= 1 ? 'Good' : 'Slow but solid'
  } else if (r.totalReturnPct >= 1) {
    grade = 'ok'; label = 'Marginal'
  } else {
    grade = 'caution'; label = 'Barely profitable'
  }

  return { grade, label, reason: parts.join(', ') }
}

export function timeAgo(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
