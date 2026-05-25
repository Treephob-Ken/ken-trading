import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, RefreshCw, Bot, Grid3x3, Hand } from 'lucide-react'
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { apiFetch } from '@/contexts/AuthContext'
import { useHLAssets } from '@/lib/hlAssets'
import { fetchKlines } from '@/lib/binance'
import type { Candle } from '@/types'
import StatTile, { type Tone } from '@/components/ui/StatTile'
import InfoTip from '@/components/InfoTip'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PositionInfo {
  asset: string; size: number; side: 'long' | 'short'
  entryPx: number | null; unrealizedPnl: number
  // Pro-trader metrics from /api/account
  liquidationPx?: number | null
  leverage?: number
  marginUsed?: number
  positionValue?: number
  markPx?: number
}

interface PositionSource {
  kind: 'signal' | 'grid'
  botId: string
  botName: string
  running: boolean
  strategyId?: string
  gridCount?: number
}

interface PositionBrackets {
  slPx: number | null
  tpPx: number | null
}

interface AccountState {
  network: 'testnet' | 'mainnet'
  user: string
  accountValue: number
  withdrawable: number
  currentPrice: number | null
  position: PositionInfo | null
  allPositions: PositionInfo[]
}

interface AssetInfo { maxLeverage?: number; midPx?: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-lg border border-border bg-panel-2 px-3 py-2 font-mono text-sm text-text outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">{label}</span>
      {children}
    </label>
  )
}

