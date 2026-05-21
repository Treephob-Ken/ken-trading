import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Direction, StrategyId } from '@/types'
import type { SymbolInfo } from '@/lib/binance'
import { STRATEGIES, strategyMeta } from '@/lib/strategies'
import NumberInput from './NumberInput'
import SymbolSearch from './SymbolSearch'
import InfoTip from './InfoTip'

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']
const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: 'long', label: 'Long' },
  { id: 'short', label: 'Short' },
  { id: 'both', label: 'Long & Short' },
]
const PRESETS: { label: string; days: number }[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y', days: 365 },
]

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface Props {
  symbol: string
  symbols: SymbolInfo[]
  timeframe: string
  startDate: string
  endDate: string
  strategyId: StrategyId
  params: Record<string, number>
  direction: Direction
  initialCapital: number
  feePct: number
  stopLossPct: number
  takeProfitPct: number
  positionMode: 'fixed' | 'compounding' | 'volatility'
  targetRiskPct: number
  atrMultiplier: number
  loading: boolean
  onSymbol: (v: string) => void
  onTimeframe: (v: string) => void
  onStartDate: (v: string) => void
  onEndDate: (v: string) => void
  onStrategy: (v: StrategyId) => void
  onParam: (key: string, value: number) => void
  onDirection: (v: Direction) => void
  onCapital: (v: number) => void
  onFee: (v: number) => void
  onStopLoss: (v: number) => void
  onTakeProfit: (v: number) => void
  onPositionMode: (v: 'fixed' | 'compounding' | 'volatility') => void
  onTargetRisk: (v: number) => void
  onAtrMultiplier: (v: number) => void
  onReload: () => void
}

