import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSiteSettings } from '@/lib/site'
import { loadPageSections } from '@/lib/sections/load'
import PageBody from '@/components/PageBody'
import { pageMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

/**
 * The Shop page is a list of sections, edited in the canvas at /edit/shop.
 * Until its first Publish it is drawn by lib/sections/legacy.ts as it always
 * was: the print wall. The wall itself — texture, heading typeface, closing
 * quote — is Shop settings, put around the page by lib/sections/frame.tsx.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Title, description, share image and indexing: set in the canvas (Page
  // settings), otherwise worked out from the page. See lib/seo.ts.
  const { sections, settings } = await loadPageSections('shop')
  return pageMetadata('shop', sections, settings)
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  const settings = await getSiteSettings()

  // An unpublished shop stays invisible rather than showing an empty page.
  if (!settings.show_shop) notFound()

  const [{ sections }, { c }] = await Promise.all([loadPageSections('shop'), searchParams])

  return <PageBody sections={sections} settings={settings} page="shop" query={{ c }} />
}
