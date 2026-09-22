import { createClient } from '@/lib/supabase/server'
import { currentEditor } from '@/lib/auth'
import { getSiteSettings } from '@/lib/site'
import { loadPageSections } from '@/lib/sections/load'
import { sanitizeCustomPages, sitePages } from '@/lib/sections/pages'
import { sanitizeSeoMap } from '@/lib/seo'
import { sanitizeMenu } from '@/lib/menu'
import { chromeFrom, sanitizeChrome } from '@/lib/chrome'
import type { DraftSnapshot } from '@/lib/drafts/steps'
import type { DraftSection } from '@/lib/drafts/store'

/**
 * VERSION HISTORY
 * ═══════════════
 *
 * After every Publish, the whole live site is kept as a version:
 *   - every page's sections;
 *   - the style;
 *   - search settings;
 *   - the photographer's own pages and the menu;
 *   - the header and footer.
 *
 * The very first time, the site as it was BEFORE that publish is kept too, as
 * the starting point.
 *
 * A version has the same shape as the draft (DraftSnapshot), and that is the
 * design. Restoring one does not touch the live site: it becomes the DRAFT, to
 * be looked at in the editor and published, or undone, like any other change.
 * There is no second, riskier path that writes to the live tables.
 *
 * Best effort on the way in: if a version cannot be kept (the table is not
 * there yet), Publish still happens. The older undo point in
 * site_template_history is still written first, as before, and that one DOES
 * block a publish when it fails.
 */

export type VersionRow = {
  id: string
  kind: 'publish' | 'baseline'
  note: string | null
  createdAt: string
}

const KEEP = 60
const MISSING_HINT = 'Run db/migrations/2026-09-22_versions_and_review.sql in Supabase.'

/** The live site, whole, in the draft's shape. */
export async function liveSnapshot(): Promise<DraftSnapshot> {
  const settings = await getSiteSettings()
  const custom = sanitizeCustomPages(settings.custom_pages)

  const pages: Record<string, DraftSection[]> = {}
  for (const page of sitePages(custom)) {
    const { sections } = await loadPageSections(page.key)
    pages[page.key] = sections.map((s, position) => ({
      id: s.id,
      type: s.type,
      position,
      visible: s.visible,
      version: s.def.version,
      settings: s.settings,
    }))
  }

  return {
    pages,
    global_styles: settings.global_styles ?? {},
    type_styles: settings.type_styles ?? {},
    page_seo: sanitizeSeoMap(settings.page_seo),
    custom_pages: custom,
    menu: sanitizeMenu(settings.menu),
    chrome: sanitizeChrome(chromeFrom(settings)),
  }
}

/** Keeps the live site as a version, and trims the oldest past KEEP. */
export async function recordVersion(kind: VersionRow['kind'], note: string): Promise<void> {
  const editor = await currentEditor()
  if (!editor) return

  try {
    const supabase = await createClient()
    const snapshot = await liveSnapshot()

    const { error } = await supabase.from('site_versions').insert({
      tenant_id: editor.tenantId,
      kind,
      note,
      snapshot,
      created_by: editor.userId,
    })
    if (error) throw new Error(error.message)

    const { data: old } = await supabase
      .from('site_versions')
      .select('id')
      .eq('tenant_id', editor.tenantId)
      .order('created_at', { ascending: false })
      .range(KEEP, KEEP + 200)
    if (old?.length) {
      await supabase.from('site_versions').delete().in('id', old.map((r) => r.id as string))
    }
  } catch (e) {
    console.warn(`[versions] ${e instanceof Error ? e.message : e} — ${MISSING_HINT}`)
  }
}

/** Whether any version has been kept yet — the first publish keeps a baseline. */
export async function hasVersions(): Promise<boolean> {
  const editor = await currentEditor()
  if (!editor) return true
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('site_versions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', editor.tenantId)
  // Unknown (no table) counts as "yes", so nothing tries to write a baseline.
  return error ? true : (count ?? 0) > 0
}

/** The kept versions, newest first, without their (large) snapshots. */
export async function listVersions(): Promise<{ versions: VersionRow[]; missing: boolean }> {
  const editor = await currentEditor()
  if (!editor) return { versions: [], missing: false }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('site_versions')
    .select('id, kind, note, created_at')
    .eq('tenant_id', editor.tenantId)
    .order('created_at', { ascending: false })
    .limit(KEEP)

  if (error) return { versions: [], missing: true }
  return {
    versions: (data ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as VersionRow['kind'],
      note: (r.note as string) ?? null,
      createdAt: r.created_at as string,
    })),
    missing: false,
  }
}

/** One version's snapshot, cleaned, or null. */
export async function readVersion(id: string): Promise<{ snapshot: DraftSnapshot; createdAt: string } | null> {
  const editor = await currentEditor()
  if (!editor) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('site_versions')
    .select('snapshot, created_at')
    .eq('tenant_id', editor.tenantId)
    .eq('id', id)
    .maybeSingle()
  if (!data) return null

  const raw = (data.snapshot ?? {}) as Record<string, unknown>
  return {
    createdAt: data.created_at as string,
    snapshot: {
      pages: (raw.pages ?? {}) as Record<string, DraftSection[]>,
      global_styles: (raw.global_styles ?? null) as DraftSnapshot['global_styles'],
      type_styles: (raw.type_styles ?? null) as DraftSnapshot['type_styles'],
      page_seo: raw.page_seo ? sanitizeSeoMap(raw.page_seo) : null,
      custom_pages: Array.isArray(raw.custom_pages) ? sanitizeCustomPages(raw.custom_pages) : null,
      menu: sanitizeMenu(raw.menu),
      chrome: raw.chrome ? sanitizeChrome(raw.chrome) : null,
    },
  }
}
