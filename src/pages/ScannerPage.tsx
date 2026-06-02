import { useEffect, useState } from 'react'
import { Radar, RefreshCw } from 'lucide-react'
import type { SymbolInfo } from '@/lib/binance'
import {
  getScannerUniverse,
  clearUniverseCache,
  type UniverseKind,
} from '@/lib/scanner/universe'
import PageHeader from '@/components/ui/PageHeader'
import IndicatorScanTab from '@/components/scanner/IndicatorScanTab'
import GridScanTab from '@/components/scanner/GridScanTab'
import SmcScanTab from '@/components/scanner/SmcScanTab'
import CustomScanTab from '@/components/scanner/CustomScanTab'

interface Props {
  onSymbol: (v: string) => void
  onTimeframe: (v: string) => void
}

type TabId = 'indicator' | 'grid' | 'smc' | 'custom'

export default function ScannerPage({ onSymbol, onTimeframe }: Props) {
  const [tab, setTab] = useState<TabId>(
    () => (localStorage.getItem('scanner_tab') as TabId) || 'indicator',
  )
  const [kind, setKind] = useState<UniverseKind>(
    () => (localStorage.getItem('scanner_kind') as UniverseKind) || 'crypto',
  )
  const [universe, setUniverse] = useState<SymbolInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem('scanner_tab', tab)
  }, [tab])

  useEffect(() => {
    localStorage.setItem('scanner_kind', kind)
  }, [kind])

  const loadUniverse = () => {
    setLoading(true)
    setError(null)
    // Load every HL-tradeable coin that also has a Binance pair (so the coin
    // picker covers everything the user can trade), not just the top 30.
    // The scan respects whatever the coin filter is set to, so a full
    // universe doesn't force scanning every coin — only what the user picks.
    getScannerUniverse(Number.POSITIVE_INFINITY, kind)
      .then((u) => {
        setUniverse(u)
        setLoading(false)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
  }

  useEffect(loadUniverse, [kind])

  const refresh = () => {
    clearUniverseCache()
    loadUniverse()
  }

  return (
    <main className="flex w-full flex-1 flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Radar}
        title="Scanner"
        subtitle="Batch-rank symbols × strategies to find the best combos right now."
        actions={
          <>
            <span className="rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] font-mono text-text">
              {loading ? '…' : `Symbols (${universe.length})`}
            </span>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1 rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-dim hover:text-text disabled:opacity-50"
              title="Re-pull HL asset list and Binance 24h volume"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </>
        }
      />

      {error && (
        <div className="card border border-loss/30 bg-loss/5 p-3 text-xs text-loss">
          Could not load symbol universe: {error}
        </div>
      )}

      {/* ── Market kind toggle ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-dim">Universe</span>
        <div className="flex overflow-hidden rounded-md border border-border">
          <button
            type="button"
            onClick={() => setKind('crypto')}
            className={`px-3 py-1 text-xs font-semibold ${
              kind === 'crypto' ? 'bg-brand text-bg' : 'bg-panel-2 text-dim hover:text-text'
            }`}
          >
            Crypto (Binance-ranked)
          </button>
          <button
            type="button"
            onClick={() => setKind('hip3')}
            className={`px-3 py-1 text-xs font-semibold ${
              kind === 'hip3' ? 'bg-brand text-bg' : 'bg-panel-2 text-dim hover:text-text'
            }`}
          >
            Stocks & Commodities (HL-only)
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('indicator')}
          className={`px-4 py-2 text-sm font-semibold transition-colors -mb-px border-b-2 ${
            tab === 'indicator'
              ? 'border-brand text-text'
              : 'border-transparent text-dim hover:text-text'
          }`}
        >
          Indicator
        </button>
        <button
          type="button"
          onClick={() => setTab('grid')}
          className={`px-4 py-2 text-sm font-semibold transition-colors -mb-px border-b-2 ${
            tab === 'grid'
              ? 'border-brand text-text'
              : 'border-transparent text-dim hover:text-text'
          }`}
        >
          Grid
        </button>
        <button
          type="button"
          onClick={() => setTab('smc')}
          className={`px-4 py-2 text-sm font-semibold transition-colors -mb-px border-b-2 ${
            tab === 'smc'
              ? 'border-brand text-text'
              : 'border-transparent text-dim hover:text-text'
          }`}
        >
          SMC
        </button>
        <button
          type="button"
          onClick={() => setTab('custom')}
          className={`px-4 py-2 text-sm font-semibold transition-colors -mb-px border-b-2 ${
            tab === 'custom'
              ? 'border-brand text-text'
              : 'border-transparent text-dim hover:text-text'
          }`}
        >
          Custom
        </button>
      </div>

      {tab === 'indicator' ? (
        <IndicatorScanTab
          universe={universe}
          onPickSymbol={onSymbol}
          onPickTimeframe={onTimeframe}
        />
      ) : tab === 'grid' ? (
        <GridScanTab
          universe={universe}
          onPickSymbol={onSymbol}
          onPickTimeframe={onTimeframe}
        />
      ) : tab === 'smc' ? (
        <SmcScanTab
          universe={universe}
          onPickSymbol={onSymbol}
          onPickTimeframe={onTimeframe}
        />
      ) : (
        <CustomScanTab
          universe={universe}
          onPickSymbol={onSymbol}
          onPickTimeframe={onTimeframe}
        />
      )}
    </main>
  )
}
