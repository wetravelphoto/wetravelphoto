import { createClient } from '@/lib/supabase/server'
import { currentEditor } from '@/lib/auth'
import { PAGES, isPage, type CustomPage } from '@/lib/sections/pages'
import { sectionDef } from '@/lib/sections/registry'
import { chromeLabel } from '@/lib/chrome'
import type { SiteDraft } from '@/lib/drafts/store'

/**
 * UNDO AND REDO
 * ═════════════
 *
 * Every edit rewrites the one draft row. Just before it does, the draft as it
 * was is kept as a step (db/migrations/2026-09-22_draft_steps.sql). Undo puts
 * the newest step back and keeps the state it replaced as a Redo step; Redo is
 * the same move in the other direction.
 *
 * Whole snapshots, not inverse operations: nothing here knows what a reorder
 * or a recolour is, so a new kind of edit is undoable the day it is added,
 * without anyone remembering to write its opposite.
 *
 * Everything in this file is BEST EFFORT. If the steps table is not there yet,
 * or a step cannot be written, the edit itself still saves — losing an Undo
 * step is a small thing; refusing to save someone's work over it is not.
 */

/** The part of a draft a step holds. */
export type DraftSnapshot = Pick<
  SiteDraft,
  'pages' | 'global_styles' | 'type_styles' | 'page_seo' | 'custom_pages' | 'menu' | 'chrome'
>

export type StepsState = {
  /** What Undo would take back, or null when there is nothing to undo. */
  undo: string | null
  /** What Redo would put back, or null. */
  redo: string | null
}

export type StepResult = {
  /** What was undone or redone. */
  label: string
  /** The pages whose sections, or search and sharing settings, changed. */
  pages: string[]
  /** Whether the site style changed. */
  styles: boolean
  /** Whether the list of pages or the menu changed. */
  site: boolean
}

const MISSING_HINT = 'Run db/migrations/2026-09-22_draft_steps.sql in Supabase for undo and redo.'

export function snapshotOf(draft: DraftSnapshot): DraftSnapshot {
  return {
    pages: draft.pages ?? {},
    global_styles: draft.global_styles ?? null,
    type_styles: draft.type_styles ?? null,
    // Steps kept before search settings existed have none: null, "untouched".
    page_seo: draft.page_seo ?? null,
    custom_pages: draft.custom_pages ?? null,
    menu: draft.menu ?? null,
    chrome: draft.chrome ?? null,
  }
}

/**
 * JSON with object keys sorted, so two values that differ only in the order
 * their keys were written compare equal. A settings form re-saves every field,
 * and a key-order difference alone must not count as an edit — that would keep
 * an Undo step that changes nothing when used.
 */
function stable(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  )
}

const same = (a: unknown, b: unknown) => stable(a) === stable(b)

function pageName(slug: string, ...lists: (CustomPage[] | null)[]): string {
  if (isPage(slug)) return PAGES[slug].label
  for (const list of lists) {
    const page = list?.find((p) => p.key === slug)
    if (page) return page.title
  }
  return 'a page'
}

/**
 * What differs between two drafts: pages whose sections changed, whether the
 * style did, and pages whose search and sharing settings did.
 */
export function diffDrafts(
  a: DraftSnapshot,
  b: DraftSnapshot
): { pages: string[]; styles: boolean; seo: string[]; site: boolean; chrome: string[] } {
  const slugs = new Set([...Object.keys(a.pages ?? {}), ...Object.keys(b.pages ?? {})])
  const seoSlugs = new Set([...Object.keys(a.page_seo ?? {}), ...Object.keys(b.page_seo ?? {})])
  return {
    pages: [...slugs].filter((slug) => !same(a.pages?.[slug], b.pages?.[slug])),
    styles: !same(a.global_styles, b.global_styles) || !same(a.type_styles, b.type_styles),
    // Null ("untouched") compares as empty. writeDraftSeo names its first
    // change against the live values, so this only has to be exact about
    // WHICH pages moved when undoing.
    seo: [...seoSlugs].filter((slug) => !same(a.page_seo?.[slug], b.page_seo?.[slug])),
    // The list of pages or the menu. Null ("untouched") differs from a list
    // only when writeDraftSite has actually changed something, and it names
    // its own steps.
    site: !same(a.custom_pages, b.custom_pages) || !same(a.menu, b.menu),
    // Header and footer values that differ.
    chrome: [...new Set([...Object.keys(a.chrome ?? {}), ...Object.keys(b.chrome ?? {})])].filter(
      (key) => !same(a.chrome?.[key as keyof typeof a.chrome], b.chrome?.[key as keyof typeof b.chrome])
    ),
  }
}

/**
 * A name for what changed between two drafts, e.g. "Introduction · Homepage".
 *
 * Two jobs: it is what the Undo button's tooltip says, and it decides what
 * counts as the same burst — saves with the same name, moments apart, are one
 * step. So it names the THING edited (a section, the order, the style) and
 * never the value, or every keystroke would be a step of its own.
 *
 * Null when nothing changed, which keeps no step.
 */
