import { getPublishedEntry, getRelated, displayTitle } from '@/lib/catalog'
import { getShopCategories, formatMoney } from '@/lib/shop'
import { getSiteSettings } from '@/lib/site'
import { srcSetFor, displayUrl } from '@/lib/srcset'
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
    description: entry.description ?? settings.shop_intro ?? undefined,
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

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 5rem' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <p className="shop-crumb">
            <Link href="/shop">← {settings.shop_heading || 'Prints'}</Link>
          </p>

          <div className="product-layout">
            <div className="wall product-wall">
              <FramedPrint
                imageUrl={displayUrl(entry.photo)}
                srcSet={srcSetFor(entry.photo)}
                alt={entry.photo.alt_text ?? title}
                width={entry.photo.width}
                height={entry.photo.height}
              />
            </div>

            <div className="product-buy">
              {eyebrow && <p className="product-eyebrow">{eyebrow}</p>}
              <h1 className="product-title">{title}</h1>

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

              {/* Framed too, and on the same shared height — so a portrait
                  sitting between two landscapes still lines up. */}
              <div className="wall shop-wall">
                <div className="wall-row">
                  {related.map((item) => {
                    const itemTitle = displayTitle(item, item.photo)
                    const from = item.products.length
                      ? Math.min(...item.products.map((p) => p.price_cents))
                      : null

                    return (
                      <Link key={item.photo_id} href={`/shop/${item.photo_id}`} className="piece">
                        <FramedArt
                          imageUrl={displayUrl(item.photo)}
                          srcSet={srcSetFor(item.photo)}
                          alt={item.photo.alt_text ?? itemTitle}
                          width={item.photo.width}
                          height={item.photo.height}
                          sizes="(max-width: 620px) 45vw, 300px"
                        />

                        <div className="piece-caption">
                          <span className="piece-title">{itemTitle}</span>
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
            </section>
          )}
        </div>
      </div>

      <SiteFooter />
    </main>
  )
}
