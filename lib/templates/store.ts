import { createClient } from '@/lib/supabase/server'
import { currentEditor } from '@/lib/auth'
import { getSiteSettings } from '@/lib/site'
import { loadPageSections } from '@/lib/sections/load'
import {
  EMPTY_MANIFEST,
  extractManifest,
  type LiveSection,
  type TemplateManifest,
} from '@/lib/templates/manifest'

export type LookRow = {
  id: string
  slug: string
  name: string
  blurb: string | null
  version: number
  status: 'draft' | 'published' | 'retired'
  origin: 'system' | 'tenant'
  tier: string | null
  manifest: TemplateManifest
  preview_path: string | null
  sort_order: number
  published_at: string | null
}

export type SiteLook = {
  /** Null when this site has never adopted one. */
  look: LookRow | null
  /** The version this site is on, which may be behind `look.version`. */
  version: number
  adoptedAt: string | null
  /** A newer version of the same look has been published. */
  updateAvailable: boolean
  /** The manifest as it was applied, not as the look reads today. */
  snapshot: TemplateManifest | null
}

export type HistoryRow = {
  id: string
  action: 'apply' | 'update' | 'revert'
  template_slug: string | null
  template_name: string | null
  version: number | null
  created_at: string
  note: string | null
}

/** Tables not migrated yet. The Design page says so instead of erroring. */
export type MaybeMissing<T> = T & { missing: boolean }

const MISSING_HINT =
  'Run db/migrations/2026-09-15_templates.sql in Supabase, then ' +
  "`notify pgrst, 'reload schema'`."

export async function listLooks(): Promise<MaybeMissing<{ looks: LookRow[] }>> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .neq('status', 'draft')
    .order('sort_order', { ascending: true })

  if (error) {
    console.warn(`[looks] ${error.message} — ${MISSING_HINT}`)
    return { looks: [], missing: true }
  }

  return { looks: (data ?? []) as LookRow[], missing: false }
}

export async function currentLook(): Promise<MaybeMissing<SiteLook>> {
  const supabase = await createClient()

  const editor = await currentEditor()

  const { data, error } = await supabase
    .from('site_template')
    .select('template_id, version, snapshot, adopted_at')
    .eq('tenant_id', editor?.tenantId ?? '')
    .maybeSingle()

  if (error) {
    console.warn(`[looks] ${error.message} — ${MISSING_HINT}`)
    return {
      look: null,
      version: 0,
      adoptedAt: null,
      updateAvailable: false,
      snapshot: null,
      missing: true,
    }
  }

  if (!data?.template_id) {
    return {
      look: null,
      version: 0,
      adoptedAt: null,
      updateAvailable: false,
      snapshot: null,
      missing: false,
    }
  }

  const { data: look } = await supabase
    .from('templates')
    .select('*')
    .eq('id', data.template_id)
    .maybeSingle()

  const row = (look ?? null) as LookRow | null

  return {
    look: row,
    version: (data.version as number) ?? 0,
    adoptedAt: (data.adopted_at as string) ?? null,
    // The gap between what was taken and what has since been published. This
    // is the whole reason a site stores a version rather than following one.
    updateAvailable: !!row && row.version > ((data.version as number) ?? 0),
    snapshot: (data.snapshot as TemplateManifest) ?? null,
    missing: false,
  }
}

export async function lookHistory(limit = 20): Promise<HistoryRow[]> {
  const supabase = await createClient()

  const editor = await currentEditor()

  const { data, error } = await supabase
    .from('site_template_history')
    .select('id, action, template_slug, template_name, version, created_at, note')
    .eq('tenant_id', editor?.tenantId ?? '')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return []
  return (data ?? []) as HistoryRow[]
}

/**
 * A published version's manifest. This is what makes "stay on v2" real: the
 * look row moves on, the archived version does not.
 */
export async function manifestForVersion(
  templateId: string,
  version: number
): Promise<TemplateManifest | null> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('template_versions')
    .select('manifest')
    .eq('template_id', templateId)
    .eq('version', version)
    .maybeSingle()

  return (data?.manifest as TemplateManifest) ?? null
}

/**
 * The live page, resolved, as the manifest functions expect it.
 *
 * READ ONLY — deliberately goes through loadPageSections rather than
 * materializing, so the Design page can show what an update would do without
 * writing anything. A site that has never opened the editor is described here
 * by its site_settings exactly as it is drawn, which is also what gets stored
 * as the undo point.
 */
export async function liveSections(page = 'home'): Promise<LiveSection[]> {
  const { sections } = await loadPageSections(page)

  return sections.map((s) => ({
    type: s.type,
    visible: s.visible,
    version: s.def.version,
    settings: s.settings,
  }))
}

/** The current design of this site, as a manifest. */
export async function liveManifest(pages = ['home']): Promise<TemplateManifest> {
  const settings = await getSiteSettings()

  const live: Record<string, LiveSection[]> = {}
  for (const page of pages) live[page] = await liveSections(page)

  return extractManifest(live, {
    type_styles: (settings.type_styles ?? {}) as Record<string, Record<string, unknown>>,
    tokens: (settings.global_styles ?? {}) as Record<string, unknown>,
  })
}

export { EMPTY_MANIFEST }
