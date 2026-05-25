import { useEffect, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, RefreshCw } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'
import { useHLAssets } from '@/lib/hlAssets'
import StatTile, { type Tone } from '@/components/ui/StatTile'
import InfoTip from '@/components/InfoTip'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PositionInfo {
  asset: string; size: number; side: 'long' | 'short'
  entryPx: number | null; unrealizedPnl: number
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
              {positions.map(pos => (
                <div key={pos.asset} className="flex items-center justify-between rounded-xl border border-border bg-panel-2 p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text">{pos.asset}/USDT</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        pos.side === 'long' ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'
                      }`}>{pos.side}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-dim">
                      Size: <span className="font-mono text-text">{pos.size}</span>
                      {pos.entryPx && <span className="ml-2">Entry: <span className="font-mono text-text">${pos.entryPx}</span></span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-mono text-sm font-semibold tabular-nums ${pos.unrealizedPnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                      {pos.unrealizedPnl >= 0 ? '+' : ''}{pos.unrealizedPnl.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => closePosition(pos.asset)}
                      className="rounded-lg border border-loss/30 bg-loss/5 px-2.5 py-1.5 text-xs font-semibold text-loss hover:bg-loss/10 transition-colors disabled:opacity-40"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
