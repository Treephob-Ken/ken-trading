import { useEffect, useState } from 'react'
import { fetchSymbols, type SymbolInfo } from '@/lib/binance'
import Sidebar, { type Page } from '@/components/Sidebar'
import BacktesterPage from '@/pages/BacktesterPage'
import GridPage from '@/pages/GridPage'

const FALLBACK_SYMBOLS: SymbolInfo[] = [
  { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT' },
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' },
  { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT' },
  { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT' },
  { symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT' },
]

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem('lab_page') as Page
    return saved === 'backtest' || saved === 'grid' ? saved : 'backtest'
  })
  const [symbol, setSymbol] = useState(() => localStorage.getItem('lab_symbol') || 'ETHUSDT')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('lab_timeframe') || '1h')
  const [symbols, setSymbols] = useState<SymbolInfo[]>(FALLBACK_SYMBOLS)

  useEffect(() => { localStorage.setItem('lab_page', page) }, [page])
  useEffect(() => { localStorage.setItem('lab_symbol', symbol) }, [symbol])
  useEffect(() => { localStorage.setItem('lab_timeframe', timeframe) }, [timeframe])

  useEffect(() => {
    let cancelled = false
    fetchSymbols()
      .then((list) => { if (!cancelled && list.length) setSymbols(list) })
      .catch(() => { /* keep fallback list */ })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Left icon nav rail ── */}
      <Sidebar page={page} onPage={setPage} />

      {/* ── Main content area ── */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* 3px brand accent stripe */}
        <div className="h-[3px] w-full shrink-0 bg-brand" />

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {page === 'backtest' && (
            <BacktesterPage
              symbol={symbol}
              timeframe={timeframe}
              symbols={symbols}
              onSymbol={setSymbol}
              onTimeframe={setTimeframe}
            />
          )}
          {page === 'grid' && (
            <GridPage
              symbol={symbol}
              timeframe={timeframe}
              symbols={symbols}
              onSymbol={setSymbol}
              onTimeframe={setTimeframe}
            />
          )}

        </div>
      </div>
    </div>
  )
}
