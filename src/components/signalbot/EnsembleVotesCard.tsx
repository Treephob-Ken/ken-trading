import InfoTip from '@/components/InfoTip'

interface StrategyMeta { id: string; name: string }

interface EnsembleStatus {
  config: { ensembleMode?: boolean; ensembleStrategyIds?: string[]; ensembleThreshold?: number }
  lastVotes?: { buy: number; sell: number; abstain: number; threshold: number } | null
}

interface Props {
  status: EnsembleStatus
  strategies: StrategyMeta[]
}

export default function EnsembleVotesCard({ status, strategies }: Props) {
  if (!status.config.ensembleMode || !status.config.ensembleStrategyIds?.length) return null

  const v = status.lastVotes
  const total = status.config.ensembleStrategyIds.length
  const threshold = v?.threshold ?? status.config.ensembleThreshold ?? Math.ceil(total / 2)
  const direction = v ? (v.buy >= threshold ? 'buy' : v.sell >= threshold ? 'sell' : null) : null
  const consensusCount = v ? (direction === 'buy' ? v.buy : direction === 'sell' ? v.sell : Math.max(v.buy, v.sell)) : 0

  // Strategy name lookup. Falls back to the id if a strategy isn't in the catalog.
  const nameFor = (id: string) => strategies.find((s) => s.id === id)?.name ?? id.toUpperCase()

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-text">Ensemble votes</h3>
          <InfoTip term="Each strategy in the ensemble votes BUY, SELL, or abstains on every closed bar. A trade fires only when at least the threshold number agree on a direction." />
        </div>
        <span className="text-[10px] text-dim">last bar</span>
      </div>

      {!v ? (
        <p className="text-[11px] text-dim">Waiting for the next bar close to record votes.</p>
      ) : (
        <>
          {/* Per-strategy chips — we know the count per direction but not which strategy
              voted which way, so we show the totals as buckets instead. */}
          <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
            <Bucket label="BUY" count={v.buy} total={total} tone="gain" />
            <Bucket label="SELL" count={v.sell} total={total} tone="loss" />
            <Bucket label="Abstain" count={v.abstain} total={total} tone="text" />
          </div>

          {/* Member list (informational — which strategies make up the ensemble) */}
          <div className="mb-3 flex flex-wrap gap-1">
            {status.config.ensembleStrategyIds.map((id) => (
              <span
                key={id}
                className="rounded-md border border-border bg-panel-2 px-2 py-0.5 text-[10px] font-mono text-dim"
                title={id}
              >
                {nameFor(id)}
              </span>
            ))}
          </div>

          {/* Aggregate verdict */}
          <div className={`rounded-lg border px-3 py-2 text-[11px] ${
            direction === 'buy' ? 'border-gain/30 bg-gain/5 text-gain'
            : direction === 'sell' ? 'border-loss/30 bg-loss/5 text-loss'
            : 'border-border bg-panel-2 text-dim'
          }`}>
            <span className="font-semibold">
              {consensusCount}/{total} {direction ? direction.toUpperCase() : 'NO CONSENSUS'}
            </span>{' '}
            <span className="opacity-80">
              · threshold {threshold} ·{' '}
              {direction ? 'OK — trade can fire' : 'not enough agreement to trade'}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function Bucket({ label, count, total, tone }: { label: string; count: number; total: number; tone: 'gain' | 'loss' | 'text' }) {
  const cls = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-text'
  const fill = total > 0 ? (count / total) * 100 : 0
  const barCls = tone === 'gain' ? 'bg-gain/40' : tone === 'loss' ? 'bg-loss/40' : 'bg-border'
  return (
    <div className="rounded-lg border border-border bg-panel-2 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${cls}`}>{count}</div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-bg">
        <div className={`h-full ${barCls}`} style={{ width: `${fill}%` }} />
      </div>
    </div>
  )
}
