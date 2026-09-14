import type { RoomSceneRecord } from '@/lib/scenes'
import type { Quad } from '@/lib/perspective'

/**
 * Rooms that ship with the site.
 *
 * Most photographers don't have a photograph of an empty wall to hand, and
 * asking for one before the shop looks like anything is a poor trade. These
 * three are bare walls, so the site draws the whole framed piece onto them and
 * a portrait gets a portrait frame — which is the part a room with a frame
 * already in it can't do.
 *
 * They live in /public rather than storage: every site gets the same three, so
 * there's nothing per-tenant to upload, back up or pay for. A site that adds
 * its own rooms gets those as well, and can switch these off.
 *
 * The corners are the wall space art may occupy, as percentages of the image,
 * clockwise from top left. A piece is centred inside and keeps its own shape,
 * so the box is deliberately a little generous.
 */
type Preset = {
  id: string
  name: string
  file: string
  width: number
  height: number
  corners: Quad
}

const PRESETS: Preset[] = [
  {
    id: 'preset-living-room',
    name: 'Living room',
    file: 'living-room',
    width: 1600,
    height: 900,
    corners: [
      [33, 9],
      [69, 9],
      [69, 50],
      [33, 50],
    ],
  },
  {
    id: 'preset-concrete-bench',
    name: 'Concrete wall',
    file: 'concrete-bench',
    width: 1600,
    height: 900,
    corners: [
      [34, 12],
      [71, 12],
      [71, 57],
      [34, 57],
    ],
  },
  {
    id: 'preset-reading-corner',
    name: 'Reading corner',
    file: 'reading-corner',
    width: 1600,
    height: 900,
    corners: [
      [31, 11],
      [67, 11],
      [67, 52],
      [31, 52],
    ],
  },
]

export const PRESET_ROOMS: RoomSceneRecord[] = PRESETS.map((preset, index) => ({
  id: preset.id,
  name: preset.name,
  imageUrl: `/rooms/${preset.file}-1600.webp`,
  srcSet: `/rooms/${preset.file}-800.webp 800w, /rooms/${preset.file}-1600.webp 1600w`,
  width: preset.width,
  height: preset.height,
  corners: preset.corners,
  // Bare walls, so the site draws the frame
  hasFrame: false,
  sortOrder: index - 100,
  isActive: true,
  isPreset: true,
}))

export function isPresetId(id: string): boolean {
  return id.startsWith('preset-')
}
