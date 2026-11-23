/**
 * GALLERY LAYOUTS — the arithmetic, kept pure
 * ═══════════════════════════════════════════
 *
 * `albums.layout_style` is a contract: `masonry`, `grid` (shown as
 * Justified), `single_column`, `square`. This file decides how each one
 * arranges a given number of photographs at a given width, and nothing in it
 * touches the DOM, so the public gallery, the client link and the editor's
 * preview arrange the same photographs identically (components/gallery/
 * PhotoLayout.tsx draws what this decides).
 *
 * What the database accepts is narrower than the contract:
 * albums_layout_style_check allows `masonry`, `grid`, `single_column` and —
 * since migration 20261122233837 (2026-11-22_album_layout_square.sql) —
 * `square`. `editorial` is rendered here but is NOT storable until a migration
 * widens that CHECK again — the editor shows it disabled and the save action
 * refuses it rather than letting the database raise (which would reach the
 * photographer as a redacted server error). See claude/open-items.md.
 */

export const LAYOUT_STYLES = [
  { key: 'grid', label: 'Justified' },
  { key: 'masonry', label: 'Masonry' },
  { key: 'single_column', label: 'Single column' },
  { key: 'square', label: 'Square' },
  { key: 'editorial', label: 'Editorial' },
] as const

export type LayoutStyle = (typeof LAYOUT_STYLES)[number]['key']

/** What albums_layout_style_check accepts in production today (square: migration 20261122233837). */
export const STORABLE_LAYOUTS: readonly LayoutStyle[] = ['grid', 'masonry', 'single_column', 'square']

/** A layout from a form, exactly as the database accepts it, or null. */
export function storableLayout(value: unknown): LayoutStyle | null {
  return typeof value === 'string' && (STORABLE_LAYOUTS as readonly string[]).includes(value) ? (value as LayoutStyle) : null
}

/** Justified is the default for an album that has never chosen. */
export const DEFAULT_LAYOUT: LayoutStyle = 'grid'

export function layoutStyleOf(value: unknown): LayoutStyle {
  return LAYOUT_STYLES.some((l) => l.key === value) ? (value as LayoutStyle) : DEFAULT_LAYOUT
}

/** What is actually drawn, once the small-count rules have spoken. */
export type Arrangement = 'none' | 'single' | 'justified' | 'masonry' | 'column' | 'square' | 'editorial'

/** Masonry columns only from about this many photographs; fewer look sparse. */
export const MASONRY_MIN = 6

/**
 * The small-count rules (client-gallery-v2, Part 2):
 *   1 photograph    → large and centred, whatever the layout
 *   2–4             → one or two justified rows, whatever the layout — never
 *                     sparse masonry columns, a lone square grid row or a
 *                     short column (justifiedRows keeps it to two rows)
 *   masonry         → only from MASONRY_MIN; below that, justified
 * From 5 photographs each layout has its own character.
 */
export const SMALL_COUNT_MAX = 4

export function arrangementFor(style: LayoutStyle, count: number): Arrangement {
  if (count <= 0) return 'none'
  if (count === 1) return 'single'
  if (count <= SMALL_COUNT_MAX) return 'justified'
  if (style === 'single_column') return 'column'
  if (style === 'square') return 'square'
  if (style === 'masonry') return count >= MASONRY_MIN ? 'masonry' : 'justified'
  if (style === 'editorial') return 'editorial'
  return 'justified'
}

/** A photograph's width ÷ height, from its own size; unknown → 3:2, the common case. */
export function ratioOf(width: number | null | undefined, height: number | null | undefined): number {
  if (!width || !height || width <= 0 || height <= 0) return 1.5
  // Bounded so one panorama or sliver cannot flatten a whole row.
  return Math.min(4, Math.max(0.25, width / height))
}

export type Placed = { index: number; width: number; height: number }
export type Row = { items: Placed[]; height: number; /** false for a short last row left at its natural size */ filled: boolean }

/** The row height a justified gallery aims for at this width. */
export function targetRowHeight(width: number): number {
  if (width < 520) return Math.max(150, width * 0.62)
  if (width < 900) return width * 0.36
  return Math.min(380, Math.max(240, width * 0.24))
}

/**
 * Justified rows: every photograph keeps its proportions, every full row is
 * exactly `width` wide, and no row is taller than `maxHeight`. Greedy, closing
 * a row at whichever break leaves its height nearer the target. A short last
 * row is not stretched into giants: it stays at the target height.
 *
 * Two to SMALL_COUNT_MAX photographs are never more than two rows: where the
 * greedy pass would make more (a phone, wide photographs), the one- or two-row
 * split whose worst row is nearest the target wins instead. Larger sets are
 * untouched.
 */
export function justifiedRows(
  ratios: readonly number[],
  width: number,
  gap: number,
  target = targetRowHeight(width),
  maxHeight = target * 1.6
): Row[] {
  const rows = greedyRows(ratios, width, gap, target, maxHeight)
  if (ratios.length < 2 || ratios.length > SMALL_COUNT_MAX || rows.length <= 2) return rows
  return fewestRows(ratios, width, gap, target, maxHeight)
}

