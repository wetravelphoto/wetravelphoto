import type { Metadata } from 'next'
import { loadPageSections } from '@/lib/sections/load'
import PageBody from '@/components/PageBody'
import { pageMetadata } from '@/lib/seo'

export const revalidate = 60

/**
 * The Journal page is a list of sections, edited in the canvas at
 * /edit/journal. Until its first Publish it is drawn by lib/sections/legacy.ts
 * as it always was: the journal section in its grid layout — every story, the
 * newest drawn large.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Title, description, share image and indexing: set in the canvas (Page
  // settings), otherwise worked out from the page. See lib/seo.ts.
  const { sections, settings } = await loadPageSections('journal')
  return pageMetadata('journal', sections, settings)
}

export default async function JournalPage() {
  const { sections, settings } = await loadPageSections('journal')

  return <PageBody sections={sections} settings={settings} page="journal" />
}
