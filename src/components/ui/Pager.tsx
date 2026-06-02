import type { ReactNode } from 'react'

// Reusable numeric pager: « first · ‹ prev · [1 … 4 5 6 … 20] · next › · last »
// Emits a CONSTANT number of slots once there are enough pages, so the control
// never changes width as you click (no side-to-side jump). Pages are 0-based.

export default function Pager({ page, totalPages, onPage, className = '' }: {
  page: number
  totalPages: number
  onPage: (p: number) => void
  className?: string
}) {
  if (totalPages <= 1) return null
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Btn onClick={() => onPage(0)} disabled={page === 0} label="First page">«</Btn>
      <Btn onClick={() => onPage(page - 1)} disabled={page === 0} label="Previous page">‹</Btn>
      {buildPageWindow(page, totalPages).map((p, i) =>
        p === -1 ? (
          <span
            key={`gap-${i}`}
            aria-hidden="true"
            className="inline-flex min-w-[28px] items-center justify-center text-[11px] text-dim"
          >…</span>
        ) : (
          <Btn key={p} onClick={() => onPage(p)} active={p === page} label={`Page ${p + 1}`}>{p + 1}</Btn>
        ),
      )}
      <Btn onClick={() => onPage(page + 1)} disabled={page === totalPages - 1} label="Next page">›</Btn>
      <Btn onClick={() => onPage(totalPages - 1)} disabled={page === totalPages - 1} label="Last page">»</Btn>
    </div>
  )
}

function Btn({ children, onClick, disabled, active, label }: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`min-w-[28px] rounded-md border px-2 py-1 text-[11px] tabular-nums transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? 'border-brand bg-brand/10 text-brand font-semibold'
          : 'border-border bg-panel-2 text-dim hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

// First + last + a window around the current page; -1 marks an ellipsis. With
// one sibling each side that's 7 numeric slots once total > 7.
function buildPageWindow(current: number, total: number): number[] {
  const SIBLINGS = 1
  if (total <= SIBLINGS * 2 + 5) return Array.from({ length: total }, (_, i) => i)
  const last = total - 1
  const left = Math.max(current - SIBLINGS, 0)
  const right = Math.min(current + SIBLINGS, last)
  const showLeftDots = left > 1
  const showRightDots = right < last - 1
  const edgeCount = 3 + 2 * SIBLINGS
  if (!showLeftDots && showRightDots) {
    const head = Array.from({ length: edgeCount }, (_, i) => i)
    return [...head, -1, last]
  }
  if (showLeftDots && !showRightDots) {
    const tail = Array.from({ length: edgeCount }, (_, i) => total - edgeCount + i)
    return [0, -1, ...tail]
  }
  const mid = Array.from({ length: right - left + 1 }, (_, i) => left + i)
  return [0, -1, ...mid, -1, last]
}
