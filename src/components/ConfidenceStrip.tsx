import { useMemo } from 'react'
import type { BacktestResult, Direction } from '@/types'
import type { RegimeAnalysis } from '@/lib/markov'
import { simulateMonteCarlo, mcPct } from '@/lib/montecarlo'
import StatTile, { type Tone } from '@/components/ui/StatTile'

interface Props {
  result: BacktestResult
  regime: RegimeAnalysis | null
  direction: Direction
}

// Regime ↔ direction fit. Bull+long or Bear+short = aligned; Bull+short or Bear+long = fighting the tape.
function regimeFit(regime: RegimeAnalysis | null, direction: Direction): {
  score: number
  label: string
  tone: Tone
  sub: string
} {
  if (!regime?.currentLabel) return { score: 0, label: '—', tone: 'neutral', sub: 'Not enough candles to detect regime yet.' }
  const r = regime.currentLabel
  const conv = regime.conviction != null ? Math.abs(regime.conviction) : 0
  const aligned =
    (r === 'Bull' && direction !== 'short') ||
    (r === 'Bear' && direction !== 'long') ||
    (r === 'Sideways' && direction === 'both')
  const score = Math.round(conv * 100 * (aligned ? 1 : 0.3))
  if (aligned && conv >= 0.4) return { score, label: 'Aligned', tone: 'gain', sub: `${r} regime + ${direction} direction · ${Math.round(conv * 100)}% conviction.` }
  if (!aligned) return { score, label: 'Fighting tape', tone: 'loss', sub: `${r} regime vs ${direction} direction — change direction to match.` }
  return { score, label: 'Weak signal', tone: 'warn', sub: `${r} regime, only ${Math.round(conv * 100)}% conviction.` }
}

// μ ± σ of per-trade pnlPct — the strategy's edge in plain stats. Positive μ with small σ is the holy grail.
function edgePerTrade(result: BacktestResult): { mean: number; sd: number; tone: Tone; sub: string } | null {
  const trades = result.trades
  if (trades.length < 2) return null
  const xs = trades.map((t) => t.pnlPct)
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)
  const sd = Math.sqrt(variance)
  const tone: Tone = mean > 0.3 ? 'gain' : mean < -0.3 ? 'loss' : 'warn'
  const sharpeLike = sd > 0 ? mean / sd : 0
  const sub =
    sharpeLike >= 0.3
      ? 'Solid edge — gain clearly beats noise.'
      : sharpeLike >= 0.1
      ? 'Thin edge — gain is small vs trade-to-trade noise.'
      : sharpeLike >= 0
      ? 'No clear edge — gain is inside the noise band.'
      : 'Negative edge — losing trades dominate.'
  return { mean, sd, tone, sub }
}

export default function ConfidenceStrip({ result, regime, direction }: Props) {
  const m = result.metrics
  const fit = regimeFit(regime, direction)
  const edge = edgePerTrade(result)

  // Memoised — runs 1000 paths × 30 steps; cheap (~5ms) but no need to redo on every render.
  const mc = useMemo(() => simulateMonteCarlo(result.trades, { paths: 1000, horizon: 30 }), [result.trades])

  const ddTone: Tone = m.maxDrawdownPct < 10 ? 'gain' : m.maxDrawdownPct < 25 ? 'warn' : 'loss'

  // MC tile derivation
  let mcValue = '—'
  let mcTone: Tone = 'neutral'
  let mcSub = 'Need at least 3 trades to bootstrap.'
  if (mc) {
    const p5 = mcPct(mc.finalP5)
    const p50 = mcPct(mc.finalP50)
    const p95 = mcPct(mc.finalP95)
    mcValue = `${p5 >= 0 ? '+' : ''}${p5.toFixed(0)}% → ${p95 >= 0 ? '+' : ''}${p95.toFixed(0)}%`
    // Tone: gain if pessimistic case is still positive; loss if median loses; warn otherwise
    mcTone = p5 > 0 ? 'gain' : p50 < 0 ? 'loss' : 'warn'
    const ruinPct = (mc.probRuin * 100).toFixed(0)
    mcSub = `Median ${p50 >= 0 ? '+' : ''}${p50.toFixed(0)}% · ${ruinPct}% chance of ruin · ${mc.horizon} trades ahead`
  }

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-dim font-display">
          Confidence Strip — quick health check
        </h3>
        <span className="text-[10px] text-dim">Verdict-grade signals at a glance</span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile
          compact
          question="Does the regime support this trade?"
          info="Whether the current market regime (Bull/Bear/Sideways) aligns with your chosen trade direction. Aligned = tailwind; Fighting = headwind."
          value={fit.label}
          tone={fit.tone}
          bar={{ fill: fit.score, tone: fit.tone }}
          sub={fit.sub}
        />

        <StatTile
          compact
          question="Where could equity land in 30 trades?"
          info="Equity Band"
          value={mcValue}
          tone={mcTone}
          sub={mcSub}
        />

        <StatTile
          compact
          question="How bad can it get?"
          info="Max Drawdown"
          value={`-${m.maxDrawdownPct.toFixed(1)}%`}
          tone={ddTone}
          bar={{ fill: Math.min(100, (m.maxDrawdownPct / 60) * 100), tone: ddTone }}
          sub={`Historical worst drawdown across ${m.numTrades} trade${m.numTrades !== 1 ? 's' : ''}.`}
        />

        {edge ? (
          <StatTile
            compact
            question="What's the edge per trade?"
            info="Edge per trade = mean ± standard deviation of per-trade %. A positive mean that exceeds its standard deviation = real edge above noise."
            value={`${edge.mean >= 0 ? '+' : ''}${edge.mean.toFixed(2)}% ± ${edge.sd.toFixed(2)}%`}
            tone={edge.tone}
            sub={edge.sub}
          />
        ) : (
          <StatTile
            compact
            question="What's the edge per trade?"
            info="Edge per trade = mean ± standard deviation of per-trade %. Needs at least 2 closed trades to compute."
            value="—"
            tone="neutral"
            sub="Need at least 2 closed trades."
          />
        )}
      </div>
    </div>
  )
}
