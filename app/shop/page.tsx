import { getSiteSettings } from '@/lib/site'
import { getShopCategories, formatMoney } from '@/lib/shop'
import { getPublishedCatalogResult, displayTitle } from '@/lib/catalog'
import { srcSetFor, displayUrl } from '@/lib/srcset'
import { pieceStyle } from '@/lib/frame'
import { wallStyle, googleFontHref } from '@/lib/wall'
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
    description: settings.shop_subheading ?? settings.shop_intro ?? settings.tagline ?? undefined,
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
  const { entries, failed } = await getPublishedCatalogResult(active?.id ?? null)

  // A shop with nothing in it and a shop that couldn't be read look identical
  // to a visitor, so they get different words.
  const columns = Number(settings.shop_columns) || 4

  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const fontHref = googleFontHref(settings.shop_title_font)

  return (
    <main className="wall shop-page" style={wallStyle(settings)}>
      {/* The wall's typeface is the owner's choice, so it's fetched at runtime
          the same way the gallery covers fetch theirs. */}
      {fontHref && <link rel="stylesheet" href={fontHref} />}

      <SiteHeader />

      <div className="shop-body">
        <div className="shop-inner">
          <header className="wall-head">
            {settings.shop_eyebrow && <p className="wall-overline">{settings.shop_eyebrow}</p>}

            <h1 className="wall-title">{settings.shop_heading || 'Prints'}</h1>

            {settings.shop_subheading && (
              <p className="wall-subhead">{settings.shop_subheading}</p>
            )}

            <span className="wall-rule" aria-hidden />

            {categories.length > 0 && (
              <nav className="wall-filters" aria-label="Categories">
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
          </header>

          {settings.shop_intro && <p className="wall-intro">{settings.shop_intro}</p>}

          {entries.length > 0 ? (
            <div
              className="wall-grid"
              style={{ '--cols-wide': String(columns) } as React.CSSProperties}
            >
              {entries.map((entry, index) => {
                const title = displayTitle(entry, entry.photo)

                const from = entry.products.length
                  ? Math.min(...entry.products.map((p) => p.price_cents))
                  : null

                // One quiet line under the title. Each part can be switched
                // off in the shop settings, and an empty line simply isn't
                // rendered rather than leaving a gap.
                const sub = [
                  settings.shop_show_location !== false ? entry.location?.trim() : null,
                  settings.shop_show_collection !== false
                    ? categoryName.get(entry.categoryIds[0] ?? '')
                    : null,
                  settings.shop_show_price !== false && from !== null
                    ? formatMoney(from, settings.shop_currency)
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <div key={entry.photo_id} className="wall-col">
                    <Link
                      href={`/shop/${entry.photo_id}`}
                      className="piece"
                      style={pieceStyle(entry.photo.width, entry.photo.height) as React.CSSProperties}
                    >
                      <FramedArt
                        imageUrl={displayUrl(entry.photo)}
                        srcSet={srcSetFor(entry.photo)}
                        alt={entry.photo.alt_text ?? title}
                        width={entry.photo.width}
                        height={entry.photo.height}
                        eager={index < columns}
                      />

                      <div className="piece-meta">
                        <div className="piece-title">{title}</div>
                        {sub && <div className="piece-sub">{sub}</div>}
                        <span className="piece-rule" aria-hidden />
                      </div>
                    </Link>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="wall-empty">
              {failed
                ? "The prints couldn't be loaded just now. Please try again shortly."
                : active
                  ? `Nothing in ${active.name} yet.`
                  : 'No prints available just yet — check back shortly.'}
            </p>
          )}
        </div>
      </div>

      {settings.shop_quote && (
        <section className="wall-quote">
          <div className="shop-inner">
            <p className="wall-quote-text">{settings.shop_quote}</p>
            {settings.shop_quote_by && (
              <p className="wall-quote-by">— {settings.shop_quote_by}</p>
            )}
          </div>
        </section>
      )}

      <SiteFooter />
    </main>
  )
}
