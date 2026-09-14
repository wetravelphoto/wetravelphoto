import { getSiteSettings } from '@/lib/site'
import { getShopCategories, formatMoney } from '@/lib/shop'
import { getPublishedCatalog, displayTitle } from '@/lib/catalog'
import { srcSetFor, displayUrl } from '@/lib/srcset'
import FramedArt from '@/components/shop/FramedArt'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import '../frame.css'
import './shop.css'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  return {
    title: `${settings.shop_heading || 'Prints'} — ${settings.site_title}`,
    description: settings.shop_intro ?? settings.tagline ?? undefined,
  }
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  const settings = await getSiteSettings()

  // An unpublished shop stays invisible rather than showing an empty page
  if (!settings.show_shop) notFound()

  const { c: activeSlug } = await searchParams
  const categories = await getShopCategories()
  const active = categories.find((cat) => cat.slug === activeSlug) ?? null

  // Only prints with a published catalogue entry — a photograph marked for
  // sale but never written up doesn't belong in front of a customer
  const entries = await getPublishedCatalog(active?.id ?? null)

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 5rem' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div className="shop-head">
            {settings.shop_eyebrow && <p className="eyebrow">{settings.shop_eyebrow}</p>}
            <h1 className="display shop-title">{settings.shop_heading || 'Prints'}</h1>
            {settings.shop_intro && <p className="shop-intro">{settings.shop_intro}</p>}
          </div>

          {categories.length > 0 && (
            <nav className="shop-filters" aria-label="Categories">
              <Link href="/shop" data-active={!active}>
                All
              </Link>
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={`/shop?c=${category.slug}`}
                  data-active={active?.id === category.id}
                >
                  {category.name}
                </Link>
              ))}
            </nav>
          )}

          {entries.length > 0 ? (
            /* Every frame shares one height, so mixed shapes still line up and
               the moulding reads the same thickness right across the wall. */
            <div className="wall shop-wall">
              <div className="wall-row">
                {entries.map((entry, index) => {
                  const title = displayTitle(entry, entry.photo)
                  const from = entry.products.length
                    ? Math.min(...entry.products.map((p) => p.price_cents))
                    : null

                  return (
                    <Link
                      key={entry.photo_id}
                      href={`/shop/${entry.photo_id}`}
                      className="piece"
                    >
                      <FramedArt
                        imageUrl={displayUrl(entry.photo)}
                        srcSet={srcSetFor(entry.photo)}
                        alt={entry.photo.alt_text ?? title}
                        width={entry.photo.width}
                        height={entry.photo.height}
                        sizes="(max-width: 620px) 45vw, 340px"
                        eager={index < 3}
                      />

                      <div className="piece-caption">
                        <span className="piece-title">{title}</span>
                        {from !== null && (
                          <span className="piece-price">
                            {formatMoney(from, settings.shop_currency)}
                          </span>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--ink-mute)' }}>
              {active
                ? `Nothing in ${active.name} yet.`
                : 'No prints available just yet — check back shortly.'}
            </p>
          )}
        </div>
      </div>

      <SiteFooter />
    </main>
  )
}
