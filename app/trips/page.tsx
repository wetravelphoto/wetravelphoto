import type { Metadata } from 'next'
import { loadPageSections } from '@/lib/sections/load'
import PageBody from '@/components/PageBody'
import { pageMetadata } from '@/lib/seo'

export const revalidate = 60

/**
 * The Galleries page is a list of sections, edited in the canvas at
 * /edit/galleries (the address stays /trips). Until its first Publish it is
 * drawn by lib/sections/legacy.ts as it always was: the galleries section in
 * its grid layout — every public gallery as a tile.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Title, description, share image and indexing: set in the canvas (Page
  // settings), otherwise worked out from the page. See lib/seo.ts.
  const { sections, settings } = await loadPageSections('galleries')
  return pageMetadata('galleries', sections, settings)
}

export default async function GalleriesPage() {
  const { sections, settings } = await loadPageSections('galleries')

  return <PageBody sections={sections} settings={settings} page="galleries" />
}
