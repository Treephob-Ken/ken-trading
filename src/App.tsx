import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { fetchSymbols, type SymbolInfo } from '@/lib/binance'
import { AuthProvider } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import BacktesterPage from '@/pages/BacktesterPage'
import GridPage from '@/pages/GridPage'
import LoginPage from '@/pages/LoginPage'
import ComingSoonPage from '@/pages/ComingSoonPage'

// ─── Fallback symbol list used before the HL asset list loads ─────────────────
const FALLBACK_SYMBOLS: SymbolInfo[] = [
  { symbol: 'ETHUSDT',  base: 'ETH',  quote: 'USDT' },
  { symbol: 'BTCUSDT',  base: 'BTC',  quote: 'USDT' },
  { symbol: 'SOLUSDT',  base: 'SOL',  quote: 'USDT' },
  { symbol: 'BNBUSDT',  base: 'BNB',  quote: 'USDT' },
  { symbol: 'XRPUSDT',  base: 'XRP',  quote: 'USDT' },
]

// ─── Shared layout for auth-gated pages ───────────────────────────────────────
function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* 3px brand accent stripe */}
        <div className="h-[3px] w-full shrink-0 bg-brand" />
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [symbol, setSymbol] = useState(() => localStorage.getItem('lab_symbol') || 'ETHUSDT')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('lab_timeframe') || '1h')
  const [symbols, setSymbols] = useState<SymbolInfo[]>(FALLBACK_SYMBOLS)

  useEffect(() => { localStorage.setItem('lab_symbol', symbol) }, [symbol])
  useEffect(() => { localStorage.setItem('lab_timeframe', timeframe) }, [timeframe])

  // Phase 1: still using Binance symbols (Phase 2 switches to HL assets via /api/assets)
  useEffect(() => {
    let cancelled = false
    fetchSymbols()
      .then((list) => { if (!cancelled && list.length) setSymbols(list) })
      .catch(() => { /* keep fallback list */ })
    return () => { cancelled = true }
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        {/* Public route — no auth check */}
        <Route path="/login" element={<LoginPage />} />

        {/* Auth-gated layout — all other paths */}
        <Route
          path="/"
          element={
            <AuthProvider>
              <AppShell />
            </AuthProvider>
          }
        >
          <Route index element={<Navigate to="/backtest" replace />} />

          <Route path="backtest" element={
            <BacktesterPage
              symbol={symbol}
              timeframe={timeframe}
              symbols={symbols}
              onSymbol={setSymbol}
              onTimeframe={setTimeframe}
            />
          } />

          <Route path="grid" element={
            <GridPage
              symbol={symbol}
              timeframe={timeframe}
              symbols={symbols}
              onSymbol={setSymbol}
              onTimeframe={setTimeframe}
            />
          } />

          {/* Phase 3 — Signal Bots (coming soon) */}
          <Route path="signal" element={<ComingSoonPage label="Signal Bots" />} />

          {/* Phase 4 — Grid Bots (coming soon) */}
          <Route path="bots" element={<ComingSoonPage label="Grid Bots" />} />

          {/* Phase 5 — Trade (coming soon) */}
          <Route path="trade" element={<ComingSoonPage label="Trade" />} />

          {/* Phase 5 — Logs (coming soon) */}
          <Route path="logs" element={<ComingSoonPage label="Logs" />} />

          {/* Catch-all → backtest */}
          <Route path="*" element={<Navigate to="/backtest" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
