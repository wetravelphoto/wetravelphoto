'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getSiteSettings } from '@/lib/site'
import { legacyHomeSections } from '@/lib/sections/legacy'
import {
  materializeSections,
  mirrorSection,
  mirrorSectionById,
} from '@/lib/sections/store'
import { resolveSettings, sectionDef, type Field, type SectionSettings } from '@/lib/sections/registry'

const PATHS = ['/', '/admin/pages/home', '/admin/design']

function done() {
  PATHS.forEach((p) => revalidatePath(p))
}

const realId = (id: string, ids: Map<string, string>) => ids.get(id) ?? id

// ── Order and visibility ─────────────────────────────────────────────────────

/**
 * Takes the whole order every time and rewrites positions 0..n. Cheaper to
 * reason about than move-up/move-down, and it is what a drag gives you.
 */
export async function reorderSections(page: string, orderedIds: string[]) {
  const ids = await materializeSections(page)
  const supabase = await createClient()

  await Promise.all(
    orderedIds.map((id, position) =>
      supabase
        .from('page_sections')
        .update({ position, updated_at: new Date().toISOString() })
        .eq('id', realId(id, ids))
    )
  )

  done()
}

export async function setSectionVisible(page: string, id: string, visible: boolean) {
  const ids = await materializeSections(page)
  const supabase = await createClient()

  const { error } = await supabase
    .from('page_sections')
    .update({ visible, updated_at: new Date().toISOString() })
    .eq('id', realId(id, ids))

  if (error) throw new Error(error.message)

  await mirrorSectionById(realId(id, ids))
  done()
}

// ── Adding and removing ──────────────────────────────────────────────────────

export async function addSection(page: string, type: string, afterPosition?: number) {
  const def = sectionDef(type)
  if (!def) throw new Error(`Unknown section type: ${type}`)

  await materializeSections(page)
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('page_sections')
    .select('id, type, position')
    .eq('page', page)
    .order('position', { ascending: true })

  const rows = existing ?? []

  if (def.singleton && rows.some((r) => r.type === type)) {
    throw new Error(`${def.label} can only appear once on a page.`)
  }

  const at = afterPosition === undefined ? rows.length : afterPosition + 1

  // Push everything at or after the insertion point down one.
  await Promise.all(
    rows
      .filter((r) => r.position >= at)
      .map((r) =>
        supabase
          .from('page_sections')
          .update({ position: r.position + 1 })
          .eq('id', r.id)
      )
  )

  const { error } = await supabase.from('page_sections').insert({
    page,
    type,
    position: at,
    visible: true,
    version: def.version,
    // Empty, not a copy of the defaults: defaults are merged in at read time,
    // so a row stores only what has actually been changed from them.
    settings: {},
  })

  if (error) throw new Error(error.message)
  done()
}

export async function removeSection(page: string, id: string) {
  const ids = await materializeSections(page)
  const supabase = await createClient()
  const target = realId(id, ids)

  const { data: row } = await supabase
    .from('page_sections')
    .select('type')
    .eq('id', target)
    .maybeSingle()

  const def = row ? sectionDef(row.type as string) : null
  if (def?.permanent) {
    throw new Error(`${def.label} can be hidden but not removed.`)
  }

  const { error } = await supabase.from('page_sections').delete().eq('id', target)
  if (error) throw new Error(error.message)

  // Close the gap so positions stay 0..n.
  const { data: rest } = await supabase
    .from('page_sections')
    .select('id')
    .eq('page', page)
    .order('position', { ascending: true })

  await Promise.all(
    (rest ?? []).map((r, position) =>
      supabase.from('page_sections').update({ position }).eq('id', r.id)
    )
  )

  done()
}

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * Reads one field back out of a submitted form, using the kind declared in the
 * registry. This is why the field schema exists: a new setting needs no new
 * parsing code, and no section can quietly save a string into a number.
 *
 * A field the panel did not draw — hidden by its `when`, or a custom editor —
 * is left exactly as it was. The panel marks what it drew with a hidden
 * `__present_<key>` input, because an unchecked checkbox is indistinguishable
 * from a field that was never on the page.
 */
function readField(field: Field, formData: FormData, current: SectionSettings): unknown {
  if (!formData.has(`__present_${field.key}`)) return current[field.key]

  switch (field.kind) {
    case 'toggle':
      return formData.get(field.key) === 'on'

    case 'number': {
      const raw = Number((formData.get(field.key) as string) ?? '')
      if (!Number.isFinite(raw)) return current[field.key]
      const min = field.min ?? -Infinity
      const max = field.max ?? Infinity
      return Math.min(max, Math.max(min, raw))
    }

    case 'custom':
      return current[field.key]

    default: {
      const raw = ((formData.get(field.key) as string) ?? '').trim()
      return raw === '' ? null : raw
    }
  }
}

export async function updateSectionSettings(page: string, id: string, formData: FormData) {
  const ids = await materializeSections(page)
  const supabase = await createClient()
  const target = realId(id, ids)

  const { data: row, error: readError } = await supabase
    .from('page_sections')
    .select('type, settings, visible')
    .eq('id', target)
    .maybeSingle()

  if (readError) throw new Error(readError.message)
  if (!row) throw new Error('That section is no longer on the page.')

  const def = sectionDef(row.type as string)
  if (!def) throw new Error(`Unknown section type: ${row.type}`)

  const current = (row.settings ?? {}) as SectionSettings
  const next: SectionSettings = { ...current }

  for (const field of def.fields) {
    // A custom field is edited elsewhere; the generic panel never draws it and
    // this must not blank it.
    if (field.kind === 'custom') continue
    next[field.key] = readField(field, formData, current)
  }

  const { error } = await supabase
    .from('page_sections')
    .update({
      settings: next,
      // Saving through this release stamps this release's schema version.
      version: def.version,
      updated_at: new Date().toISOString(),
    })
    .eq('id', target)

  if (error) throw new Error(error.message)

  const resolved = resolveSettings(row.type as string, next, def.version)
  if (resolved) await mirrorSection(row.type as string, resolved, row.visible !== false)

  done()
}

/**
 * Pushes the site_settings columns into the section rows.
 *
 * The other half of the shim: called after the old homepage form saves, so a
 * page that has already been materialized picks up what was typed there.
 * Sections the old form knows nothing about are left alone.
 */
export async function syncSectionsFromSettings(page = 'home') {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('page_sections')
    .select('id, type, settings')
    .eq('page', page)

  // Not materialized yet (or no table): the page still renders from the
  // columns that were just written, so there is nothing to do.
  if (error || !data || data.length === 0) return

  const settings = await getSiteSettings()
  const byType = new Map(legacyHomeSections(settings).map((row) => [row.type, row]))

  await Promise.all(
    data.map((row) => {
      const source = byType.get(row.type as string)
      if (!source) return Promise.resolve()

      return supabase
        .from('page_sections')
        .update({
          // Merged, not replaced: settings with no column behind them — how
          // many galleries, the journal's link text — are only in the section
          // row, and the old form knows nothing about them.
          settings: { ...((row.settings ?? {}) as SectionSettings), ...source.settings },
          visible: source.visible,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
    })
  )

  done()
}
