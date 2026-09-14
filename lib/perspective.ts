/**
 * Mapping a rectangle onto four arbitrary corners.
 *
 * A room photograph is rarely taken square-on to the wall, so hanging a print
 * in one means more than moving and scaling it — the far edge has to be
 * shorter than the near one. That's a projective transform, and CSS can do it
 * natively through matrix3d, which means the mockup is the live frame with the
 * live photograph in it rather than a picture of one. Change the moulding or
 * replace the photograph and every room updates.
 */

export type Point = [number, number]

/** Four corners, clockwise from top-left. */
export type Quad = [Point, Point, Point, Point]

export const DEFAULT_QUAD: Quad = [
  [32, 20],
  [68, 20],
  [68, 64],
  [32, 64],
]

/** Anything stored in the database has been hand-edited; check it's usable. */
export function isQuad(value: unknown): value is Quad {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === 'number' &&
        typeof p[1] === 'number' &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1])
    )
  )
}

export function toQuad(value: unknown): Quad {
  return isQuad(value) ? value : DEFAULT_QUAD
}

/**
 * The CSS transform that carries a `width` × `height` box onto `quad`, whose
 * points are in the same pixel space.
 *
 * Solves the projective map from the unit square to the quad, then pre-scales
 * it so the source is the box rather than the square. Returns null when the
 * corners are degenerate — three in a line, say — because a transform built
 * from that collapses the frame to nothing.
 */
export function matrix3dFor(quad: Quad, width: number, height: number): string | null {
  if (!(width > 0) || !(height > 0)) return null

  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad

  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const dy3 = y0 - y1 + y2 - y3

  let a: number, b: number, c: number
  let d: number, e: number, f: number
  let g: number, h: number

  if (dx3 === 0 && dy3 === 0) {
    // The corners form a parallelogram, so no perspective is involved
    a = x1 - x0
    b = x2 - x1
    c = x0
    d = y1 - y0
    e = y2 - y1
    f = y0
    g = 0
    h = 0
  } else {
    const den = dx1 * dy2 - dx2 * dy1
    if (den === 0) return null

    g = (dx3 * dy2 - dx2 * dy3) / den
    h = (dx1 * dy3 - dx3 * dy1) / den

    a = x1 - x0 + g * x1
    b = x3 - x0 + h * x3
    c = x0
    d = y1 - y0 + g * y1
    e = y3 - y0 + h * y3
    f = y0
  }

  // Source the transform from the box instead of the unit square
  const m = [a / width, b / height, c, d / width, e / height, f, g / width, h / height]
  if (m.some((n) => !Number.isFinite(n))) return null

  const [A, B, C, D, E, F, G, H] = m

  // Column-major, the way CSS wants it
  return `matrix3d(${A}, ${D}, 0, ${G}, ${B}, ${E}, 0, ${H}, 0, 0, 1, 0, ${C}, ${F}, 0, 1)`
}

/**
 * Where a point of the unit square lands inside a quad.
 *
 * Used to hang a frame *within* the marked wall space: the frame's own
 * rectangle is worked out in the flat unit square, where fitting one shape
 * inside another is simple arithmetic, and only then pushed out through the
 * perspective.
 */
export function mapPoint(quad: Quad, u: number, v: number): Point {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad

  // Bilinear along the top and bottom edges, then between them. For a true
  // projective quad this is the same surface the matrix describes at the
  // corners and close enough between them for placing a frame.
  const top: Point = [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]
  const bottom: Point = [x3 + (x2 - x3) * u, y3 + (y2 - y3) * u]

  return [top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v]
}

/**
 * The quad's proportions as the wall would see them, ignoring perspective.
 * Averaging opposite edges is rough, but it only decides how much of the
 * marked space a given shape takes up.
 */
export function quadAspect(quad: Quad): number {
  const top = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1])
  const bottom = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1])
  const left = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1])
  const right = Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1])

  const horizontal = (top + bottom) / 2
  const vertical = (left + right) / 2

  return vertical > 0 ? horizontal / vertical : 1
}

/**
 * The sub-quad a piece of the given shape occupies, centred in the wall space.
 *
 * A portrait and a panorama are both marked against the same wall; neither
 * should be stretched to fill it. Whichever way the piece is more extreme than
 * the space runs out first, and the rest stays wall.
 */
export function fitInQuad(quad: Quad, aspect: number): Quad {
  const wall = quadAspect(quad)

  const w = aspect >= wall ? 1 : aspect / wall
  const h = aspect >= wall ? wall / aspect : 1

  const u = (1 - w) / 2
  const v = (1 - h) / 2

  return [
    mapPoint(quad, u, v),
    mapPoint(quad, u + w, v),
    mapPoint(quad, u + w, v + h),
    mapPoint(quad, u, v + h),
  ]
}

/** The quad in pixels, given percentages and the size they're a percentage of. */
export function quadToPixels(quad: Quad, width: number, height: number): Quad {
  return quad.map(([x, y]) => [(x / 100) * width, (y / 100) * height]) as Quad
}

/**
 * How wide the art should be drawn before it's transformed.
 *
 * The frame is laid out at its natural size and then mapped onto the corners,
 * so the reference width only has to be close enough that the transform isn't
 * scaling text or borders by a silly factor. The quad's longest horizontal
 * edge is the honest answer.
 */
export function referenceWidth(quad: Quad): number {
  const top = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1])
  const bottom = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1])
  return Math.max(top, bottom, 1)
}
