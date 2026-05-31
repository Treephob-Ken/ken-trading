// The Jam Room — every bot is a headbanging pixel cat in a metal band. Running
// bots play (mood = profit/loss/idle); stopped bots sleep on stage. The riff is
// synthesized in-browser (src/lib/jam/metalRiff.ts) — no audio files. Pure fun.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, Volume2, Music4 } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'
import PixelCat, { type CatMood, type Instrument } from '@/components/jam/PixelCat'
import { MetalJam } from '@/lib/jam/metalRiff'

interface SignalSummary {
  id: string; name: string; running: boolean; symbol: string; strategyId?: string
}
interface GridSummary {
  id: string; name: string; running: boolean; asset: string
}
interface PositionInfo { asset: string; unrealizedPnl: number }
interface AccountState { allPositions?: PositionInfo[] }

interface BandCat {
  id: string
  label: string
  sub: string
  mood: CatMood
  instrument: Instrument
  color: string
}

const CAT_COLORS = ['#e8843c', '#9aa7b2', '#6ab04c', '#e056fd', '#f6c945', '#4aa3df', '#d35400', '#bdc3c7']
const INSTRUMENTS: Instrument[] = ['guitar', 'drums', 'bass', 'mic']
// PnL band (USD) before a running cat switches from "idle/tuning" to rock/sad.
const PNL_EPS = 0.5

// "ETHUSDT" / "xyz:GOLD" / "ETH" → "ETH" (upper, no dex prefix, no USDT tail).
function toCoin(s: string): string {
  const noDex = s.includes(':') ? s.split(':').pop()! : s
  return noDex.replace(/USDT$/i, '').toUpperCase()
}

