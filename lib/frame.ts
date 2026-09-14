/**
 * Frame geometry.
 *
 * The frame is drawn around the photograph rather than being a fixed picture of
 * a frame, so any aspect ratio works — landscape, portrait, square, panorama —
 * with no per-shape asset to supply.
 *
 * It works because percentage padding in CSS always resolves against the
 * element's WIDTH, top and bottom included. So a mat of `padding: 7%` is the
 * same number of pixels on every side, exactly like a real cut mat, and the
 * frame's outer shape falls out of the photograph's own proportions.
 */

/** Moulding thickness, as a fraction of the frame's outer width. */
export const MOULDING = 0.022

/** Mat border, as a fraction of the frame's outer width. */
export const MAT = 0.07

/** Everything the frame adds around the print, both sides combined. */
const SURROUND = 2 * (MOULDING + MAT)

/** The wall panel's shape, and how much wall shows around the frame. */
const STAGE_RATIO = 4 / 3
const STAGE_PAD = 0.07

/**
 * How wide the frame should be, as a percentage of the wall panel.
 *
 * A tall print has to be narrower to fit the same wall, which is what makes a
 * portrait read as a portrait instead of being stretched to fill the space.
 * Returns a width-limited value for wide images and a height-limited one for
 * tall ones.
 */
export function frameWidthPercent(ratio: number): number {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1.5

  // Outer shape of the frame once the mat and moulding are added
  const frameRatio = 1 / ((1 - SURROUND) / safe + SURROUND)

  const innerWidth = 1 - 2 * STAGE_PAD
  const innerHeight = 1 / STAGE_RATIO - 2 * STAGE_PAD

  return Math.min(innerWidth, innerHeight * frameRatio) * 100
}

export function ratioOf(width: number | null, height: number | null): number {
  return width && height ? width / height : 1.5
}
