import { useEffect, useState } from 'react'
import { apiFetch } from '@/contexts/AuthContext'

interface NetworkInfo {
  network: 'mainnet' | 'testnet'
  configured: boolean
}

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
  const label = mainnet ? 'MAINNET' : 'TESTNET'
  const title = mainnet
    ? 'Trading with real funds. Be careful.'
    : 'Trading on testnet with play funds. Safe to experiment.'

  return (
    <div
      title={title}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${mainnet ? 'animate-pulse' : ''}`} />
      {label}
    </div>
  )
}
