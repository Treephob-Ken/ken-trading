import { Download, RefreshCw, Zap } from 'lucide-react'
import type { SymbolInfo } from '@/lib/binance'
import type { GridMode, GridType } from '@/lib/grid'
import SymbolSearch from './SymbolSearch'

const INTERVALS = ['5m', '15m', '30m', '1h', '4h', '1d']
const MODES: { id: GridMode; label: string }[] = [
  { id: 'arithmetic', label: 'Arithmetic' },
  { id: 'geometric', label: 'Geometric' },
]
const TYPES: { id: GridType; label: string }[] = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'long', label: 'Long' },
  { id: 'short', label: 'Short' },
]

export interface GridControlsProps {
  symbol: string
  symbols: SymbolInfo[]
  timeframe: string
  lookback: number
  mode: GridMode
  gridType: GridType
  minGrids: number
  maxGrids: number
  feePct: number
  investment: number
  reanchor: boolean
  loading: boolean
  canExport: boolean
  onSymbol: (v: string) => void
  onTimeframe: (v: string) => void
  onLookback: (v: number) => void
  onMode: (v: GridMode) => void
  onGridType: (v: GridType) => void
  onMinGrids: (v: number) => void
  onMaxGrids: (v: number) => void
  onFee: (v: number) => void
  onInvestment: (v: number) => void
  onReanchor: (v: boolean) => void
  onReload: () => void
  onExport: () => void
}

export default function GridControls(props: GridControlsProps) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="label">Market Pair</label>
        <SymbolSearch
          value={props.symbol}
          symbols={props.symbols}
          onChange={props.onSymbol}
        />
      </div>

      <div>
        <label className="label">Timeframe</label>
        <select
          className="field"
          value={props.timeframe}
          onChange={(e) => props.onTimeframe(e.target.value)}
        >
          {INTERVALS.map((iv) => (
            <option key={iv} value={iv}>
              {iv}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Lookback (bars)</label>
        <input
          type="number"
          className="field"
          value={props.lookback}
          min={20}
          max={1000}
          step={10}
          onChange={(e) =>
            props.onLookback(Math.max(20, Math.min(1000, Number(e.target.value) || 20)))
          }
        />
        <p className="mt-1.5 text-[11px] text-dim">
          The range high/low is taken from these recent bars.
        </p>
      </div>

      <div className="h-px bg-border" />

      <div>
        <label className="label">Grid Spacing</label>
        <div className="flex gap-1 rounded-md border border-border bg-bg p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`seg ${props.mode === m.id ? 'seg-active' : ''}`}
              onClick={() => props.onMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-dim">
          {props.mode === 'arithmetic'
            ? 'Equal price gap between lines.'
            : 'Equal % gap — better for volatile assets.'}
        </p>
      </div>

      <div>
        <label className="label">Grid Type</label>
        <div className="flex gap-1 rounded-md border border-border bg-bg p-1">
          {TYPES.map((tp) => (
            <button
              key={tp.id}
              className={`seg ${props.gridType === tp.id ? 'seg-active' : ''}`}
              onClick={() => props.onGridType(tp.id)}
            >
              {tp.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-dim">
          {props.gridType === 'neutral'
            ? 'Trades both sides of the current price.'
            : props.gridType === 'long'
              ? 'Only buys dips below the current price.'
              : 'Only sells rallies above the current price.'}
        </p>
      </div>

      <div>
        <label className="label">Grid Count to Test</label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <input
              type="number"
              className="field"
              value={props.minGrids}
              min={2}
              max={200}
              onChange={(e) =>
                props.onMinGrids(Math.max(2, Number(e.target.value) || 2))
              }
            />
            <p className="mt-1 text-center text-[10px] text-dim">min</p>
          </div>
          <div>
            <input
              type="number"
              className="field"
              value={props.maxGrids}
              min={2}
              max={200}
              onChange={(e) =>
                props.onMaxGrids(Math.max(2, Number(e.target.value) || 2))
              }
            />
            <p className="mt-1 text-center text-[10px] text-dim">max</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Investment ($)</label>
          <input
            type="number"
            className="field"
            value={props.investment}
            min={1}
            step={100}
            onChange={(e) =>
              props.onInvestment(Math.max(1, Number(e.target.value) || 0))
            }
          />
        </div>
        <div>
          <label className="label">Taker Fee / Side (%)</label>
          <input
            type="number"
            className="field"
            value={props.feePct}
            min={0}
            step={0.01}
            onChange={(e) => props.onFee(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-brand"
          checked={props.reanchor}
          onChange={(e) => props.onReanchor(e.target.checked)}
        />
        <span className="text-sm text-muted">Re-anchor grid to current price</span>
      </label>

      <button
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[.98] disabled:opacity-40"
        onClick={props.onReload}
        disabled={props.loading}
      >
        {props.loading
          ? <><RefreshCw className="h-4 w-4 animate-spin" /> Optimizing…</>
          : <><Zap className="h-4 w-4" /> Run Optimizer</>
        }
      </button>

      {props.canExport && (
        <>
          <div className="h-px bg-border" />
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-dim">Export to Bot</p>
            <button
              onClick={props.onExport}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand py-2.5 text-sm font-semibold text-brand transition hover:bg-brand hover:text-white active:scale-[.98]"
            >
              <Download className="h-4 w-4" />
              Download grid.config.json
            </button>
            <p className="mt-2 text-center text-[11px] text-dim">
              Drop the file in your{' '}
              <a href="http://localhost:3001" target="_blank" rel="noreferrer" className="text-brand hover:underline">
                Bot Dashboard
              </a>
            </p>
          </div>
        </>
      )}
    </div>
  )
}
