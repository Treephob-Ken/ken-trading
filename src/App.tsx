import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import BacktesterPage from '@/pages/BacktesterPage'
import GridPage from '@/pages/GridPage'
import LoginPage from '@/pages/LoginPage'
import SignalBotsPage from '@/pages/SignalBotsPage'
import GridBotsPage from '@/pages/GridBotsPage'
import TradePage from '@/pages/TradePage'
import LogsPage from '@/pages/LogsPage'
import SettingsPage from '@/pages/SettingsPage'
import FundamentalsPage from '@/pages/FundamentalsPage'
import NetworkBadge from '@/components/NetworkBadge'
import KillSwitchBanner from '@/components/KillSwitchBanner'

// ─── Shared layout for auth-gated pages ───────────────────────────────────────
function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* 3px brand accent stripe */}
        <div className="h-[3px] w-full shrink-0 bg-brand" />
        <div className="absolute right-4 top-2 z-50">
          <NetworkBadge />
        </div>
        <KillSwitchBanner />
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  // Selected symbol and timeframe are shared across analytics pages.
  // The symbol list itself is fetched per-page via useHLAssets().
  const [symbol, setSymbol] = useState(() => localStorage.getItem('lab_symbol') || 'ETHUSDT')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('lab_timeframe') || '1h')

  useEffect(() => { localStorage.setItem('lab_symbol', symbol) }, [symbol])
  useEffect(() => { localStorage.setItem('lab_timeframe', timeframe) }, [timeframe])

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
              onSymbol={setSymbol}
              onTimeframe={setTimeframe}
            />
          } />

          <Route path="grid" element={
            <GridPage
              symbol={symbol}
              timeframe={timeframe}
              onSymbol={setSymbol}
              onTimeframe={setTimeframe}
            />
          } />

          {/* Phase 3 — Signal Bots */}
          <Route path="signal" element={<SignalBotsPage />} />

          {/* Phase 4 — Grid Bots */}
          <Route path="bots" element={<GridBotsPage />} />

          {/* Phase 5 — Trade */}
          <Route path="trade" element={<TradePage />} />

          {/* Phase 5 — Logs */}
          <Route path="logs" element={<LogsPage />} />

          {/* Fundamentals — sentiment, valuation, regime, verdict */}
          <Route path="fundamentals" element={<FundamentalsPage />} />

          {/* Settings */}
          <Route path="settings" element={<SettingsPage />} />

          {/* Catch-all → backtest */}
          <Route path="*" element={<Navigate to="/backtest" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