/** A row of ratios[from..to] at its natural height, or left at the target if that is too tall. */
function naturalRow(ratios: readonly number[], from: number, to: number, width: number, gap: number, target: number, maxHeight: number): Row {
  const total = ratios.slice(from, to + 1).reduce((a, b) => a + b, 0)
  const natural = (width - gap * (to - from)) / total
  const filled = natural <= maxHeight
  const h = filled ? natural : Math.min(target, maxHeight)
  return { items: place(ratios, from, to, h), height: h, filled }
}

/** The best of one row or any two-row split, by the worst row's distance from the target (fewer rows on a tie). */
function fewestRows(ratios: readonly number[], width: number, gap: number, target: number, maxHeight: number): Row[] {
  const last = ratios.length - 1
  const worst = (rs: Row[]) => Math.max(...rs.map((r) => Math.abs(Math.log(r.height / target))))
  let best = [naturalRow(ratios, 0, last, width, gap, target, maxHeight)]
  let bestScore = worst(best)
  for (let split = 0; split < last; split++) {
    const candidate = [naturalRow(ratios, 0, split, width, gap, target, maxHeight), naturalRow(ratios, split + 1, last, width, gap, target, maxHeight)]
    const score = worst(candidate)
    if (score < bestScore - 1e-9) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

function greedyRows(ratios: readonly number[], width: number, gap: number, target: number, maxHeight: number): Row[] {
  const rows: Row[] = []
  let start = 0
  while (start < ratios.length) {
    let end = start
    let sum = 0
    let chosen = -1
    for (let i = start; i < ratios.length; i++) {
      const nextSum = sum + ratios[i]!
      const h = (width - gap * (i - start)) / nextSum
      if (h <= target) {
        // Is the row nearer the target with this photograph, or without it?
        const without = i > start ? (width - gap * (i - 1 - start)) / sum : Infinity
        chosen = Math.abs(without - target) < Math.abs(h - target) && i > start ? i - 1 : i
        break
      }
      sum = nextSum
      end = i
    }
    if (chosen === -1) {
      // Ran out of photographs before the row filled: the last row.
      const n = ratios.length - start
      const total = ratios.slice(start).reduce((a, b) => a + b, 0)
      const natural = (width - gap * (n - 1)) / total
      const filled = natural <= maxHeight
      const h = filled ? natural : Math.min(target, maxHeight)
      rows.push({ items: place(ratios, start, ratios.length - 1, h), height: h, filled })
      break
    }
    end = chosen
    const total = ratios.slice(start, end + 1).reduce((a, b) => a + b, 0)
    const natural = (width - gap * (end - start)) / total
    const h = Math.min(maxHeight, natural)
    rows.push({ items: place(ratios, start, end, h), height: h, filled: h === natural })
    start = end + 1
  }
  return rows
}

function place(ratios: readonly number[], from: number, to: number, h: number): Placed[] {
  const out: Placed[] = []
  for (let i = from; i <= to; i++) out.push({ index: i, width: ratios[i]! * h, height: h })
  return out
}

/** Masonry column count for a width (and never more columns than photographs make sensible). */
export function masonryColumns(width: number, count: number): number {
  const byWidth = width < 520 ? 2 : width < 1000 ? 3 : 4
  return Math.max(1, Math.min(byWidth, Math.ceil(count / 2)))
}

/**
 * Deals photographs into columns, each to the currently shortest column, so the
 * columns end level. Each tile's height follows its own photograph's ratio —
 * there is no fixed row height for a landscape tile to leave empty.
 */
export function masonryDeal(ratios: readonly number[], columns: number): number[][] {
  const cols: number[][] = Array.from({ length: columns }, () => [])
  const heights = new Array(columns).fill(0)
  ratios.forEach((r, i) => {
    let shortest = 0
    for (let c = 1; c < columns; c++) if (heights[c] < heights[shortest] - 1e-9) shortest = c
    cols[shortest]!.push(i)
    heights[shortest] += 1 / r
  })
  return cols
}

/**
 * Editorial: mixed sizes in a repeating rhythm — one large, a pair, a trio, a
 * pair — each group a justified row of fixed count, a lone photograph capped
 * and centred so a portrait never runs the full width.
 */
const EDITORIAL_RHYTHM = [1, 2, 3, 2] as const

export function editorialRows(ratios: readonly number[], width: number, gap: number, maxSingle = width * 0.62): Row[] {
  const rows: Row[] = []
  let i = 0
  let beat = 0
  while (i < ratios.length) {
    const n = Math.min(EDITORIAL_RHYTHM[beat % EDITORIAL_RHYTHM.length]!, ratios.length - i)
    const total = ratios.slice(i, i + n).reduce((a, b) => a + b, 0)
    const natural = (width - gap * (n - 1)) / total
    const cap = n === 1 ? maxSingle : maxSingle * 0.8
    const h = Math.min(natural, cap)
    rows.push({ items: place(ratios, i, i + n - 1, h), height: h, filled: h === natural })
    i += n
    beat++
  }
  return rows
}
