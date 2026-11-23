import { sameChoice, type PhotoChoice } from '@/lib/sections/image-bundle'

/**
 * WHAT A PHOTOGRAPH FIELD SHOWS WHILE ITS SAVE IS ON THE WAY
 * ═════════════════════════════════════════════════════════
 *
 * components/canvas/ImageField.tsx shows a choice the moment it is made, while
 * the Inspector's debounced save is still travelling; the section's stored
 * settings (its props) catch up a moment later. Pure, so the suite can drive
 * it through every order of events without a browser.
 *
 *   own      what the field shows as this size's own choice
 *   seen     the stored bundle the field last OBSERVED in its props — moved
 *            only when the props move, never by a choice
 *   pending  the bundle the field last wrote, until the props show it
 *
 * When the props change:
 *   · they now show the pending bundle   → the save landed: settle on it
 *   · something is pending, props differ → an earlier save of ours (or another
 *                                          field's) landed first: keep showing
 *                                          the choice still in flight
 *   · nothing is pending                 → somebody else changed it (Undo,
 *                                          Discard, a restore): show that
 *
 * Undo and Discard also rebuild the panel (Canvas keys it on `revision`), so a
 * field never carries a pending choice across one.
 */

export type FieldView = { own: PhotoChoice | null; seen: string; pending: string | null }

export const keyOf = (c: PhotoChoice | null) => JSON.stringify(c)

export const initialView = (stored: PhotoChoice | null): FieldView => ({ own: stored, seen: keyOf(stored), pending: null })

/** The props say `stored`. Returns the same object when nothing changes. */
export function observe(v: FieldView, stored: PhotoChoice | null): FieldView {
  const key = keyOf(stored)
  if (key === v.seen) return v
  if (v.pending === null) return { own: stored, seen: key, pending: null }
  if (key === v.pending) return { own: stored, seen: key, pending: null }
  return { ...v, seen: key }
}

/** A choice was made and sent. Null when it changes nothing (no save is needed). */
export function choose(v: FieldView, next: PhotoChoice | null): FieldView | null {
  if (sameChoice(v.own, next)) return null
  const key = keyOf(next)
  // Back to what the props already show: there is nothing left to wait for
  // (the props may never move again, so a pending marker would outlive it).
  return { own: next, seen: v.seen, pending: key === v.seen ? null : key }
}
