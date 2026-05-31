import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Network, Rocket } from 'lucide-react'
import { fetchKlines } from '@/lib/binance'
import { useHLAssets } from '@/lib/hlAssets'
import { computeSMC } from '@/lib/smc/engine'
import { summarizeSMC } from '@/lib/smc/summary'
import SMCChart from '@/components/smc/SMCChart'
import SymbolSearch from '@/components/SymbolSearch'
import type { Candle } from '@/types'

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d']

type LayerKey = 'structure' | 'strongWeak' | 'orderBlocks' | 'equal' | 'fvg' | 'zones' | 'mtf'
const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'structure', label: 'BOS/CHoCH' },
  { key: 'strongWeak', label: 'Strong/Weak' },
  { key: 'orderBlocks', label: 'Order blocks' },
  { key: 'equal', label: 'EQH/EQL' },
  { key: 'fvg', label: 'Fair Value Gap' },
  { key: 'zones', label: 'Premium/Discount' },
  { key: 'mtf', label: 'MTF levels' },
]

export default function MarketStructurePage() {
  const navigate = useNavigate()
  const { symbols } = useHLAssets()
  const [symbol, setSymbol] = useState(() => localStorage.getItem('lab_symbol') || 'ETHUSDT')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('lab_timeframe') || '1h')
  const [swingLength, setSwingLength] = useState(50)
  const [riskUsd, setRiskUsd] = useState(3)
  const [slPct, setSlPct] = useState(1.5)
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    structure: true, strongWeak: true, orderBlocks: true, equal: true, fvg: false, zones: false, mtf: false,
  })
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchKlines({ symbol, interval: timeframe })
      .then(c => { if (!cancelled) setCandles(c) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol, timeframe])

  const result = useMemo(() => computeSMC(candles, { swingLength }), [candles, swingLength])
  const lastPrice = candles.length ? candles[candles.length - 1].close : 0
  const summary = useMemo(() => summarizeSMC(result, lastPrice), [result, lastPrice])
  const pairLabel = symbol.includes(':') ? symbol.split(':')[1] + '/USDC' : symbol.replace(/USDT$/, '/USDC')

  const pickSymbol = (s: string) => { setSymbol(s); localStorage.setItem('lab_symbol', s) }
  const toggle = (k: LayerKey) => setVisible(v => ({ ...v, [k]: !v[k] }))

  const deployToBot = () => {
    const asset = symbol.includes(':') ? symbol : symbol.replace(/USDT$/, '')
    const payload = {
      asset,
      strategy: 'smc',
      timeframe,
      params: { swingLength, mode: 1 }, // 1 = CHoCH-only (trend flips)
      direction: 'both',
      slPct,
      riskUsd,
      sizingSlPct: slPct,
    }
    sessionStorage.setItem('pending_signal_bot_config', JSON.stringify(payload))
    navigate('/signal')
  }

  const biasTone = summary.bias === 'bullish' ? 'text-gain' : summary.bias === 'bearish' ? 'text-loss' : 'text-dim'
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 })

  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-brand" />
          <h1 className="text-lg font-semibold text-text font-display">Market Structure</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-[210px]">
            <SymbolSearch value={symbol} symbols={symbols} onChange={pickSymbol} />
          </div>
          <div className="flex items-center gap-1">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                type="button"
                onClick={() => { setTimeframe(tf); localStorage.setItem('lab_timeframe', tf) }}
                className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer ${tf === timeframe ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-panel-2 text-dim hover:text-text'}`}
              >{tf}</button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-[11px] text-dim">
            Swing
            <input
              type="number" min={3} max={200} value={swingLength}
              onChange={e => setSwingLength(Math.max(3, +e.target.value || 50))}
              className="field w-[64px]"
            />
          </label>
        </div>
      </div>

      {/* Layer show/hide toggles */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-dim mr-1">Show</span>
        {LAYERS.map(l => (
          <button
            key={l.key}
            type="button"
            onClick={() => toggle(l.key)}
            className={`rounded-md border px-2.5 py-1 text-[11px] cursor-pointer ${visible[l.key] ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-panel-2 text-dim hover:text-text'}`}
          >{l.label}</button>
        ))}
      </div>

      {error && <div className="card border border-loss/30 bg-loss/5 p-3 text-xs text-loss">{error}</div>}

      <section className="card shrink-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-text">Chart</h3>
          {loading && <span className="text-[10px] text-dim animate-pulse">Loading…</span>}
        </div>
        {candles.length === 0 && !loading ? (
          <div className="flex h-[460px] min-h-[460px] items-center justify-center text-sm text-dim">No data.</div>
        ) : (
          <SMCChart
            candles={candles}
            result={result}
            showStructure={visible.structure}
            showStrongWeak={visible.strongWeak}
            showEqual={visible.equal}
            showOrderBlocks={visible.orderBlocks}
            showFVG={visible.fvg}
            showZones={visible.zones}
            showMTF={visible.mtf}
          />
        )}
      </section>

      {/* ── Setup summary: plain-language read of the current structure ── */}
      <section className="card p-4">
        <div className="mb-3 text-xs font-semibold text-text">
          Setup summary <span className="font-normal text-dim">· last price {fmt(lastPrice)}</span>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryStat label="Bias" value={summary.bias === 'neutral' ? '—' : summary.bias} valueClass={biasTone} />
          <SummaryStat label="Price zone" value={summary.zone ?? '—'}
            valueClass={summary.zone === 'premium' ? 'text-loss' : summary.zone === 'discount' ? 'text-gain' : 'text-text'} />
          <SummaryStat label="Nearest demand (buy)" value={summary.nearestDemand ? `${fmt(summary.nearestDemand.bottom)}–${fmt(summary.nearestDemand.top)}` : '—'} valueClass="text-gain" />
          <SummaryStat label="Nearest supply (sell)" value={summary.nearestSupply ? `${fmt(summary.nearestSupply.bottom)}–${fmt(summary.nearestSupply.top)}` : '—'} valueClass="text-loss" />
          <SummaryStat label="Liquidity above (EQH)" value={summary.liquidityAbove ? fmt(summary.liquidityAbove.level) : '—'} valueClass="text-loss" />
          <SummaryStat label="Liquidity below (EQL)" value={summary.liquidityBelow ? fmt(summary.liquidityBelow.level) : '—'} valueClass="text-gain" />
          <SummaryStat label="FVG above" value={summary.nearestFvgAbove ? `${fmt(summary.nearestFvgAbove.bottom)}–${fmt(summary.nearestFvgAbove.top)}` : '—'} />
          <SummaryStat label="FVG below" value={summary.nearestFvgBelow ? `${fmt(summary.nearestFvgBelow.bottom)}–${fmt(summary.nearestFvgBelow.top)}` : '—'} />
        </div>
        <p className="rounded-lg border border-border bg-panel-2/40 px-3 py-2 text-[11px] leading-relaxed text-text">
          {summary.note}
        </p>
        <p className="mt-2 text-[10px] text-dim italic">
          Guide only — confirm with your own analysis and size by risk. Not financial advice.
        </p>
      </section>

      {/* ── Deploy as a live signal bot ── */}
      <section className="card p-4">
        <div className="mb-1 flex items-center gap-1.5">
          <Rocket className="h-4 w-4 text-brand" />
          <span className="text-xs font-semibold text-text">Deploy as Signal Bot</span>
        </div>
        <p className="mb-3 text-[11px] text-dim">
          Runs the SMC structure strategy live on {pairLabel} · {timeframe} (enters on Bullish/Bearish CHoCH). Sizing is risk-based.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-dim">
            <span className="mb-1 block">Risk $ / trade</span>
            <input type="number" min={1} step={1} value={riskUsd}
              onChange={e => setRiskUsd(Math.max(1, +e.target.value || 1))}
              className="field w-[90px]" />
          </label>
          <label className="text-[11px] text-dim">
            <span className="mb-1 block">Stop loss %</span>
            <input type="number" min={0.1} step={0.1} value={slPct}
              onChange={e => setSlPct(Math.max(0.1, +e.target.value || 0.1))}
              className="field w-[90px]" />
          </label>
          <button type="button" onClick={deployToBot} className="btn-primary">
            <Rocket className="h-4 w-4" /> Deploy to Signal Bot
          </button>
        </div>
        <p className="mt-2 text-[10px] text-dim">
          You'll review and confirm everything on the Signal Bots page before it goes live.
        </p>
      </section>

      {visible.orderBlocks && (
        <section className="card p-3">
          <div className="mb-2 text-xs font-semibold text-text">
            Order blocks <span className="text-dim font-normal">({result.orderBlocks.length} active)</span>
          </div>
          {result.orderBlocks.length === 0 ? (
            <div className="text-[11px] text-dim italic">No un-mitigated order blocks in this window.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {result.orderBlocks.map((ob, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className={ob.bias === 'bullish' ? 'text-gain' : 'text-loss'}>
                    {ob.bias === 'bullish' ? 'Bullish (demand)' : 'Bearish (supply)'}
                  </span>
                  <span className="font-mono tabular-nums text-dim">
                    {ob.bottom} – {ob.top}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {visible.structure && (
        <section className="card p-3">
          <div className="mb-2 text-xs font-semibold text-text">Recent structure events</div>
          {result.structures.length === 0 ? (
            <div className="text-[11px] text-dim italic">No structure breaks detected in this window.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {result.structures.slice(-12).reverse().map((s, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className={s.bias === 'bullish' ? 'text-gain' : 'text-loss'}>
                    {s.bias === 'bullish' ? 'Bullish' : 'Bearish'} {s.kind}
                  </span>
                  <span className="font-mono tabular-nums text-dim">
                    @ {s.level} · {new Date(s.atTime * 1000).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}

function SummaryStat({ label, value, valueClass = 'text-text' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel-2/40 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`mt-0.5 font-mono text-xs font-bold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  )
}
