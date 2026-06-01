// The Jam Room — every bot is a headbanging pixel cat in a metal band. Running
// bots play (mood = profit/loss/idle); stopped bots sleep. Uses your art from
// public/jam/ if present (room.png + cat-rock/sad/sleep), else the built-in
// code-drawn room/cats. The riff is synthesized in-browser (no audio files).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, Volume2, Music4 } from 'lucide-react'
import { apiFetch } from '@/contexts/AuthContext'
import PixelCat, { type CatMood, type Instrument } from '@/components/jam/PixelCat'
import IsoRoom from '@/components/jam/IsoRoom'
import { iso, CAT_SLOTS, VIEW_W, VIEW_H } from '@/lib/jam/iso'
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
  coin: string
  mood: CatMood
  instrument: Instrument
  color: string
}

// One-shot reaction fired when a coin's P&L flips or a position closes.
interface Fx { kind: 'win' | 'loss'; at: number }
const FX_MS = 1500

const CAT_COLORS = ['#e8843c', '#9aa7b2', '#6ab04c', '#e056fd', '#f6c945', '#4aa3df', '#d35400', '#bdc3c7']
const INSTRUMENTS: Instrument[] = ['guitar', 'drums', 'bass', 'mic']
const PNL_EPS = 0.5

// Floor slots tuned to the room.png art (percent of the image). Back row sits
// higher + smaller; front row lower + bigger. Used only when room.png is present.
const IMG_SLOTS = [
  { l: 40, t: 64, w: 8.5 }, { l: 50, t: 62, w: 8.5 }, { l: 60, t: 64, w: 8.5 },
  { l: 33, t: 84, w: 10.5 }, { l: 50, t: 86, w: 10.5 }, { l: 67, t: 84, w: 10.5 },
]

function toCoin(s: string): string {
  const noDex = s.includes(':') ? s.split(':').pop()! : s
  return noDex.replace(/USDT$/i, '').toUpperCase()
}

function rigClass(mood: CatMood): string {
  return mood === 'rock' ? 'cat-rock' : mood === 'idle' ? 'cat-idle' : mood === 'sad' ? 'cat-sad' : 'cat-sleep'
}

// Speech-bubble text. During a reaction it shows the event; otherwise the mood.
function bubbleText(mood: CatMood, pnl: number, fx: Fx | null): string {
  if (fx) return fx.kind === 'win' ? 'WIN! 🎸' : 'ouch… 😿'
  if (mood === 'sleep') return 'zzz'
  if (mood === 'rock') return `+$${pnl.toFixed(2)} 🤘`
  if (mood === 'sad') return `−$${Math.abs(pnl).toFixed(2)} 😿`
  return 'watching 👀'
}

function JamBubble({ text }: { text: string }) {
  return (
    <div key={text} className="jam-bubble relative mb-1 whitespace-nowrap rounded-md border border-border bg-panel px-1.5 py-0.5 font-mono text-[9px] font-bold text-text shadow-lg">
      {text}
      <span className="absolute left-1/2 top-full -translate-x-1/2 border-[4px] border-transparent border-t-panel" />
    </div>
  )
}

const CONFETTI_COLORS = ['#f6c945', '#e84bd0', '#4aa3df', '#6ab04c', '#ef5350']
function Confetti() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-0 z-30 h-0 w-0">
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} className="confetti-bit absolute block h-1.5 w-1.5 rounded-[1px]"
          style={{ left: `${Math.random() * 44 - 22}px`, background: CONFETTI_COLORS[i % CONFETTI_COLORS.length], animationDelay: `${Math.random() * 0.3}s` }} />
      ))}
    </div>
  )
}

// Probe a list of candidate URLs, resolve the first that actually loads.
function firstThatLoads(cands: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let i = 0
    const tryNext = () => {
      if (i >= cands.length) return resolve(null)
      const url = cands[i++]
      const img = new Image()
      img.onload = () => resolve(url)
      img.onerror = tryNext
      img.src = url
    }
    tryNext()
  })
}

interface Assets { room: string | null; rock: string | null; sad: string | null; sleep: string | null }

