// A hand-drawn pixel cat band member. No external sprites — it's an inline SVG
// of blocky shapes (crispEdges → pixel look) so it ships as pure code and has
// zero licensing concerns. Mood drives the CSS animation + face; instrument is
// drawn in front. Swap in the CC0 itch.io sprite pack later by replacing the
// <svg> body with a sprite-sheet <div> — the props stay the same.

export type CatMood = 'rock' | 'idle' | 'sad' | 'sleep'
export type Instrument = 'guitar' | 'bass' | 'drums' | 'mic'

interface Props {
  mood: CatMood
  instrument: Instrument
  /** Body colour (any CSS colour). Stripes are drawn as translucent black. */
  color: string
  /** Beat length in ms — sets the headbang tempo via the --beat CSS var. */
  beatMs: number
  label: string
  sub?: string
}

const EAR_PINK = '#f4a6b8'
const STRIPE = 'rgba(0,0,0,0.18)'

export default function PixelCat({ mood, instrument, color, beatMs, label, sub }: Props) {
  const rigClass =
    mood === 'rock' ? 'cat-rock' : mood === 'idle' ? 'cat-idle' : mood === 'sad' ? 'cat-sad' : 'cat-sleep'

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <div
        className="relative"
        style={{ ['--beat' as string]: `${Math.round(beatMs)}ms` }}
      >
        {/* Floating sleep Z's */}
        {mood === 'sleep' && (
          <div className="pointer-events-none absolute -right-1 -top-1 text-dim">
            <span className="zzz absolute text-[10px] font-bold" style={{ animationDelay: '0s' }}>z</span>
            <span className="zzz absolute left-2 text-[13px] font-bold" style={{ animationDelay: '0.8s' }}>z</span>
          </div>
        )}
        {/* Rocking music notes */}
        {mood === 'rock' && (
          <div className="pointer-events-none absolute -right-2 top-0 text-brand">
            <span className="jam-note absolute text-[11px]" style={{ animationDelay: '0s' }}>♪</span>
            <span className="jam-note absolute left-2 text-[13px]" style={{ animationDelay: '0.7s' }}>♫</span>
          </div>
        )}

        <svg
          width="92"
          height="92"
          viewBox="0 0 64 64"
          shapeRendering="crispEdges"
          className="drop-shadow-[0_3px_0_rgba(0,0,0,0.35)]"
        >
          <g className={`cat-rig ${rigClass}`}>
            {/* Tail */}
            <rect x="10" y="40" width="6" height="4" fill={color} />
            <rect x="8" y="34" width="4" height="8" fill={color} />

            {/* Body */}
            <rect x="18" y="34" width="28" height="22" rx="4" fill={color} />
            <rect x="22" y="38" width="18" height="3" fill={STRIPE} />
            <rect x="22" y="46" width="18" height="3" fill={STRIPE} />
            {/* Paws */}
            <rect x="20" y="54" width="7" height="4" rx="1" fill={color} />
            <rect x="37" y="54" width="7" height="4" rx="1" fill={color} />

            {/* Ears */}
            <polygon points="20,18 30,18 22,6" fill={color} />
            <polygon points="44,18 34,18 42,6" fill={color} />
            <polygon points="23,16 28,16 24,9" fill={EAR_PINK} />
            <polygon points="41,16 36,16 40,9" fill={EAR_PINK} />

            {/* Head */}
            <rect x="20" y="14" width="24" height="22" rx="6" fill={color} />
            <rect x="24" y="15" width="4" height="6" fill={STRIPE} />
            <rect x="36" y="15" width="4" height="6" fill={STRIPE} />

            {/* Face — varies by mood */}
            <Face mood={mood} />

            {/* Nose */}
            <polygon points="30,26 34,26 32,29" fill={EAR_PINK} />
          </g>

          {/* Instrument sits in front of the body (not rigged, so it stays put) */}
          <InstrumentArt instrument={instrument} mood={mood} />
        </svg>
      </div>

      <div className="text-center leading-tight">
        <div className="max-w-[96px] truncate font-mono text-[11px] font-bold text-text">{label}</div>
        {sub && <div className="max-w-[96px] truncate text-[9px] text-dim">{sub}</div>}
      </div>
    </div>
  )
}

function Face({ mood }: { mood: CatMood }) {
  if (mood === 'sleep') {
    return (
      <>
        <path d="M25 24 h5" stroke="#222" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M34 24 h5" stroke="#222" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </>
    )
  }
  if (mood === 'sad') {
    return (
      <>
        <path d="M25 25 q2.5 -3 5 0" stroke="#222" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M34 25 q2.5 -3 5 0" stroke="#222" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        {/* tear */}
        <rect x="27" y="27" width="2" height="4" rx="1" fill="#5bc8ff" />
        <path d="M30 32 q2 2 4 0" stroke="#222" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </>
    )
  }
  if (mood === 'rock') {
    return (
      <>
        {/* wide excited eyes */}
        <circle cx="27" cy="24" r="3.2" fill="#fff" />
        <circle cx="37" cy="24" r="3.2" fill="#fff" />
        <circle cx="27.6" cy="24.4" r="1.5" fill="#111" />
        <circle cx="37.6" cy="24.4" r="1.5" fill="#111" />
        {/* open mouth + tongue */}
        <rect x="29" y="30" width="6" height="4" rx="2" fill="#3a1d22" />
        <rect x="30" y="32" width="4" height="2" rx="1" fill="#e2566b" />
      </>
    )
  }
  // idle
  return (
    <>
      <circle cx="27" cy="24" r="1.8" fill="#222" />
      <circle cx="37" cy="24" r="1.8" fill="#222" />
      <path d="M30 31 q2 1.5 4 0" stroke="#222" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  )
}

function InstrumentArt({ instrument, mood }: { instrument: Instrument; mood: CatMood }) {
  if (instrument === 'drums') {
    return (
      <g>
        {/* kick drum + tom + cymbal in front */}
        <rect x="14" y="46" width="14" height="12" rx="2" fill="#c0392b" stroke="#7d2018" strokeWidth="1" />
        <rect x="36" y="48" width="10" height="9" rx="2" fill="#2980b9" stroke="#1b4f72" strokeWidth="1" />
        <rect x="44" y="40" width="14" height="2" rx="1" fill="#f1c40f" />
        <rect x="50" y="42" width="1.5" height="10" fill="#888" />
      </g>
    )
  }
  if (instrument === 'mic') {
    return (
      <g>
        <rect x="46" y="20" width="2" height="34" fill="#888" />
        <circle cx="47" cy="18" r="4" fill="#333" stroke="#111" strokeWidth="1" />
        <rect x="43" y="53" width="8" height="3" rx="1" fill="#555" />
      </g>
    )
  }
  // guitar / bass — body + neck, tilted across the cat
  const body = instrument === 'bass' ? '#6c3483' : '#b9770e'
  const dark = instrument === 'bass' ? '#4a235a' : '#7d5109'
  const accent = mood === 'rock' ? '#f1c40f' : '#e0a020'
  return (
    <g transform="rotate(-18 32 48)">
      <rect x="16" y="44" width="16" height="11" rx="5" fill={body} stroke={dark} strokeWidth="1" />
      <circle cx="24" cy="49.5" r="2.4" fill={dark} />
      <rect x="30" y="47" width="22" height="3" rx="1" fill={dark} />
      <rect x="51" y="45" width="4" height="6" rx="1" fill={accent} />
    </g>
  )
}
