// Shared isometric projection for the Jam Room. A 2:1 isometric: each floor
// tile is TW wide and TH tall on screen; z is height (up). Both the room SVG
// and the cat-placement layer use these so cats land exactly on the floor.

export const VIEW_W = 760
export const VIEW_H = 600

const TW = 42 // half tile width on screen
const TH = 21 // quarter tile height on screen (2:1 iso)
const ZH = 46 // screen pixels per unit of height
const OX = 380 // screen x of tile (0,0)
const OY = 132 // screen y of tile (0,0)

export const FLOOR = 6 // floor is FLOOR×FLOOR tiles

export interface Pt { x: number; y: number }

/** Tile (x,y) at height z → screen point. */
export function iso(x: number, y: number, z = 0): Pt {
  return { x: OX + (x - y) * TW, y: OY + (x + y) * TH - z * ZH }
}

/** "x,y x,y …" polygon string from tile coords [ [x,y,z], … ]. */
export function poly(pts: [number, number, number][]): string {
  return pts.map(([x, y, z]) => { const p = iso(x, y, z); return `${p.x},${p.y}` }).join(' ')
}

// Floor slots for the band, ordered back→front so nearer cats overlay farther
// ones (DOM order + z-index). Kept clear of the back wall where the gear sits.
export const CAT_SLOTS: Pt[] = [
  { x: 1.5, y: 2.0 }, { x: 3.0, y: 1.8 }, { x: 4.5, y: 2.0 },
  { x: 1.2, y: 3.5 }, { x: 3.0, y: 3.4 }, { x: 4.8, y: 3.5 },
  { x: 1.6, y: 5.0 }, { x: 3.0, y: 5.1 }, { x: 4.4, y: 5.0 },
].sort((a, b) => (a.x + a.y) - (b.x + b.y))