export default function JamRoomPage() {
  const [signalBots, setSignalBots] = useState<SignalSummary[]>([])
  const [gridBots, setGridBots] = useState<GridSummary[]>([])
  const [pnlByCoin, setPnlByCoin] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [assets, setAssets] = useState<Assets>({ room: null, rock: null, sad: null, sleep: null })

  const jamRef = useRef<MetalJam | null>(null)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.5)

  // Live trade reactions: remember each coin's last P&L sign so we can fire a
  // win/loss pop when it flips or the position closes. Keyed by coin.
  const [fx, setFx] = useState<Record<string, Fx>>({})
  const prevSignRef = useRef<Record<string, number>>({})
  const initedRef = useRef(false)

  // Probe for user-supplied art once on mount.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      firstThatLoads(['/jam/room.png', '/jam/room.gif', '/jam/room.webp']),
      firstThatLoads(['/jam/cat-rock.png', '/jam/cat-rock.gif', '/jam/cat-rock.webp']),
      firstThatLoads(['/jam/cat-sad.png', '/jam/cat-sad.gif', '/jam/cat-sad.webp']),
      firstThatLoads(['/jam/cat-sleep.png', '/jam/cat-sleep.gif', '/jam/cat-sleep.webp']),
    ]).then(([room, rock, sad, sleep]) => {
      if (!cancelled) setAssets({ room, rock, sad, sleep })
    })
    return () => { cancelled = true }
  }, [])

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

        // Detect win/loss transitions vs the previous poll. A vanished position
        // means a close — we react by its LAST-seen sign (realized pnl is gone
        // from /api/account, so the remembered unrealized sign is the signal).
        const sign = (v: number) => (v > PNL_EPS ? 1 : v < -PNL_EPS ? -1 : 0)
        const curSigns: Record<string, number> = {}
        for (const c in map) curSigns[c] = sign(map[c])
        if (initedRef.current) {
          const prev = prevSignRef.current
          const events: Record<string, Fx> = {}
          const now = Date.now()
          for (const c of new Set([...Object.keys(prev), ...Object.keys(curSigns)])) {
            const ps = prev[c] ?? 0
            const cs = c in curSigns ? curSigns[c] : 'gone' as const
            if (cs === 'gone') {
              if (ps === 1) events[c] = { kind: 'win', at: now }
              else if (ps === -1) events[c] = { kind: 'loss', at: now }
            } else if (cs === 1 && ps !== 1) events[c] = { kind: 'win', at: now }
            else if (cs === -1 && ps !== -1) events[c] = { kind: 'loss', at: now }
          }
          if (Object.keys(events).length) {
            setFx((f) => ({ ...f, ...events }))
            if (Object.values(events).some((e) => e.kind === 'win')) jamRef.current?.crash()
          }
        }
        prevSignRef.current = curSigns
        initedRef.current = true

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

  useEffect(() => () => { jamRef.current?.dispose() }, [])

  // Clear reactions once they've played, so cats return to their mood loop.
  useEffect(() => {
    if (Object.keys(fx).length === 0) return
    const t = setTimeout(() => {
      setFx((cur) => {
        const now = Date.now()
        const next: Record<string, Fx> = {}
        for (const k in cur) if (now - cur[k].at < FX_MS) next[k] = cur[k]
        return next
      })
    }, FX_MS + 100)
    return () => clearTimeout(t)
  }, [fx])

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
      all.push({ id: `s-${b.id}`, label: b.name || coin, sub: `${coin} · signal`, coin,
        mood: moodFor(b.running, coin), instrument: INSTRUMENTS[i % INSTRUMENTS.length], color: CAT_COLORS[i % CAT_COLORS.length] })
      i++
    }
    for (const b of gridBots) {
      const coin = toCoin(b.asset)
      all.push({ id: `g-${b.id}`, label: b.name || coin, sub: `${coin} · grid`, coin,
        mood: moodFor(b.running, coin), instrument: INSTRUMENTS[i % INSTRUMENTS.length], color: CAT_COLORS[i % CAT_COLORS.length] })
      i++
    }
    return all
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalBots, gridBots, pnlByCoin])

  const beatMs = jamRef.current?.beatMs ?? 60000 / 144
  const anyRocking = cats.some((c) => c.mood === 'rock')
  const useImgRoom = assets.room !== null

  // The mood → image URL (idle reuses the guitar/rock cat). null = draw the cat.
  const moodImg = (mood: CatMood): string | null => {
    if (mood === 'sad') return assets.sad
    if (mood === 'sleep') return assets.sleep
    return assets.rock // rock + idle
  }

  const toggleMusic = () => {
    if (!jamRef.current) jamRef.current = new MetalJam()
    const jam = jamRef.current
    if (playing) { jam.stop(); setPlaying(false) }
    else { jam.setVolume(volume); jam.start(); setPlaying(true) }
  }
  const onVolume = (v: number) => { setVolume(v); jamRef.current?.setVolume(v) }

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
        <div className="flex items-center gap-3 rounded-xl border border-border bg-panel-2 px-3 py-2">
          <button type="button" onClick={toggleMusic}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              playing ? 'bg-loss/15 text-loss hover:bg-loss/20' : 'bg-brand text-white hover:opacity-90'}`}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? 'Stop riff' : 'Play riff'}
          </button>
          <div className="flex items-center gap-1.5">
            <Volume2 className="h-4 w-4 text-dim" />
            <input type="range" min={0} max={1} step={0.05} value={volume}
              onChange={(e) => onVolume(Number(e.target.value))} className="w-20 accent-brand" aria-label="Volume" />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-loss/30 bg-loss/5 p-2 text-xs text-loss">
          Couldn’t load bots: {error}
        </div>
      )}

      {/* ── The room ─────────────────────────────────────────────────────── */}
      <div className={`relative mx-auto w-full overflow-hidden rounded-2xl border border-border bg-[#0e0a16] ${useImgRoom ? 'max-w-4xl' : 'max-w-3xl'}`}
           style={useImgRoom ? undefined : { aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
        {useImgRoom
          ? <img src={assets.room!} alt="jam room" className="block w-full" style={{ imageRendering: 'pixelated' }} />
          : <div className="absolute inset-0"><IsoRoom lit={anyRocking} /></div>}

        {/* Neon LIVE sign */}
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
          <span className={`rounded-md border px-3 py-1 font-mono text-[11px] font-bold tracking-widest ${
              anyRocking ? 'border-brand/60 text-brand' : 'border-border text-dim'}`}
            style={anyRocking ? { textShadow: '0 0 8px rgba(120,220,160,0.8)', boxShadow: '0 0 12px rgba(120,220,160,0.3)' } : undefined}>
            🎸 GARLIC TRADING · {anyRocking ? 'LIVE' : 'SOUNDCHECK'} 🥁
          </span>
        </div>

        {/* Empty state */}
        {cats.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-dim">
            No bots yet — create a Signal or Grid bot and the band shows up here. 😼
          </div>
        )}

        {/* ── Band (image-room layout) ── */}
        {useImgRoom && cats.slice(0, IMG_SLOTS.length).map((c, i) => {
          const s = IMG_SLOTS[i]
          const url = moodImg(c.mood)
          const pnl = pnlByCoin[c.coin] ?? 0
          const f = fx[c.coin]
          const fxOn = !!f && Date.now() - f.at < FX_MS
          return (
            <div key={c.id} className="absolute flex flex-col items-center"
              style={{ left: `${s.l}%`, top: `${s.t}%`, width: `${s.w}%`, transform: 'translate(-50%,-100%)', zIndex: Math.round(s.t) }}>
              <JamBubble text={bubbleText(c.mood, pnl, fxOn ? f : null)} />
              <div className="relative w-full">
                {fxOn && f.kind === 'win' && <Confetti />}
                <div className={`w-full ${fxOn ? (f.kind === 'win' ? 'cat-fx-win' : 'cat-fx-loss') : `cat-rig ${rigClass(c.mood)}`}`}>
                  {url
                    ? <img src={url} alt={c.label} className="block w-full drop-shadow-[0_2px_0_rgba(0,0,0,0.4)]" style={{ imageRendering: 'pixelated' }} />
                    : <PixelCat mood={c.mood} instrument={c.instrument} color={c.color} beatMs={beatMs} label="" />}
                </div>
              </div>
              <div className="mt-0.5 max-w-[120px] truncate text-center font-mono text-[10px] font-bold text-text drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                {c.label}
              </div>
            </div>
          )
        })}

        {/* ── Band (drawn-room layout) ── */}
        {!useImgRoom && cats.slice(0, CAT_SLOTS.length).map((c, i) => {
          const slot = CAT_SLOTS[i]
          const p = iso(slot.x, slot.y, 0)
          const pnl = pnlByCoin[c.coin] ?? 0
          const f = fx[c.coin]
          const fxOn = !!f && Date.now() - f.at < FX_MS
          return (
            <div key={c.id} className="absolute flex flex-col items-center"
              style={{ left: `${(p.x / VIEW_W) * 100}%`, top: `${(p.y / VIEW_H) * 100}%`,
                transform: 'translate(-50%, -92%)', zIndex: 10 + Math.round((slot.x + slot.y) * 10) }}>
              <JamBubble text={bubbleText(c.mood, pnl, fxOn ? f : null)} />
              <div className="relative" style={{ transform: 'scale(0.82)' }}>
                {fxOn && f.kind === 'win' && <Confetti />}
                <PixelCat mood={c.mood} instrument={c.instrument} color={c.color} beatMs={beatMs} label={c.label} sub={c.sub} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-dim">
        <span>🤘 <b className="text-text">Headbang</b> = position in profit</span>
        <span>😿 <b className="text-text">Sad</b> = position in loss</span>
        <span>🎵 <b className="text-text">Tuning</b> = running, no position</span>
        <span>💤 <b className="text-text">Asleep</b> = bot stopped</span>
        {!useImgRoom && (
          <span className="text-dim/70">· drop art in <code className="text-text">public/jam/</code> for the pro look</span>
        )}
      </div>
    </div>
  )
}
