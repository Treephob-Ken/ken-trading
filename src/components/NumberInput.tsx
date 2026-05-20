import { useEffect, useRef, useState } from 'react'

interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number | string
  placeholder?: string
  className?: string
  disabled?: boolean
}

// Numeric input that doesn't fight the user.
//
// The classic mistake — `value={Math.max(min, Number(e.target.value) || 0)}`
// snaps the field to `min` the moment you clear it, so editing is jittery.
// Here the textbox owns its own string buffer while focused; we push numeric
// updates to the parent as the user types (only when the value parses), and
// only clamp / re-format on blur.
export default function NumberInput({
  value, onChange, min, max, step, placeholder, className, disabled,
}: Props) {
  const [text, setText] = useState<string>(formatValue(value))
  const focused = useRef(false)

  // When the parent updates the value externally (preset click, etc.), sync
  // — but never while the user is mid-type.
  useEffect(() => {
    if (!focused.current) setText(formatValue(value))
  }, [value])

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      value={text}
      onFocus={() => { focused.current = true }}
      onBlur={() => {
        focused.current = false
        const n = parseFloat(text)
        if (!Number.isFinite(n)) {
          // Restore the last known good number
          setText(formatValue(value))
          return
        }
        const clamped = clamp(n, min, max)
        setText(formatValue(clamped))
        if (clamped !== value) onChange(clamped)
      }}
      onChange={(e) => {
        const next = e.target.value
        // Allow empty, '-', and partial decimals like '5.' or '.5'
        if (!/^-?\d*\.?\d*$/.test(next)) return
        setText(next)
        const n = parseFloat(next)
        if (Number.isFinite(n)) {
          // Don't clamp here — the user may still be typing.
          if (n !== value) onChange(n)
        }
      }}
      onKeyDown={(e) => {
        // Up/Down step like a native number input.
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        const s = typeof step === 'string' ? parseFloat(step) : (step ?? 1)
        const cur = parseFloat(text)
        const base = Number.isFinite(cur) ? cur : value
        const next = clamp(e.key === 'ArrowUp' ? base + s : base - s, min, max)
        setText(formatValue(next))
        onChange(next)
      }}
    />
  )
}

function clamp(n: number, min?: number, max?: number): number {
  if (min !== undefined && n < min) return min
  if (max !== undefined && n > max) return max
  return n
}

function formatValue(n: number): string {
  if (!Number.isFinite(n)) return ''
  // Drop trailing zeros: 0.01000 -> 0.01, 100.0 -> 100
  return String(n)
}
