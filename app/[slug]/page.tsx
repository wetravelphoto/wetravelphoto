import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSiteSettings } from '@/lib/site'
import { loadPageSections } from '@/lib/sections/load'
import { sanitizeCustomPages } from '@/lib/sections/pages'
import PageBody from '@/components/PageBody'
import { pageMetadata } from '@/lib/seo'

export const revalidate = 60

/**
 * THE PHOTOGRAPHER'S OWN PAGES — /weddings, /workshops, …
 *
 * Created in the editor (Pages & menu) and listed in site_settings.custom_pages.
 * Every fixed route in app/ (about, journal, trips, admin, …) is matched before
 * this one, and those addresses are refused when a page is created
 * (RESERVED in lib/sections/pages.ts), so this only ever sees addresses that
 * belong to the photographer.
 *
 * The page is found by its address, then drawn by its KEY: its sections are
 * filed under the key, so renaming the address moves nothing.
 */
async function findBySlug(slug: string) {
  const settings = await getSiteSettings()
  return sanitizeCustomPages(settings.custom_pages).find((p) => p.slug === slug) ?? null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const page = await findBySlug(slug)
  if (!page) return { title: 'Not found' }

  const { sections, settings } = await loadPageSections(page.key)
  return pageMetadata(page.key, sections, settings)
}

export default async function CustomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = await findBySlug(slug)
  if (!page) notFound()

  const { sections, settings } = await loadPageSections(page.key)
  return <PageBody sections={sections} settings={settings} page={page.key} />
}