export default function JamRoomPage() {
  const [signalBots, setSignalBots] = useState<SignalSummary[]>([])
  const [gridBots, setGridBots] = useState<GridSummary[]>([])
  const [pnlByCoin, setPnlByCoin] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  const jamRef = useRef<MetalJam | null>(null)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.5)

  // Live poll — bots + open positions, every 5s.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [sigRes, gridRes, accRes] = await Promise.all([
          apiFetch('/api/signal/bots'),
          apiFetch('/api/bots'),
          apiFetch('/api/account'),
        ])
        const sig: SignalSummary[] = sigRes.ok ? await sigRes.json() : []
        const grid: GridSummary[] = gridRes.ok ? await gridRes.json() : []
        const acc: AccountState = accRes.ok ? await accRes.json() : {}
        if (cancelled) return
        const map: Record<string, number> = {}
        for (const p of acc.allPositions ?? []) {
          const c = toCoin(p.asset)
          map[c] = (map[c] ?? 0) + (Number(p.unrealizedPnl) || 0)
        }
        setSignalBots(sig)
        setGridBots(grid)
        setPnlByCoin(map)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const id = setInterval(load, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Tear down audio on unmount.
  useEffect(() => () => { jamRef.current?.dispose() }, [])

  const moodFor = (running: boolean, coin: string): CatMood => {
    if (!running) return 'sleep'
    const pnl = pnlByCoin[coin] ?? 0
    if (pnl > PNL_EPS) return 'rock'
    if (pnl < -PNL_EPS) return 'sad'
    return 'idle'
  }

  const cats = useMemo<BandCat[]>(() => {
    const all: BandCat[] = []
    let i = 0
    for (const b of signalBots) {
      const coin = toCoin(b.symbol)
      all.push({
        id: `s-${b.id}`,
        label: b.name || coin,
        sub: `${coin} · signal`,
        mood: moodFor(b.running, coin),
        instrument: INSTRUMENTS[i % INSTRUMENTS.length],
        color: CAT_COLORS[i % CAT_COLORS.length],
      })
      i++
    }
    for (const b of gridBots) {
      const coin = toCoin(b.asset)
      all.push({
        id: `g-${b.id}`,
        label: b.name || coin,
        sub: `${coin} · grid`,
        mood: moodFor(b.running, coin),
        instrument: INSTRUMENTS[i % INSTRUMENTS.length],
        color: CAT_COLORS[i % CAT_COLORS.length],
      })
      i++
    }
    return all
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalBots, gridBots, pnlByCoin])

  const beatMs = jamRef.current?.beatMs ?? 60000 / 144
  const anyRocking = cats.some((c) => c.mood === 'rock')

  const toggleMusic = () => {
    if (!jamRef.current) jamRef.current = new MetalJam()
    const jam = jamRef.current
    if (playing) { jam.stop(); setPlaying(false) }
    else { jam.setVolume(volume); jam.start(); setPlaying(true) }
  }

  const onVolume = (v: number) => {
    setVolume(v)
    jamRef.current?.setVolume(v)
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-text">
            <Music4 className="h-5 w-5 text-brand" /> The Jam Room 🤘
          </h1>
          <p className="text-xs text-dim">
            Every bot is a cat in the band. Winning = headbang, losing = sad, stopped = asleep.
          </p>
        </div>

        {/* Music controls */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-panel-2 px-3 py-2">
          <button
            type="button"
            onClick={toggleMusic}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              playing ? 'bg-loss/15 text-loss hover:bg-loss/20' : 'bg-brand text-white hover:opacity-90'
            }`}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? 'Stop riff' : 'Play riff'}
          </button>
          <div className="flex items-center gap-1.5">
            <Volume2 className="h-4 w-4 text-dim" />
            <input
              type="range" min={0} max={1} step={0.05} value={volume}
              onChange={(e) => onVolume(Number(e.target.value))}
              className="w-20 accent-brand"
              aria-label="Volume"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-loss/30 bg-loss/5 p-2 text-xs text-loss">
          Couldn’t load bots: {error}
        </div>
      )}

      {/* ── The stage ───────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border"
           style={{ background: 'linear-gradient(180deg,#15101c 0%,#1c1426 55%,#241a30 100%)' }}>
        {/* Spotlights */}
        <div className="stage-light pointer-events-none absolute -top-10 left-10 h-40 w-40 rounded-full"
             style={{ background: 'radial-gradient(circle,rgba(155,120,255,0.35),transparent 70%)' }} />
        <div className="stage-light pointer-events-none absolute -top-10 right-10 h-40 w-40 rounded-full"
             style={{ background: 'radial-gradient(circle,rgba(255,90,120,0.32),transparent 70%)', animationDelay: '1s' }} />

        {/* Neon sign */}
        <div className="relative z-10 flex justify-center pt-5">
          <span
            className={`rounded-md border px-3 py-1 font-mono text-xs font-bold tracking-widest ${
              anyRocking ? 'border-brand/60 text-brand' : 'border-border text-dim'
            }`}
            style={anyRocking ? { textShadow: '0 0 8px rgba(120,220,160,0.8)', boxShadow: '0 0 12px rgba(120,220,160,0.3)' } : undefined}
          >
            🎸 GARLIC TRADING · {anyRocking ? 'LIVE' : 'SOUNDCHECK'} 🥁
          </span>
        </div>

        {/* Band */}
        <div className="relative z-10 flex min-h-[220px] flex-wrap items-end justify-center gap-x-2 gap-y-6 px-4 pt-6 pb-2">
          {cats.length === 0 ? (
            <div className="self-center py-12 text-center text-sm text-dim">
              No bots yet — create a Signal or Grid bot and the band shows up here. 😼
            </div>
          ) : (
            cats.map((c) => (
              <PixelCat
                key={c.id}
                mood={c.mood}
                instrument={c.instrument}
                color={c.color}
                beatMs={beatMs}
                label={c.label}
                sub={c.sub}
              />
            ))
          )}
        </div>

        {/* Stage floor */}
        <div className="relative z-0 h-6 w-full"
             style={{ background: 'repeating-linear-gradient(90deg,#0d0a12 0 18px,#120d18 18px 36px)' }} />
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-dim">
        <span>🤘 <b className="text-text">Headbang</b> = position in profit</span>
        <span>😿 <b className="text-text">Sad</b> = position in loss</span>
        <span>🎵 <b className="text-text">Tuning</b> = running, no position</span>
        <span>💤 <b className="text-text">Asleep</b> = bot stopped</span>
      </div>
    </div>
  )
}
