/**
 * Frame geometry.
 *
 * Every frame on a wall shares one height. The mat and the moulding are
 * derived from that shared height, which is what makes them identical on every
 * piece — a real frame's moulding doesn't get thicker because the print is
 * wider. Only the outer width varies, and it varies with the photograph.
 *
 * The frame itself is the real thing: a nine-slice of a photograph of your
 * frame, stretched along its edges by CSS border-image. The corners stay
 * crisp, the moulding keeps its actual grain and sheen, and one asset covers
 * every aspect ratio at any size.
 */

/** Moulding thickness, as a fraction of the shared frame height. */
export const MOULDING = 0.032

/** Mat border, as a fraction of the shared frame height. */
export const MAT = 0.105

/** Total height (and width) eaten by mat + moulding, both sides. */
export const SURROUND = 2 * (MOULDING + MAT)

/**
 * How far a print may stray from square before the mat takes up the slack.
 *
 * Without a cap, a 3:1 panorama at a shared height becomes a box three times
 * wider than its neighbours and wrecks the row. Past these limits the frame
 * stops growing and the photograph sits inside with more mat around it —
 * which is how an extreme panorama is actually mounted. Nothing is cropped.
 */
export const MIN_RATIO = 0.5
export const MAX_RATIO = 2.2

const DEFAULT_RATIO = 1.5

/** The photograph's own width-to-height ratio. */
export function artRatio(width: number | null, height: number | null): number {
  if (!width || !height) return DEFAULT_RATIO
  const ratio = width / height
  if (!Number.isFinite(ratio) || ratio <= 0) return DEFAULT_RATIO
  return ratio
}

/** The frame's width-to-height ratio, clamped to keep rows readable. */
export function frameRatio(width: number | null, height: number | null): number {
  const ratio = artRatio(width, height)
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

/** True when the cap kicked in, so the mat is carrying the difference. */
export function isClamped(width: number | null, height: number | null): boolean {
  const ratio = artRatio(width, height)
  return ratio > MAX_RATIO || ratio < MIN_RATIO
}

/**
 * Outer width ÷ outer height for a frame of the given art ratio.
 *
 * Used where something has to fit the whole frame into a known box — the
 * enlarged view works out its height from this.
 */
export function frameAspect(ratio: number): number {
  return (1 - SURROUND) * ratio + SURROUND
}
