import type { Metadata } from 'next'
import { loadPageSections } from '@/lib/sections/load'
import PageBody from '@/components/PageBody'
import { pageMetadata } from '@/lib/seo'

export const revalidate = 300

/**
 * The Contact page is a list of sections, edited in the canvas at
 * /edit/contact. Until its first Publish it is drawn by lib/sections/legacy.ts
 * as it always was: a heading, the intro line, and the form.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Title, description, share image and indexing: set in the canvas (Page
  // settings), otherwise worked out from the page. See lib/seo.ts.
  const { sections, settings } = await loadPageSections('contact')
  return pageMetadata('contact', sections, settings)
}

export default async function ContactPage() {
  const { sections, settings } = await loadPageSections('contact')

  return <PageBody sections={sections} settings={settings} page="contact" />
}
