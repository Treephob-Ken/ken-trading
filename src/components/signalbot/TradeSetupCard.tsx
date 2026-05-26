import InfoTip from '@/components/InfoTip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CardStatus {
  config: {
    asset: string
    strategyId: string
    timeframe: string
    params?: Record<string, number>
    size: number
    riskUsd?: number
    slPct?: number
    tpPct?: number
    cooldownSec: number
    tradeSide: 'buy' | 'sell' | 'both'
    mtfEnabled?: boolean
    mtfTimeframe?: string
    ensembleMode?: boolean
    ensembleStrategyIds?: string[]
    ensembleThreshold?: number
    dailyLossLimitPct?: number
    maxDivergencePct?: number
  }
}

interface StrategyMeta {
  id: string
  name: string
  params: { key: string; label: string }[]
}

interface Props {
  status: CardStatus
  strategies: StrategyMeta[]
  lastPrice: number | null   // for fixed-size mode → estimate $ notional
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function directionLabel(t: 'buy' | 'sell' | 'both'): string {
  return t === 'both' ? 'Both (long & short)' : t === 'buy' ? 'Long only' : 'Short only'
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export default function TradeSetupCard({ status, strategies, lastPrice }: Props) {
  const cfg = status.config
  const stratMeta = strategies.find((s) => s.id === cfg.strategyId)
  const stratName = stratMeta?.name ?? cfg.strategyId.toUpperCase()

  // Strategy params summary, e.g. "(zigzag 3%, length 14)"
  let stratParamsText: string | null = null
  if (stratMeta && cfg.params && stratMeta.params.length > 0) {
    const parts = stratMeta.params
      .slice(0, 3)  // cap at 3 so the line stays short
      .map((d) => {
        const v = cfg.params?.[d.key]
        if (v == null) return null
        return `${d.label.toLowerCase()} ${v}`
      })
      .filter(Boolean)
    if (parts.length > 0) stratParamsText = parts.join(', ')
  }

  // Risk-mode vs fixed-size
  const riskMode = cfg.riskUsd != null && cfg.riskUsd > 0 && cfg.slPct != null && cfg.slPct > 0
  const fixedSizeUsd = lastPrice ? cfg.size * lastPrice : null

  const sizingLine = riskMode
    ? `${fmtUsd(cfg.riskUsd)} risk @ ${cfg.slPct}% SL`
    : fixedSizeUsd != null
      ? `Fixed: ~${fmtUsd(fixedSizeUsd)} (${cfg.size} ${cfg.asset})`
      : `Fixed: ${cfg.size} ${cfg.asset}`

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Trade setup</h3>
        <span className="text-[10px] text-dim">{cfg.asset.toUpperCase()} · {cfg.timeframe}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <Row
          k="Sizing"
          info={riskMode
            ? 'Risk mode: every trade risks the same USDC amount. Bot recomputes order size from live price.'
            : 'Fixed size: every trade uses the same coin quantity regardless of price.'}
          v={sizingLine}
          cls={riskMode ? 'text-brand' : 'text-text'}
        />
        <Row
          k="Strategy"
          info="The strategy this bot evaluates on each closed bar."
          v={stratName}
          sub={stratParamsText ?? undefined}
        />
        <Row
          k="Direction"
          info="Which sides the bot may open: both, long-only, or short-only."
          v={directionLabel(cfg.tradeSide)}
        />
        <Row
          k="Cooldown"
          info="Minimum seconds between opening trades. Prevents churn on flip-flop signals."
          v={`${cfg.cooldownSec}s`}
        />
        <Row
          k="Auto SL %"
          info="Stop-loss bracket placed on the exchange after each fill. Survives bot disconnects."
          v={cfg.slPct ? `${cfg.slPct}%` : 'off'}
          cls={cfg.slPct ? 'text-loss' : 'text-warn'}
        />
        <Row
          k="Auto TP %"
          info="Take-profit bracket placed on the exchange. Often left off so the strategy decides the exit."
          v={cfg.tpPct ? `${cfg.tpPct}%` : 'off'}
          cls={cfg.tpPct ? 'text-gain' : 'text-dim'}
        />
        <Row
          k="MTF filter"
          info="When on, only trades where the higher timeframe agrees with the entry signal."
          v={cfg.mtfEnabled ? `on · ${cfg.mtfTimeframe ?? '—'}` : 'off'}
          cls={cfg.mtfEnabled ? 'text-brand' : 'text-dim'}
        />
        <Row
          k="Daily loss cap"
          info="If today's loss exceeds this %, the bot pauses new entries until UTC midnight."
          v={cfg.dailyLossLimitPct ? `${cfg.dailyLossLimitPct}%` : 'off'}
          cls={cfg.dailyLossLimitPct ? 'text-warn' : 'text-dim'}
        />
        {cfg.ensembleMode && (
          <Row
            k="Ensemble"
            info="Runs multiple strategies; trades only when this many agree."
            v={`${cfg.ensembleThreshold ?? '?'} of ${cfg.ensembleStrategyIds?.length ?? '?'}`}
            cls="text-brand"
          />
        )}
        {cfg.maxDivergencePct != null && (
          <Row
            k="Slippage gate"
            info="Aborts the trade if HL mid differs from Binance signal close by more than this %."
            v={`${cfg.maxDivergencePct}%`}
          />
        )}
      </dl>
    </div>
  )
}

function Row({
  k, info, v, sub, cls = 'text-text',
}: {
  k: string; info: string; v: string; sub?: string; cls?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-dim">
        {k}
        <InfoTip term={info} />
      </dt>
      <dd className={`font-mono tabular-nums ${cls}`}>
        {v}
        {sub && <span className="ml-1 text-[10px] text-dim">{sub}</span>}
      </dd>
    </div>
  )
}
