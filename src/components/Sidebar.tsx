import { useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowUpDown,
  BotMessageSquare,
  Brain,
  Briefcase,
  CandlestickChart,
  Hammer,
  LayoutGrid,
  LineChart,
  Radar,
  Radio,
  Settings,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import NetworkBadge from '@/components/NetworkBadge'

interface NavItem {
  path: string
  icon: typeof LineChart
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { path: '/backtest', icon: LineChart,       label: 'Strategy Backtester' },
  { path: '/scanner',  icon: Radar,            label: 'Scanner'             },
  { path: '/grid',    icon: LayoutGrid,       label: 'Grid Optimizer'      },
  { path: '/builder', icon: Hammer,           label: 'Strategy Builder'    },
  { path: '/signal',  icon: Radio,            label: 'Signal Bots'         },
  { path: '/bots',    icon: BotMessageSquare, label: 'Grid Bots'           },
  { path: '/fundamentals', icon: Brain,       label: 'Fundamentals'        },
  { path: '/trade',    icon: ArrowUpDown,      label: 'Trade'               },
  { path: '/portfolio', icon: Briefcase,       label: 'Portfolio'           },
  { path: '/logs',     icon: Activity,         label: 'Logs'                },
  { path: '/settings', icon: Settings,         label: 'Settings'            },
]

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <aside className="relative flex flex-col h-screen w-[60px] shrink-0 border-r border-border bg-panel/90 backdrop-blur-sm z-50">
      {/* ── Brand logo ── */}
      <div className="flex items-center justify-center h-[60px] shrink-0 border-b border-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand/30 bg-brand/10">
          <CandlestickChart className="h-[18px] w-[18px] text-brand" />
        </div>
      </div>

      {/* ── Nav items ── */}
      <nav className="flex flex-col items-center gap-1 p-2 pt-3 flex-1">
        {NAV_ITEMS.map(({ path, icon: Icon, label }) => {
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
                           group-hover:opacity-100 group-hover:translate-x-0"
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
                          group-hover:opacity-100 group-hover:translate-x-0">
            Log out
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-border" />
            <span className="absolute right-full top-1/2 -translate-y-1/2 translate-x-[1px] border-[5px] border-transparent border-r-panel" />
          </div>
        </div>
      </div>

      {/* ── Subtle bottom accent ── */}
      <div className="h-[3px] w-full shrink-0 bg-gradient-to-r from-brand/40 via-brand/20 to-transparent" />
    </aside>
  )
}
