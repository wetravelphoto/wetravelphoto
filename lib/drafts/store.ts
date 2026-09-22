import { createClient } from '@/lib/supabase/server'
import { currentUser } from '@/lib/auth'
import { getSiteSettings, type SiteSettings } from '@/lib/site'
import { patchSiteSettings } from '@/lib/site-patch'
import {
  loadPageSections,
  normalizeRow,
  resolveRows,
  type PageSections,
  type StoredSection,
} from '@/lib/sections/load'
import { replaceSections, mirrorPage } from '@/lib/sections/store'
import { recordHistory } from '@/lib/templates/history'
import { TOKENS_VERSION } from '@/lib/styles/tokens'
import { sanitizePageSeo, sanitizeSeoMap, type PageSeo, type PageSeoMap } from '@/lib/seo'
import { isPage, sanitizeCustomPages, type CustomPage } from '@/lib/sections/pages'
import { sanitizeMenu, type MenuItem } from '@/lib/menu'
import {
  clearSteps,
  describeChange,
  moveStep,
  pushStep,
  type DraftSnapshot,
  type StepResult,
} from '@/lib/drafts/steps'

/**
 * THE DRAFT LAYER
 * ═══════════════
 *
 * Everything the canvas edits lands here. The live site does not change until
 * Publish, and nothing in the public read path knows this file exists —
 * app/page.tsx calls loadPageSections() exactly as it did before.
 *
 * That separation is the design. The tempting alternative is a `status` column
 * on page_sections and a filter in every query, which puts the safety of a
 * photographer's live homepage in the hands of whoever writes the next query
 * and remembers the filter. Here the live path cannot see a draft even by
 * mistake, because it never asks.
 *
 * ONE DRAFT PER SITE. Two would mean deciding which is real.
 *
 * ── The lifecycle ──
 *   nothing        → no row. The canvas shows the live site.
 *   first edit     → ensureDraft() copies the live state in, then edits it.
 *   more edits     → writeDraftPage / writeDraftStyles patch the row.
 *   Publish        → undo point, then replaceSections + patchSiteSettings,
 *                    then the row is deleted. Back to nothing.
 *   Discard        → the row is deleted. Back to nothing.
 *
 * Every edit keeps the draft as it was as an Undo step first
 * (lib/drafts/steps.ts). Seeding a page does not: it adds nothing the live
 * site does not already show. Publish and Discard clear the steps.
 *
 * Publish deliberately reuses the same two write functions that applying a
 * look uses. There is one way for section rows to change and one way for
 * settings to change, whatever asked for it.
 */

export type DraftSection = StoredSection

/**
 * The two style halves are typed exactly as site_settings types them, so a
 * draft can be dropped straight onto a settings object. Widening them to
 * Record<string, unknown> here would have meant a cast at every use, and a
 * cast is how the wrong shape gets written.
 */
export type DraftGlobalStyles = SiteSettings['global_styles']
export type DraftTypeStyles = SiteSettings['type_styles']

export type SiteDraft = {
  /** Page slug → its ordered sections. Only pages that have been edited. */
  pages: Record<string, DraftSection[]>
  /** Null means this draft has not touched style — not that style is empty. */
  global_styles: DraftGlobalStyles | null
  type_styles: DraftTypeStyles | null
  /**
   * Search and sharing for EVERY page (lib/seo.ts), copied from the live
   * settings on the first change. Null: this draft has not touched it.
   */
  page_seo: PageSeoMap | null
  /**
   * The photographer's own pages (lib/sections/pages.ts), and the menu
   * (lib/menu.ts). Null: this draft has not touched them. A page created in the
   * editor exists only here until Publish.
   */
  custom_pages: CustomPage[] | null
  menu: MenuItem[] | null
  updatedAt: string | null
}

export type DraftState = {
  draft: SiteDraft | null
  /** The table is not there yet. The canvas says so instead of erroring. */
  missing: boolean
}

const MISSING_HINT =
  'Run db/migrations/2026-09-16_site_draft.sql in Supabase, then ' +
  "`notify pgrst, 'reload schema'`."

// ── Reading ──────────────────────────────────────────────────────────────────

