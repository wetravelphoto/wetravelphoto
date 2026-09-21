import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { legacyHomeSections } from '@/lib/sections/legacy'
import { readDraft, writeDraftPage } from '@/lib/drafts/store'
import type { SectionSettings } from '@/lib/sections/registry'

/**
 * The contact page's copy, carried into the homepage's contact section.
 *
 * The /contact form writes the contact_* columns on site_settings, and the
 * homepage's contact section is drawn from the same words. Once the homepage
 * reads from page_sections, something has to carry an edit made on the contact
 * page across — this is that something.
 *
 * It used to live in app/actions/sections.ts as a server action that re-merged
 * EVERY section from the columns. Two changes on the way here:
 *
 *   · It is a library function, not an action. Only the contact page's own
 *     action calls it, after that action has checked who is asking. As an
 *     exported action it was a public endpoint that nothing in the UI used.
 *
 *   · It touches the contact section and nothing else. Re-merging the hero or
 *     the intro from the columns was only ever right while the old homepage form
 *     was writing those columns; with that form gone, the columns for those
 *     sections are a mirror of the rows, never the other way round.
 *
 * AND THE DRAFT. If the canvas has a draft open, it holds its own copy of the
 * homepage — and Publish replaces the live rows with that copy wholesale. An
 * edit on the contact page that reached only the live rows would be quietly
 * undone by the next Publish, and then mirrored back over the columns too. So
 * the same words go into the draft's copy as well.
 */
export async function syncContactSection(page = 'home'): Promise<void> {
  const settings = await getSiteSettings()
  const source = legacyHomeSections(settings).find((row) => row.type === 'contact')
  if (!source) return

  const merge = (current: unknown): SectionSettings => ({
    // Merged, not replaced: a setting with no column behind it lives only in
    // the section row, and the contact page knows nothing about it.
    ...((current ?? {}) as SectionSettings),
    ...source.settings,
  })

  // ── Live rows ──
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('page_sections')
    .select('id, settings')
    .eq('page', page)
    .eq('type', 'contact')

  // No rows (not materialized yet, or no table): the homepage still renders
  // from the columns that were just written, so there is nothing to carry.
  if (!error && data && data.length > 0) {
    await Promise.all(
      data.map((row) =>
        supabase
          .from('page_sections')
          .update({
            settings: merge(row.settings),
            visible: source.visible,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
      )
    )
  }

  // ── The open draft, if there is one ──
  const { draft } = await readDraft()
  const sections = draft?.pages[page]
  if (!draft || !sections || !sections.some((s) => s.type === 'contact')) return

  await writeDraftPage(
    page,
    sections.map((s) =>
      s.type === 'contact' ? { ...s, settings: merge(s.settings), visible: source.visible } : s
    ),
    draft
  )
}
