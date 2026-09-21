import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSiteSettings } from '@/lib/site'
import { loadPageSections } from '@/lib/sections/load'
import { str } from '@/lib/sections/registry'
import PageBody from '@/components/PageBody'

export const revalidate = 300

/**
 * The About page is a list of sections, edited in the canvas at /edit/about.
 *
 * Until its first Publish it is drawn from the old about_* columns by
 * lib/sections/legacy.ts, which reproduces the page exactly as it was — one
 * About section: the photograph beside the story.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { sections, settings } = await loadPageSections('about')
  // The title follows the page's own heading, as it always did — now read
  // from its first About section rather than a column.
  const about = sections.find((s) => s.type === 'about' && s.visible)
  const heading = about ? str(about.settings, 'heading') : null

  return {
    title: `${heading || 'About'} — ${settings.site_title}`,
    description: settings.tagline ?? undefined,
  }
}

export default async function AboutPage() {
  const settings = await getSiteSettings()

  // Switching the page off (Settings → Menu) makes it genuinely absent, not
  // just unlinked.
  if (settings.show_about === false) notFound()

  const { sections } = await loadPageSections('about')

  return <PageBody sections={sections} settings={settings} page="about" />
}
