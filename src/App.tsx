import { useEffect, useState } from 'react'
import { CandlestickChart, LayoutGrid, LineChart } from 'lucide-react'
import { fetchSymbols, type SymbolInfo } from '@/lib/binance'
import BacktesterPage from '@/pages/BacktesterPage'
import GridPage from '@/pages/GridPage'

const FALLBACK_SYMBOLS: SymbolInfo[] = [
  { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT' },
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' },
  { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT' },
  { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT' },
  { symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT' },
]

type Page = 'backtest' | 'grid'

const TABS: { id: Page; label: string; icon: typeof LineChart }[] = [
  { id: 'backtest', label: 'Strategy Backtester', icon: LineChart },
  { id: 'grid', label: 'Grid Optimizer', icon: LayoutGrid },
]

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem('lab_page') as Page
    return saved === 'backtest' || saved === 'grid' ? saved : 'backtest'
  })
  const [symbol, setSymbol] = useState(() => localStorage.getItem('lab_symbol') || 'ETHUSDT')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('lab_timeframe') || '1h')
  const [symbols, setSymbols] = useState<SymbolInfo[]>(FALLBACK_SYMBOLS)

  useEffect(() => {
    localStorage.setItem('lab_page', page)
  }, [page])
  useEffect(() => {
    localStorage.setItem('lab_symbol', symbol)
  }, [symbol])
  useEffect(() => {
    localStorage.setItem('lab_timeframe', timeframe)
  }, [timeframe])

  // Load the full list of tradeable pairs once.
  useEffect(() => {
    let cancelled = false
    fetchSymbols()
      .then((list) => {
        if (!cancelled && list.length) setSymbols(list)
      })
      .catch(() => {
        /* keep fallback list */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const activeLabel = TABS.find((tab) => tab.id === page)?.label

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-[2200px] items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-panel">
              <CandlestickChart className="h-4 w-4 text-text" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight text-text font-display">
                Crypto Strategy Lab
              </h1>
              <p className="text-[11px] text-dim">
                Backtest indicators &amp; optimize grid bots on live market data
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 rounded-lg border border-border bg-panel p-1 font-display">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const active = page === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setPage(tab.id)}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-panel-2 text-text shadow-sm'
                      : 'text-dim hover:text-text'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="mx-auto max-w-[2200px] px-6 pb-2">
          <nav className="flex items-center gap-1.5 text-[11px] font-display">
            <span className="text-dim">Tools</span>
            <span className="text-border-strong">/</span>
            <span className="text-muted">{activeLabel}</span>
          </nav>
        </div>
      </header>

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
      <footer className="border-t border-border px-6 py-4 text-center text-[11px] text-dim">
        Backtests are simulations on historical data and do not predict future
        results. Not financial advice. Market data from Binance.
      </footer>
    </div>
  )
}
