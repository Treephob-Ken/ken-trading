import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { SymbolInfo } from '@/lib/binance'
import {
  classifyMarket,
  filterByMarket,
  MARKET_OPTIONS,
  type Market,
} from '@/lib/marketClassify'

interface Props {
  value: string
  symbols: SymbolInfo[]
  onChange: (symbol: string) => void
}

const LS_MARKET = 'lab_market_filter'

function loadMarket(): Market | 'all' {
  const v = localStorage.getItem(LS_MARKET) as Market | 'all' | null
  if (!v) return 'all'
  if (MARKET_OPTIONS.some((o) => o.value === v)) return v
  return 'all'
}

// Strip the dex prefix from a HIP-3 base so the picker shows "GOLD" not "xyz:GOLD".
function prettyBase(base: string): string {
  const i = base.indexOf(':')
  return i < 0 ? base : base.slice(i + 1)
}

// We pull data from Binance (USDT pairs) but trade on Hyperliquid (USDC perps).
// Display the HL-side quote to match what the user actually trades.
function prettyQuote(quote: string): string {
  return quote === 'USDT' ? 'USDC' : quote
}

function marketBadge(market: Market): string {
  switch (market) {
    case 'crypto': return 'Crypto'
    case 'stocks': return 'Stock'
    case 'commodities': return 'Commod'
    case 'forex': return 'FX'
    case 'index': return 'Index'
    default: return ''
  }
}

export default function SymbolSearch({ value, symbols, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [market, setMarket] = useState<Market | 'all'>(() => loadMarket())
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(LS_MARKET, market)
  }, [market])

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
  const byMarket = filterByMarket(symbols, market)
  const filtered = (
    q ? byMarket.filter((s) => s.symbol.toUpperCase().includes(q) || s.base.toUpperCase().includes(q)) : byMarket
  ).slice(0, 120)

  const select = (symbol: string) => {
    onChange(symbol)
    setOpen(false)
    setQuery('')
  }

  // The Backtester stores the raw symbol (e.g. ETHUSDT or xyz:GOLD). We display
  // a friendlier pair label, falling back to the raw value while the list loads.
  const selected = symbols.find((s) => s.symbol === value)
  const displayValue = selected
    ? `${prettyBase(selected.base)}/${prettyQuote(selected.quote)}`
    : value

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
        <input
          className="field pl-8"
          value={open ? query : displayValue}
          placeholder={symbols.length ? 'Search any pair…' : 'Loading pairs…'}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
        />
      </div>
      {open && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-md border border-border bg-panel-2 shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <span className="text-[11px] uppercase tracking-wide text-dim">Market</span>
            <select
              className="field h-7 w-auto px-2 py-0 text-xs"
              value={market}
              onChange={(e) => setMarket(e.target.value as Market | 'all')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {MARKET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-dim">No pairs found</p>
            ) : (
              filtered.map((s) => {
                const m = classifyMarket(s.symbol)
                const badge = marketBadge(m)
                return (
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
                      {prettyBase(s.base)}
                      <span className="text-dim">/{prettyQuote(s.quote)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {badge && (
                        <span className="rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] uppercase text-dim">
                          {badge}
                        </span>
                      )}
                      <span className="font-mono text-[11px] text-dim">{prettyBase(s.base)}</span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
