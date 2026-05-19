import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { SymbolInfo } from '@/lib/binance'

interface Props {
  value: string
  symbols: SymbolInfo[]
  onChange: (symbol: string) => void
}

export default function SymbolSearch({ value, symbols, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const q = query.trim().toUpperCase()
  const filtered = (
    q ? symbols.filter((s) => s.symbol.includes(q) || s.base.includes(q)) : symbols
  ).slice(0, 80)

  const select = (symbol: string) => {
    onChange(symbol)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
        <input
          className="field pl-8"
          value={open ? query : value}
          placeholder={symbols.length ? 'Search any pair…' : 'Loading pairs…'}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
        />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-panel-2 py-1 shadow-2xl">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-dim">No pairs found</p>
          ) : (
            filtered.map((s) => (
              <button
                key={s.symbol}
                onMouseDown={(e) => {
                  e.preventDefault()
                  select(s.symbol)
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition-colors hover:bg-bg ${
                  s.symbol === value ? 'text-brand' : 'text-text'
                }`}
              >
                <span className="font-medium">
                  {s.base}
                  <span className="text-dim">/{s.quote}</span>
                </span>
                <span className="font-mono text-[11px] text-dim">{s.symbol}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