export async function readDraft(): Promise<DraftState> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('site_draft')
    // '*' rather than a column list, so a column added by a newer migration
    // that has not been run yet reads as absent instead of failing the read —
    // which the canvas would show as "the draft table is missing".
    .select('*')
    .maybeSingle()

  if (error) {
    console.warn(`[draft] ${error.message} — ${MISSING_HINT}`)
    return { draft: null, missing: true }
  }

  if (!data) return { draft: null, missing: false }

  return {
    draft: {
      // Retired section types are read as their replacements here too, so a
      // draft written before a rename can still be edited: every canvas action
      // looks the row's type up in the registry.
      pages: Object.fromEntries(
        Object.entries((data.pages ?? {}) as Record<string, DraftSection[]>).map(([page, rows]) => [
          page,
          Array.isArray(rows) ? rows.map(normalizeRow) : [],
        ])
      ),
      global_styles: (data.global_styles ?? null) as DraftGlobalStyles | null,
      type_styles: (data.type_styles ?? null) as DraftTypeStyles | null,
      page_seo: data.page_seo ? sanitizeSeoMap(data.page_seo) : null,
      custom_pages: Array.isArray(data.custom_pages) ? sanitizeCustomPages(data.custom_pages) : null,
      menu: sanitizeMenu(data.menu),
      updatedAt: (data.updated_at as string) ?? null,
    },
    missing: false,
  }
}

/** Is there unpublished work, and on which pages. */
export async function draftStatus(): Promise<{
  hasDraft: boolean
  missing: boolean
  pages: string[]
  stylesTouched: boolean
  seoTouched: boolean
  siteTouched: boolean
  updatedAt: string | null
}> {
  const { draft, missing } = await readDraft()

  return {
    hasDraft: !!draft,
    missing,
    pages: draft ? Object.keys(draft.pages) : [],
    stylesTouched: !!draft && (draft.global_styles !== null || draft.type_styles !== null),
    seoTouched: !!draft && draft.page_seo !== null,
    siteTouched: !!draft && (draft.custom_pages !== null || draft.menu !== null),
    updatedAt: draft?.updatedAt ?? null,
  }
}

/**
 * A page as the canvas should draw it: the draft if there is one, the live
 * page if not.
 *
 * Returns the same shape as loadPageSections, so the preview route and the
 * public route hand identical data to identical components. The preview is
 * then honest by construction rather than by diligence.
 */
export async function loadDraftPage(page = 'home'): Promise<PageSections & { isDraft: boolean }> {
  const [{ draft }, live] = await Promise.all([readDraft(), loadPageSections(page)])
  if (!draft) return { ...live, isDraft: false }

  // Draft style and search settings sit on top of the live settings object,
  // so a draft that changed only the sections still renders in the site's
  // real colours — and a page whose sections are untouched still shows the
  // draft's colours and page settings.
  const settings: SiteSettings = {
    ...live.settings,
    ...(draft.global_styles !== null ? { global_styles: draft.global_styles } : {}),
    ...(draft.type_styles !== null ? { type_styles: draft.type_styles } : {}),
    ...(draft.page_seo !== null ? { page_seo: draft.page_seo } : {}),
    ...(draft.custom_pages !== null ? { custom_pages: draft.custom_pages } : {}),
    ...(draft.menu !== null ? { menu: draft.menu } : {}),
  }

  const rows = draft.pages[page]
  if (!rows) return { ...live, settings, isDraft: false }

  return {
    sections: resolveRows(rows, false),
    settings,
    legacy: false,
    isDraft: true,
  }
}

/** The draft's style tokens if it has any, otherwise the live ones. */
export async function draftStyleSettings(): Promise<
  Pick<SiteSettings, 'global_styles' | 'global_styles_version' | 'type_styles'>
