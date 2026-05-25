import { useEffect, useState } from 'react'
import { Save, ShieldCheck } from 'lucide-react'
import { apiFetch, useAuth } from '@/contexts/AuthContext'
import RiskControlsCard from '@/components/RiskControlsCard'

interface Credentials {
  hlUser: string
  hlNetwork: 'mainnet' | 'testnet'
  hlConfigured: boolean
}

const inputCls = 'w-full rounded-xl border border-border bg-panel-2 px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50'

export default function SettingsPage() {
  const { user } = useAuth()

  const [creds, setCreds] = useState<Credentials | null>(null)
  const [agentKey, setAgentKey] = useState('')
  const [hlUser, setHlUser] = useState('')
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('mainnet')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
  const [showKey, setShowKey] = useState(false)

  // Load existing credentials on mount
  useEffect(() => {
    apiFetch('/settings/credentials')
      .then(r => r.ok ? r.json() : null)
      .then((d: Credentials | null) => {
        if (!d) return
        setCreds(d)
        setHlUser(d.hlUser ?? '')
        setNetwork(d.hlNetwork ?? 'mainnet')
      })
      .catch(() => {})
  }, [])

  const save = async () => {
    setBusy(true); setNotice(null)
    try {
      const res = await apiFetch('/settings/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentKey, hlUser, network }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        networkChanged?: boolean
        stoppedForMainnet?: { signalBots: number; gridBots: number } | null
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setCreds(prev => prev
        ? { ...prev, hlUser, hlNetwork: network, hlConfigured: Boolean(agentKey || prev.hlConfigured) }
        : { hlUser, hlNetwork: network, hlConfigured: Boolean(agentKey) }
      )
      setAgentKey('')       // clear after save — don't persist key in state
      let msg = 'Credentials saved'
      if (data.stoppedForMainnet) {
        const { signalBots, gridBots } = data.stoppedForMainnet
        const total = signalBots + gridBots
        if (total > 0) {
          msg = `Saved. Stopped ${total} bot${total === 1 ? '' : 's'} (${signalBots} signal + ${gridBots} grid) — switched to mainnet, start them manually after reviewing.`
        } else {
          msg = 'Saved. Switched to mainnet — no bots were running.'
        }
      } else if (data.networkChanged) {
        msg = 'Saved. Switched to testnet — bots kept running.'
      }
      setNotice({ text: msg, ok: true })
    } catch (e) {
      setNotice({ text: `Save failed: ${(e as Error).message}`, ok: false })
    } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-6 py-8">

      <div>
        <h1 className="text-lg font-semibold text-text">Settings</h1>
        <p className="text-sm text-dim">
          Logged in as <span className="text-text">{typeof user === 'object' && user && 'email' in user ? (user as { email: string }).email : '—'}</span>
        </p>
      </div>

      {/* ── Hyperliquid credentials ── */}
      <div className="card p-5">
        <div className="mb-4 flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <div>
            <h2 className="text-sm font-semibold text-text">Hyperliquid API Credentials</h2>
            <p className="mt-0.5 text-xs text-dim">
              Your agent key is encrypted at rest (AES-256-GCM). It can place and cancel orders
              but cannot withdraw funds.
            </p>
          </div>
        </div>

        {/* Status badge */}
        {creds && (
          <div className={`mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
            creds.hlConfigured
              ? 'border-gain/30 bg-gain/5 text-gain'
              : 'border-warn/30 bg-warn/5 text-warn'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${creds.hlConfigured ? 'bg-gain' : 'bg-warn'}`} />
            {creds.hlConfigured
              ? `Agent key configured · ${creds.hlNetwork}`
              : 'No agent key — bots cannot trade until you save credentials'}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">
              HL Wallet Address
            </span>
            <input
              type="text"
              placeholder="0x…"
              value={hlUser}
              onChange={e => setHlUser(e.target.value)}
              className={inputCls}
            />
            <span className="text-[10px] text-dim">
              Your Hyperliquid account address (not the agent key address).
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">
              Agent Private Key
            </span>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                placeholder={creds?.hlConfigured ? '(key already saved — paste to replace)' : '0x…'}
                value={agentKey}
                onChange={e => setAgentKey(e.target.value)}
                className={`${inputCls} pr-16`}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-dim hover:text-text transition-colors"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <span className="text-[10px] text-dim">
              Generate an API agent in the Hyperliquid UI → Settings → API. Leave blank to keep
              the existing key.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-dim">
              Network
            </span>
            <div className="flex gap-2">
              {(['mainnet', 'testnet'] as const).map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNetwork(n)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors capitalize ${
                    network === n
                      ? n === 'mainnet'
                        ? 'border-gain/40 bg-gain/10 text-gain'
                        : 'border-warn/40 bg-warn/10 text-warn'
                      : 'border-border text-dim hover:text-text hover:border-border/80'
                  }`}
                >
                  {n}
                  {n === 'testnet' && <span className="ml-1 opacity-60">⚠</span>}
                </button>
              ))}
            </div>
          </label>

          {notice && (
            <p className={`text-xs ${notice.ok ? 'text-gain' : 'text-loss'}`}>{notice.text}</p>
          )}

          <button
            type="button"
            disabled={busy || (!agentKey && !hlUser && !(creds?.hlNetwork !== network))}
            onClick={save}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Save className="h-4 w-4" />
            {busy ? 'Saving…' : 'Save Credentials'}
          </button>
        </div>
      </div>

      {/* ── Risk controls (kill switch) ── */}
      <RiskControlsCard />

    </main>
  )
}
