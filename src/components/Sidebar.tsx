import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowUpDown,
  BotMessageSquare,
  Brain,
  CandlestickChart,
  Hammer,
  LayoutGrid,
  LineChart,
  LogOut,
  Menu,
  Network,
  Radar,
  Radio,
  Settings,
  X,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import NetworkBadge from '@/components/NetworkBadge'

interface NavItem {
  path: string
  icon: typeof LineChart
  label: string
}

// Grouped so the everyday loop (find → test → run → review) sits up top and the
// heavier analytics tools are demoted to an "Advanced" cluster below a divider.
const NAV_GROUPS: NavItem[][] = [
  // Find & test
  [
    { path: '/scanner',  icon: Radar,      label: 'Scanner'             },
    { path: '/backtest', icon: LineChart,  label: 'Strategy Backtester' },
    { path: '/builder',  icon: Hammer,     label: 'Strategy Builder'    },
  ],
  // Trade & bots
  [
    { path: '/signal', icon: Radio,            label: 'Signal Bots' },
    { path: '/bots',   icon: BotMessageSquare, label: 'Grid Bots'   },
    { path: '/trade',  icon: ArrowUpDown,      label: 'Trade'       },
  ],
  // Review
  [
    { path: '/performance', icon: Activity, label: 'Performance' },
  ],
  // Advanced analytics
  [
    { path: '/structure',    icon: Network,    label: 'Market Structure' },
    { path: '/grid',         icon: LayoutGrid, label: 'Grid Optimizer'   },
    { path: '/fundamentals', icon: Brain,      label: 'Fundamentals'     },
  ],
  // System
  [
    { path: '/settings', icon: Settings, label: 'Settings' },
  ],
]

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()
  // Mobile drawer open state. Desktop (lg+) shows the fixed rail and ignores this.
  const [open, setOpen] = useState(false)

  // Close the drawer whenever the route changes (a nav tap navigated us).
  useEffect(() => { setOpen(false) }, [location.pathname])

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/')

  return (
    <>
      {/* ══ Mobile top bar — only < lg. Holds the menu trigger + brand + network. ══ */}
      <header className="lg:hidden fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-3 border-b border-border bg-panel/95 px-3 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-brand/30 bg-brand/10">
            <CandlestickChart className="h-4 w-4 text-brand" />
          </div>
          <span className="text-sm font-semibold text-text font-display">Garlic Trading</span>
        </div>
        <div className="ml-auto"><NetworkBadge /></div>
      </header>

      {/* ══ Mobile drawer — labelled nav. Slides over content; backdrop closes it. ══ */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[82vw] flex-col border-r border-border bg-panel">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
              <span className="text-sm font-semibold text-text">Menu</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-dim hover:text-text"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              {NAV_GROUPS.map((group, gi) => (
                <div key={gi}>
                  {gi > 0 && <div className="my-2 h-px bg-border" />}
                  {group.map(({ path, icon: Icon, label }) => {
                    const active = isActive(path)
                    return (
                      <button
                        key={path}
                        type="button"
                        onClick={() => navigate(path)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                          active ? 'bg-brand/15 text-brand' : 'text-dim hover:bg-panel-2 hover:text-text'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {label}
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>
            <button
              type="button"
              onClick={() => { setOpen(false); logout() }}
              className="m-2 flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-dim transition-colors hover:bg-panel-2 hover:text-text"
            >
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </aside>
        </div>
      )}

      {/* ══ Desktop rail — only lg+. ══ */}
      <aside className="relative hidden lg:flex flex-col h-dvh w-[60px] shrink-0 border-r border-border bg-panel/90 backdrop-blur-sm z-50">
      {/* ── Brand logo ── */}
      <div className="flex items-center justify-center h-[60px] shrink-0 border-b border-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand/30 bg-brand/10">
          <CandlestickChart className="h-[18px] w-[18px] text-brand" />
        </div>
      </div>

      {/* ── Nav items (grouped, divider between groups) ── */}
      <nav className="flex flex-col items-center gap-1 p-2 pt-3 flex-1">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className="flex w-full flex-col items-center gap-1">
            {gi > 0 && <div className="my-1 h-px w-7 bg-border" />}
            {group.map(({ path, icon: Icon, label }) => {
          const active = location.pathname === path || location.pathname.startsWith(path + '/')
          return (
            <div key={path} className="relative group w-full">
              <button
                type="button"
                onClick={() => navigate(path)}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center justify-center w-full h-10 rounded-xl transition-all duration-200 ${
                  active
                    ? 'bg-brand/15 text-brand'
                    : 'text-dim hover:text-text hover:bg-panel-2'
                }`}
              >
                {/* Left active bar */}
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all duration-200 ${
                    active ? 'h-5 bg-brand opacity-100' : 'h-0 opacity-0'
                  }`}
                />
                <Icon className="h-4 w-4 shrink-0" />
              </button>

              {/* Floating label tooltip */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 z-[100]
                           whitespace-nowrap rounded-lg border border-border bg-panel px-3 py-1.5
                           text-xs font-medium text-text shadow-lg
                           opacity-0 translate-x-[-6px]
                           transition-all duration-150 ease-out
                           group-hover:opacity-100 group-hover:translate-x-0
                           group-focus-within:opacity-100 group-focus-within:translate-x-0"
              >
                {label}
                <span className="absolute right-full top-1/2 -translate-y-1/2
                                 border-[5px] border-transparent border-r-border" />
                <span className="absolute right-full top-1/2 -translate-y-1/2 translate-x-[1px]
                                 border-[5px] border-transparent border-r-panel" />
              </div>
            </div>
          )
            })}
          </div>
        ))}
      </nav>

      {/* ── Network badge ── */}
      <div className="flex flex-col items-center px-2 pb-1">
        <NetworkBadge />
      </div>

      {/* ── Logout button ── */}
      <div className="flex flex-col items-center p-2 pb-3">
        <div className="relative group w-full">
          <button
            type="button"
            onClick={logout}
            aria-label="Log out"
            className="flex items-center justify-center w-full h-10 rounded-xl text-dim hover:text-text hover:bg-panel-2 transition-all duration-200"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" />
            </svg>
          </button>
          <div aria-hidden="true"
               className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 z-[100]
                          whitespace-nowrap rounded-lg border border-border bg-panel px-3 py-1.5
                          text-xs font-medium text-text shadow-lg
                          opacity-0 translate-x-[-6px]
                          transition-all duration-150 ease-out
                          group-hover:opacity-100 group-hover:translate-x-0
                          group-focus-within:opacity-100 group-focus-within:translate-x-0">
            Log out
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-border" />
            <span className="absolute right-full top-1/2 -translate-y-1/2 translate-x-[1px] border-[5px] border-transparent border-r-panel" />
          </div>
        </div>
      </div>

      {/* ── Subtle bottom accent ── */}
      <div className="h-[3px] w-full shrink-0 bg-gradient-to-r from-brand/40 via-brand/20 to-transparent" />
    </aside>
    </>
  )
}
