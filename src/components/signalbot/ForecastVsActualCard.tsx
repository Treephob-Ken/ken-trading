import InfoTip from '@/components/InfoTip'

// Forward-test scorecard — "did the backtest's promise survive contact with the
// market?" Compares the backtest snapshot captured at deploy against the bot's
// real HL round-trips. Deliberately conservative: win-rate is the only metric
// both sides report, and the comparison is GATED on a minimum live sample,
// because one or two trades is noise and a "Predicted 62% / Actual 0%" panic
// after a single loss is the opposite of the trust this card is meant to build.

interface Snapshot {
  winRate: number
  profitFactor: number
  expectancy: number
  maxDrawdownPct: number
  totalReturnPct: number
  numTrades: number
  feePct: number
  capturedAt: number
}
interface Live {
  netPnl: number
  roundTrips: number
  winRate: number
}

// Below this many live round-trips, win-rate comparison is statistical noise.
const MIN_TRADES = 10

function money(v: number): string {
  const s = v < 0 ? '-' : ''
  return `${s}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ForecastVsActualCard({ snapshot, live }: {
  snapshot: Snapshot
  live: Live | null
}) {
  const liveTrades = live?.roundTrips ?? 0
  const enough = liveTrades >= MIN_TRADES
  const liveWin = live?.winRate ?? null

  // Directional verdict — only once there's enough live data. Framed as
  // "tracking / below / above", never pass-fail.
  let verdict: { text: string; tone: 'gain' | 'warn' | 'loss' | 'dim' } = {
    text: `Too early to compare — ${liveTrades} of ${MIN_TRADES} live round-trips. One or two trades is noise.`,
    tone: 'dim',
  }
  if (enough && liveWin != null) {
    const delta = liveWin - snapshot.winRate
    if (delta >= -5) verdict = { text: `Live win-rate is tracking the backtest (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} pts).`, tone: 'gain' }
    else if (delta >= -15) verdict = { text: `Live is running ${Math.abs(delta).toFixed(0)} pts below backtest — normal once slippage + funding bite. Watch the gap.`, tone: 'warn' }
    else verdict = { text: `Live is ${Math.abs(delta).toFixed(0)} pts below backtest — bigger than costs alone explain. Worth a look.`, tone: 'loss' }
  }

  const vtone =
    verdict.tone === 'gain' ? 'text-gain' :
    verdict.tone === 'warn' ? 'text-warn' :
    verdict.tone === 'loss' ? 'text-loss' : 'text-dim'

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-text">
          Backtest vs Live
          <InfoTip term="How the bot's real Hyperliquid trades compare to the backtest you deployed. Win-rate is the only metric both sides measure the same way. Live almost always runs lower — the backtest doesn't model slippage, spread, or funding." />
        </h3>
        <span className="text-[10px] text-dim">forward test</span>
      </div>

      {/* Predicted vs actual — two columns */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-panel-2/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">Backtest said</div>
          <div className="mt-1 font-mono text-xl font-bold tabular-nums text-text">{snapshot.winRate.toFixed(0)}%</div>
          <div className="text-[10px] text-dim">win rate · {snapshot.numTrades} trades</div>
          <div className="mt-1.5 text-[10px] text-dim tabular-nums">
            PF {Number.isFinite(snapshot.profitFactor) ? snapshot.profitFactor.toFixed(2) : '∞'} · exp {snapshot.expectancy >= 0 ? '+' : ''}{snapshot.expectancy.toFixed(2)}%
          </div>
        </div>
        <div className="rounded-lg border border-border bg-panel-2/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">Live so far</div>
          <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${liveWin == null ? 'text-dim' : 'text-text'}`}>
            {liveWin == null ? '—' : `${liveWin.toFixed(0)}%`}
          </div>
          <div className="text-[10px] text-dim">win rate · {liveTrades} round-trips</div>
          <div className={`mt-1.5 text-[10px] tabular-nums ${live && live.netPnl >= 0 ? 'text-gain' : live ? 'text-loss' : 'text-dim'}`}>
            net {live ? money(live.netPnl) : '—'}
          </div>
        </div>
      </div>

      {/* Directional verdict */}
      <p className={`mt-3 text-[11px] leading-relaxed ${vtone}`}>{verdict.text}</p>

      {/* Permanent honesty caveat */}
      <p className="mt-1.5 text-[10px] leading-relaxed text-dim">
        The backtest assumed {snapshot.feePct}% fees and <span className="text-muted">no</span> slippage or funding, so
        live should sit a little under it. Judge the gap once you have a real sample — not the first few trades.
      </p>
    </div>
  )
}