export function describeChange(before: DraftSnapshot, after: DraftSnapshot): string | null {
  const { pages, styles, seo, site, chrome } = diffDrafts(before, after)
  const name = (slug: string) => pageName(slug, after.custom_pages, before.custom_pages)

  if (site) return 'Pages & menu'
  if (chrome.length) return chromeLabel(chrome)
  if (seo.length) {
    return pages.length === 0 && !styles && seo.length === 1
      ? `Search & sharing · ${name(seo[0])}`
      : 'Several changes'
  }
  if (pages.length === 0) return styles ? 'Site style' : null
  if (pages.length > 1 || styles) return 'Several changes'

  const slug = pages[0]
  const where = name(slug)
  const was = before.pages?.[slug] ?? []
  const now = after.pages?.[slug] ?? []
  const label = (type: string) => sectionDef(type)?.label ?? 'Section'

  const wasIds = new Set(was.map((r) => r.id))
  const nowIds = new Set(now.map((r) => r.id))
  const added = now.filter((r) => !wasIds.has(r.id))
  const removed = was.filter((r) => !nowIds.has(r.id))

  if (added.length === 1 && removed.length === 0) return `Added ${label(added[0].type)} · ${where}`
  if (removed.length === 1 && added.length === 0) return `Removed ${label(removed[0].type)} · ${where}`
  if (added.length || removed.length) return where

  const changed = now.filter((r) => {
    const old = was.find((w) => w.id === r.id)
    return !old || !same(old.settings, r.settings) || old.visible !== r.visible
  })

  if (changed.length === 1) {
    const old = was.find((w) => w.id === changed[0].id)
    if (old && old.visible !== changed[0].visible) {
      return `${changed[0].visible ? 'Showed' : 'Hid'} ${label(changed[0].type)} · ${where}`
    }
    return `${label(changed[0].type)} · ${where}`
  }
  if (changed.length === 0) return `Section order · ${where}`
  return where
}

/**
 * Keeps `before` as an Undo step, unless this save is part of the same burst
 * as the last one (decided in the database, see push_draft_step). Clears Redo.
 */
export async function pushStep(before: DraftSnapshot, label: string): Promise<void> {
  const editor = await currentEditor()
  if (!editor) return

  const supabase = await createClient()
  const { error } = await supabase.rpc('push_draft_step', {
    p_tenant: editor.tenantId,
    p_snapshot: snapshotOf(before),
    p_label: label,
  })

  if (error) console.warn(`[steps] ${error.message} — ${MISSING_HINT}`)
}

/** What the Undo and Redo buttons would do right now. */
export async function readSteps(): Promise<StepsState> {
  const editor = await currentEditor()
  if (!editor) return { undo: null, redo: null }

  const supabase = await createClient()
  const top = (stack: 'undo' | 'redo') =>
    supabase
      .from('site_draft_steps')
      .select('label')
      .eq('tenant_id', editor.tenantId)
      .eq('stack', stack)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()

  const [undo, redo] = await Promise.all([top('undo'), top('redo')])
  if (undo.error || redo.error) return { undo: null, redo: null }

  return {
    undo: undo.data ? ((undo.data.label as string) ?? 'the last change') : null,
    redo: redo.data ? ((redo.data.label as string) ?? 'the last change') : null,
  }
}

/**
 * Moves one step: takes the newest step off `from`, keeps the current draft on
 * the other stack under the same name, and writes the step as the draft.
 *
 * `write` is the draft store's own writer, passed in so there is still only one
 * place that writes site_draft. Returns null when there is nothing to move.
 */
export async function moveStep(
  direction: 'undo' | 'redo',
  current: DraftSnapshot,
  write: (snapshot: DraftSnapshot) => Promise<void>
): Promise<StepResult | null> {
  const editor = await currentEditor()
  if (!editor) return null

  const from = direction
  const to = direction === 'undo' ? 'redo' : 'undo'
  const supabase = await createClient()

  const { data: step, error } = await supabase
    .from('site_draft_steps')
    .select('id, snapshot, label')
    .eq('tenant_id', editor.tenantId)
    .eq('stack', from)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Undo is not set up yet. ${MISSING_HINT}`)
  if (!step) return null

  const target = snapshotOf(step.snapshot as DraftSnapshot)
  const label = (step.label as string) ?? 'the last change'

  // The way back first, so a failure part-way leaves the step reachable
  // rather than lost.
  const { error: keepError } = await supabase.from('site_draft_steps').insert({
    tenant_id: editor.tenantId,
    stack: to,
    snapshot: snapshotOf(current),
    label,
  })
  if (keepError) throw new Error(`Could not ${direction}. (${keepError.message})`)

  await write(target)

  // The id came from a read that was already scoped, so this is belt and
  // braces — but a delete addressed only by id is the shape that goes wrong
  // when somebody later reuses the line, and a platform admin's session would
  // not stop it.
  await supabase
    .from('site_draft_steps')
    .delete()
    .eq('tenant_id', editor.tenantId)
    .eq('id', step.id as number)

  const moved = diffDrafts(current, target)
  return {
    label,
    pages: [...new Set([...moved.pages, ...moved.seo])],
    styles: moved.styles,
    // The header and footer are on every page, like the menu.
    site: moved.site || moved.chrome.length > 0,
  }
}

/** Publish and Discard end the draft, and its steps with it. */
export async function clearSteps(): Promise<void> {
  const editor = await currentEditor()
  if (!editor) return

  const supabase = await createClient()
  const { error } = await supabase.from('site_draft_steps').delete().eq('tenant_id', editor.tenantId)
  if (error) console.warn(`[steps] ${error.message}`)
}
