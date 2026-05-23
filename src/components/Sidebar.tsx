import { CandlestickChart, LayoutGrid, LineChart } from 'lucide-react'

export type Page = 'backtest' | 'grid'

interface NavItem {
  id: Page
  icon: typeof LineChart
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'backtest', icon: LineChart, label: 'Strategy Backtester' },
  { id: 'grid', icon: LayoutGrid, label: 'Grid Optimizer' },
]

interface Props {
  page: Page
  onPage: (page: Page) => void
}

export default function Sidebar({ page, onPage }: Props) {
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
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const active = page === id
          return (
            <div key={id} className="relative group w-full">
              <button
                type="button"
                onClick={() => onPage(id)}
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

              {/* Floating label tooltip (appears to the right on hover) */}
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
                {/* Arrow pointing left */}
                <span
                  className="absolute right-full top-1/2 -translate-y-1/2
                             border-[5px] border-transparent border-r-border"
                />
                <span
                  className="absolute right-full top-1/2 -translate-y-1/2 translate-x-[1px]
                             border-[5px] border-transparent border-r-panel"
                />
              </div>
            </div>
          )
        })}
      </nav>

      {/* ── Subtle bottom accent ── */}
      <div className="h-[3px] w-full shrink-0 bg-gradient-to-r from-brand/40 via-brand/20 to-transparent" />
    </aside>
  )
}
