import { getPublishedEntry, getRelated, displayTitle } from '@/lib/catalog'
import { getShopCategories, formatMoney } from '@/lib/shop'
import { getSiteSettings } from '@/lib/site'
import { getRoomScenes } from '@/lib/scenes'
import { srcSetFor, displayUrl } from '@/lib/srcset'
import { pieceStyle, shapeOf } from '@/lib/frame'
import { wallStyle, googleFontHref, features, footerLines } from '@/lib/wall'
import FramedArt from '@/components/shop/FramedArt'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import ProductViews from '@/components/shop/ProductViews'
import BuyPanel, { type BuyOption } from '@/components/shop/BuyPanel'
import FeatureIcon from '@/components/shop/FeatureIcon'
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

  const [categories, related, scenes] = await Promise.all([
    getShopCategories(),
    getRelated(entry, 4),
    getRoomScenes(false, settings.shop_preset_rooms !== false),
  ])

  const title = displayTitle(entry, entry.photo)
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const collection = categories.find((c) => entry.categoryIds.includes(c.id))?.name ?? null

  const options: BuyOption[] = entry.products.map((p) => ({
    id: p.id,
    label: p.size_label ?? 'Print',
    kind: p.type ?? 'print',
    price_cents: p.price_cents,
  }))

  const shape = shapeOf(entry.photo.width, entry.photo.height)
  const orientation =
    shape === 'portrait' ? 'Portrait' : shape === 'square' ? 'Square' : 'Landscape'

  const blurbs = features(settings)
  const fontHref = googleFontHref(settings.shop_title_font)
  const shopLabel = settings.shop_heading || 'Prints'

  return (
    <main className="shop-page product-page" style={wallStyle(settings)}>
      {fontHref && <link rel="stylesheet" href={fontHref} />}

      <SiteHeader />

      <div className="shop-body">
        <div className="shop-inner">
          {/* ---------- Crumbs and the corner line ---------- */}
          <div className="product-top">
            {settings.shop_show_breadcrumbs !== false ? (
              <nav className="shop-crumb" aria-label="Breadcrumb">
                <Link href="/">Home</Link>
                <span aria-hidden>/</span>
                <Link href="/shop">{shopLabel}</Link>
                <span aria-hidden>/</span>
                <span aria-current="page">{title}</span>
              </nav>
            ) : (
              <nav className="shop-crumb" aria-label="Breadcrumb">
                <Link href="/shop">← {shopLabel}</Link>
              </nav>
            )}

            {settings.shop_corner_line && (
              <p className="product-corner">{settings.shop_corner_line}</p>
            )}
          </div>

          <div className="product-layout">
            {/* ---------- Views ---------- */}
            <ProductViews
              imageUrl={displayUrl(entry.photo)}
              srcSet={srcSetFor(entry.photo)}
              alt={entry.photo.alt_text ?? title}
              width={entry.photo.width}
              height={entry.photo.height}
              scenes={scenes}
              hint="Click to enlarge"
            />

            {/* ---------- Buying ---------- */}
            <div className="product-buy">
              <h1 className="product-title">{title}</h1>

              {collection && settings.shop_show_collection !== false && (
                <p className="product-collection">{collection}</p>
              )}

              {settings.shop_show_location !== false && entry.location?.trim() && (
                <p className="product-location">{entry.location.trim()}</p>
              )}

              <span className="product-rule" aria-hidden />

              <BuyPanel
                options={options}
                currency={settings.shop_currency}
                orderNote={settings.shop_order_note}
                orientation={orientation}
                description={entry.description}
              />

              {blurbs.length > 0 && (
                <ul className="product-features">
                  {blurbs.map((blurb, i) => (
                    <li key={i}>
                      <FeatureIcon name={blurb.icon} />
                      <div>
                        <p className="product-feature-title">{blurb.title}</p>
                        {blurb.body && <p className="product-feature-body">{blurb.body}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
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

          {/* ---------- You may also like ---------- */}
          {related.length > 0 && (
            <section className="related">
              {settings.shop_related_overline && (
                <p className="wall-overline">{settings.shop_related_overline}</p>
              )}
              <h2 className="related-heading">
                {settings.shop_related_heading || 'You may also like'}
              </h2>
              <span className="wall-rule" aria-hidden />

              <div className="wall-grid" style={{ '--cols-wide': '4' } as React.CSSProperties}>
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
                          sizes="(max-width: 560px) 84vw, (max-width: 900px) 42vw, 260px"
                        />

                        <div className="piece-meta piece-meta-centre">
                          <div className="piece-title">{itemTitle}</div>
                          {sub && <div className="piece-sub">{sub}</div>}
                          {settings.shop_show_price !== false && from !== null && (
                            <div className="piece-price">
                              {formatMoney(from, settings.shop_currency)}
                            </div>
                          )}
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

      {/* ---------- Footer band ---------- */}
      {(settings.shop_quote || settings.shop_footer_left || settings.shop_footer_right) && (
        <section className="wall-band">
          <div className="wall-band-inner">
            <div className="wall-band-side">
              {footerLines(settings.shop_footer_left).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>

            <div className="wall-band-centre">
              {settings.shop_quote && (
                <p className="wall-quote-text">&ldquo;{settings.shop_quote}&rdquo;</p>
              )}
              {settings.shop_quote_by && <p className="wall-quote-by">— {settings.shop_quote_by}</p>}
            </div>

            <div className="wall-band-side wall-band-end">
              {footerLines(settings.shop_footer_right).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        </section>
      )}

      <SiteFooter />
    </main>
  )
}
