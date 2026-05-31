import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Network, Rocket } from 'lucide-react'
import { fetchKlines } from '@/lib/binance'
import { useHLAssets } from '@/lib/hlAssets'
import { computeSMC } from '@/lib/smc/engine'
import { summarizeSMC } from '@/lib/smc/summary'
import { compareSmcEntries } from '@/lib/smc/strategyTest'
import SMCChart from '@/components/smc/SMCChart'
import SymbolSearch from '@/components/SymbolSearch'
import type { Candle } from '@/types'

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d']

type LayerKey = 'structure' | 'internal' | 'strongWeak' | 'orderBlocks' | 'equal' | 'fvg' | 'zones' | 'mtf' | 'trend'
const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'structure', label: 'BOS/CHoCH' },
  { key: 'internal', label: 'Internal' },
  { key: 'strongWeak', label: 'Strong/Weak' },
  { key: 'orderBlocks', label: 'Order blocks' },
  { key: 'equal', label: 'EQH/EQL' },
  { key: 'fvg', label: 'Fair Value Gap' },
  { key: 'zones', label: 'Premium/Discount' },
  { key: 'mtf', label: 'MTF levels' },
  { key: 'trend', label: 'Trend candles' },
]

export default function MarketStructurePage() {
  const navigate = useNavigate()
  const { symbols } = useHLAssets()
  const [symbol, setSymbol] = useState(() => localStorage.getItem('lab_symbol') || 'ETHUSDT')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('lab_timeframe') || '1h')
  const [swingLength, setSwingLength] = useState(50)
  const [riskUsd, setRiskUsd] = useState(3)
  // SL% and lookback are shared with the Scanner (localStorage) so the Strategy
  // test here matches what the scan showed for the same coin.
  const [slPct, setSlPct] = useState(() => +(localStorage.getItem('smc_sl_pct') || '1.5'))
  const [lookbackDays, setLookbackDays] = useState(() => +(localStorage.getItem('smc_lookback_days') || '150'))
  // Which structure entry the bot fires on: CHoCH only (mode 1) or BOS+CHoCH (mode 2).
  const [entryRule, setEntryRule] = useState<'choch' | 'both'>('choch')
  // Exit mode for the deployed bot.
  const [exitMode, setExitMode] = useState<'flip' | 'rr' | 'mfe'>('mfe')
  const [rrTarget, setRrTarget] = useState(2)
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({
    structure: true, internal: false, strongWeak: true, orderBlocks: true, equal: true, fvg: false, zones: false, mtf: false, trend: false,
  })
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { localStorage.setItem('smc_sl_pct', String(slPct)) }, [slPct])
  useEffect(() => { localStorage.setItem('smc_lookback_days', String(lookbackDays)) }, [lookbackDays])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchKlines({ symbol, interval: timeframe, startTime: Date.now() - lookbackDays * 86_400_000 })
      .then(c => { if (!cancelled) setCandles(c) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol, timeframe, lookbackDays])

  const result = useMemo(() => computeSMC(candles, { swingLength }), [candles, swingLength])
  const lastPrice = candles.length ? candles[candles.length - 1].close : 0
  const summary = useMemo(() => summarizeSMC(result, lastPrice), [result, lastPrice])
  const strategyResults = useMemo(
    () => compareSmcEntries(candles, result, slPct, swingLength).sort((a, b) => b.quality - a.quality),
    [candles, result, slPct, swingLength],
  )
  const pairLabel = symbol.includes(':') ? symbol.split(':')[1] + '/USDC' : symbol.replace(/USDT$/, '/USDC')

  const pickSymbol = (s: string) => { setSymbol(s); localStorage.setItem('lab_symbol', s) }
  const toggle = (k: LayerKey) => setVisible(v => ({ ...v, [k]: !v[k] }))

  const deployToBot = () => {
    const asset = symbol.includes(':') ? symbol : symbol.replace(/USDT$/, '')
    const payload = {
      asset,
      strategy: 'smc',
      timeframe,
      params: { swingLength, mode: entryRule === 'both' ? 2 : 1 }, // 1 = CHoCH only, 2 = BOS+CHoCH
      direction: 'both',
      slPct,
      riskUsd,
      sizingSlPct: slPct,
      // Exit: flip = opposite signal (no TP); rr = fixed take-profit at N×SL;
      // mfe = bot computes its own TP from historical favourable excursion (P75).
      ...(exitMode === 'rr' ? { tpPct: +(rrTarget * slPct).toFixed(2) } : {}),
      ...(exitMode === 'mfe' ? { useSuggestedTp: true } : {}),
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
          <label className="flex items-center gap-1 text-[11px] text-dim">
            Lookback
            <input
              type="number" min={30} step={10} value={lookbackDays}
              onChange={e => setLookbackDays(Math.max(30, +e.target.value || 150))}
              className="field w-[72px]"
            />
            <span>d</span>
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
            showInternal={visible.internal}
            showTrend={visible.trend}
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

      {/* ── Strategy test: which entry rule would have had an edge here ── */}
      <section className="card p-4">
        <div className="mb-1 text-xs font-semibold text-text">
          Strategy test <span className="font-normal text-dim">· {pairLabel} {timeframe} · SL {slPct}%, exit on opposite signal, fees on</span>
        </div>
        <p className="mb-3 text-[11px] text-dim">
          Entry × exit combos, ranked by <b>Quality</b> (0-100: PF + sample size + win-rate + drawdown; Return% barely counts because an open position inflates it). <span className="text-gain">Quality ≥ 50</span> = worth a look. Pick the winning combo's exit in the Deploy card. This window only — not a guarantee.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-dim">
                <th className="py-1 pr-3">Entry rule</th>
                <th className="py-1 pr-3 text-right">Quality</th>
                <th className="py-1 pr-3 text-right">Trades</th>
                <th className="py-1 pr-3 text-right">Win %</th>
                <th className="py-1 pr-3 text-right">Return %</th>
                <th className="py-1 pr-3 text-right">Profit factor</th>
              </tr>
            </thead>
            <tbody>
              {strategyResults.map(r => (
                <tr key={r.name} className="border-t border-border">
                  <td className="py-1 pr-3 font-medium text-text">
                    {r.name}
                    {!r.deployable && <span className="ml-1 text-[9px] text-dim">(test-only)</span>}
                  </td>
                  <td className={`py-1 pr-3 text-right font-mono tabular-nums font-bold ${r.quality >= 50 ? 'text-gain' : r.quality >= 30 ? 'text-warn' : 'text-dim'}`}>
                    {r.trades ? r.quality : '—'}
                  </td>
                  <td className="py-1 pr-3 text-right font-mono tabular-nums">{r.trades}</td>
                  <td className="py-1 pr-3 text-right font-mono tabular-nums">{r.trades ? `${r.winRate.toFixed(0)}%` : '—'}</td>
                  <td className={`py-1 pr-3 text-right font-mono tabular-nums ${r.returnPct > 0 ? 'text-gain' : r.returnPct < 0 ? 'text-loss' : 'text-dim'}`}>
                    {r.trades ? `${r.returnPct > 0 ? '+' : ''}${r.returnPct.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-1 pr-3 text-right font-mono tabular-nums">
                    {r.trades === 0 ? '—' : r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-dim italic">
          Includes retrace/retest entries (wait for the pull-back after a break). "(test-only)" rows aren't deployable yet — the bot still enters on the break. If a retest entry wins clearly, tell me and I'll wire it into the bot.
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
            <span className="mb-1 block">Entry rule</span>
            <select
              value={entryRule}
              onChange={e => setEntryRule(e.target.value as 'choch' | 'both')}
              className="field w-[150px]"
            >
              <option value="choch">CHoCH only</option>
              <option value="both">BOS + CHoCH</option>
            </select>
          </label>
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
          <label className="text-[11px] text-dim">
            <span className="mb-1 block">Exit (TP)</span>
            <select
              value={exitMode}
              onChange={e => setExitMode(e.target.value as 'flip' | 'rr' | 'mfe')}
              className="field w-[150px]"
            >
              <option value="mfe">Auto (MFE)</option>
              <option value="rr">Fixed R:R</option>
              <option value="flip">Flip (opposite signal)</option>
            </select>
          </label>
          {exitMode === 'rr' && (
            <label className="text-[11px] text-dim">
              <span className="mb-1 block">R:R target</span>
              <input type="number" min={1} step={0.5} value={rrTarget}
                onChange={e => setRrTarget(Math.max(1, +e.target.value || 2))}
                className="field w-[72px]" />
            </label>
          )}
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
