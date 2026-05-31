// Isometric band-practice room, drawn entirely in SVG (no external assets).
// Floor uses a neon-grid like the reference; two back walls with windows; amps,
// a red drum kit, flying-V guitars, a keyboard and PA stacks sit against the
// back. The band (PixelCats) is layered on top by JamRoomPage using the same
// iso() projection so they stand on the floor.

import { iso, poly, FLOOR, VIEW_W, VIEW_H } from '@/lib/jam/iso'

interface Props { lit: boolean }

// An isometric box from tile-space size (w,d) and height (h, in z-units).
function Cuboid({
  x, y, z = 0, w, d, h, top, right, front,
}: {
  x: number; y: number; z?: number; w: number; d: number; h: number
  top: string; right: string; front: string
}) {
  return (
    <g>
      {/* +y face (front-left, toward viewer) */}
      <polygon points={poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={front} />
      {/* +x face (right) */}
      <polygon points={poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])} fill={right} />
      {/* top */}
      <polygon points={poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={top} />
    </g>
  )
}

// Iso cylinder (drum/cymbal): anchored at floor tile (cx,cy); sizes in px.
function Cylinder({
  cx, cy, bodyH, rx, ry, top, side,
}: { cx: number; cy: number; bodyH: number; rx: number; ry: number; top: string; side: string }) {
  const b = iso(cx, cy, 0)
  const t = { x: b.x, y: b.y - bodyH }
  return (
    <g>
      <ellipse cx={b.x} cy={b.y} rx={rx} ry={ry} fill={side} />
      <polygon points={`${t.x - rx},${t.y} ${b.x - rx},${b.y} ${b.x + rx},${b.y} ${t.x + rx},${t.y}`} fill={side} />
      <ellipse cx={t.x} cy={t.y} rx={rx} ry={ry} fill={top} />
    </g>
  )
}

// Red flying-V guitar leaning against the wall, anchored at a tile point.
function FlyingV({ cx, cy, rot }: { cx: number; cy: number; rot: number }) {
  const a = iso(cx, cy, 0)
  return (
    <g transform={`translate(${a.x} ${a.y}) rotate(${rot})`}>
      <rect x="-3" y="-78" width="6" height="62" rx="2" fill="#3a2207" />
      <polygon points="-3,-84 3,-84 5,-74 -5,-74" fill="#1c1208" />
      <polygon points="0,-20 -16,8 -7,12 0,-2 7,12 16,8" fill="#d63031" stroke="#7d1c1c" strokeWidth="1.5" />
      <polygon points="0,-20 -8,-4 0,0 8,-4" fill="#a52323" />
    </g>
  )
}