> {
  const [{ draft }, settings] = await Promise.all([readDraft(), getSiteSettings()])

  return {
    global_styles: draft?.global_styles ?? settings.global_styles,
    global_styles_version: settings.global_styles_version,
    type_styles: draft?.type_styles ?? settings.type_styles,
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Makes sure a draft row exists, seeding it from the live page the first time.
 *
 * Seeding from the live state rather than from empty is what makes the canvas
 * feel like editing the site instead of building a new one. A photographer who
 * has never opened the editor still gets their six real sections, synthesized
 * from site_settings by the legacy adapter, because loadPageSections handles
 * that case and this goes through it.
 */
export async function ensureDraft(page = 'home'): Promise<SiteDraft> {
  const { draft, missing } = await readDraft()

  if (missing) {
    throw new Error(`The draft table is missing. ${MISSING_HINT}`)
  }

  if (draft?.pages[page]) return draft

  const live = await loadPageSections(page)

  const rows: DraftSection[] = live.sections.map((s, position) => ({
    id: s.id,
    type: s.type,
    position,
    visible: s.visible,
    version: s.def.version,
    settings: s.settings,
  }))

  const next: SiteDraft = {
    pages: { ...(draft?.pages ?? {}), [page]: rows },
    global_styles: draft?.global_styles ?? null,
    type_styles: draft?.type_styles ?? null,
    page_seo: draft?.page_seo ?? null,
    custom_pages: draft?.custom_pages ?? null,
    menu: draft?.menu ?? null,
    updatedAt: null,
  }

  await upsertDraft(next, { kind: 'seed' })
  return next
}

/**
 * How a write relates to Undo.
 *   edit — an edit: `before` is kept as a step first. `label` names the edit
 *          when the caller knows better than a diff does (an action that
 *          writes several times and should undo as one).
 *   seed — a page copied in from the live site. Changes nothing visible, so
 *          no step, and the last edit's name is left alone.
 *   jump — Undo or Redo itself, which manage the steps on their own.
 */
type WriteKind =
  | { kind: 'edit'; before: DraftSnapshot; label?: string }
  | { kind: 'seed' }
  | { kind: 'jump' }

/** Columns added after the draft table, which a save can do without. */
const OPTIONAL_COLUMNS = ['edit_label', 'page_seo', 'custom_pages', 'menu'] as const

async function upsertDraft(draft: SiteDraft, how: WriteKind): Promise<void> {
  const supabase = await createClient()
  // currentUser() is request-cached, so this rides on the check the action has
  // already done rather than making a second round trip to the auth server.
  const user = await currentUser()

  let editLabel: string | null | undefined
  if (how.kind === 'edit') {
    const label = how.label ?? describeChange(how.before, draft)
    // Saving exactly what is already there is not an edit, and keeps no step.
    if (label) await pushStep(how.before, label)
    editLabel = label ?? undefined
  } else if (how.kind === 'jump') {
    editLabel = null
  }

  const row: Record<string, unknown> = {
    pages: draft.pages,
    global_styles: draft.global_styles,
    type_styles: draft.type_styles,
    page_seo: draft.page_seo ?? null,
    custom_pages: draft.custom_pages ?? null,
    menu: draft.menu ?? null,
    updated_by: user?.id ?? null,
  }
  // Omitted on a seed, so the upsert leaves the column as it was.
  if (editLabel !== undefined) row.edit_label = editLabel

  let { error } = await supabase.from('site_draft').upsert(row, { onConflict: 'tenant_id' })

  // Deployed before a newer migration was run: save the edit anyway, without
  // the column it adds (edit_label: undo; page_seo: search and sharing). A
  // search-settings edit made then is the one thing that cannot be kept.
  for (const column of OPTIONAL_COLUMNS) {
    if (error && column in row && error.message.includes(column)) {
      delete row[column]
      ;({ error } = await supabase.from('site_draft').upsert(row, { onConflict: 'tenant_id' }))
    }
  }

  if (error) throw new Error(`Could not save the draft. (${error.message})`)
}

/**
 * Replaces one page's section list in the draft.
 *
 * `known` is the draft the caller has already read. Every action needs the
 * current sections before it can change them, so without this the pair of calls
 * read the same row twice — which on a keystroke-by-keystroke autosave is half
 * the round trips for nothing.
 */
export async function writeDraftPage(
  page: string,
  sections: DraftSection[],
  known?: SiteDraft,
  /** Names the edit for Undo; by default it is worked out from what changed. */
  label?: string
): Promise<void> {
  const draft = known ?? (await ensureDraft(page))

  await upsertDraft(
    {
      ...draft,
      pages: {
        ...draft.pages,
        // Positions are rewritten here rather than trusted from the caller, so a
        // drag that reorders the array is enough — the client never has to keep
        // a position field in step.
        [page]: sections.map((s, position) => ({ ...s, position })),
      },
    },
    { kind: 'edit', before: draft, label }
  )
}

/** Sets the draft's style halves. Pass null for a half to leave it untouched. */
export async function writeDraftStyles(
  values: {
    global_styles?: DraftGlobalStyles
    type_styles?: DraftTypeStyles
  },
  /** Names the edit for Undo; by default it is worked out from what changed. */
  label?: string
): Promise<void> {
  const { draft, missing } = await readDraft()
  if (missing) throw new Error(`The draft table is missing. ${MISSING_HINT}`)

  const base: SiteDraft = draft ?? emptyDraft()

  await upsertDraft(
    {
      ...base,
      global_styles: values.global_styles ?? base.global_styles,
      type_styles: values.type_styles ?? base.type_styles,
    },
    { kind: 'edit', before: base, label }
  )
}

function emptyDraft(): SiteDraft {
  return {
    pages: {},
    global_styles: null,
    type_styles: null,
    page_seo: null,
    custom_pages: null,
    menu: null,
    updatedAt: null,
  }
}

/**
 * The photographer's pages as the editor should see them: the draft's list if
 * it has touched pages, the live one if not.
 */
export async function currentCustomPages(): Promise<CustomPage[]> {
  const { draft } = await readDraft()
  if (draft?.custom_pages) return draft.custom_pages
  return sanitizeCustomPages((await getSiteSettings()).custom_pages)
}

/** The menu as the editor should see it (null: never set). */
export async function currentMenu(): Promise<MenuItem[] | null> {
  const { draft } = await readDraft()
  if (draft?.menu) return draft.menu
  return sanitizeMenu((await getSiteSettings()).menu)
}

/**
 * Changes the site's structure in the draft: the list of pages, the menu, and
 * whatever has to move with them in the same step (a new page's first
 * sections; a deleted page's sections and search settings). One write, so it
 * undoes as one step.
 *
 * `change` receives the draft as it stands, with the pages list and menu
 * filled in from the live site if the draft has not touched them yet, and
 * returns the new draft.
 */
export async function writeDraftSite(
  change: (draft: SiteDraft & { custom_pages: CustomPage[] }) => SiteDraft,
  label: string
): Promise<void> {
  const { draft, missing } = await readDraft()
  if (missing) throw new Error(`The draft table is missing. ${MISSING_HINT}`)

  const base: SiteDraft = draft ?? emptyDraft()
  const live = base.custom_pages === null || base.menu === null ? await getSiteSettings() : null
  const filled = {
    ...base,
    custom_pages: base.custom_pages ?? sanitizeCustomPages(live?.custom_pages),
    menu: base.menu ?? sanitizeMenu(live?.menu),
  }

  const next = change(filled)
  await upsertDraft(
    {
      ...next,
      custom_pages: sanitizeCustomPages(next.custom_pages),
      menu: next.menu === null ? null : sanitizeMenu(next.menu),
    },
    { kind: 'edit', before: base, label }
  )
}

/**
 * Sets one page's search and sharing values (lib/seo.ts) in the draft.
 *
 * The draft holds every page's values, not just this one's, so Publish can
 * write the column in one go. On the first change they are copied from the
 * live site, or publishing one page's title would wipe every other page's.
 */
export async function writeDraftSeo(page: string, values: PageSeo): Promise<void> {
  const { draft, missing } = await readDraft()
  if (missing) throw new Error(`The draft table is missing. ${MISSING_HINT}`)

  const base: SiteDraft = draft ?? emptyDraft()
  const current = base.page_seo ?? sanitizeSeoMap((await getSiteSettings()).page_seo)
  const clean = sanitizePageSeo(values)

  const next: PageSeoMap = { ...current }
  if (Object.keys(clean).length) next[page] = clean
  else delete next[page]

  // Named against the live values, not against "untouched", so the first
  // change reads as a change to this page rather than to every page.
  const label = describeChange({ ...base, page_seo: current }, { ...base, page_seo: next })
  if (!label) return

  await upsertDraft({ ...base, page_seo: next }, { kind: 'edit', before: base, label })
}

// ── Undo and redo ────────────────────────────────────────────────────────────

/**
 * One step back (or forward). Null when there is nothing to undo or redo —
 * including when there is no draft at all, since Publish and Discard clear the
 * steps with it.
 */
export async function stepDraft(direction: 'undo' | 'redo'): Promise<StepResult | null> {
  const { draft, missing } = await readDraft()
  if (missing) throw new Error(`The draft table is missing. ${MISSING_HINT}`)
  if (!draft) return null

  return moveStep(direction, draft, (snapshot) =>
    upsertDraft({ ...draft, ...snapshot }, { kind: 'jump' })
  )
}

// ── Publishing and discarding ────────────────────────────────────────────────

/**
 * Promotes the draft to the live site.
 *
 * The undo point goes first and the whole thing stops if it cannot be written,
 * so the way back always exists before the way forward is taken. After that
 * this does nothing clever: it calls the same replaceSections and
 * patchSiteSettings that applying a look calls.
 *
 * The row is deleted last. If a write fails partway the draft is still there,
 * which is the failure mode worth having — the alternative loses the work.
 */
export async function publishDraft(): Promise<{ pages: string[]; styles: boolean }> {
  const { draft, missing } = await readDraft()

  if (missing) throw new Error(`The draft table is missing. ${MISSING_HINT}`)
  if (!draft) throw new Error('There is nothing waiting to be published.')

  const styles = draft.global_styles !== null || draft.type_styles !== null
  const seo = draft.page_seo !== null
  const site = draft.custom_pages !== null || draft.menu !== null

  // The photographer's pages after this publish, and the ones it removes.
  const live = await getSiteSettings()
  const liveCustom = sanitizeCustomPages(live.custom_pages)
  const finalCustom = draft.custom_pages ?? liveCustom
  const removed = liveCustom.filter((p) => !finalCustom.some((f) => f.key === p.key)).map((p) => p.key)

  // Only pages that still exist are written; a page deleted in the draft is
  // cleared below instead.
  const exists = (key: string) => isPage(key) || finalCustom.some((p) => p.key === key)
  const pages = Object.keys(draft.pages).filter(exists)

  if (pages.length === 0 && !styles && !seo && !site) {
    throw new Error('There is nothing waiting to be published.')
  }

  await recordHistory({
    action: 'publish',
    templateId: null,
    templateSlug: null,
    templateName: null,
    version: null,
    note: describeDraft(pages, styles, seo, site),
  })

  for (const page of pages) {
    await replaceSections(
      page,
      draft.pages[page].map((s) => ({
        type: s.type,
        visible: s.visible,
        version: s.version,
        settings: s.settings,
      }))
    )
  }

  if (styles) {
    await patchSiteSettings({
      ...(draft.global_styles !== null
        ? { global_styles: draft.global_styles, global_styles_version: TOKENS_VERSION }
        : {}),
      ...(draft.type_styles !== null ? { type_styles: draft.type_styles } : {}),
    })
  }

  // Search settings of removed pages go with them.
  const seoMap = draft.page_seo ?? (removed.length ? sanitizeSeoMap(live.page_seo) : null)
  if (seoMap) {
    for (const key of removed) delete seoMap[key]
    await patchSiteSettings({ page_seo: seoMap })
  }

  if (site) {
    await patchSiteSettings({
      ...(draft.custom_pages !== null ? { custom_pages: draft.custom_pages } : {}),
      ...(draft.menu !== null ? { menu: draft.menu } : {}),
    })
  }

  // A deleted page's sections are removed from the live table, not left
  // behind for a page nobody can reach.
  for (const key of removed) await replaceSections(key, [])

  // Keep the old site_settings columns in step with what was just published —
  // the way back for pages the canvas owns, and the live contract for pages it
  // does not (each print's page reads the shop_* columns). See MIRRORED.
  for (const page of pages) await mirrorPage(page)

  await deleteDraft()
  await clearSteps()

  return { pages, styles }
}

export async function discardDraft(): Promise<void> {
  const { missing } = await readDraft()
  if (missing) throw new Error(`The draft table is missing. ${MISSING_HINT}`)
  await deleteDraft()
  await clearSteps()
}

async function deleteDraft(): Promise<void> {
  const supabase = await createClient()

  // No .eq() — RLS already limits this to the caller's own site, and naming a
  // tenant here would be a second, weaker copy of that rule.
  const { error } = await supabase.from('site_draft').delete().not('tenant_id', 'is', null)
  if (error) throw new Error(error.message)
}

function describeDraft(pages: string[], styles: boolean, seo: boolean, site: boolean): string {
  const parts: string[] = []
  if (site) parts.push('pages and menu')
  if (pages.length) parts.push(pages.length === 1 ? `the ${pages[0]} page` : `${pages.length} pages`)
  if (styles) parts.push('site style')
  if (seo) parts.push('search and sharing settings')
  return `Published ${parts.join(' and ')} from the editor.`
}
