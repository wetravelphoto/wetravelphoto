import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { getShopCategories, getPrintOptions, formatMoney } from '@/lib/shop'
import { srcSetFor, displayUrl, SIZES_ATTR } from '@/lib/srcset'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Link from 'next/link'
import { notFound } from 'next/navigation'
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

type ShopPhoto = {
  id: string
  storage_path: string
  derivatives: Record<string, string> | null
  caption: string | null
  alt_text: string | null
  width: number | null
  height: number | null
  is_for_sale: boolean
  products: { price_cents: number; is_active: boolean }[]
  photo_shop_categories: { category_id: string }[]
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  const settings = await getSiteSettings()

  // Unpublished shop stays invisible rather than showing an empty page
  if (!settings.show_shop) notFound()

  const { c: activeSlug } = await searchParams
  const supabase = await createClient()

  const [categories, priceList] = await Promise.all([getShopCategories(), getPrintOptions()])

  const sellsEverything = settings.shop_mode === 'all'

  let query = supabase
    .from('photos')
    .select(
      'id, storage_path, derivatives, caption, alt_text, width, height, is_for_sale, ' +
        'products(price_cents, is_active), photo_shop_categories(category_id)'
    )
    .order('created_at', { ascending: false })

  if (!sellsEverything) query = query.eq('is_for_sale', true)

  const { data } = await query
  let photos = (data ?? []) as unknown as ShopPhoto[]

  const active = categories.find((cat) => cat.slug === activeSlug) ?? null

  if (active) {
    photos = photos.filter((p) =>
      (p.photo_shop_categories ?? []).some((link) => link.category_id === active.id)
    )
  }

  // In curated mode the price comes from the photo's own product rows. In
  // everything mode most photos have none, so the live price list stands in.
  const listPrice = priceList.length ? Math.min(...priceList.map((o) => o.price_cents)) : null

  function fromPrice(photo: ShopPhoto): number | null {
    const live = (photo.products ?? []).filter((p) => p.is_active).map((p) => p.price_cents)
    if (live.length > 0) return Math.min(...live)
    return sellsEverything ? listPrice : null
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 5rem' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
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

          {photos.length > 0 ? (
            <div className="shop-grid">
              {photos.map((photo) => {
                const price = fromPrice(photo)
                const ratio =
                  photo.width && photo.height ? photo.width / photo.height : 1

                return (
                  <Link key={photo.id} href={`/shop/${photo.id}`} className="shop-card">
                    <div className="shop-card-image" style={{ aspectRatio: String(ratio) }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={displayUrl(photo)}
                        srcSet={srcSetFor(photo)}
                        sizes={SIZES_ATTR.grid}
                        alt={photo.alt_text ?? photo.caption ?? 'Photograph'}
                        width={photo.width ?? undefined}
                        height={photo.height ?? undefined}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>

                    <div className="shop-card-meta">
                      <span className="shop-card-title">{photo.caption || 'Untitled'}</span>
                      {price !== null && (
                        <span className="shop-card-price">
                          from {formatMoney(price, settings.shop_currency)}
                        </span>
                      )}
                    </div>
                  </Link>
                )
              })}
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
