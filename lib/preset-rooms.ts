import type { Quad } from '@/lib/perspective'

/**
 * The rooms a print can be shown in.
 *
 * Three, fixed, shipped with the site. A photographer picks one and every
 * print hangs in it — there's nothing to upload, nothing to mark up, and one
 * fewer screen to understand. They're bare walls, so the site draws the whole
 * framed piece and a tall photograph gets a tall frame.
 *
 * ── Making the print belong in the room ──────────────────────────────────
 *
 * A frame drawn at full brightness and dropped onto a photograph of a dim room
 * reads as a sticker, because the light doesn't agree. The concrete room's
 * wall measures luma 118 while a white mat is drawn at 240 — the frame is lit
 * like a studio and the room isn't.
 *
 * So each room carries what its own light does, measured off the photograph at
 * the spot where art hangs:
 *
 *   exposure  how far to bring the frame down toward the room's light. Not all
 *             the way: a print under glass is genuinely brighter than the wall
 *             behind it, and taking it to the wall's own value looks muddy.
 *   wash      the wall's actual colour, laid over the frame so it picks up the
 *             room's cast — every one of these rooms is warm.
 *   falloff   how much darker the far side of the frame is, from the window
 *             light dropping off across the wall.
 *   shadow    how hard the contact shadow reads. A dim room swallows it.
 */
type Light = {
  exposure: number
  wash: string
  falloff: number
  shadow: number
}

export type PresetRoom = {
  id: string
  name: string
  note: string
  file: string
  width: number
  height: number
  corners: Quad
  light: Light
}

export const PRESET_ROOMS: PresetRoom[] = [
  {
    id: 'living-room',
    name: 'Living room',
    note: 'Bright, soft, almost shadowless. Flatters everything.',
    file: 'living-room',
    width: 1600,
    height: 900,
    corners: [
      [33, 9],
      [69, 9],
      [69, 50],
      [33, 50],
    ],
    // wall luma 224, falls off 5 left to right
    light: { exposure: 0.964, wash: 'rgba(229, 224, 221, 0.10)', falloff: 0.028, shadow: 0.33 },
  },
  {
    id: 'concrete-bench',
    name: 'Concrete wall',
    note: 'Dim and directional. The most dramatic, and the kindest to dark prints.',
    file: 'concrete-bench',
    width: 1600,
    height: 900,
    corners: [
      [34, 12],
      [71, 12],
      [71, 57],
      [34, 57],
    ],
    // wall luma 118, falls off 22 left to right — much the strongest light
    light: { exposure: 0.721, wash: 'rgba(125, 118, 111, 0.16)', falloff: 0.12, shadow: 0.53 },
  },
  {
    id: 'reading-corner',
    name: 'Reading corner',
    note: 'Warm, with real sun across the wall. The most lived-in.',
    file: 'reading-corner',
    width: 1600,
    height: 900,
    corners: [
      [31, 11],
      [67, 11],
      [67, 52],
      [31, 52],
    ],
    // wall luma 219, falls off 12 left to right
    light: { exposure: 0.951, wash: 'rgba(225, 219, 212, 0.12)', falloff: 0.063, shadow: 0.34 },
  },
]

export const DEFAULT_ROOM = PRESET_ROOMS[0].id

/** The chosen room, or null when a site has turned the mockup off. */
export function roomFor(id: string | null | undefined): PresetRoom | null {
  if (id === 'none') return null
  return PRESET_ROOMS.find((room) => room.id === id) ?? PRESET_ROOMS[0]
}

export function imageFor(room: PresetRoom) {
  return {
    src: `/rooms/${room.file}-1600.webp`,
    srcSet: `/rooms/${room.file}-800.webp 800w, /rooms/${room.file}-1600.webp 1600w`,
  }
}
