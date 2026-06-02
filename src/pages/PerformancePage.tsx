// Performance hub — merges the old Portfolio + Logs pages into one destination.
//
//   Overview     → account value, equity curve, PnL calendar, per-bot cards
//                  (the former Portfolio page, rendered as-is)
//   Round-Trips  ┐
//   Fills        ├ the former Logs page in `embedded` mode (forensic ledger:
//   Rejected     ┘ filters + table + CSV export, no duplicate KPI/leaderboard)
//
// Follows the standard Overview → Detail pattern: a dashboard first, then the
// full transaction ledger. The active tab persists in localStorage and is
// mirrored to the URL (?tab=) so deep links + the old /logs and /portfolio
// redirects land on the right view.

import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity } from 'lucide-react'
import PortfolioPage from '@/pages/PortfolioPage'
import LogsPage, { type TabId } from '@/pages/LogsPage'

type HubTab = 'overview' | TabId

const HUB_TABS: { id: HubTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'roundtrips', label: 'Round-Trips' },
  { id: 'fills', label: 'Fills' },
  { id: 'rejected', label: 'Rejected' },
]

const VALID = new Set<HubTab>(['overview', 'roundtrips', 'fills', 'rejected'])

function readInitialTab(param: string | null): HubTab {
  if (param && VALID.has(param as HubTab)) return param as HubTab
  const saved = localStorage.getItem('performance_tab')
  if (saved && VALID.has(saved as HubTab)) return saved as HubTab
  return 'overview'
}

export default function PerformancePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = readInitialTab(searchParams.get('tab'))

  useEffect(() => { localStorage.setItem('performance_tab', tab) }, [tab])

  const selectTab = (next: HubTab) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('tab', next)
      return p
    }, { replace: true })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Hub header: title + top tab bar ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2.5 sm:px-5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-brand" />
          <h1 className="text-sm font-semibold text-text font-display">Performance</h1>
        </div>
        <div className="flex items-center rounded-xl border border-border bg-panel-2 p-0.5">
          {HUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id ? 'bg-brand text-bg' : 'text-dim hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Active view ── */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'overview' ? (
          <PortfolioPage />
        ) : (
          <LogsPage embedded tab={tab} onTabChange={selectTab} />
        )}
      </div>
    </div>
  )
}
