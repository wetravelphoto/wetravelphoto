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
