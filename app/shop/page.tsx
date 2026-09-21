import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getSiteSettings } from '@/lib/site'
import { loadPageSections } from '@/lib/sections/load'
import { str } from '@/lib/sections/registry'
import PageBody from '@/components/PageBody'

export const dynamic = 'force-dynamic'

/**
 * The Shop page is a list of sections, edited in the canvas at /edit/shop.
 * Until its first Publish it is drawn by lib/sections/legacy.ts as it always
 * was: the print wall. The wall itself — texture, heading typeface, closing
 * quote — is Shop settings, put around the page by lib/sections/frame.tsx.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { sections, settings } = await loadPageSections('shop')
  const wall = sections.find((s) => s.type === 'shop' && s.visible)
  const heading = wall ? str(wall.settings, 'heading') : null
  const subheading = wall ? str(wall.settings, 'subheading') : null

  return {
    title: `${heading || 'Prints'} — ${settings.site_title}`,
    description: subheading ?? settings.shop_intro ?? settings.tagline ?? undefined,
  }
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
