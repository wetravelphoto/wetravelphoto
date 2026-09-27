import { DEVICES, type Device } from '@/lib/sections/devices'

/**
 * WHETHER A PIECE OF TEXT IS DRAWN AT ALL, PER SIZE
 * ═════════════════════════════════════════════════
 *
 * A hero button that makes sense on a desktop can be the third thing over a
 * photograph on a phone; a short line that only earns its place on a small
 * screen has nowhere to go on a wide one. So each piece of text can say which
 * sizes it appears on.
 *
 * ── Why this is not "hidden" ────────────────────────────────────────────────
 *
 * There is no "nowhere". Text that should never appear is text that should be
 * deleted, and an editor that lets you hide something everywhere gives you a
 * site with invisible content in it and no way to notice. The three states are
 * all real answers to "where does this belong".
 *
 * ── Why it is display, not visibility ───────────────────────────────────────
 *
 * A hidden element is REMOVED, not merely invisible. `visibility: hidden` and
 * `opacity: 0` both leave the element in the layout and in the accessibility
 * tree, so a screen reader still reads out a button nobody can see and a
 * search engine still indexes the words. Where possible it is not rendered at
 * all; where CSS has to do it — because the same markup serves both sizes —
 * it is `display: none`, which takes it out of both.
 */

export const SHOWN = ['all', 'desktop', 'mobile'] as const
export type Shown = (typeof SHOWN)[number]

export const DEFAULT_SHOWN: Shown = 'all'

export const SHOWN_LABEL: Record<Shown, string> = {
  all: 'Everywhere',
  desktop: 'Desktop only',
  mobile: 'Phone only',
}

/** A key must look like a field name — it is read back against one. */
const FIELD_KEY = /^[a-z][a-z0-9_]*$/

export type ShownBag = Record<string, Shown>

export function sanitizeShown(input: unknown): ShownBag {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: ShownBag = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!FIELD_KEY.test(key)) continue
    if (typeof value !== 'string' || !(SHOWN as readonly string[]).includes(value)) continue
    // `all` is the default, so storing it is storing nothing. Keeping the bag
    // empty until something actually differs is what makes "has this been
    // touched" answerable without comparing against a default.
    if (value === DEFAULT_SHOWN) continue
    out[key] = value as Shown
  }
  return out
}

/** Where a section keeps them: `settings.shown`, keyed by the field's name. */
export function shownBag(settings: Record<string, unknown>): ShownBag {
  return sanitizeShown(settings.shown)
}

export function shownFor(settings: Record<string, unknown>, field: string): Shown {
  return shownBag(settings)[field] ?? DEFAULT_SHOWN
}

/** The sizes a piece of text appears on. */
export function sizesFor(shown: Shown): readonly Device[] {
  return shown === 'all' ? DEVICES : [shown as Device]
}

export function withShown(bag: ShownBag, field: string, next: Shown): ShownBag {
  const out = { ...bag }
  if (next === DEFAULT_SHOWN) delete out[field]
  else out[field] = next
  return out
}
