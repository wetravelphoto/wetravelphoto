import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSiteSettings } from '@/lib/site'
import { loadPageSections } from '@/lib/sections/load'
import PageBody from '@/components/PageBody'
import { pageMetadata } from '@/lib/seo'

export const revalidate = 300

/**
 * The About page is a list of sections, edited in the canvas at /edit/about.
 *
 * Until its first Publish it is drawn from the old about_* columns by
 * lib/sections/legacy.ts, which reproduces the page exactly as it was — one
 * About section: the photograph beside the story.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Title, description, share image and indexing: set in the canvas (Page
  // settings), otherwise worked out from the page. See lib/seo.ts.
  const { sections, settings } = await loadPageSections('about')
  return pageMetadata('about', sections, settings)
}

export default async function AboutPage() {
  const settings = await getSiteSettings()

  // Switching the page off (Settings → Menu) makes it genuinely absent, not
  // just unlinked.
  if (settings.show_about === false) notFound()

  const { sections } = await loadPageSections('about')

  return <PageBody sections={sections} settings={settings} page="about" />
}
