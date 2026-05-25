// Tiny CSV helper — no library. Handles commas, quotes, newlines, nulls.

function escapeCell(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function toCsv<T extends object>(rows: T[], columns: Array<keyof T | { key: keyof T; label: string }>): string {
  if (rows.length === 0) return ''
  const headers = columns.map((c) => (typeof c === 'object' ? c.label : String(c)))
  const keys = columns.map((c) => (typeof c === 'object' ? c.key : c))
  const lines = [headers.map(escapeCell).join(',')]
  for (const row of rows) {
    lines.push(keys.map((k) => escapeCell(row[k])).join(','))
  }
  return lines.join('\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
