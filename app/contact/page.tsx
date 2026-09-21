import type { Metadata } from 'next'
import { loadPageSections } from '@/lib/sections/load'
import { PAGES } from '@/lib/sections/pages'
import PageBody from '@/components/PageBody'

export const revalidate = 300

/**
 * The Contact page is a list of sections, edited in the canvas at
 * /edit/contact. Until its first Publish it is drawn by lib/sections/legacy.ts
 * as it always was: a heading, the intro line, and the form.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await loadPageSections('contact')
  return { title: `Contact — ${settings.site_title}` }
}

export default async function ContactPage() {
  const { sections, settings } = await loadPageSections('contact')

  return <PageBody sections={sections} settings={settings} fill={PAGES.contact.fill} />
}
