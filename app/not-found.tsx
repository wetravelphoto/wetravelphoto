import { getSiteSettings } from '@/lib/site'
import { loadPageSections } from '@/lib/sections/load'
import PageBody from '@/components/PageBody'

/**
 * PAGE NOT FOUND — now the photographer's own page.
 *
 * Next draws this in place of any address that does not exist, and in place
 * of anything that calls notFound() (a private album, a story that was taken
 * down). It used to be laid out here in code; it is now an editor page
 * ("Not found (404)" in the page menu), so it carries the site's header,
 * footer and style like every other page, and its words can be changed.
 *
 * Until its first Publish it is drawn from lib/sections/legacy.ts, which
 * reproduces what this file used to say.
 *
 * It cannot be in the menu (lib/menu.ts): it has no address of its own.
 */
export default async function NotFound() {
  const [{ sections }, settings] = await Promise.all([
    loadPageSections('notfound'),
    getSiteSettings(),
  ])

  return <PageBody sections={sections} settings={settings} page="notfound" />
}
