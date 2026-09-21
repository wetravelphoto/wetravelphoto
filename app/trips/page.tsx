import type { Metadata } from 'next'
import { loadPageSections } from '@/lib/sections/load'
import { str } from '@/lib/sections/registry'
import PageBody from '@/components/PageBody'

export const revalidate = 60

/**
 * The Galleries page is a list of sections, edited in the canvas at
 * /edit/galleries (the address stays /trips). Until its first Publish it is
 * drawn by lib/sections/legacy.ts as it always was: the galleries section in
 * its grid layout — every public gallery as a tile.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { sections, settings } = await loadPageSections('galleries')
  const grid = sections.find((s) => s.type === 'galleries' && s.visible)
  const heading = grid ? str(grid.settings, 'heading') : null

  return {
    title: `${heading || 'Galleries'} — ${settings.site_title}`,
    description: settings.tagline ?? undefined,
  }
}

export default async function GalleriesPage() {
  const { sections, settings } = await loadPageSections('galleries')

  return <PageBody sections={sections} settings={settings} page="galleries" />
}
