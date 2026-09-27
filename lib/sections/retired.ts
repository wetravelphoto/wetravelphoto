import type { SectionSettings } from '@/lib/sections/registry'

/**
 * Section types that have been folded into another or split in two, and how to
 * read a row written under the old name.
 *
 * Rows are converted as they are READ, never rewritten in place: the database
 * keeps what was written, the page draws the new type, and the next Publish of
 * that page stores the new type naturally. So an old deploy reading the same
 * rows still finds what it expects, and there is no migration to run first.
 */
const RETIRED: Record<string, (settings: SectionSettings) => { type: string; settings: SectionSettings }> = {
  // 2026-09-21: the Contact page's own "Contact form" became the Contact
  // section's centred layout, so a site has one contact section with two looks
  // rather than two sections that do the same job.
  'contact-form': (s) => ({
    type: 'contact',
    settings: { ...s, layout: 'centered', heading: s.heading ?? 'Contact' },
  }),

  /*
   * 2026-09-27: the Hero's "What the hero shows" switch became two blocks.
   *
   * A row written before that carries `mode`, and a row with `mode: 'stories'`
   * is a sequence hero written under the standing hero's name — so it is READ
   * as one. Everything it needs travels with it: the featured ids, the
   * per-story titles and crops, the overlay copy, its places and its
   * typography are all keys the new type also declares.
   *
   * `backdrop` is set from what the row actually has rather than left to the
   * default, because a standing hero written before backdrops existed always
   * meant a photograph, and defaulting would be right by luck rather than by
   * reading what is there.
   */
  hero: (s) =>
    s.mode === 'stories'
      ? { type: 'hero-sequence', settings: { ...s, source: 'stories' } }
      : { type: 'hero', settings: { backdrop: 'image', ...s } },
}

/**
 * A stored row, with a retired type read as the type that replaced it.
 *
 * Must be idempotent: a row already written under the new name passes through
 * here again on every read, and a conversion that changed something the second
 * time would quietly rewrite settings on every page load.
 */
export function normalizeRow<T extends { type: string; settings: SectionSettings }>(row: T): T {
  const convert = RETIRED[row.type]
  if (!convert) return row
  const next = convert(row.settings ?? {})
  if (next.type === row.type && next.settings === row.settings) return row
  return { ...row, type: next.type, settings: next.settings }
}
