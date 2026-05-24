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

export type SizingMode = 'fixed' | 'volatility'

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
  sizingMode: SizingMode
  targetRiskPct: number
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
  onSizingMode: (v: SizingMode) => void
  onTargetRisk: (v: number) => void
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

  const riskUsd = props.initialCapital * (props.targetRiskPct / 100)
  const slMissing = props.sizingMode === 'volatility' && props.stopLossPct <= 0

  return (
    <div className="flex flex-col gap-5">

      {/* ─── Data ──────────────────────────────────────────── */}

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
            <option key={iv} value={iv}>{iv}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="label flex items-center gap-1">
            Date Range
            <InfoTip term="Date Range" className="text-dim hover:text-muted" />
          </label>
          <button
            type="button"
            onClick={props.onReload}
            disabled={props.loading}
            title="Reload market data"
            className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-dim transition-colors hover:text-muted disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${props.loading ? 'animate-spin' : ''}`} />
            Reload
          </button>
        </div>
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
            onClick={() => { props.onStartDate(''); props.onEndDate('') }}
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
          onClick={() => props.onEndDate('')}
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

      {/* ─── Strategy ──────────────────────────────────────── */}

      <div className="flex items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Strategy</p>
        <span className="rounded-full border border-brand/30 bg-brand/5 px-1.5 py-0.5 text-[9px] text-brand">deploys to bot</span>
      </div>

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
                <option key={s.id} value={s.id}>{s.name}</option>
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
          Trade Direction
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

      <div className="h-px bg-border" />

      {/* ─── Risk & Sizing — all fields below deploy to bot ── */}

      <div className="flex items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Risk &amp; Sizing</p>
        <span className="rounded-full border border-brand/30 bg-brand/5 px-1.5 py-0.5 text-[9px] text-brand">deploys to bot</span>
      </div>

      <div>
        <label className="label flex items-center gap-1">
          Sizing Mode
          <InfoTip term="Volatility Targeting" className="text-dim hover:text-muted" />
        </label>
        <div className="flex gap-1 rounded-md border border-border bg-bg p-1">
          <button
            type="button"
            className={`seg ${props.sizingMode === 'fixed' ? 'seg-active' : ''}`}
            onClick={() => props.onSizingMode('fixed')}
          >
            Fixed
          </button>
          <button
            type="button"
            className={`seg ${props.sizingMode === 'volatility' ? 'seg-active' : ''}`}
            onClick={() => props.onSizingMode('volatility')}
          >
            Risk-based
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-dim">
          {props.sizingMode === 'fixed'
            ? 'Each trade uses the same $ amount (Capital below). Deploy card asks for an order size in qty.'
            : 'Each trade risks the same $ amount. Deploy auto-fills the Signal Bot Risk-Mode calculator.'}
        </p>
      </div>

      {props.sizingMode === 'volatility' && (
        <div className="border-l-2 border-brand/50 pl-2.5 py-1">
          <label className="mb-1 block text-[11px] text-dim flex items-center gap-1">
            Risk per Trade (%)
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
          <p className="mt-1.5 text-[11px] text-gain">
            Risks <span className="font-mono">${riskUsd.toFixed(2)}</span> per trade
            <span className="text-dim"> ({props.targetRiskPct}% of ${props.initialCapital.toLocaleString()} capital)</span>
          </p>
        </div>
      )}

      <div>
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
        {slMissing ? (
          <p className="mt-1.5 rounded-md border border-warn/30 bg-warn/5 px-2 py-1 text-[11px] text-warn">
            Risk-based sizing needs a Stop Loss % to compute order size on the bot.
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] text-dim">
            Applied intrabar on every trade. 0 = disabled.
          </p>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* ─── Simulation — backtest math only ────────────────── */}

      <div className="flex items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Simulation</p>
        <span className="rounded-full border border-dim/30 px-1.5 py-0.5 text-[9px] text-dim">backtest only</span>
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
      <p className="-mt-3 text-[11px] text-dim">
        Capital sets the $ size of each backtest trade
        {props.sizingMode === 'volatility' && ' — and the Risk USD above'}.
      </p>

    </div>
  )
}