function fmtUsd(v: number | undefined | null) {
  if (v == null) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TradePage() {
  const { symbols } = useHLAssets()

  // Account state
  const [account, setAccount] = useState<AccountState | null>(null)
  const [accountLoading, setAccountLoading] = useState(false)
  const [assetInfo, setAssetInfo] = useState<AssetInfo | null>(null)

  // Order form state
  const [selectedAsset, setSelectedAsset] = useState('')
  const [assetSearch, setAssetSearch] = useState('')
  const [slippage, setSlippage] = useState(2)
  const [closeSlippage, setCloseSlippage] = useState(2)
  const [usdcAmount, setUsdcAmount] = useState<number | ''>('')
  const [orderStatus, setOrderStatus] = useState('')
  const [busy, setBusy] = useState(false)

  // Sizing — Risk-based is the primary mode (matches Backtester / Signal Bots / Grid pages).
  // Fixed USDC stays available for quick manual sizing.
  type SizingMode = 'risk' | 'fixed'
  const [sizingMode, setSizingMode] = useState<SizingMode>(
    () => (localStorage.getItem('trade_sizingMode') as SizingMode) || 'risk',
  )
  const [riskUsd, setRiskUsd] = useState<number | ''>(
    () => {
      const v = localStorage.getItem('trade_riskUsd')
      return v && v !== '' ? Number(v) : 50
    },
  )
  const [slPct, setSlPct] = useState<number | ''>(
    () => {
      const v = localStorage.getItem('trade_slPct')
      return v && v !== '' ? Number(v) : 2
    },
  )

  useEffect(() => { localStorage.setItem('trade_sizingMode', sizingMode) }, [sizingMode])
  useEffect(() => { localStorage.setItem('trade_riskUsd', String(riskUsd)) }, [riskUsd])
  useEffect(() => { localStorage.setItem('trade_slPct', String(slPct)) }, [slPct])

  // ── Position detail panel state ───────────────────────────────────────────
  // Asset of the position the user has clicked (or auto-selected = first one).
  const [selectedPosAsset, setSelectedPosAsset] = useState<string | null>(null)
  const [sources, setSources] = useState<Record<string, PositionSource[]>>({})
  const [brackets, setBrackets] = useState<PositionBrackets | null>(null)
  const [posOpenedAt, setPosOpenedAt] = useState<Record<string, number>>(() => {
    // Position openedAt timestamps don't come from HL — track locally per asset.
    try {
      const raw = localStorage.getItem('trade_pos_openedAt')
      return raw ? (JSON.parse(raw) as Record<string, number>) : {}
    } catch { return {} }
  })
  const persistOpenedAt = (next: Record<string, number>) => {
    setPosOpenedAt(next)
    try { localStorage.setItem('trade_pos_openedAt', JSON.stringify(next)) } catch { /* quota */ }
  }

  // ── Account fetch ──────────────────────────────────────────────────────────

  const fetchAccount = async (asset?: string) => {
    setAccountLoading(true)
    try {
      const r = await apiFetch('/api/account' + (asset ? `?asset=${encodeURIComponent(asset)}` : ''))
      if (r.ok) setAccount(await r.json())
    } catch { /* ignore */ } finally { setAccountLoading(false) }
  }

  const fetchAssetInfo = async (asset: string) => {
    if (!asset) return
    try {
      const r = await apiFetch(`/api/asset-info?asset=${encodeURIComponent(asset)}`)
      if (r.ok) setAssetInfo(await r.json())
    } catch { /* ignore */ }
  }

  // Load account on mount
  useEffect(() => {
    fetchAccount()
    const id = setInterval(() => fetchAccount(selectedAsset || undefined), 10000)
    return () => clearInterval(id)
    // only run once on mount; interval handles refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh account + asset info when selected asset changes
  useEffect(() => {
    if (!selectedAsset) return
    fetchAccount(selectedAsset)
    fetchAssetInfo(selectedAsset)
    setUsdcAmount('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset])

  // Track first-seen timestamps for each open position so we can show "time held".
  // HL doesn't expose entry timestamp directly — we infer from "first seen here".
  useEffect(() => {
    if (!account?.allPositions) return
    const now = Date.now()
    const next = { ...posOpenedAt }
    const liveAssets = new Set(account.allPositions.map((p) => p.asset))
    let changed = false
    // Add newly-seen positions
    for (const p of account.allPositions) {
      if (next[p.asset] === undefined) { next[p.asset] = now; changed = true }
    }
    // Drop closed-position timestamps
    for (const a of Object.keys(next)) {
      if (!liveAssets.has(a)) { delete next[a]; changed = true }
    }
    if (changed) persistOpenedAt(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.allPositions])

  // Auto-select the first position if none is selected yet, OR if the selected
  // one was closed.
  useEffect(() => {
    const positions = account?.allPositions ?? []
    if (positions.length === 0) { setSelectedPosAsset(null); return }
    const stillThere = positions.some((p) => p.asset === selectedPosAsset)
    if (!stillThere) setSelectedPosAsset(positions[0].asset)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.allPositions])

  // Fetch source map once on mount + when positions change (cheap — bot config lookup, no HL call).
  useEffect(() => {
    apiFetch('/api/positions/sources')
      .then((r) => r.ok ? r.json() : {})
      .then((d: Record<string, PositionSource[]>) => setSources(d))
      .catch(() => setSources({}))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.allPositions?.length])

  // Fetch bracket orders for the selected position (this is one HL call).
  useEffect(() => {
    if (!selectedPosAsset) { setBrackets(null); return }
    const pos = account?.allPositions.find((p) => p.asset === selectedPosAsset)
    if (!pos) { setBrackets(null); return }
    let cancelled = false
    apiFetch(`/api/positions/${encodeURIComponent(selectedPosAsset)}/brackets?side=${pos.side}`)
      .then((r) => r.ok ? r.json() : { slPx: null, tpPx: null })
      .then((d: PositionBrackets) => { if (!cancelled) setBrackets(d) })
      .catch(() => { if (!cancelled) setBrackets({ slPx: null, tpPx: null }) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPosAsset, account?.allPositions])

  // ── Position calculator ────────────────────────────────────────────────────

  interface SizingResult {
    positionUsd: number; qty: number; margin: number
    maxLev: number; slLong: number; slShort: number
  }
  const sizing: SizingResult | null = (() => {
    if (typeof riskUsd !== 'number' || typeof slPct !== 'number') return null
    if (riskUsd <= 0 || slPct <= 0 || !assetInfo?.midPx) return null
    const positionUsd = riskUsd / (slPct / 100)
    const maxLev = assetInfo.maxLeverage ?? 1
    const margin = positionUsd / maxLev
    const qty = assetInfo.midPx > 0 ? positionUsd / assetInfo.midPx : 0
    const slLong = assetInfo.midPx * (1 - slPct / 100)
    const slShort = assetInfo.midPx * (1 + slPct / 100)
    return { positionUsd, qty, margin, maxLev, slLong, slShort }
  })()

  // ── Order placement ────────────────────────────────────────────────────────

  const placeOrder = async (side: 'buy' | 'sell') => {
    if (!selectedAsset) { setOrderStatus('Select an asset first'); return }
    if (!assetInfo?.midPx) { setOrderStatus('Price not loaded yet'); return }

    // Resolve the order size from the active sizing mode. Risk-mode derives
    // qty from (riskUsd / SL%) so a fill that hits SL loses exactly the risk
    // amount. Fixed-USDC mode lets the user type a notional directly.
    let size: number
    if (sizingMode === 'risk') {
      if (!sizing) { setOrderStatus('Set Risk $ and SL % first'); return }
      size = +sizing.qty.toFixed(6)
    } else {
      if (typeof usdcAmount !== 'number' || usdcAmount <= 0) { setOrderStatus('Enter USDC amount'); return }
      size = +(usdcAmount / assetInfo.midPx).toFixed(6)
    }
    if (size <= 0) { setOrderStatus('Computed size is zero — check inputs'); return }

    setBusy(true); setOrderStatus('Placing order…')
    try {
      const res = await apiFetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: selectedAsset, side, size, orderType: 'market', maxSlippagePct: slippage }),
      })
      const data = (await res.json()) as { message?: string; filled?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setOrderStatus(`✓ ${side.toUpperCase()} ${size} ${selectedAsset} placed`)
      setTimeout(() => fetchAccount(selectedAsset), 1500)
    } catch (e) {
      setOrderStatus(`✗ ${(e as Error).message}`)
    } finally { setBusy(false) }
  }

  const closePosition = async (asset: string) => {
    if (!confirm(`Close ${asset} position?`)) return
    setBusy(true)
    try {
      const res = await apiFetch('/api/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, maxSlippagePct: closeSlippage }),
      })
      const data = (await res.json()) as { filled?: boolean; message?: string; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (data.filled === false) {
        setOrderStatus(data.message || 'No position to close')
      } else {
        setOrderStatus(`✓ Closed ${asset}`)
        setTimeout(() => fetchAccount(selectedAsset || undefined), 1500)
      }
    } catch (e) {
      setOrderStatus(`✗ ${(e as Error).message}`)
    } finally { setBusy(false) }
  }

  // ── Asset search filtering ─────────────────────────────────────────────────

  const filteredSymbols = assetSearch
    ? symbols.filter(s => s.base.toUpperCase().includes(assetSearch.toUpperCase()))
    : symbols.slice(0, 20)

  const handleSelectAsset = (asset: string) => {
    setSelectedAsset(asset)
    setAssetSearch('')
  }

  const quickSize = (pct: number) => {
    if (!account || !assetInfo?.midPx) return
    const usdc = (account.withdrawable * pct) / 100
    setUsdcAmount(+usdc.toFixed(2))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const positions = account?.allPositions ?? []

  return (
    <main className="mx-auto flex w-full max-w-[2200px] flex-1 flex-col gap-4 px-6 py-5 lg:flex-row">

      {/* ── Left: Account + positions ── */}
      <div className="flex flex-1 flex-col gap-4 min-w-0">

        {/* Account card */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text">Account · Hyperliquid</h2>
              <p className="text-[11px] text-dim">
                {account?.user ? account.user.slice(0, 8) + '…' + account.user.slice(-4) : '—'}
                {account?.network && (
                  <span className={`ml-2 ${account.network === 'testnet' ? 'text-warn' : 'text-gain'}`}>
                    {account.network === 'testnet' ? '· Testnet ⚠' : '· Mainnet'}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchAccount(selectedAsset || undefined)}
              disabled={accountLoading}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-dim hover:text-text transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${accountLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <StatTile
              question="How much is the account worth?"
              info="Account Value"
              value={fmtUsd(account?.accountValue)}
              sub="USDC including unrealized PnL"
            />
            <StatTile
              question="How much can I deploy right now?"
              info="Withdrawable"
              value={fmtUsd(account?.withdrawable)}
              tone={
                account && account.withdrawable < account.accountValue * 0.2
                  ? 'warn'
                  : 'gain'
              }
              sub="USDC free of margin"
            />
            <StatTile
              question="How much is tied up as collateral?"
              info="Margin Used"
              value={account ? fmtUsd(account.accountValue - account.withdrawable) : '—'}
              sub="USDC posted for open positions"
            />
          </div>
        </div>

        {/* Asset context strip — visible once an asset is picked. Mirrors the
            ConfidenceStrip pattern from the Backtester / Grid pages so the
            "what am I about to trade" picture is one glance. */}
        {selectedAsset && (
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-dim font-display">
                Context — {selectedAsset}/USDT
              </h3>
              <span className="text-[10px] text-dim">
                {account?.network ? account.network.toUpperCase() : '—'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <StatTile
                compact
                question="What's the live mid price?"
                info="Mid Price"
                value={assetInfo?.midPx ? `$${assetInfo.midPx.toLocaleString()}` : '—'}
                tone="brand"
                sub="Hyperliquid mark"
              />
              <StatTile
                compact
                question="How much leverage is available?"
                info="Max Leverage"
                value={assetInfo?.maxLeverage ? `${assetInfo.maxLeverage}×` : '—'}
                tone="neutral"
                sub="Higher = bigger position, faster liquidation"
              />
              <StatTile
                compact
                question="Is this real money?"
                info="Network"
                value={account?.network === 'mainnet' ? 'Mainnet' : account?.network === 'testnet' ? 'Testnet' : '—'}
                tone={account?.network === 'mainnet' ? 'gain' : account?.network === 'testnet' ? 'warn' : 'neutral'}
                sub={account?.network === 'mainnet' ? 'Live funds' : 'Paper trading'}
              />
              <StatTile
                compact
                question="What's my buying power here?"
                info="At max leverage, the largest USDC notional you could open with your current Withdrawable balance. Just an upper bound — don't actually size to it."
                value={
                  account && assetInfo?.maxLeverage
                    ? fmtUsd(account.withdrawable * assetInfo.maxLeverage)
                    : '—'
                }
                tone="neutral"
                sub="Withdrawable × max leverage"
              />
            </div>
          </div>
        )}

        {/* Open positions */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1 text-sm font-semibold text-text">
              Open Positions
              <InfoTip term="Open Positions" />
              {positions.length > 0 && (
                <span className="ml-2 rounded-md bg-panel-2 px-1.5 py-0.5 text-xs text-dim">{positions.length}</span>
              )}
              {positions.length > 0 && (() => {
                const totalUpnl = positions.reduce((acc, p) => acc + p.unrealizedPnl, 0)
                const tone: Tone = totalUpnl > 0 ? 'gain' : totalUpnl < 0 ? 'loss' : 'neutral'
                const toneCls = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-dim'
                return (
                  <span className={`ml-2 inline-flex items-center gap-1 text-xs font-mono tabular-nums ${toneCls}`}>
                    total uPnL {totalUpnl >= 0 ? '+' : ''}{totalUpnl.toFixed(2)}
                    <InfoTip term="Unrealized PnL" />
                  </span>
                )
              })()}
            </h2>
            <label className="flex items-center gap-2 text-[10px] text-dim">
              Close slippage %
              <input type="number" step="0.1" min="0"
                value={closeSlippage}
                onChange={e => setCloseSlippage(+e.target.value)}
                className="w-16 rounded-lg border border-border bg-panel-2 px-2 py-1 font-mono text-xs text-text outline-none focus:border-brand/60" />
            </label>
          </div>

          {positions.length === 0 ? (
            <p className="py-4 text-center text-sm text-dim">Flat — no open positions</p>
          ) : (
            <div className="flex flex-col gap-2">
              {positions.map(pos => {
                const isSelected = pos.asset === selectedPosAsset
                const posSources = sources[pos.asset] ?? []
                return (
                  <div
                    key={pos.asset}
                    onClick={() => setSelectedPosAsset(pos.asset)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedPosAsset(pos.asset) }}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 transition-colors ${
                      isSelected
                        ? 'border-brand/50 bg-brand/5 ring-1 ring-brand/30'
                        : 'border-border bg-panel-2 hover:border-border-strong'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-text">{pos.asset}/USDT</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          pos.side === 'long' ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'
                        }`}>{pos.side}</span>
                        <SourceChips sources={posSources} />
                      </div>
                      <div className="mt-0.5 text-[11px] text-dim">
                        Size: <span className="font-mono text-text">{pos.size}</span>
                        {pos.entryPx && <span className="ml-2">Entry: <span className="font-mono text-text">${pos.entryPx}</span></span>}
                        {pos.leverage && <span className="ml-2">Lev: <span className="font-mono text-text">{pos.leverage}x</span></span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-sm font-semibold tabular-nums ${pos.unrealizedPnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                        {pos.unrealizedPnl >= 0 ? '+' : ''}{pos.unrealizedPnl.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); closePosition(pos.asset) }}
                        className="rounded-lg border border-loss/30 bg-loss/5 px-2.5 py-1.5 text-xs font-semibold text-loss hover:bg-loss/10 transition-colors disabled:opacity-40"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Selected position detail ── */}
        {(() => {
          const pos = account?.allPositions.find((p) => p.asset === selectedPosAsset) ?? null
          if (!pos) return null
          return (
            <PositionDetailCard
              position={pos}
              brackets={brackets}
              sources={sources[pos.asset] ?? []}
              openedAt={posOpenedAt[pos.asset] ?? null}
            />
          )
        })()}
      </div>

      {/* ── Right: Place Order (sticky) ── */}
      <aside className="relative z-[35] flex h-fit w-full shrink-0 flex-col gap-4 lg:sticky lg:top-5 lg:w-[360px]">
        <div className="card p-4">
          <h2 className="mb-4 text-sm font-semibold text-text">Place Order</h2>

          <div className="flex flex-col gap-3">
            {/* Asset picker */}
            <Field label="Asset">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search ETH, BTC, SOL…"
                  value={selectedAsset ? (assetSearch || selectedAsset) : assetSearch}
                  onFocus={() => { if (selectedAsset) setAssetSearch('') }}
                  onChange={e => {
                    setAssetSearch(e.target.value)
                    if (!e.target.value) setSelectedAsset('')
                  }}
                  className={inputCls}
                />
                {(assetSearch || !selectedAsset) && filteredSymbols.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-border bg-panel shadow-lg">
                    {filteredSymbols.map(s => (
                      <button
                        key={s.symbol}
                        type="button"
                        onMouseDown={() => handleSelectAsset(s.base)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-panel-2 text-text"
                      >
                        {s.base}/USDT
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>

            {/* Price + slippage */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">Price</span>
                <div className="mt-1 rounded-lg border border-border bg-panel-2 px-3 py-2 font-mono text-sm text-text">
                  {assetInfo?.midPx ? `$${assetInfo.midPx.toLocaleString()}` : '—'}
                </div>
              </div>
              <Field label="Max slippage %">
                <input type="number" step="0.1" min="0"
                  value={slippage}
                  onChange={e => setSlippage(+e.target.value)}
                  className={inputCls} />
              </Field>
            </div>

            {/* Sizing mode toggle — Risk-based primary, matches every other page */}
            <div>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-dim">Sizing mode</span>
              <div className="flex gap-1 rounded-lg border border-border bg-bg p-1">
                <button
                  type="button"
                  onClick={() => setSizingMode('risk')}
                  className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    sizingMode === 'risk' ? 'bg-brand/15 text-brand' : 'text-dim hover:text-text'
                  }`}
                >
                  Risk-based
                </button>
                <button
                  type="button"
                  onClick={() => setSizingMode('fixed')}
                  className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    sizingMode === 'fixed' ? 'bg-brand/15 text-brand' : 'text-dim hover:text-text'
                  }`}
                >
                  Fixed USDC
                </button>
              </div>
            </div>

            {sizingMode === 'risk' ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Risk per trade ($)">
                    <input type="number" min="1" step="any" placeholder="e.g. 50"
                      value={riskUsd}
                      onChange={e => setRiskUsd(e.target.value === '' ? '' : +e.target.value)}
                      className={inputCls} />
                  </Field>
                  <Field label="Stop loss %">
                    <input type="number" min="0.1" step="0.1" placeholder="e.g. 2"
                      value={slPct}
                      onChange={e => setSlPct(e.target.value === '' ? '' : +e.target.value)}
                      className={inputCls} />
                  </Field>
                </div>

                {sizing ? (
                  <div className="rounded-xl border border-brand/20 bg-brand/5 px-3 py-2 text-[11px] space-y-1">
                    <div className="flex justify-between">
                      <span className="text-dim">Position size</span>
                      <span className="font-mono text-text font-semibold">${sizing.positionUsd.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-dim">Order qty</span>
                      <span className="font-mono text-text">{sizing.qty.toFixed(6)} {selectedAsset || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-dim">Margin @ max lev ({sizing.maxLev}x)</span>
                      <span className="font-mono text-text">${sizing.margin.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-dim">SL long / short</span>
                      <span className="font-mono text-loss">${sizing.slLong.toFixed(4)} / ${sizing.slShort.toFixed(4)}</span>
                    </div>
                    <p className="pt-1 text-[10px] text-dim leading-snug">
                      A fill that hits the SL loses ~${typeof riskUsd === 'number' ? riskUsd.toFixed(2) : '—'} (the risk you set).
                    </p>
                  </div>
                ) : (
                  <p className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] text-warn">
                    {selectedAsset
                      ? 'Set Risk $ and SL % to compute order size.'
                      : 'Pick an asset to compute order size.'}
                  </p>
                )}
              </>
            ) : (
              <>
                <Field label="Amount (USDC)">
                  <input type="number" step="any" min="0" placeholder="e.g. 100"
                    value={usdcAmount}
                    onChange={e => setUsdcAmount(e.target.value === '' ? '' : +e.target.value)}
                    className={inputCls} />
                </Field>

                <div className="grid grid-cols-4 gap-1">
                  {[25, 50, 75, 100].map(pct => (
                    <button key={pct} type="button"
                      onClick={() => quickSize(pct)}
                      disabled={!account}
                      className="rounded-lg border border-border px-2 py-1.5 text-xs text-dim hover:border-brand/40 hover:text-text transition-colors disabled:opacity-40">
                      {pct === 100 ? 'Max' : `${pct}%`}
                    </button>
                  ))}
                </div>

                {selectedAsset && assetInfo?.midPx && typeof usdcAmount === 'number' && usdcAmount > 0 && (
                  <div className="rounded-xl border border-border bg-panel-2 px-3 py-2 text-[10px]">
                    <div className="flex justify-between"><span className="text-dim">Qty</span><span className="font-mono text-text">{(usdcAmount / assetInfo.midPx).toFixed(6)} {selectedAsset}</span></div>
                    <div className="flex justify-between mt-1"><span className="text-dim">Notional</span><span className="font-mono text-text">${usdcAmount.toFixed(2)}</span></div>
                  </div>
                )}
              </>
            )}

            {/* Buy / Sell buttons */}
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                disabled={busy || !selectedAsset}
                onClick={() => placeOrder('buy')}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-gain px-4 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <ArrowUpCircle className="h-4 w-4" /> Buy / Long
              </button>
              <button
                type="button"
                disabled={busy || !selectedAsset}
                onClick={() => placeOrder('sell')}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-loss px-4 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <ArrowDownCircle className="h-4 w-4" /> Sell / Short
              </button>
            </div>

            {orderStatus && (
              <p className={`text-center text-xs ${
                orderStatus.startsWith('✓') ? 'text-gain'
                  : orderStatus.startsWith('✗') ? 'text-loss'
                    : 'text-dim'
              }`}>{orderStatus}</p>
            )}
          </div>
        </div>
      </aside>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Source chips — visual badge per bot that owns/configured this asset, plus
// a fallback "Manual" chip when no bot matches.
// ─────────────────────────────────────────────────────────────────────────────

function SourceChips({ sources }: { sources: PositionSource[] }) {
  if (sources.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">
        <Hand className="h-2.5 w-2.5" />
        Manual
      </span>
    )
  }
  return (
    <>
      {sources.map((s) => {
        const live = s.running
        const label =
          s.kind === 'signal'
            ? `Signal · ${s.strategyId?.toUpperCase() ?? '?'}`
            : `Grid · ${s.gridCount ?? '?'}`
        const Icon = s.kind === 'signal' ? Bot : Grid3x3
        return (
          <span
            key={s.botId}
            title={`${s.botName}${live ? ' (running)' : ' (stopped)'}`}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
              live
                ? 'border-gain/40 bg-gain/10 text-gain'
                : 'border-border bg-panel-2 text-muted'
            }`}
          >
            <Icon className="h-2.5 w-2.5" />
            {label}
          </span>
        )
      })}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Position detail card — chart + metrics for whichever position is selected.
// ─────────────────────────────────────────────────────────────────────────────

function fmtMoney(v: number | null | undefined, sign = false): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = sign && v >= 0 ? '+' : ''
  return `${s}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
         (v < 0 && !sign ? '' : '')
}

function fmtPctOf(v: number, dp = 2): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function PositionDetailCard({
  position,
  brackets,
  sources,
  openedAt,
}: {
  position: PositionInfo
  brackets: PositionBrackets | null
  sources: PositionSource[]
  openedAt: number | null
}) {
  // Re-render every 30s so "time held" stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const mark = position.markPx ?? position.entryPx ?? 0
  const entry = position.entryPx ?? 0
  const notional = position.positionValue ?? (position.size * mark)
  const margin = position.marginUsed
  const liq = position.liquidationPx

  // Unrealized PnL %: against initial margin = ROE.
  const roePct = margin && margin > 0 ? (position.unrealizedPnl / margin) * 100 : null
  // PnL % of position notional (price move %).
  const priceMovePct = entry > 0
    ? position.side === 'long'
      ? ((mark - entry) / entry) * 100
      : ((entry - mark) / entry) * 100
    : null

  // Distance to liquidation (% of price). Higher = safer.
  const distToLiqPct = liq && mark > 0
    ? position.side === 'long'
      ? ((mark - liq) / mark) * 100
      : ((liq - mark) / mark) * 100
    : null

  // Distance to SL / TP
  const distToSlPct = brackets?.slPx && mark > 0
    ? position.side === 'long'
      ? ((mark - brackets.slPx) / mark) * 100
      : ((brackets.slPx - mark) / mark) * 100
    : null
  const distToTpPct = brackets?.tpPx && mark > 0
    ? position.side === 'long'
      ? ((brackets.tpPx - mark) / mark) * 100
      : ((mark - brackets.tpPx) / mark) * 100
    : null

  // Risk:reward at current setup. Uses the absolute distances from entry.
  const rrRatio = brackets?.slPx && brackets?.tpPx && entry > 0
    ? (() => {
        const risk = Math.abs(entry - brackets.slPx)
        const reward = Math.abs(brackets.tpPx - entry)
        return risk > 0 ? reward / risk : null
      })()
    : null

  const timeHeldMs = openedAt ? Date.now() - openedAt : null

  const pnlTone: Tone = position.unrealizedPnl > 0 ? 'gain' : position.unrealizedPnl < 0 ? 'loss' : 'neutral'
  const liqTone: Tone = distToLiqPct == null ? 'neutral' : distToLiqPct < 5 ? 'loss' : distToLiqPct < 15 ? 'warn' : 'gain'

  return (
    <div className="card relative overflow-hidden p-4 ring-1 ring-brand/30 shadow-[0_0_0_4px_hsl(var(--brand)/0.05)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand via-accent to-brand" />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${
          position.side === 'long'
            ? 'ring-gain/40 bg-gain/10 text-gain'
            : 'ring-loss/40 bg-loss/10 text-loss'
        }`}>
          {position.side === 'long' ? '↑ LONG' : '↓ SHORT'}
        </span>
        <h3 className="text-sm font-bold text-text font-display">
          {position.asset}/USDT
          <span className="ml-2 text-xs font-mono text-dim font-normal">
            {position.size} @ ${entry.toFixed(4)}
          </span>
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <SourceChips sources={sources} />
        </div>
      </div>

      {/* 6-tile metric grid — what most traders check first */}
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-3">
        <StatTile
          compact
          question="How much am I up/down right now?"
          info="Unrealized PnL"
          value={fmtMoney(position.unrealizedPnl, true)}
          tone={pnlTone}
          sub={roePct != null ? `${fmtPctOf(roePct)} on margin (ROE)` : 'Margin unknown'}
        />
        <StatTile
          compact
          question="How far has price moved?"
          info="Price change since entry as a percentage of entry. Independent of leverage — useful to compare across positions."
          value={priceMovePct != null ? fmtPctOf(priceMovePct) : '—'}
          tone={priceMovePct == null ? 'neutral' : priceMovePct > 0 ? 'gain' : 'loss'}
          sub={`Mark $${mark.toFixed(4)} · Entry $${entry.toFixed(4)}`}
        />
        <StatTile
          compact
          question="How close am I to liquidation?"
          info="Percentage of price move that would trigger liquidation. Under 5% = danger zone — add margin or reduce size."
          value={distToLiqPct != null ? `${distToLiqPct.toFixed(1)}%` : '—'}
          tone={liqTone}
          sub={liq != null ? `Liq @ $${liq.toFixed(4)}` : 'No liq computed'}
        />
        <StatTile
          compact
          question="Where's my stop loss?"
          info="Distance from current mark to the open reduce-only stop order. If empty, no SL is on the exchange — your position has no automated downside cap."
          value={brackets?.slPx != null ? `$${brackets.slPx.toFixed(4)}` : '—'}
          tone={brackets?.slPx == null ? 'warn' : 'neutral'}
          sub={distToSlPct != null ? `${Math.abs(distToSlPct).toFixed(2)}% away` : 'No SL on exchange'}
        />
        <StatTile
          compact
          question="Where's my take profit?"
          info="Distance from current mark to the open reduce-only TP order."
          value={brackets?.tpPx != null ? `$${brackets.tpPx.toFixed(4)}` : '—'}
          tone={brackets?.tpPx == null ? 'neutral' : 'gain'}
          sub={distToTpPct != null ? `${Math.abs(distToTpPct).toFixed(2)}% away` : 'No TP on exchange'}
        />
        <StatTile
          compact
          question="What's my risk-to-reward?"
          info="R:R"
          value={rrRatio != null ? `${rrRatio.toFixed(2)}:1` : '—'}
          tone={rrRatio == null ? 'neutral' : rrRatio >= 2 ? 'gain' : rrRatio >= 1 ? 'warn' : 'loss'}
          sub={timeHeldMs != null ? `Held ${fmtDuration(timeHeldMs)}` : 'Set both SL + TP for R:R'}
        />
      </div>

      {/* Notional + margin + leverage quick info */}
      <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-lg border border-border bg-panel-2 px-2 py-1.5">
          <div className="text-dim">Notional</div>
          <div className="font-mono text-text">${notional.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel-2 px-2 py-1.5">
          <div className="text-dim">Margin used</div>
          <div className="font-mono text-text">{margin != null ? `$${margin.toFixed(2)}` : '—'}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel-2 px-2 py-1.5">
          <div className="text-dim">Leverage</div>
          <div className="font-mono text-text">{position.leverage ? `${position.leverage}x` : '—'}</div>
        </div>
      </div>

      {/* Chart with entry/SL/TP/liq overlay lines */}
      <PositionChart
        asset={position.asset}
        side={position.side}
        entryPx={entry}
        slPx={brackets?.slPx ?? null}
        tpPx={brackets?.tpPx ?? null}
        liqPx={liq ?? null}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Position chart — candles + entry/SL/TP/liq price lines.
// Lightweight clone of ChartPanel without strategy overlays. Switches
// asset/timeframe in place by re-running the build effect on key change.
// ─────────────────────────────────────────────────────────────────────────────

const POS_CHART_TF = '1h'  // sensible default; could be user-selectable later

function PositionChart({
  asset,
  side,
  entryPx,
  slPx,
  tpPx,
  liqPx,
}: {
  asset: string
  side: 'long' | 'short'
  entryPx: number
  slPx: number | null
  tpPx: number | null
  liqPx: number | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch candles whenever asset changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchKlines({ symbol: `${asset.toUpperCase()}USDT`, interval: POS_CHART_TF })
      .then((data) => { if (!cancelled) { setCandles(data); setLoading(false) } })
      .catch((e: unknown) => {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [asset])

  // Build the chart whenever candles or any of the overlay prices change.
  useEffect(() => {
    const el = ref.current
    if (!el || candles.length === 0) return
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b93a7',
        fontFamily: "'Inter', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3142' },
      rightPriceScale: { borderColor: '#2a3142' },
    })
    const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444',
    })
    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      })),
    )

    // Price-line overlays — entry always; SL/TP/Liq only when present.
    const lines: IPriceLine[] = []
    lines.push(
      series.createPriceLine({
        price: entryPx,
        color: side === 'long' ? '#10b981' : '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `ENTRY ${side.toUpperCase()}`,
      }),
    )
    if (slPx != null) {
      lines.push(
        series.createPriceLine({
          price: slPx,
          color: '#ef4444',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'SL',
        }),
      )
    }
    if (tpPx != null) {
      lines.push(
        series.createPriceLine({
          price: tpPx,
          color: '#10b981',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'TP',
        }),
      )
    }
    if (liqPx != null) {
      lines.push(
        series.createPriceLine({
          price: liqPx,
          color: '#f59e0b',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'LIQ',
        }),
      )
    }

    chart.timeScale().fitContent()
    return () => {
      chart.remove()
    }
  }, [candles, side, entryPx, slPx, tpPx, liqPx])

  // Quiet memo to avoid stale-warning ESLint complaint when slPx, tpPx, liqPx change but candles don't.
  useMemo(() => ({ slPx, tpPx, liqPx, entryPx, side }), [slPx, tpPx, liqPx, entryPx, side])

  if (error) {
    return (
      <div className="flex h-[280px] flex-col items-center justify-center gap-2 rounded-lg border border-border bg-panel-2 text-center">
        <p className="text-sm text-loss">Could not load chart</p>
        <p className="max-w-sm text-xs text-dim">{error}</p>
      </div>
    )
  }
  if (loading && candles.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-lg border border-border bg-panel-2 text-sm text-dim">
        Loading {asset}/USDT chart…
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-panel-2 p-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] text-dim">
        <span>{asset}/USDT · {POS_CHART_TF}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <span className="flex items-center gap-1">
            <span className={`h-0.5 w-3 ${side === 'long' ? 'bg-gain' : 'bg-loss'}`} /> entry
          </span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 border-t border-dashed border-loss" /> SL</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 border-t border-dashed border-gain" /> TP</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 border-t border-dotted border-warn" /> Liq</span>
        </span>
      </div>
      <div ref={ref} className="h-[280px] w-full" />
    </div>
  )
}
