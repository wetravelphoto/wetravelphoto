'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { requireUser } from '@/lib/auth'
import {
  discardDraft,
  ensureDraft,
  publishDraft,
  readDraft,
  writeDraftPage,
  writeDraftStyles,
  type DraftSection,
} from '@/lib/drafts/store'
import { getSiteSettings } from '@/lib/site'
import { readSettingsFromForm } from '@/lib/sections/form'
import { sectionDef, type SectionSettings } from '@/lib/sections/registry'
import { sanitizeSectionStyle, sanitizeTokens, trimToDefaults } from '@/lib/styles/sanitize'
import {
  STYLED_SECTIONS,
  type SectionStyle,
  type StyledSection,
  type TypeStyles,
} from '@/lib/type-styles'
import {
  PAIRINGS,
  PALETTES,
  resolveTokens,
  type StyleTokens,
} from '@/lib/styles/tokens'

/**
 * THE CANVAS'S ACTIONS
 * ════════════════════
 *
 * Every one of these writes to the draft and NOTHING ELSE. There is no path
 * through this file that touches page_sections or site_settings — only
 * publish() does that, and it does it by handing over to lib/drafts/store.ts.
 *
 * That is the rule worth keeping as this file grows: if a new action here ever
 * needs to write to a live table, it belongs somewhere else.
 *
 * These are server actions, which means they are public endpoints. Each one
 * therefore checks the session itself rather than assuming the editor page did
 * it — the middleware protects the PAGE, not the action, and an action reached
 * directly has no page in front of it.
 */

/**
 * Request-cached, so calling it here and again inside the draft write costs one
 * round trip to the auth server rather than two. See lib/auth.ts.
 */
const requireEditor = requireUser

/**
 * The editor and its preview. Not '/' — the live page has not changed, and
 * revalidating it on every keystroke would throw away the cache that keeps the
 * homepage quick for visitors.
 */
function done(page: string) {
  revalidatePath(`/edit/${page}`)
  revalidatePath(`/preview/${page}`)
}

// ── Reading the draft into the editor ────────────────────────────────────────

/** Starts a draft if there is not one, and returns the page's sections. */
export async function beginEditing(page: string): Promise<DraftSection[]> {
  await requireEditor()
  const draft = await ensureDraft(page)
  return draft.pages[page] ?? []
}

// ── Order, visibility, membership ────────────────────────────────────────────

/**
 * Takes the whole order every time and rewrites positions 0..n. Cheaper to
 * reason about than move-up/move-down, and it is what a drag gives you.
 */
export async function reorderDraft(page: string, orderedIds: string[]) {
  await requireEditor()
  const draft = await ensureDraft(page)
  const rows = draft.pages[page] ?? []
  const byId = new Map(rows.map((r) => [r.id, r]))

  const next = orderedIds
    .map((id) => byId.get(id))
    .filter((r): r is DraftSection => r !== undefined)

  // Anything the client did not mention is kept, at the end. A reorder should
  // never be able to lose a section because two tabs disagreed about the list.
  for (const row of rows) if (!orderedIds.includes(row.id)) next.push(row)

  await writeDraftPage(page, next, draft)
  done(page)
}

export async function setDraftVisible(page: string, id: string, visible: boolean) {
  await requireEditor()
  const draft = await ensureDraft(page)
  const rows = draft.pages[page] ?? []

  await writeDraftPage(
    page,
    rows.map((r) => (r.id === id ? { ...r, visible } : r)),
    draft
  )
  done(page)
}

export async function addDraftSection(page: string, type: string, afterId?: string) {
  await requireEditor()

  const def = sectionDef(type)
  if (!def) throw new Error(`Unknown section type: ${type}`)

  const draft = await ensureDraft(page)
  const rows = draft.pages[page] ?? []

  if (def.singleton && rows.some((r) => r.type === type)) {
    throw new Error(`${def.label} can only appear once on a page.`)
  }

  const row: DraftSection = {
    id: randomUUID(),
    type,
    position: 0,
    visible: true,
    version: def.version,
    // Empty, not a copy of the defaults: defaults are merged in at read time,
    // so a row stores only what has actually been changed from them.
    settings: {},
  }

  const at = afterId ? rows.findIndex((r) => r.id === afterId) + 1 : rows.length
  const next = [...rows]
  next.splice(at, 0, row)

  await writeDraftPage(page, next, draft)
  done(page)

  // So the editor can select what it just added.
  return row.id
}

