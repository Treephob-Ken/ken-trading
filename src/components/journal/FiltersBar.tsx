import { useMemo } from 'react'

export type RangeKey = '24h' | '7d' | '30d'
export type SideFilter = 'all' | 'long' | 'short'
export type ResultFilter = 'all' | 'win' | 'loss'

export interface FilterState {
  range: RangeKey
  bot: string         // 'all' | botId | 'manual'
  asset: string       // 'all' | uppercased symbol
  side: SideFilter
  result: ResultFilter
  search: string
}

export interface BotOption {
  id: string          // botId or the literal 'manual'
  name: string
}

interface Props {
  state: FilterState
  onChange: (next: FilterState) => void
  bots: BotOption[]
  assets: string[]
  showResult: boolean // hidden on Fills tab where there's no win/loss yet
}

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
]

const segWrap = 'flex items-center rounded-xl border border-border bg-panel-2 p-0.5'
const segBtn = (active: boolean) =>
  `rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
    active ? 'bg-brand text-bg' : 'text-dim hover:text-text'
  }`

export default function FiltersBar({ state, onChange, bots, assets, showResult }: Props) {
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => onChange({ ...state, [k]: v })

  const anyActive = useMemo(
    () =>
      state.bot !== 'all' ||
      state.asset !== 'all' ||
      state.side !== 'all' ||
      state.result !== 'all' ||
      state.search.length > 0,
    [state],
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Date range */}
      <div className={segWrap}>
        {RANGES.map((r) => (
          <button key={r.key} type="button" className={segBtn(state.range === r.key)} onClick={() => set('range', r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      {/* Bot */}
      {bots.length > 0 && (
        <select
          value={state.bot}
          onChange={(e) => set('bot', e.target.value)}
          className="rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-brand/60"
          aria-label="Filter by bot"
        >
          <option value="all">All bots</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      )}

      {/* Asset */}
      {assets.length > 0 && (
        <select
          value={state.asset}
          onChange={(e) => set('asset', e.target.value)}
          className="rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-brand/60"
          aria-label="Filter by asset"
        >
          <option value="all">All assets</option>
          {assets.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      )}

      {/* Side */}
      <div className={segWrap}>
        {(['all', 'long', 'short'] as SideFilter[]).map((s) => (
          <button key={s} type="button" className={segBtn(state.side === s)} onClick={() => set('side', s)}>
            {s === 'all' ? 'Any' : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Result — only on Round-Trips tab */}
      {showResult && (
        <div className={segWrap}>
          {(['all', 'win', 'loss'] as ResultFilter[]).map((r) => (
            <button key={r} type="button" className={segBtn(state.result === r)} onClick={() => set('result', r)}>
              {r === 'all' ? 'Result' : r === 'win' ? 'Wins' : 'Losses'}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        value={state.search}
        onChange={(e) => set('search', e.target.value)}
        placeholder="Search…"
        className="w-32 rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-brand/60"
        aria-label="Search rows"
      />

      {/* Clear all — only renders when something is active. :has() in CSS would
          also work but JSX-side is unambiguous for the screen reader. */}
      {anyActive && (
        <button
          type="button"
          onClick={() =>
            onChange({ ...state, bot: 'all', asset: 'all', side: 'all', result: 'all', search: '' })
          }
          className="rounded-lg border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-dim hover:text-text"
        >
          Clear
        </button>
      )}
    </div>
  )
}
