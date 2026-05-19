export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '∞'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
