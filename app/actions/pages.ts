'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { requireEditor } from '@/lib/auth'
import { currentCustomPages, writeDraftSite, type DraftSection } from '@/lib/drafts/store'
import {
  MAX_CUSTOM_PAGES,
  findPage,
  newPageKey,
  slugProblem,
  slugify,
  type CustomPage,
} from '@/lib/sections/pages'
import { legacyMenu, newMenuId, sanitizeMenu, type MenuItem } from '@/lib/menu'
import { sectionDef } from '@/lib/sections/registry'
import { createClient } from '@/lib/supabase/server'
import { SAMPLE_PHOTOS } from '@/lib/samples'

/**
 * PAGES AND THE MENU
 * ══════════════════
 *
 * Creating, renaming and deleting the photographer's own pages, and saving
 * the menu. Like every canvas action, these write to the DRAFT and nothing
 * else: a new page, a renamed address or a reordered menu reaches the live
 * site on Publish, all together, and each is one Undo step.
 *
 * Server actions are public endpoints, so each one checks the editor itself.
 */

/** Every editor page and its preview: the menu and page list show on all of them. */
function refreshEditor() {
  revalidatePath('/edit', 'layout')
  revalidatePath('/preview', 'layout')
}

function cleanTitle(input: unknown): string {
  const title = typeof input === 'string' ? input.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  if (!title) throw new Error('Give the page a name.')
  return title
}

/**
 * A new page's first section: an Introduction headed with the page's name,
 * with room under the fixed header. Something to click and write into, rather
 * than an empty page with nothing to select.
 */
/**
 * A new page opens with a photograph on it.
 *
 * It used to be one text block and nothing else, which is a blank page with a
 * heading — and a blank page teaches a photographer nothing about what a page
 * can be. A picture beside the words shows the shape of it immediately.
 *
 * Whose picture: **theirs if they have one**, and a sample only while they do
 * not. Nobody wants a stranger's photograph appearing on a page they just
 * made, and by the time somebody is adding pages they usually have their own.
 *
 * The sample rotates with the number of pages so a second new page does not
 * open with the same picture as the first.
 */
function starterSections(title: string, imagePath: string | null): DraftSection[] {
  const def = sectionDef('intro')
  if (!def) return []
  return [
    {
      id: randomUUID(),
      type: 'intro',
      position: 0,
      visible: true,
      version: def.version,
      settings: {
        heading: title,
        body: 'Write about this page here. Add photographs, galleries or a contact form with “+ Add a section”.',
        space_top: 'l',
        ...(imagePath ? { image_path: imagePath, image_side: 'right' } : {}),
      },
    },
  ]
}

/** Their newest photograph, or a sample while they have none. */
async function pictureForNewPage(tenantId: string, index: number): Promise<string | null> {
  const supabase = await createClient()

  const { data: mine } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('tenant_id', tenantId)
    .not('storage_path', 'like', '/samples/%')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (mine?.storage_path) return mine.storage_path as string

  const samples = SAMPLE_PHOTOS
  if (samples.length === 0) return null
  return samples[index % samples.length].storage_path
}

/** Removes every menu entry pointing at a page, including inside folders. */
function withoutPage(menu: MenuItem[], key: string): MenuItem[] {
  return menu
    .filter((item) => !(item.kind === 'page' && item.page === key))
    .map((item) =>
      item.kind === 'folder'
        ? { ...item, children: item.children.filter((c) => !(c.kind === 'page' && c.page === key)) }
        : item
    )
}

// ── Pages ────────────────────────────────────────────────────────────────────

/**
 * A new page: added to the list, given its first section, and put at the end
 * of the menu (which is created from the usual one the first time). Returns
 * its key, so the editor can open it.
 */
export async function createDraftPage(input: { title: unknown; slug?: unknown }) {
  const { tenantId } = await requireEditor()
  const title = cleanTitle(input.title)
  const pages = await currentCustomPages()

  if (pages.length >= MAX_CUSTOM_PAGES) {
    throw new Error(`A site can have up to ${MAX_CUSTOM_PAGES} pages of its own.`)
  }

  const slug = typeof input.slug === 'string' && input.slug.trim() ? input.slug.trim() : slugify(title)
  const problem = slugProblem(slug, pages)
  if (problem) throw new Error(problem)

  const page: CustomPage = { key: newPageKey(), slug, title }
  const picture = await pictureForNewPage(tenantId, pages.length)

  await writeDraftSite(
    (draft) => ({
      ...draft,
      custom_pages: [...draft.custom_pages, page],
      pages: { ...draft.pages, [page.key]: starterSections(title, picture) },
      menu: [...(draft.menu ?? legacyMenu()), { id: newMenuId(), kind: 'page', page: page.key }],
    }),
    `Added the ${title} page`
  )

  refreshEditor()
  return { key: page.key, slug: page.slug }
}

/**
 * A new name and/or address for one of the photographer's pages. Its sections
 * and settings stay where they are (they are filed by key, not by address),
 * and its menu entry follows the new name unless one was typed there.
 */
export async function updateDraftPage(key: string, input: { title: unknown; slug: unknown }) {
  await requireEditor()
  const title = cleanTitle(input.title)
  const slug = typeof input.slug === 'string' ? input.slug.trim() : ''
  const pages = await currentCustomPages()

  if (!pages.some((p) => p.key === key)) throw new Error('That page no longer exists.')
  const problem = slugProblem(slug, pages, key)
  if (problem) throw new Error(problem)

  await writeDraftSite(
    (draft) => ({
      ...draft,
      custom_pages: draft.custom_pages.map((p) => (p.key === key ? { ...p, title, slug } : p)),
    }),
    `Renamed the ${title} page`
  )

  refreshEditor()
}

/**
 * Deletes one of the photographer's pages from the draft: the page, its
 * sections, its search settings and its menu entries. The live page stays
 * until Publish, and Undo brings all of it back.
 */
export async function deleteDraftPage(key: string) {
  await requireEditor()
  const pages = await currentCustomPages()
  const page = pages.find((p) => p.key === key)
  if (!page) throw new Error('That page no longer exists.')

  await writeDraftSite((draft) => {
    const remaining = { ...draft.pages }
    delete remaining[key]
    const seo = draft.page_seo ? { ...draft.page_seo } : null
    if (seo) delete seo[key]

    return {
      ...draft,
      custom_pages: draft.custom_pages.filter((p) => p.key !== key),
      pages: remaining,
      page_seo: seo,
      menu: draft.menu ? withoutPage(draft.menu, key) : null,
    }
  }, `Deleted the ${page.title} page`)

  refreshEditor()
}

// ── The menu ─────────────────────────────────────────────────────────────────

/**
 * The whole menu, as the editor holds it. Cleaned entry by entry
 * (lib/menu.ts), and any entry pointing at a page that does not exist is
 * dropped.
 */
export async function saveDraftMenu(items: unknown) {
  await requireEditor()
  const pages = await currentCustomPages()
  const clean = sanitizeMenu(items) ?? []

  const exists = (key: string) => findPage(key, pages) !== null
  const menu: MenuItem[] = clean
    .filter((item) => item.kind !== 'page' || exists(item.page))
    .map((item) =>
      item.kind === 'folder'
        ? { ...item, children: item.children.filter((c) => c.kind !== 'page' || exists(c.page)) }
        : item
    )

  await writeDraftSite((draft) => ({ ...draft, menu }), 'Menu')
  refreshEditor()
}
