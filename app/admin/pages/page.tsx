import { getSiteSettings } from '@/lib/site'
import { currentSite } from '@/lib/tenant'
import { currentCustomPages, draftStatus, readDraft } from '@/lib/drafts/store'
import { listVersions } from '@/lib/drafts/versions'
import { PAGES, PAGE_SLUGS, sanitizeCustomPages } from '@/lib/sections/pages'
import { pageIcon, type AdminPage, type PageState } from '@/lib/admin/page-status'
import PagesBoard from '@/components/admin/PagesBoard'

export const dynamic = 'force-dynamic'

/**
 * THE PAGES OF A PHOTOGRAPHER'S WEBSITE
 * ═════════════════════════════════════
 *
 * Every fact on this screen is read from what the site actually is. There is
 * no sample data here and no placeholder status: a page is published because
 * a visitor can reach it, it has unpublished changes because the draft holds
 * edits for it, and the publish time is the newest row in the version history.
 *
 * Where the application cannot answer something the design asked for, the
 * screen says so rather than inventing it — see the notes on the card menu in
 * components/admin/PageCard.tsx.
 */
export default async function PagesIndex() {
  const [settings, custom, status, { draft }, site, { versions }] = await Promise.all([
    getSiteSettings(),
    // The draft's list, so a page created a minute ago is here before Publish.
    currentCustomPages(),
    draftStatus(),
    readDraft(),
    currentSite(),
    listVersions(),
  ])

  /*
   * WHICH PAGES A VISITOR CAN ACTUALLY REACH.
   *
   * Only two built-in pages can be switched off, and both do it by returning
   * a 404 from their own route (app/about/page.tsx, app/shop/page.tsx). The
   * other show_* settings govern SECTIONS of the homepage, not whether a page
   * exists, so reading them here would report pages as hidden that are not.
   */
  const off = new Set<string>([
    ...(settings.show_about === false ? ['about'] : []),
    ...(settings.show_shop ? [] : ['shop']),
  ])

  /** Custom pages as the LIVE site has them — the draft's may differ. */
  const livePages = sanitizeCustomPages(settings.custom_pages)
  const liveByKey = new Map(livePages.map((p) => [p.key, p]))

  const edited = new Set(status.pages)

  const state = (key: string, builtin: boolean): PageState => {
    if (!builtin) {
      const live = liveByKey.get(key)
      // Made in the editor and not yet published: nobody has ever seen it.
      if (!live) return 'unpublished'
      // Its sections were edited, or it was renamed or re-addressed in the
      // draft — both are edits waiting to go live.
      const moved = draft?.custom_pages?.find((p) => p.key === key)
      const renamed = !!moved && (moved.title !== live.title || moved.slug !== live.slug)
      return edited.has(key) || renamed ? 'changes' : 'live'
    }
    if (off.has(key)) return 'hidden'
    return edited.has(key) ? 'changes' : 'live'
  }

  const pages: AdminPage[] = [
    ...PAGE_SLUGS.map((key) => ({
      key,
      label: PAGES[key].label,
      // The 404 has no address of its own — Next draws it in place of
      // whatever was asked for — so there is nothing to link to.
      path: key === 'notfound' ? null : PAGES[key].path,
      editHref: `/edit/${key}`,
      builtin: true,
      state: state(key, true),
      icon: pageIcon(key),
      home: key === 'home',
    })),
    ...custom.map((p) => ({
      key: p.key,
      label: p.title,
      path: `/${p.slug}`,
      editHref: `/edit/${p.key}`,
      builtin: false,
      state: state(p.key, false),
      icon: pageIcon(p.key),
      home: false,
    })),
  ]

  /*
   * THE LAST TIME THE SITE WENT LIVE.
   *
   * The newest 'publish' row in the version history (lib/drafts/versions.ts).
   * A site that has never been published has none, and the footer says that
   * instead of showing a date it made up.
   */
  const lastPublished = versions.find((v) => v.kind === 'publish')?.createdAt ?? null

  return (
    <PagesBoard
      pages={pages}
      host={site?.primaryHost ?? null}
      lastPublished={lastPublished}
      hasDraft={status.hasDraft}
    />
  )
}
