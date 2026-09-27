/**
 * WHERE A PIECE OF HERO COPY SITS
 * ═══════════════════════════════
 *
 * Nine places on the photograph: three rows crossed with three columns. The
 * title, the subtitle and the button each name one, independently.
 *
 * ── Why nine fixed places and not free coordinates ──────────────────────────
 *
 * A free x/y would be easier to build and worse to use. A photographer
 * dragging a title to 43.7% / 71.2% has made a decision they cannot repeat on
 * the next page, that does not survive a phone screen, and that no template
 * can express. Nine places are a vocabulary: the same words on every page,
 * every device and every look, and a drag that lands somewhere sensible
 * rather than somewhere exact.
 *
 * ── Why they stack ──────────────────────────────────────────────────────────
 *
 * Elements that choose the same place are laid out one under the other, in the
 * order title → subtitle → button, rather than on top of each other. The
 * default is all three at bottom-centre, which is the layout the hero had
 * before any of this existed, so nothing moves for a site that never touches
 * it.
 *
 * ── Why a container per place, rather than a grid-area per element ──────────
 *
 * Nine containers cost nine empty divs. The alternative — three grid children
 * positioned by `grid-area` — is fewer nodes and cannot stack: two items in
 * one cell overlap, which is the failure this is here to avoid. It also makes
 * the drag honest, because dropping an element into a zone moves the node into
 * exactly the container the server will render it in.
 */

import { deviceKey } from '@/lib/sections/devices'

/*
 * Five bands rather than three. The vertical is where the choice actually
 * matters on a hero — a title a third of the way down and one just above the
 * fold are different designs — while left / centre / right is how a page is
 * read and gains nothing from being cut finer. Fifths across a wide picture
 * are also hard to tell apart in a picker and hard to hit in a drag.
 *
 * Widening this is the only change needed: the renderer, the picker and the
 * drag all count off these two lists.
 */
export const ROWS = ['top', 'upper', 'middle', 'lower', 'bottom'] as const
export const COLUMNS = ['left', 'center', 'right'] as const

export type Row = (typeof ROWS)[number]
export type Column = (typeof COLUMNS)[number]

/** `top-left` … `bottom-right`. Stored as one string so one control sets both. */
export type Spot = `${Row}-${Column}`

export const SPOTS: Spot[] = ROWS.flatMap((r) => COLUMNS.map((c) => `${r}-${c}` as Spot))

/**
 * The hero as it has always looked: everything along the bottom, centred.
 * Changing this changes every site that has not chosen otherwise, so it is the
 * old layout on purpose.
 */
export const DEFAULT_SPOT: Spot = 'bottom-center'

/**
 * A stored value, or the default. Never throws and never trusts the input: a
 * spot reaches the renderer as a CSS class and a data attribute, so a
 * hand-edited row must not be able to put anything else there.
 */
export function spot(value: unknown): Spot {
  return typeof value === 'string' && (SPOTS as string[]).includes(value)
    ? (value as Spot)
    : DEFAULT_SPOT
}

export function rowOf(s: Spot): Row {
  return s.split('-')[0] as Row
}

export function columnOf(s: Spot): Column {
  return s.split('-')[1] as Column
}

/** Human wording, for the picker's tooltip and for anything that has to say it. */
export function describeSpot(s: Spot): string {
  const r = rowOf(s)
  const c = columnOf(s)
  const row = { top: 'Top', upper: 'Upper', middle: 'Middle', lower: 'Lower', bottom: 'Bottom' }[r]
  const col = c === 'center' ? 'centre' : c
  return `${row} ${col}`
}

/**
 * The three pieces of hero copy that can be placed, in the order they stack
 * when they share a place. The key is the setting; the label is what the
 * panel and the drag handle call it.
 */
export const PLACEABLE = [
  { key: 'title_spot', label: 'Title', field: 'title' },
  { key: 'subtitle_spot', label: 'Subtitle', field: 'subtitle' },
  { key: 'cta_spot', label: 'Button', field: 'cta_label' },
] as const

export type PlaceableKey = (typeof PLACEABLE)[number]['key']

/**
 * WHERE IT SITS ON EACH SIZE
 * ══════════════════════════
 *
 * A phone is a different picture from the same photograph — a wide landscape
 * becomes a tall crop, and copy that sat neatly in the lower left of one can
 * be over somebody's face in the other. So each placement can differ by size,
 * on the same terms as typography: the phone follows the desktop until it is
 * given a place of its own, and moving it on the phone never moves it on the
 * desktop.
 *
 * Stored as `<key>` for desktop and `<key>_mobile` for the phone (deviceKey),
 * so every row already in the database is a desktop row.
 */
export type SpotPair = {
  desktop: Spot
  /** Null while the phone is still following the desktop. */
  mobile: Spot | null
  /** What the phone actually resolves to. */
  effectiveMobile: Spot
  /** True when the two differ — the one case the renderer has to work for. */
  differs: boolean
}

export function spotPair(settings: Record<string, unknown>, key: string): SpotPair {
  const desktop = spot(settings[key])
  const raw = settings[deviceKey(key, 'mobile')]
  // `spot()` would turn anything unrecognised into the default, which would
  // make "following the desktop" indistinguishable from "deliberately set to
  // bottom-centre". Following has to stay absent to stay following.
  const mobile =
    typeof raw === 'string' && (SPOTS as string[]).includes(raw) ? (raw as Spot) : null

  return {
    desktop,
    mobile,
    effectiveMobile: mobile ?? desktop,
    differs: mobile !== null && mobile !== desktop,
  }
}

/**
 * WHICH SIZES AN ELEMENT IS DRAWN FOR, IN A GIVEN PLACE.
 *
 * The renderer's whole problem in one function. An element lives inside the
 * container for its place — that is what makes two elements sharing a place
 * stack instead of overlapping — and CSS cannot move a node between
 * containers. So an element whose phone place differs from its desktop one
 * has to be drawn in BOTH containers, with one hidden at each width.
 *
 * Drawing it twice is not free: it is the same words twice in the markup, read
 * twice by anything that reads markup. So it only happens where somebody has
 * actually asked the two to differ, which is rare and never the default. The
 * common case — and every site that has never touched this — draws each
 * element exactly once, marked `both`, with nothing to hide.
 *
 * Visibility folds into the same answer rather than being a second mechanism:
 * a piece of text shown only on the phone is simply not drawn for the desktop.
 * One attribute then says everything about which widths a node is for.
 *
 * Returns null for a container this element has no business being in, so a
 * renderer can map over the places and ask this each time.
 */
export type DrawnAt = 'both' | 'desktop' | 'mobile'

export function drawnAt(
  pair: SpotPair,
  here: Spot,
  sizes: readonly ('desktop' | 'mobile')[] = ['desktop', 'mobile']
): DrawnAt | null {
  const wanted = sizes.filter((size) =>
    (size === 'mobile' ? pair.effectiveMobile : pair.desktop) === here
  )
  if (wanted.length === 0) return null
  // Both sizes want this container AND both sizes show it: one node, no
  // hiding, nothing duplicated.
  if (wanted.length === 2) return 'both'
  return wanted[0]
}
