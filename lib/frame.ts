/**
 * Frame geometry for the hung wall.
 *
 * Everything is a fraction of ONE number: the width of the column a piece sits
 * in. Every column on the wall is the same width, so the moulding and the mat
 * come out identical on every frame — a real frame's moulding doesn't get
 * thicker because the print is bigger. The photograph's shape then decides how
 * tall the frame is and how it hangs.
 *
 * The frame itself is the real thing: a nine-slice of a photograph of the
 * frame, stretched along its edges by CSS border-image, so the corners stay
 * crisp, the moulding keeps its actual grain, and one asset covers every
 * aspect ratio at any size.
 *
 * How a wall hangs:
 *   · landscapes, panoramas and squares share a bottom line
 *   · verticals sit centred on that line, rising higher and hanging lower
 */

/** Moulding thickness, as a fraction of the column width. */
export const MOULDING = 0.022

/** Mat border, as a fraction of the column width. */
export const MAT = 0.08

/** What mat + moulding take out of the column, both sides. */
export const SURROUND = 2 * (MOULDING + MAT)

/**
 * How far a print may stray from square before the mat takes up the slack.
 *
 * Past these limits the frame stops changing shape and the photograph sits
 * inside with more mat around it — which is how an extreme panorama is
 * actually mounted. Nothing is ever cropped.
 */
export const MIN_RATIO = 0.5
export const MAX_RATIO = 2.2

/** Where the shape thresholds sit. Matches orientationOf in lib/catalog.ts. */
const LANDSCAPE_AT = 1.15
const PORTRAIT_AT = 0.87

/**
 * How much of its column each shape fills.
 *
 * A vertical that filled the whole column would tower over its neighbours, so
 * it takes a narrower share and gains its presence in height instead. This is
 * the rhythm in a hung gallery wall: wide pieces broad and low, tall pieces
 * narrow and high.
 */
const WIDTH_FACTOR = { landscape: 1, square: 0.74, portrait: 0.7 } as const

const DEFAULT_RATIO = 1.5

export type Shape = keyof typeof WIDTH_FACTOR

/** The photograph's own width-to-height ratio. */
export function artRatio(width: number | null, height: number | null): number {
  if (!width || !height) return DEFAULT_RATIO
  const ratio = width / height
  if (!Number.isFinite(ratio) || ratio <= 0) return DEFAULT_RATIO
  return ratio
}

/** The frame's ratio, clamped so one piece can't run away with the row. */
export function frameRatio(width: number | null, height: number | null): number {
  const ratio = artRatio(width, height)
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

export function shapeOf(width: number | null, height: number | null): Shape {
  const ratio = artRatio(width, height)
  if (ratio >= LANDSCAPE_AT) return 'landscape'
  if (ratio <= PORTRAIT_AT) return 'portrait'
  return 'square'
}

/**
 * The height of a plain 3:2 landscape — the line the wall is built around.
 * Horizontals sit on it; verticals straddle it.
 */
export const BAND = (WIDTH_FACTOR.landscape - SURROUND) / DEFAULT_RATIO + SURROUND

export type FrameMetrics = {
  shape: Shape
  /** Frame width, as a fraction of the column. */
  widthFactor: number
  /** Frame height, as a fraction of the column. */
  heightFactor: number
  /** How far a vertical hangs below the shared bottom line. 0 for the rest. */
  dropFactor: number
  /** The photograph's true ratio — the mat window is cut to this. */
  artRatio: number
  /** The shape of the opening the mat leaves, after the cap. */
  openingRatio: number
  /** Whether the ratio cap applied, so the mat is carrying the difference. */
  clamped: boolean
}

/**
 * Everything a frame needs, in column-relative fractions. They're fractions
 * rather than pixels on purpose: the page multiplies them by the live column
 * width in CSS, so the wall stays right at every screen size without the
 * server knowing anything about the viewport.
 */
export function frameMetrics(width: number | null, height: number | null): FrameMetrics {
  const shape = shapeOf(width, height)
  const art = artRatio(width, height)
  const ratio = frameRatio(width, height)
  const widthFactor = WIDTH_FACTOR[shape]
  const heightFactor = (widthFactor - SURROUND) / ratio + SURROUND

  return {
    shape,
    widthFactor,
    heightFactor,
    dropFactor: shape === 'portrait' ? Math.max(0, (heightFactor - BAND) / 2) : 0,
    artRatio: art,
    openingRatio: ratio,
    clamped: art > MAX_RATIO || art < MIN_RATIO,
  }
}

/**
 * The custom properties a hung piece needs, ready to spread into a style
 * attribute. The page multiplies each one by the live column width.
 */
export function pieceStyle(
  width: number | null,
  height: number | null
): Record<string, string> {
  const m = frameMetrics(width, height)
  return {
    '--wf': String(m.widthFactor),
    '--hf': String(m.heightFactor),
    '--drop': String(m.dropFactor),
  }
}

/**
 * Outer width ÷ outer height, for fitting a whole frame into a known box.
 * The enlarged view uses it to work out how wide to make its stage.
 */
export function frameAspect(metrics: FrameMetrics): number {
  return metrics.widthFactor / metrics.heightFactor
}