export default function IsoRoom({ lit }: Props) {
  const neon = lit ? '#e84bd0' : '#7b3fa0'
  const neonGlow = lit ? 0.9 : 0.45
  const wallH = 3.1 // height units

  // Floor outline
  const floorPts = poly([[0, 0, 0], [FLOOR, 0, 0], [FLOOR, FLOOR, 0], [0, FLOOR, 0]])

  // Grid lines (skip the outer edges; those are the neon border)
  const grid: string[] = []
  for (let i = 1; i < FLOOR; i++) {
    grid.push(poly([[i, 0, 0], [i, FLOOR, 0]]))
    grid.push(poly([[0, i, 0], [FLOOR, i, 0]]))
  }
  const border = poly([[0, 0, 0], [FLOOR, 0, 0], [FLOOR, FLOOR, 0], [0, FLOOR, 0], [0, 0, 0]])

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-full w-full" shapeRendering="geometricPrecision">
      <defs>
        <filter id="neonGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="wallL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#241a33" /><stop offset="1" stopColor="#171022" />
        </linearGradient>
        <linearGradient id="wallR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c2140" /><stop offset="1" stopColor="#1d1530" />
        </linearGradient>
      </defs>

      {/* ── Walls (drawn first, behind everything) ── */}
      {/* Left wall along the (0,0)→(0,FLOOR) edge */}
      <polygon points={poly([[0, 0, 0], [0, FLOOR, 0], [0, FLOOR, wallH], [0, 0, wallH]])} fill="url(#wallL)" />
      {/* Right wall along the (0,0)→(FLOOR,0) edge */}
      <polygon points={poly([[0, 0, 0], [FLOOR, 0, 0], [FLOOR, 0, wallH], [0, 0, wallH]])} fill="url(#wallR)" />
      {/* Neon trim along the top edges */}
      <polyline points={poly([[0, FLOOR, wallH], [0, 0, wallH], [FLOOR, 0, wallH]])} fill="none" stroke={neon} strokeWidth="2.5" opacity={neonGlow} filter="url(#neonGlow)" />

      {/* Windows on the right wall (y=0 plane) */}
      {[[1.0, 2.4], [3.4, 4.8]].map(([a, b], k) => (
        <polygon key={k}
          points={poly([[a, 0, 1.3], [b, 0, 1.3], [b, 0, 2.5], [a, 0, 2.5]])}
          fill="#3a3550" stroke="#4f4870" strokeWidth="1.5" opacity="0.9" />
      ))}
      {/* A framed poster on the left wall */}
      <polygon points={poly([[0, 1.2, 1.4], [0, 3.0, 1.4], [0, 3.0, 2.5], [0, 1.2, 2.5]])} fill="#2a2038" stroke={neon} strokeWidth="1.5" opacity="0.8" />

      {/* ── Floor ── */}
      <polygon points={floorPts} fill="#120d1c" />
      {grid.map((d, i) => (
        <polyline key={i} points={d} fill="none" stroke={neon} strokeWidth="1.4" opacity={neonGlow * 0.55} />
      ))}
      <polyline points={border} fill="none" stroke={neon} strokeWidth="2.6" opacity={neonGlow} filter="url(#neonGlow)" />

      {/* ── Gear against the back ── */}
      {/* Amp stack, back-left */}
      <Cuboid x={0.15} y={1.1} w={1.0} d={1.0} h={1.4} top="#3b3b44" right="#26262d" front="#1c1c22" />
      <Cuboid x={0.15} y={1.1} z={1.4} w={1.0} d={1.0} h={1.1} top="#44444f" right="#2c2c34" front="#202026" />
      {/* Amp, back-right */}
      <Cuboid x={3.9} y={0.15} w={1.0} d={1.0} h={1.6} top="#3b3b44" right="#26262d" front="#1c1c22" />

      {/* Flying-V guitars leaning */}
      <FlyingV cx={1.35} cy={0.35} rot={10} />
      <FlyingV cx={4.9} cy={1.5} rot={-12} />

      {/* Keyboard on a stand, mid-left-back */}
      <Cuboid x={0.7} y={2.3} z={0.55} w={1.7} d={0.5} h={0.18} top="#dfe3ea" right="#9aa0ab" front="#7c828d" />
      {Array.from({ length: 9 }).map((_, i) => (
        <polyline key={i} points={poly([[0.7 + (i + 1) * (1.7 / 10), 2.3, 0.73], [0.7 + (i + 1) * (1.7 / 10), 2.8, 0.73]])}
          fill="none" stroke="#2b2f37" strokeWidth="1" />
      ))}
      {/* stand legs */}
      <polygon points={poly([[0.95, 2.55, 0], [1.0, 2.55, 0], [1.0, 2.55, 0.55], [0.95, 2.55, 0.55]])} fill="#2a2a30" />
      <polygon points={poly([[2.1, 2.55, 0], [2.15, 2.55, 0], [2.15, 2.55, 0.55], [2.1, 2.55, 0.55]])} fill="#2a2a30" />

      {/* Drum kit, center-back */}
      <Cylinder cx={2.9} cy={1.55} bodyH={42} rx={34} ry={17} top="#e74c3c" side="#a82a22" />
      <Cylinder cx={2.45} cy={0.95} bodyH={26} rx={20} ry={10} top="#e74c3c" side="#a82a22" />
      <Cylinder cx={3.45} cy={0.95} bodyH={26} rx={20} ry={10} top="#e74c3c" side="#a82a22" />
      {/* cymbals on thin stands */}
      <polygon points={poly([[2.1, 0.7, 0], [2.13, 0.7, 0], [2.13, 0.7, 1.55], [2.1, 0.7, 1.55]])} fill="#777" />
      <ellipse cx={iso(2.1, 0.7, 1.55).x} cy={iso(2.1, 0.7, 1.55).y} rx={22} ry={6} fill="#f1c40f" />
      <polygon points={poly([[3.8, 0.7, 0], [3.83, 0.7, 0], [3.83, 0.7, 1.4], [3.8, 0.7, 1.4]])} fill="#777" />
      <ellipse cx={iso(3.8, 0.7, 1.4).x} cy={iso(3.8, 0.7, 1.4).y} rx={20} ry={5.5} fill="#f1c40f" />

      {/* PA speakers, back corners */}
      <Cuboid x={5.0} y={0.2} w={0.85} d={0.85} h={2.2} top="#33333b" right="#222228" front="#191920" />
      <Cuboid x={0.2} y={5.0} w={0.85} d={0.85} h={2.0} top="#33333b" right="#222228" front="#191920" />
    </svg>
  )
}
