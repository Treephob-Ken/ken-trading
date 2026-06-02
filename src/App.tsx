import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import BacktesterPage from '@/pages/BacktesterPage'
import GridPage from '@/pages/GridPage'
import LoginPage from '@/pages/LoginPage'
import SignalBotsPage from '@/pages/SignalBotsPage'
import GridBotsPage from '@/pages/GridBotsPage'
import TradePage from '@/pages/TradePage'
import PerformancePage from '@/pages/PerformancePage'
import BuilderPage from '@/pages/BuilderPage'
import SettingsPage from '@/pages/SettingsPage'
import FundamentalsPage from '@/pages/FundamentalsPage'
import ScannerPage from '@/pages/ScannerPage'
import KillSwitchBanner from '@/components/KillSwitchBanner'

const MarketStructurePage = lazy(() => import('@/pages/MarketStructurePage'))

// ─── Shared layout for auth-gated pages ───────────────────────────────────────
function AppShell() {
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      {/* pt-12 on mobile clears the fixed mobile top bar; no offset on lg+ (rail is in-flow). */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0 pt-12 lg:pt-0">
        {/* 3px brand accent stripe */}
        <div className="h-[3px] w-full shrink-0 bg-brand" />
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

  // Global fix for number inputs: select the contents on focus so typing
  // REPLACES the value instead of gluing onto it (the "03" / stuck-leading-zero
  // glitch). Applies app-wide to every <input type="number"> without touching
  // each field.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement && t.type === 'number') {
        requestAnimationFrame(() => { try { t.select() } catch { /* some inputs disallow select() */ } })
      }
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
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

          {/* Performance — merged hub: Overview (portfolio) + Round-Trips/Fills/Rejected (logs) */}
          <Route path="performance" element={<PerformancePage />} />
          {/* Back-compat: old bookmarks land on the right tab of the hub */}
          <Route path="logs" element={<Navigate to="/performance?tab=roundtrips" replace />} />
          <Route path="portfolio" element={<Navigate to="/performance?tab=overview" replace />} />

          {/* Strategy Builder — combine indicator conditions with AND/OR */}
          <Route path="builder" element={<BuilderPage />} />

          {/* Scanner — batch-rank symbols × strategies, feeds Backtester + Grid pages */}
          <Route path="scanner" element={
            <ScannerPage onSymbol={setSymbol} onTimeframe={setTimeframe} />
          } />

          {/* Market Structure — LuxAlgo SMC port (swing structure, BOS/CHoCH, strong/weak) */}
          <Route path="structure" element={
            <Suspense fallback={<div className="p-6 text-sm text-dim">Loading…</div>}>
              <MarketStructurePage onSymbol={setSymbol} onTimeframe={setTimeframe} />
            </Suspense>
          } />

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
