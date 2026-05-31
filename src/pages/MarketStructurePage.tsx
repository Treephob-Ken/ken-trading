import { useEffect, useMemo, useState } from 'react'
import { Network } from 'lucide-react'
import { fetchKlines } from '@/lib/binance'
import { computeSMC } from '@/lib/smc/engine'
import SMCChart from '@/components/smc/SMCChart'
import type { Candle } from '@/types'

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d']

export default function MarketStructurePage() {
  const [symbol, setSymbol] = useState(() => localStorage.getItem('lab_symbol') || 'ETHUSDT')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('lab_timeframe') || '1h')
  const [swingLength, setSwingLength] = useState(50)
  const [showEqual, setShowEqual] = useState(true)
  const [showOrderBlocks, setShowOrderBlocks] = useState(true)
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

  const pairLabel = symbol.includes(':') ? symbol.split(':')[1] + '/USDC' : symbol.replace(/USDT$/, '/USDC')

  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-brand" />
          <h1 className="text-lg font-semibold text-text font-display">Market Structure</h1>
          <p className="hidden sm:block text-xs text-dim">Swing structure (BOS/CHoCH) + Strong/Weak levels — {pairLabel} · {timeframe}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={symbol}
            onChange={e => { setSymbol(e.target.value.toUpperCase()); localStorage.setItem('lab_symbol', e.target.value.toUpperCase()) }}
            className="field w-[140px]"
            aria-label="Symbol"
          />
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
          <button
            type="button"
            onClick={() => setShowOrderBlocks(v => !v)}
            className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer ${showOrderBlocks ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-panel-2 text-dim hover:text-text'}`}
          >Order blocks</button>
          <button
            type="button"
            onClick={() => setShowEqual(v => !v)}
            className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer ${showEqual ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-panel-2 text-dim hover:text-text'}`}
          >EQH/EQL</button>
        </div>
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
          <SMCChart candles={candles} result={result} showEqual={showEqual} showOrderBlocks={showOrderBlocks} />
        )}
      </section>

      {showOrderBlocks && (
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
    </main>
  )
}
