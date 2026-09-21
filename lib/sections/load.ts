import { createClient } from '@/lib/supabase/server'
import { getSiteSettings, type SiteSettings } from '@/lib/site'
import { legacyPageSections } from '@/lib/sections/legacy'
import {
  resolveSettings,
  sectionDef,
  type SectionDef,
  type SectionNeed,
  type SectionSettings,
} from '@/lib/sections/registry'

/** A row as it sits in the database, or as the legacy adapter fakes one. */
export type StoredSection = {
  id: string
  type: string
  position: number
  visible: boolean
  version: number
  settings: SectionSettings
}

/** A row with its type resolved and its settings filled from defaults. */
export type LoadedSection = {
  id: string
  type: string
  position: number
  visible: boolean
  def: SectionDef
  settings: SectionSettings
  /** True when this came from site_settings because nothing is stored yet. */
  legacy: boolean
}

export type PageSections = {
  sections: LoadedSection[]
  settings: SiteSettings
  /** Nothing has been saved in the editor yet — still reading site_settings. */
  legacy: boolean
}

/**
 * Reads a page's sections.
 *
 * Three states, all of which must render the same page:
 *   · table missing   — migration not run yet → fall back to site_settings
 *   · table empty     — migration run, nothing edited → fall back
 *   · table populated — the editor has been used → read it
 *
 * A row whose type this release does not know is dropped rather than thrown,
 * so a database written by a newer deploy never white-screens an older one.
 */
export async function loadPageSections(page = 'home'): Promise<PageSections> {
  const settings = await getSiteSettings()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('page_sections')
    .select('id, type, position, visible, version, settings')
    .eq('page', page)
    .order('position', { ascending: true })

  if (error) {
    // Missing table reads as an error from PostgREST. Anything else is worth
    // knowing about, but neither is worth a broken homepage.
    console.warn(`[sections] falling back to site_settings: ${error.message}`)
  }

  const stored = (data ?? []) as StoredSection[]
  const legacy = stored.length === 0
  const rows = legacy ? legacyPageSections(page, settings) : stored

  return { sections: resolveRows(rows, legacy), settings, legacy }
}

/**
 * Stored rows → drawable sections: type looked up in the registry, settings
 * filled from that type's defaults, unknown types dropped.
 *
 * Exported because the draft layer resolves its own rows the same way. If the
 * preview resolved settings by any other route it could show something the
 * live page would not draw, and a preview that can disagree with the page is
 * worse than no preview.
 */
export function resolveRows(rows: StoredSection[], legacy = false): LoadedSection[] {
  return rows
    .map((row) => {
      const def = sectionDef(row.type)
      const resolved = resolveSettings(row.type, row.settings, row.version ?? 1)
      if (!def || !resolved) return null

      return {
        id: row.id,
        type: row.type,
        position: row.position,
        visible: row.visible !== false,
        def,
        settings: resolved,
        legacy,
      } satisfies LoadedSection
    })
    .filter((s): s is LoadedSection => s !== null)
}

/**
 * What the visible sections between them need fetched.
 *
 * The old homepage queried every published post and every public album on
 * every request whether or not those sections were switched on. Now a page
 * of nothing but a hero and a contact block makes no content queries at all.
 */
export function neededData(sections: LoadedSection[]): Set<SectionNeed> {
  const needs = new Set<SectionNeed>()

  for (const section of sections) {
    if (!section.visible) continue
    for (const need of section.def.needs ?? []) needs.add(need)
  }

  return needs
}
