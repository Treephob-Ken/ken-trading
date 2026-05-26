import InfoTip from '@/components/InfoTip'

interface FunnelStatus {
  signalsSeen?: number
  signalsExecuted?: number
  blockedByMtf?: number
  blockedByCooldown?: number
  blockedByDailyPause?: number
  blockedByEnsemble?: number
  blockedBySlippage?: number
  config: { ensembleMode?: boolean; mtfEnabled?: boolean; dailyLossLimitPct?: number; cooldownSec: number; maxDivergencePct?: number }
}

interface Props {
  status: FunnelStatus
}

function pct(n: number, d: number): string {
  if (d <= 0) return '—'
  return Math.round((n / d) * 100) + '%'
}

export default function SignalFunnelCard({ status }: Props) {
  const seen = status.signalsSeen ?? 0
  const executed = status.signalsExecuted ?? 0
  const mtf = status.blockedByMtf ?? 0
  const cool = status.blockedByCooldown ?? 0
  const daily = status.blockedByDailyPause ?? 0
  const ens = status.blockedByEnsemble ?? 0
  const slip = status.blockedBySlippage ?? 0

  // Total events the funnel can split between. Ensemble blocks happen BEFORE
  // signalsSeen (the threshold check is what makes a vote "actionable"), so
  // the visualized bar shows: executed + mtf + cool + daily + ens + slip.
  const total = executed + mtf + cool + daily + ens + slip
  const passRate = pct(executed, seen)

  if (total === 0) {
    return (
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Signal funnel</h3>
          <span className="text-[10px] text-dim">since last start</span>
        </div>
        <p className="text-[11px] text-dim leading-relaxed">
          No new signals since the bot was last started. These counters reset on
          restart — check the chart for historical fills and the Trade Log for
          all-time PnL.
        </p>
      </div>
    )
  }

  // Segment widths as % of total
  const segs = [
    { key: 'exec', n: executed, cls: 'bg-gain', label: 'Executed' },
    { key: 'mtf', n: mtf, cls: 'bg-warn/70', label: 'MTF blocked' },
    { key: 'cool', n: cool, cls: 'bg-warn/50', label: 'Cooldown' },
    { key: 'daily', n: daily, cls: 'bg-loss/70', label: 'Daily pause' },
    { key: 'ens', n: ens, cls: 'bg-loss/40', label: 'Ensemble' },
    { key: 'slip', n: slip, cls: 'bg-loss/60', label: 'Slippage' },
  ].filter((s) => s.n > 0)

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Signal funnel</h3>
        <span className="text-[10px] text-dim">since last start</span>
      </div>

      {/* Top numbers */}
      <div className="mb-3 flex items-baseline gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">Seen</div>
          <div className="font-mono text-xl font-bold tabular-nums text-text">{seen}</div>
        </div>
        <div className="text-dim">→</div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">Executed</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-xl font-bold tabular-nums text-gain">{executed}</span>
            <span className="text-[10px] text-dim">{passRate} pass-through</span>
          </div>
        </div>
      </div>

      {/* Segmented bar */}
      <div className="mb-3 flex h-2 w-full overflow-hidden rounded-full bg-bg">
        {segs.map((s) => (
          <div
            key={s.key}
            className={`h-full ${s.cls} transition-all duration-300`}
            style={{ width: `${(s.n / total) * 100}%` }}
            title={`${s.label}: ${s.n}`}
          />
        ))}
      </div>

      {/* Per-blocker rows */}
      <div className="flex flex-col gap-1.5 text-[11px]">
        <Block
          on={!!status.config.mtfEnabled}
          k="MTF blocked"
          info="The higher-timeframe trend disagreed with the signal direction. Turn off MTF in the config if you want every signal to fire."
          n={mtf}
        />
        <Block
          on={status.config.cooldownSec > 0}
          k="Cooldown"
          info="A signal arrived while the cooldown window from the previous trade was still active."
          n={cool}
        />
        <Block
          on={(status.config.dailyLossLimitPct ?? 0) > 0}
          k="Daily pause"
          info="The daily-loss circuit-breaker tripped — new entries pause until tomorrow UTC."
          n={daily}
        />
        <Block
          on={!!status.config.ensembleMode}
          k="Ensemble"
          info="Strategies voted but didn't reach the consensus threshold."
          n={ens}
        />
        <Block
          on={(status.config.maxDivergencePct ?? 0) > 0}
          k="Slippage"
          info="Hyperliquid's price had drifted more than the allowed % away from the Binance signal close at execution time. The trade was aborted to avoid an adverse fill."
          n={slip}
        />
      </div>
    </div>
  )
}

function Block({ on, k, info, n }: { on: boolean; k: string; info: string; n: number }) {
  const tone = n > 0 ? 'text-warn' : on ? 'text-dim' : 'text-dim/50'
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-0.5 text-dim">
        {k}
        <InfoTip term={info} />
        {!on && <span className="ml-1 text-[9px] uppercase tracking-wider text-dim/60">(off)</span>}
      </span>
      <span className={`font-mono tabular-nums ${tone}`}>{n}</span>
    </div>
  )
}
