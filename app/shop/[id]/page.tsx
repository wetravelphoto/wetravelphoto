import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { getPrintOptions } from '@/lib/shop'
import { srcSetFor, displayUrl, SIZES_ATTR } from '@/lib/srcset'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import BuyPanel, { type BuyOption } from '@/components/shop/BuyPanel'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import '../shop.css'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

type ProductRow = {
  id: string
  type: string | null
  size_label: string | null
  price_cents: number
  is_active: boolean
  sort_order: number
}

type PhotoRow = {
  id: string
  storage_path: string
  derivatives: Record<string, string> | null
  caption: string | null
  alt_text: string | null
  width: number | null
  height: number | null
  is_for_sale: boolean
  taken_at: string | null
  products: ProductRow[]
  albums: { title: string | null; location: string | null; privacy_type: string } | null
}

async function loadPhoto(id: string): Promise<PhotoRow | null> {
  const supabase = await createClient()

  // The FK has to be named. There are two relationships between photos and
  // albums — photos.album_id and albums.cover_photo_id — so a bare
  // `albums(...)` embed is ambiguous, and PostgREST answers with an error
  // rather than data. That surfaces here as a photo that doesn't exist.
  const { data, error } = await supabase
    .from('photos')
    .select(
      'id, storage_path, derivatives, caption, alt_text, width, height, is_for_sale, taken_at, ' +
        'products(id, type, size_label, price_cents, is_active, sort_order), ' +
        'albums!photos_album_id_fkey(title, location, privacy_type)'
    )
    .eq('id', id)
    .maybeSingle()

  // Never let a query failure masquerade as a 404
  if (error) console.error('[shop] loadPhoto failed:', error.message)

  return (data as unknown as PhotoRow) ?? null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const [settings, photo] = await Promise.all([getSiteSettings(), loadPhoto(id)])

  const title = photo?.caption || 'Print'

  return {
    title: `${title} — ${settings.shop_heading || 'Prints'} — ${settings.site_title}`,
    description: settings.shop_intro ?? undefined,
  }
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const settings = await getSiteSettings()

  if (!settings.show_shop) notFound()

  const photo = await loadPhoto(id)
  if (!photo) notFound()

  const sellsEverything = settings.shop_mode === 'all'

  // Curated mode sells only what's been marked. Everything mode still won't
  // sell a photo from a private gallery.
  if (!sellsEverything && !photo.is_for_sale) notFound()
  if (sellsEverything && photo.albums?.privacy_type !== 'public' && !photo.is_for_sale) notFound()

  const own = (photo.products ?? [])
    .filter((p) => p.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)

  // A photo listed before an option existed, or one being sold under
  // "everything" mode, falls back to the live price list.
  const options: BuyOption[] =
    own.length > 0
      ? own.map((p) => ({
          id: p.id,
          label: p.size_label ?? 'Print',
          kind: p.type ?? 'print',
          price_cents: p.price_cents,
        }))
      : (await getPrintOptions()).map((o) => ({
          id: o.id,
          label: o.label,
          kind: o.kind,
          price_cents: o.price_cents,
        }))

  const aspect = photo.width && photo.height ? photo.width / photo.height : 1
  const title = photo.caption || 'Untitled'

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 5rem' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <p className="shop-crumb">
            <Link href="/shop">← {settings.shop_heading || 'Prints'}</Link>
          </p>

          <div className="product-head">
            <h1 className="display product-title">{title}</h1>
            {(photo.albums?.location || photo.albums?.title) && (
              <p className="product-origin">
                {photo.albums?.location || photo.albums?.title}
              </p>
            )}
          </div>

          {options.length > 0 ? (
            <BuyPanel
              options={options}
              imageUrl={displayUrl(photo)}
              srcSet={srcSetFor(photo)}
              alt={photo.alt_text ?? title}
              aspect={aspect}
              currency={settings.shop_currency}
              orderNote={settings.shop_order_note}
            />
          ) : (
            <div className="product-layout">
              <div className="wall">
                <div className="wall-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={displayUrl(photo)}
                    srcSet={srcSetFor(photo)}
                    sizes={SIZES_ATTR.halfWidth}
                    alt={photo.alt_text ?? title}
                    style={{ maxWidth: '70%', height: 'auto' }}
                  />
                </div>
              </div>
              <div className="product-buy">
                <p style={{ color: 'var(--ink-mute)' }}>
                  No sizes are set up yet. Add some in the admin under Shop.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <SiteFooter />
    </main>
  )
}