export async function removeDraftSection(page: string, id: string) {
  await requireEditor()
  const draft = await ensureDraft(page)
  const rows = draft.pages[page] ?? []

  const row = rows.find((r) => r.id === id)
  const def = row ? sectionDef(row.type) : null
  if (def?.permanent) throw new Error(`${def.label} can be hidden but not removed.`)

  await writeDraftPage(
    page,
    rows.filter((r) => r.id !== id),
    draft
  )
  done(page)
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function updateDraftSection(page: string, id: string, formData: FormData) {
  await requireEditor()
  const draft = await ensureDraft(page)
  const rows = draft.pages[page] ?? []

  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error('That section is no longer on the page.')

  const def = sectionDef(row.type)
  if (!def) throw new Error(`Unknown section type: ${row.type}`)

  const current = (row.settings ?? {}) as SectionSettings

  await writeDraftPage(
    page,
    rows.map((r) =>
      r.id === id
        ? {
            ...r,
            settings: readSettingsFromForm(def, formData, current),
            // Saving through this release stamps this release's schema version.
            version: def.version,
          }
        : r
    ),
    draft
  )

  done(page)
}

// ── Style ────────────────────────────────────────────────────────────────────
//
// Style used to write straight to site_settings, which meant changing a colour
// changed the live site with no draft and no way back. It goes through the
// draft now like everything else, so colour and type are published with the
// content they were chosen for.

/** The draft's tokens if it has any, otherwise the live ones. */
async function currentTokens(): Promise<StyleTokens> {
  const { draft } = await readDraft()
  const settings = await getSiteSettings()

  return resolveTokens(
    draft?.global_styles ?? settings.global_styles,
    settings.global_styles_version
  )
}

/**
 * Merges changes over what is already there rather than replacing it, so
 * applying a palette does not silently reset the typography — each control
 * sends only itself and should mean only itself.
 */
async function saveTokens(changes: Partial<StyleTokens>) {
  const next = { ...(await currentTokens()), ...changes }
  await writeDraftStyles({ global_styles: trimToDefaults(next) })

  revalidatePath('/edit/home')
  revalidatePath('/preview/home')
}

/**
 * Writes ONE setting on one section.
 *
 * The generic panel saves a whole form at once and deliberately skips `custom`
 * fields — a focal point or a story chooser has no input for FormData to carry.
 * This is how those editors save: the key must exist in the section type's
 * defaults, so an action reached directly cannot invent settings.
 */
export async function updateDraftSectionValue(
  page: string,
  id: string,
  key: string,
  value: unknown
) {
  await requireEditor()
  const draft = await ensureDraft(page)
  const rows = draft.pages[page] ?? []

  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error('That section is no longer on the page.')

  const def = sectionDef(row.type)
  if (!def) throw new Error(`Unknown section type: ${row.type}`)
  if (!(key in def.defaults)) {
    throw new Error(`${def.label} has no setting called "${key}".`)
  }

  await writeDraftPage(
    page,
    rows.map((r) =>
      r.id === id
        ? { ...r, settings: { ...(r.settings ?? {}), [key]: value }, version: def.version }
        : r
    ),
    draft
  )

  done(page)
}

export async function updateDraftStyles(changes: unknown) {
  await requireEditor()
  await saveTokens(sanitizeTokens(changes))
}

export async function applyDraftPairing(id: string) {
  await requireEditor()

  const pairing = PAIRINGS.find((p) => p.id === id)
  if (!pairing) throw new Error(`No pairing called "${id}".`)

  await saveTokens({
    display_font: pairing.display,
    body_font: pairing.body,
    heading_case: pairing.heading_case,
    heading_tracking: pairing.heading_tracking,
  })
}

export async function applyDraftPalette(id: string) {
  await requireEditor()

  const palette = PALETTES.find((p) => p.id === id)
  if (!palette) throw new Error(`No palette called "${id}".`)

  await saveTokens({
    surface: palette.surface,
    surface_alt: palette.surface_alt,
    ink: palette.ink,
    ink_soft: palette.ink_soft,
    ink_mute: palette.ink_mute,
    accent: palette.accent,
  })
}

/**
 * One section group's typography override.
 *
 * Keyed by the STYLE GROUP ('hero', 'intro', 'journal', 'contact'), not by
 * section id, because that is how lib/type-styles.ts stores it — two intro
 * sections on a page deliberately share one setting. Undefined clears the
 * override so the section goes back to following the site.
 */
export async function updateDraftSectionType(
  group: string,
  changes: Record<string, unknown>
) {
  await requireEditor()

  if (!STYLED_SECTIONS.includes(group as StyledSection)) {
    throw new Error(`"${group}" is not a section group that carries its own typography.`)
  }

  const { draft } = await readDraft()
  const settings = await getSiteSettings()
  const current = (draft?.type_styles ?? settings.type_styles ?? {}) as TypeStyles

  const next: SectionStyle = { ...(current[group] ?? {}) }

  for (const [key, value] of Object.entries(sanitizeSectionStyle(changes))) {
    if (value === undefined) delete next[key as keyof SectionStyle]
    else Object.assign(next, { [key]: value })
  }

  // An override with nothing left in it is removed rather than stored empty,
  // so "follows the site" is the absence of a record rather than a record that
  // happens to say nothing.
  const merged: TypeStyles = { ...current }
  if (Object.keys(next).length === 0) delete merged[group]
  else merged[group] = next

  await writeDraftStyles({ type_styles: merged })

  revalidatePath('/edit/home')
  revalidatePath('/preview/home')
}

/**
 * Clears every per-section typography override at once.
 *
 * Worth its own action because the overrides are invisible until you go looking
 * for them: a site can have a typeface set on all four section groups, and then
 * the global picker appears to do nothing at all. It moves, and the headings do
 * not, and there is no way to tell from the Style panel why.
 */
export async function clearDraftSectionTypes() {
  await requireEditor()
  await writeDraftStyles({ type_styles: {} })

  revalidatePath('/edit/home')
  revalidatePath('/preview/home')
}

/** Back to the values the site shipped with — in the draft, so it is undoable. */
export async function resetDraftStyles() {
  await requireEditor()
  await writeDraftStyles({ global_styles: {} })

  revalidatePath('/edit/home')
  revalidatePath('/preview/home')
}

// ── Going live, and not ──────────────────────────────────────────────────────

export async function publish() {
  await requireEditor()
  const result = await publishDraft()

  // NOW the live site changes, so now the live paths are revalidated —
  // 'layout' because a published style change is emitted in the root layout
  // and page-level revalidation would leave every page wearing the old colours.
  revalidatePath('/', 'layout')
  revalidatePath('/admin/design')
  revalidatePath('/admin/pages/home')
  for (const page of result.pages) done(page)

  return result
}

export async function discard() {
  await requireEditor()
  await discardDraft()
  revalidatePath('/edit/home')
  revalidatePath('/preview/home')
}
