import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { GLOSSARY } from '@/lib/glossary'

// Renders a small ⓘ icon. On hover (desktop) or tap (mobile) shows a
// tooltip with the plain-English explanation of a technical term.
// Renders inside a React Portal to prevent overflow clipping.
//
// Usage:
//   <span>Sharpe Ratio <InfoTip term="Sharpe Ratio" /></span>
//   <InfoTip term="ATR" />

interface Props {
  /** Key into the GLOSSARY dictionary, or raw tooltip text. */
  term: string
  /** Override class on the icon wrapper. */
  className?: string
}

export default function InfoTip({ term, className }: Props) {
  const text = GLOSSARY[term] ?? term
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  const updateCoords = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setCoords({
        top: rect.top + window.scrollY - 8,
        left: rect.left + window.scrollX + rect.width / 2,
      })
    }
  }

  useEffect(() => {
    if (open) {
      updateCoords()
      window.addEventListener('resize', updateCoords)
      // Capture scroll events in any scrollable parent
      window.addEventListener('scroll', updateCoords, true)
    }
    return () => {
      window.removeEventListener('resize', updateCoords)
      window.removeEventListener('scroll', updateCoords, true)
    }
  }, [open])

  return (
    <span
      ref={triggerRef}
      className={`group relative inline-flex cursor-help align-middle ${className ?? ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      role="button"
      aria-label={`Info: ${term}`}
    >
      <Info className="h-3 w-3 text-dim transition-colors group-hover:text-muted" />

      {open &&
        createPortal(
          <span
            style={{
              position: 'absolute',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              transform: 'translate(-50%, -100%)',
            }}
            className="z-[9999] mb-0 w-64 rounded-lg border border-border bg-panel-2 px-3 py-2 text-left text-[11px] leading-relaxed text-muted shadow-lg shadow-black/40 animate-in pointer-events-none"
            role="tooltip"
          >
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-text">
              {term}
            </span>
            {text}
            {/* Arrow */}
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-border" />
          </span>,
          document.body
        )}
    </span>
  )
}

