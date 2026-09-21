import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { patchSiteSettings } from '@/lib/site-patch'
import { MIRRORED, legacyColumns, legacyPageSections } from '@/lib/sections/legacy'
import { resolveSettings, type SectionSettings } from '@/lib/sections/registry'
import type { StoredSection } from '@/lib/sections/load'

/**
 * Writes against page_sections, shared by the section actions and the
 * template engine. Plain functions rather than server actions: an action is a
 * public endpoint, and none of this should be callable from a browser.
 */

/**
 * Turns the synthetic `legacy-<type>` rows into real ones, writing the six
 * current sections the first time anything is edited.
 *
 * Nothing is written until the editor is used, so a site that never opens it
 * keeps rendering from site_settings and this table stays empty.
 *
 * Returns the mapping from synthetic id to real id.
 */
export async function materializeSections(page = 'home'): Promise<Map<string, string>> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('page_sections')
    .select('id, type')
    .eq('page', page)

  if (error) {
    throw new Error(
      'The page_sections table is missing — run db/migrations/2026-09-15_page_sections.sql ' +
        `in Supabase, then \`notify pgrst, 'reload schema'\`. (${error.message})`
    )
  }

  const rows = data ?? []

  if (rows.length === 0) {
    const settings = await getSiteSettings()

    const seeded = legacyPageSections(page, settings).map((row) => ({
      page,
      type: row.type,
      position: row.position,
      visible: row.visible,
      version: row.version,
      settings: row.settings,
    }))

    const { data: inserted, error: insertError } = await supabase
      .from('page_sections')
      .insert(seeded)
      .select('id, type')

    if (insertError) throw new Error(insertError.message)

    return new Map((inserted ?? []).map((r) => [`legacy-${r.type}`, r.id as string]))
  }

  return new Map(rows.map((r) => [`legacy-${r.type}`, r.id as string]))
}

/** Reads a page's rows as stored, after materializing. */
export async function readSections(page = 'home'): Promise<StoredSection[]> {
  await materializeSections(page)
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('page_sections')
    .select('id, type, position, visible, version, settings')
    .eq('page', page)
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as StoredSection[]
}

/**
 * Replaces a page's sections wholesale. Used by the template engine when
 * applying a look and when restoring a previous one.
 *
 * Delete-then-insert rather than a diff: a look changes order, membership and
 * settings at once, and the caller has already written the previous state to
 * history, so there is nothing to protect by being clever here.
 */
export async function replaceSections(
  page: string,
  sections: { type: string; visible: boolean; version: number; settings: SectionSettings }[]
): Promise<void> {
  const supabase = await createClient()

  const { error: deleteError } = await supabase.from('page_sections').delete().eq('page', page)
  if (deleteError) throw new Error(deleteError.message)

  if (sections.length === 0) return

  const { error } = await supabase.from('page_sections').insert(
    sections.map((s, position) => ({
      page,
      type: s.type,
      position,
      visible: s.visible,
      version: s.version,
      settings: s.settings,
    }))
  )

  if (error) throw new Error(error.message)
}

// ── The legacy mirror ────────────────────────────────────────────────────────
// Transition shim. See the note in lib/sections/legacy.ts.

export async function mirrorSection(
  type: string,
  settings: SectionSettings,
  visible: boolean
): Promise<void> {
  const columns = legacyColumns(type, settings, visible)
  if (!columns) return

  try {
    await patchSiteSettings(columns)
  } catch (e) {
    // Mirroring is a convenience, not the save. The section row is already
    // written and the live page reads that.
    console.warn(`[sections] could not mirror ${type} to site_settings:`, e)
  }
}

export async function mirrorSectionById(id: string): Promise<void> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('page_sections')
    .select('page, type, visible, version, settings')
    .eq('id', id)
    .maybeSingle()

  if (!data) return
  if (!(MIRRORED[data.page as string] ?? []).includes(data.type as string)) return

  const resolved = resolveSettings(
    data.type as string,
    data.settings as SectionSettings,
    (data.version as number) ?? 1
  )

  if (resolved) await mirrorSection(data.type as string, resolved, data.visible !== false)
}

/** Re-mirrors a whole page, after a change that touched every section. */
export async function mirrorPage(page = 'home'): Promise<void> {
  const supabase = await createClient()

  // Only the sections the old columns described on this page — see MIRRORED.
  const mirrored = new Set(MIRRORED[page] ?? [])
  if (mirrored.size === 0) return

  const { data } = await supabase
    .from('page_sections')
    .select('type, visible, version, settings')
    .eq('page', page)
    .order('position', { ascending: true })

  for (const row of data ?? []) {
    if (!mirrored.has(row.type as string)) continue
    const resolved = resolveSettings(
      row.type as string,
      row.settings as SectionSettings,
      (row.version as number) ?? 1
    )
    if (resolved) await mirrorSection(row.type as string, resolved, row.visible !== false)
  }
}
