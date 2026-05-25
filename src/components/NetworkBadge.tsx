import { useEffect, useState } from 'react'
import { apiFetch } from '@/contexts/AuthContext'

interface NetworkInfo {
  network: 'mainnet' | 'testnet'
  configured: boolean
}

// Compact sidebar chip — fits inside the 60px-wide sidebar rail.
// Renders a single colored letter (M / T) with a hover tooltip showing
// the full label, matching the sidebar's existing tooltip pattern.
export default function NetworkBadge() {
  const [info, setInfo] = useState<NetworkInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      apiFetch('/api/network')
        .then(r => r.ok ? r.json() : null)
        .then((d: NetworkInfo | null) => { if (!cancelled && d) setInfo(d) })
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!info) return null

  const mainnet = info.network === 'mainnet'
  const tone = mainnet
    ? 'border-loss/40 bg-loss/10 text-loss'
    : 'border-warn/40 bg-warn/10 text-warn'
  const dot = mainnet ? 'bg-loss' : 'bg-warn'
  const tooltip = mainnet
    ? 'MAINNET — real funds at risk'
    : 'TESTNET — play funds, safe to experiment'

  return (
    <div className="relative group w-full flex items-center justify-center">
      <div
        className={`flex h-10 w-full items-center justify-center gap-1 rounded-xl border text-[9px] font-bold uppercase tracking-wider ${tone}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot} ${mainnet ? 'animate-pulse' : ''}`} />
        {mainnet ? 'MAIN' : 'TEST'}
      </div>
      {/* Floating tooltip — matches sidebar nav tooltip styling */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 z-[100]
                   whitespace-nowrap rounded-lg border border-border bg-panel px-3 py-1.5
                   text-xs font-medium text-text shadow-lg
                   opacity-0 translate-x-[-6px]
                   transition-all duration-150 ease-out
                   group-hover:opacity-100 group-hover:translate-x-0"
      >
        {tooltip}
        <span className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-border" />
        <span className="absolute right-full top-1/2 -translate-y-1/2 translate-x-[1px] border-[5px] border-transparent border-r-panel" />
      </div>
    </div>
  )
}