export default function Controls(props: Props) {
  const meta = strategyMeta(props.strategyId)
  const today = isoDate(new Date())

  const grouped = useMemo(() => {
    const map = new Map<string, typeof STRATEGIES>()
    for (const s of STRATEGIES) {
      const list = map.get(s.category) ?? []
      list.push(s)
      map.set(s.category, list)
    }
    return [...map.entries()]
  }, [])

  const applyPreset = (days: number) => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - days)
    props.onStartDate(isoDate(start))
    props.onEndDate(isoDate(end))
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="label flex items-center gap-1">
          Market Pair
          <InfoTip term="Market Pair" className="text-dim hover:text-muted" />
        </label>
        <SymbolSearch
          value={props.symbol}
          symbols={props.symbols}
          onChange={props.onSymbol}
        />
      </div>

      <div>
        <label className="label flex items-center gap-1">
          Timeframe
          <InfoTip term="Timeframe" className="text-dim hover:text-muted" />
        </label>
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
        <label className="label flex items-center gap-1">
          Date Range
          <InfoTip term="Date Range" className="text-dim hover:text-muted" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            className="field"
            value={props.startDate}
            max={props.endDate || today}
            onChange={(e) => props.onStartDate(e.target.value)}
          />
          <input
            type="date"
            className="field"
            value={props.endDate}
            min={props.startDate}
            max={today}
            onChange={(e) => props.onEndDate(e.target.value)}
          />
        </div>
        <div className="mt-2 flex gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="flex-1 rounded-md border border-border bg-panel-2 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-text"
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className="flex-1 rounded-md border border-border bg-panel-2 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-text"
            onClick={() => {
              props.onStartDate('')
              props.onEndDate('')
            }}
          >
            Max
          </button>
        </div>
        <button
          type="button"
          className={`mt-2 w-full flex items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-semibold transition-all ${
            props.endDate === ''
              ? 'border-gain/40 bg-gain/10 text-gain shadow-[0_0_8px_rgba(34,197,94,0.15)]'
              : 'border-border bg-panel hover:bg-panel-2 text-muted hover:text-text'
          }`}
          onClick={() => {
            props.onEndDate('')
          }}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${props.endDate === '' ? 'bg-gain animate-pulse' : 'bg-dim'}`} />
          {props.endDate === '' ? 'Live Mode Active' : 'Switch to Live Mode'}
        </button>
        {!props.startDate && (
          <p className="mt-1.5 text-[11px] text-dim">
            Showing the most recent 1000 candles.
          </p>
        )}
      </div>

      <div className="h-px bg-border" />

      <div>
        <label className="label flex items-center gap-1">
          Strategy
          <InfoTip term="Strategy" className="text-dim hover:text-muted" />
        </label>
        <select
          className="field"
          value={props.strategyId}
          onChange={(e) => props.onStrategy(e.target.value as StrategyId)}
        >
          {grouped.map(([category, list]) => (
            <optgroup key={category} label={category}>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-2 text-xs leading-relaxed text-muted">{meta.description}</p>
      </div>

      <div>
        <label className="label flex items-center gap-1">
          Parameters
          <InfoTip term="Parameters" className="text-dim hover:text-muted" />
        </label>
        <div className="flex flex-col gap-2.5">
          {meta.params.map((param) => (
            <div key={param.key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted flex items-center gap-1">
                {param.label}
                <InfoTip term={param.label} className="text-dim hover:text-muted" />
              </span>
              <NumberInput
                className="field w-24 text-right"
                value={props.params[param.key] ?? param.default}
                min={param.min}
                max={param.max}
                step={param.step}
                onChange={(v) => props.onParam(param.key, v)}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="label flex items-center gap-1">
          Position Direction
          <InfoTip term="Position Direction" className="text-dim hover:text-muted" />
        </label>
        <div className="flex gap-1 rounded-md border border-border bg-bg p-1">
          {DIRECTIONS.map((d) => (
            <button
              key={d.id}
              className={`seg ${props.direction === d.id ? 'seg-active' : ''}`}
              onClick={() => props.onDirection(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-dim">
          {props.direction === 'long'
            ? 'Buy signals open longs; sell signals close them.'
            : props.direction === 'short'
              ? 'Sell signals open shorts; buy signals close them.'
              : 'Always in the market — every signal flips the position.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label flex items-center gap-1">
            Capital ($)
            <InfoTip term="Capital" className="text-dim hover:text-muted" />
          </label>
          <NumberInput
            className="field"
            value={props.initialCapital}
            min={1}
            step={100}
            onChange={props.onCapital}
          />
        </div>
        <div>
          <label className="label flex items-center gap-1">
            Fee (%)
            <InfoTip term="Fee %" className="text-dim hover:text-muted" />
          </label>
          <NumberInput
            className="field"
            value={props.feePct}
            min={0}
            step={0.01}
            onChange={props.onFee}
          />
        </div>
      </div>

      <div>
        <label className="label flex items-center gap-1">
          Position Sizing
          <InfoTip term="Volatility Targeting" className="text-dim hover:text-muted" />
        </label>
        <div className="flex gap-1 rounded-md border border-border bg-bg p-1">
          {(['fixed', 'compounding', 'volatility'] as const).map((m) => (
            <button
              key={m}
              className={`seg ${props.positionMode === m ? 'seg-active' : ''}`}
              onClick={() => props.onPositionMode(m)}
            >
              {m === 'fixed' ? 'Fixed Size' : m === 'compounding' ? 'Compounding' : 'Volatility'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-dim">
          {props.positionMode === 'fixed'
            ? 'Same $ per trade — realistic. P&L accumulates but position size stays constant.'
            : props.positionMode === 'compounding'
              ? 'Position grows with equity — each win risks more, each loss risks less.'
              : 'Sizes positions dynamically based on ATR to risk a fixed capital percentage.'}
        </p>
      </div>

      {props.positionMode === 'volatility' && (
        <div className="grid grid-cols-2 gap-2 border-l-2 border-brand/50 pl-2.5 py-1">
          <div>
            <label className="mb-1 block text-[11px] text-dim flex items-center gap-1">
              Target Risk %
              <InfoTip term="Volatility Targeting" className="text-dim hover:text-muted" />
            </label>
            <NumberInput
              className="field"
              value={props.targetRiskPct}
              min={0.1}
              max={100}
              step={0.1}
              onChange={props.onTargetRisk}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-dim flex items-center gap-1">
              ATR Multiplier
              <InfoTip term="ATR Multiplier" className="text-dim hover:text-muted" />
            </label>
            <NumberInput
              className="field"
              value={props.atrMultiplier}
              min={0.5}
              max={10}
              step={0.1}
              onChange={props.onAtrMultiplier}
            />
          </div>
        </div>
      )}

      <div className="h-px bg-border" />

      <div>
        <label className="label">Risk Controls</label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] text-dim flex items-center gap-1">
              Stop Loss %
              <InfoTip term="Stop Loss" className="text-dim hover:text-muted" />
            </label>
            <NumberInput
              className="field"
              value={props.stopLossPct}
              min={0}
              step={0.1}
              placeholder="0 = off"
              onChange={props.onStopLoss}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-dim flex items-center gap-1">
              Take Profit %
              <InfoTip term="Take Profit" className="text-dim hover:text-muted" />
            </label>
            <NumberInput
              className="field"
              value={props.takeProfitPct}
              min={0}
              step={0.1}
              placeholder="0 = off"
              onChange={props.onTakeProfit}
            />
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-dim">
          Applied intrabar to every trade. 0 = disabled. See Risk Manager below for suggested levels.
        </p>
      </div>

      <button className="btn-ghost" onClick={props.onReload} disabled={props.loading}>
        <RefreshCw className={`h-4 w-4 ${props.loading ? 'animate-spin' : ''}`} />
        {props.loading ? 'Loading data…' : 'Reload market data'}
      </button>
    </div>
  )
}
