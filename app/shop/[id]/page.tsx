import { getPublishedEntry, getRelated, displayTitle } from '@/lib/catalog'
import { getShopCategories, formatMoney } from '@/lib/shop'
import { getSiteSettings } from '@/lib/site'
import { srcSetFor, displayUrl } from '@/lib/srcset'
import { pieceStyle } from '@/lib/frame'
import { wallStyle, googleFontHref } from '@/lib/wall'
import FramedArt from '@/components/shop/FramedArt'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import FramedPrint from '@/components/shop/FramedPrint'
import BuyPanel, { type BuyOption } from '@/components/shop/BuyPanel'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import '../../frame.css'
import '../shop.css'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const [settings, entry] = await Promise.all([getSiteSettings(), getPublishedEntry(id)])

  if (!entry) return { title: settings.site_title }

  const title = displayTitle(entry, entry.photo)

  return {
    title: `${title} — ${settings.shop_heading || 'Prints'} — ${settings.site_title}`,
    description: entry.description ?? settings.shop_subheading ?? undefined,
  }
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const settings = await getSiteSettings()

  if (!settings.show_shop) notFound()

  const entry = await getPublishedEntry(id)
  if (!entry) notFound()

  const [categories, related] = await Promise.all([getShopCategories(), getRelated(entry, 3)])

  const title = displayTitle(entry, entry.photo)
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))

  // The eyebrow names the section this print belongs to, falling back to the
  // site itself — the same slot a shop would use for a collection or a label
  const firstCategory = categories.find((c) => entry.categoryIds.includes(c.id))
  const eyebrow = firstCategory?.name ?? settings.site_title

  const options: BuyOption[] = entry.products.map((p) => ({
    id: p.id,
    label: p.size_label ?? 'Print',
    kind: p.type ?? 'print',
    price_cents: p.price_cents,
  }))

  const fontHref = googleFontHref(settings.shop_title_font)

  return (
    <main className="wall shop-page" style={wallStyle(settings)}>
      {fontHref && <link rel="stylesheet" href={fontHref} />}

      <SiteHeader />

      <div className="shop-body">
        <div className="shop-inner">
          <p className="shop-crumb">
            <Link href="/shop">← {settings.shop_heading || 'Prints'}</Link>
          </p>

          <div className="product-layout">
            <FramedPrint
              imageUrl={displayUrl(entry.photo)}
              srcSet={srcSetFor(entry.photo)}
              alt={entry.photo.alt_text ?? title}
              width={entry.photo.width}
              height={entry.photo.height}
            />

            <div className="product-buy">
              {eyebrow && <p className="product-eyebrow">{eyebrow}</p>}
              <h1 className="product-title">{title}</h1>

              {settings.shop_show_location !== false && entry.location?.trim() && (
                <p className="product-location">{entry.location.trim()}</p>
              )}

              <BuyPanel
                options={options}
                currency={settings.shop_currency}
                orderNote={settings.shop_order_note}
              />

              {entry.description && (
                <div className="product-description">
                  {entry.description
                    .split('\n\n')
                    .filter(Boolean)
                    .map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                </div>
              )}

              {entry.tags.length > 0 && (
                <p className="product-tags">
                  {entry.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </p>
              )}
            </div>
          </div>

          {related.length > 0 && (
            <section className="related">
              <h2 className="related-heading">You may also like</h2>

              {/* Framed and hung by the same rules as the shop wall, so a
                  vertical sitting between two landscapes still lines up. */}
              <div
                className="wall-grid"
                style={{ '--cols-wide': '3' } as React.CSSProperties}
              >
                {related.map((item) => {
                  const itemTitle = displayTitle(item, item.photo)
                  const from = item.products.length
                    ? Math.min(...item.products.map((p) => p.price_cents))
                    : null

                  const sub = [
                    settings.shop_show_location !== false ? item.location?.trim() : null,
                    settings.shop_show_collection !== false
                      ? categoryName.get(item.categoryIds[0] ?? '')
                      : null,
                    settings.shop_show_price !== false && from !== null
                      ? formatMoney(from, settings.shop_currency)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')

                  return (
                    <div key={item.photo_id} className="wall-col">
                      <Link
                        href={`/shop/${item.photo_id}`}
                        className="piece"
                        style={pieceStyle(item.photo.width, item.photo.height) as React.CSSProperties}
                      >
                        <FramedArt
                          imageUrl={displayUrl(item.photo)}
                          srcSet={srcSetFor(item.photo)}
                          alt={item.photo.alt_text ?? itemTitle}
                          width={item.photo.width}
                          height={item.photo.height}
                          sizes="(max-width: 560px) 84vw, (max-width: 900px) 42vw, 300px"
                        />

                        <div className="piece-meta">
                          <div className="piece-title">{itemTitle}</div>
                          {sub && <div className="piece-sub">{sub}</div>}
                          <span className="piece-rule" aria-hidden />
                        </div>
                      </Link>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {settings.shop_quote && (
        <section className="wall-quote">
          <div className="shop-inner">
            <p className="wall-quote-text">{settings.shop_quote}</p>
            {settings.shop_quote_by && <p className="wall-quote-by">— {settings.shop_quote_by}</p>}
          </div>
        </section>
      )}

      <SiteFooter />
    </main>
  )
}
