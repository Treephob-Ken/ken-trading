// Command Center — a pixel/neon ops dashboard skin (inspired by the "Claude
// Code" command-center poster) wired to REAL bot data. No art assets: pure
// CSS neon panels + a CRT scanline overlay. Everything updates live.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Cpu } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'

interface SignalSummary { id: string; name: string; running: boolean; symbol: string; strategyId?: string }
interface GridSummary { id: string; name: string; running: boolean; asset: string }
interface PositionInfo { asset: string; side: 'long' | 'short'; size: number; unrealizedPnl: number }
interface AccountState { accountValue?: number; allPositions?: PositionInfo[] }

interface Agent { id: string; name: string; role: string; coin: string; running: boolean }

function toCoin(s: string): string {
  const noDex = s.includes(':') ? s.split(':').pop()! : s
  return noDex.replace(/USDT$/i, '').toUpperCase()
}
const fmtUsd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function CommandCenterPage() {
  const [signalBots, setSignalBots] = useState<SignalSummary[]>([])
  const [gridBots, setGridBots] = useState<GridSummary[]>([])
  const [account, setAccount] = useState<AccountState>({})
  const [error, setError] = useState<string | null>(null)
  const [clock, setClock] = useState(() => new Date())
  const bootRef = useRef(Date.now())

  useEffect(() => { const id = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(id) }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [s, g, a] = await Promise.all([apiFetch('/api/signal/bots'), apiFetch('/api/bots'), apiFetch('/api/account')])
        const sig: SignalSummary[] = s.ok ? await s.json() : []
        const grid: GridSummary[] = g.ok ? await g.json() : []
        const acc: AccountState = a.ok ? await a.json() : {}
        if (cancelled) return
        setSignalBots(sig); setGridBots(grid); setAccount(acc); setError(null)
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) }
    }
    load()
    const id = setInterval(load, 4000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const positions = account.allPositions ?? []
  const positionCoins = useMemo(() => new Set(positions.map((p) => toCoin(p.asset))), [positions])

  const agents = useMemo<Agent[]>(() => {
    const out: Agent[] = []
    for (const b of signalBots) out.push({ id: `s-${b.id}`, name: b.name || toCoin(b.symbol), role: (b.strategyId ?? 'signal').toUpperCase(), coin: toCoin(b.symbol), running: b.running })
    for (const b of gridBots) out.push({ id: `g-${b.id}`, name: b.name || toCoin(b.asset), role: 'GRID', coin: toCoin(b.asset), running: b.running })
    return out
  }, [signalBots, gridBots])

  const runningCount = agents.filter((a) => a.running).length
  const openPnl = positions.reduce((s, p) => s + (Number(p.unrealizedPnl) || 0), 0)
  const accountValue = account.accountValue ?? 0
  const autoOn = runningCount > 0
  const uptimeH = Math.floor((Date.now() - bootRef.current) / 3_600_000)

  const statusOf = (a: Agent): { label: string; cls: string; dot: string } => {
    if (!a.running) return { label: 'OFFLINE', cls: 'text-zinc-500', dot: 'bg-zinc-600' }
    if (positionCoins.has(a.coin)) return { label: 'TRADING', cls: 'text-emerald-400', dot: 'bg-emerald-400' }
    return { label: 'STANDBY', cls: 'text-cyan-300', dot: 'bg-cyan-400' }
  }

  return (
    <div className="relative min-h-full bg-[#070b12] p-3 sm:p-5 font-mono text-cyan-100">
      {/* CRT scanlines */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-[0.18]"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0) 0 2px, rgba(0,0,0,0.5) 2px 3px)' }} />

      <div className="relative z-10 mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between rounded-lg border border-cyan-500/40 bg-[#0a1019]/80 px-4 py-2.5"
          style={{ boxShadow: '0 0 18px rgba(34,211,238,0.12)' }}>
          <div className="flex items-center gap-3">
            <Cpu className="h-5 w-5 text-cyan-300" />
            <span className="text-sm font-bold tracking-[0.2em] text-cyan-200">GARLIC TRADING · COMMAND CENTER</span>
            <span className="rounded border border-cyan-500/40 px-1.5 py-0.5 text-[9px] text-cyan-400">v1.0</span>
          </div>
          <div className="flex items-center gap-2 text-cyan-300">
            <span className="text-[10px] tracking-widest text-cyan-500">TIME</span>
            <span className="text-lg font-bold tabular-nums">{clock.toLocaleTimeString('en-GB')}</span>
          </div>
        </div>

        {error && <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">LINK ERROR: {error}</div>}

        <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
          {/* ── TEAM STATUS ── */}
          <Panel title="Team Status">
            {agents.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-zinc-500">NO AGENTS DEPLOYED</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {agents.map((a) => {
                  const st = statusOf(a)
                  return (
                    <div key={a.id} className="flex items-center gap-2 rounded border border-cyan-500/20 bg-black/30 p-1.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-cyan-500/40 bg-cyan-500/10 text-[9px] font-bold text-cyan-300">
                        {a.coin.slice(0, 4)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-bold text-cyan-100">{a.name}</div>
                        <div className="truncate text-[9px] text-cyan-500">{a.role}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot} ${a.running ? 'animate-pulse' : ''}`} />
                        <span className={`text-[9px] font-bold ${st.cls}`}>{st.label}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-cyan-500/20 pt-2 text-[10px]">
              <KV label="AGENTS" value={`${runningCount}/${agents.length}`} />
              <KV label="POSITIONS" value={String(positions.length)} />
              <KV label="AUTO MODE" value={autoOn ? 'ON' : 'OFF'} accent={autoOn ? 'emerald' : 'zinc'} />
              <KV label="SYSTEM" value="OK" accent="emerald" />
            </div>
          </Panel>

          {/* ── COMMAND CENTER (positions) ── */}
          <Panel title="Command Center">
            <div className="mb-3 flex flex-wrap items-end gap-4">
              <div>
                <div className="text-[9px] tracking-widest text-cyan-500">ACCOUNT VALUE</div>
                <div className="text-2xl font-bold text-cyan-100 tabular-nums">{fmtUsd(accountValue)}</div>
              </div>
              <div>
                <div className="text-[9px] tracking-widest text-cyan-500">OPEN P&L</div>
                <div className={`text-2xl font-bold tabular-nums ${openPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {openPnl >= 0 ? '+' : ''}{fmtUsd(openPnl)}
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[9px] tracking-widest text-cyan-500">UPTIME</div>
                <div className="text-lg font-bold text-cyan-200 tabular-nums">{uptimeH}h</div>
              </div>
            </div>

            <div className="overflow-hidden rounded border border-cyan-500/20">
              <table className="w-full text-[11px]">
                <thead className="bg-cyan-500/10 text-[9px] uppercase tracking-widest text-cyan-400">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Asset</th>
                    <th className="px-2 py-1.5 text-left">Side</th>
                    <th className="px-2 py-1.5 text-right">Size</th>
                    <th className="px-2 py-1.5 text-right">Unreal. P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 ? (
                    <tr><td colSpan={4} className="px-2 py-6 text-center text-[11px] text-zinc-500">NO OPEN POSITIONS — STANDBY</td></tr>
                  ) : positions.map((p, i) => (
                    <tr key={`${p.asset}-${i}`} className="border-t border-cyan-500/10">
                      <td className="px-2 py-1.5 font-bold text-cyan-100">{toCoin(p.asset)}</td>
                      <td className={`px-2 py-1.5 font-bold ${p.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{p.side.toUpperCase()}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-cyan-200">{p.size}</td>
                      <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${(p.unrealizedPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(p.unrealizedPnl ?? 0) >= 0 ? '+' : ''}{fmtUsd(p.unrealizedPnl ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* ── Bottom stat strip ── */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="AGENTS" value={`${runningCount}/${agents.length}`} />
          <StatTile label="POSITIONS" value={String(positions.length)} />
          <StatTile label="OPEN P&L" value={`${openPnl >= 0 ? '+' : ''}${fmtUsd(openPnl)}`} tone={openPnl >= 0 ? 'good' : 'bad'} />
          <StatTile label="ACCOUNT" value={fmtUsd(accountValue)} />
          <StatTile label="AUTO MODE" value={autoOn ? 'ON' : 'OFF'} tone={autoOn ? 'good' : 'dim'} />
          <StatTile label="SYSTEM" value="● ● ● ● ●" tone="good" />
        </div>
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative rounded-lg border border-cyan-500/30 bg-[#0a1019]/70" style={{ boxShadow: '0 0 14px rgba(34,211,238,0.08)' }}>
      <div className="flex items-center gap-2 border-b border-cyan-500/20 px-3 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">{title}</span>
        <span className="ml-auto flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-cyan-400/50" />)}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function KV({ label, value, accent }: { label: string; value: string; accent?: 'emerald' | 'zinc' }) {
  const cls = accent === 'emerald' ? 'text-emerald-400' : accent === 'zinc' ? 'text-zinc-500' : 'text-cyan-200'
  return (
    <div className="flex items-center justify-between rounded border border-cyan-500/15 bg-black/20 px-2 py-1">
      <span className="text-cyan-600">{label}</span>
      <span className={`font-bold ${cls}`}>{value}</span>
    </div>
  )
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'dim' }) {
  const v = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : tone === 'dim' ? 'text-zinc-500' : 'text-cyan-100'
  return (
    <div className="rounded-lg border border-cyan-500/30 bg-[#0a1019]/70 px-3 py-2" style={{ boxShadow: '0 0 12px rgba(34,211,238,0.06)' }}>
      <div className="text-[9px] tracking-widest text-cyan-600">{label}</div>
      <div className={`mt-0.5 text-base font-bold tabular-nums ${v}`}>{value}</div>
    </div>
  )
}
