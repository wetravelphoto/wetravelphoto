import { loadPageSections } from '@/lib/sections/load'
import PageBody from '@/components/PageBody'
import './home.css'
import './home-polish.css'
import './hero.css'
import './instagram.css'
import './contact-footer.css'

export const revalidate = 60

/**
 * The homepage is now a list, not a layout.
 *
 * Every block on it comes from page_sections in the order stored there — or,
 * until the first save in the editor, from the site_settings columns by way of
 * lib/sections/legacy.ts. Either way this file does not know what a hero or a
 * journal is, which is the point: a new section type never touches it.
 *
 * It also does not know that drafts exist. The editor's unpublished work lives
 * in site_draft and is read only by lib/drafts/store.ts, so there is no path
 * by which an unpublished homepage reaches a visitor — not a filter that has
 * to be remembered, an absence of one that would have to be added.
 *
 * Note the revalidate above: this route stays cached. That is why the preview
 * is a separate route rather than a draft-mode cookie on this one, which would
 * have made every visit to the homepage dynamic.
 */
export default async function HomePage() {
  const { sections, settings } = await loadPageSections('home')

  return <PageBody sections={sections} settings={settings} page="home" />
}
