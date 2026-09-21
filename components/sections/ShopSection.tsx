import Link from 'next/link'
import { formatMoney } from '@/lib/shop'
import { displayTitle } from '@/lib/catalog'
import { srcSetFor, displayUrl } from '@/lib/srcset'
import { pieceStyle } from '@/lib/frame'
import { num, str, type SectionSettings } from '@/lib/sections/registry'
import { editable, live } from '@/lib/sections/editable'
import type { SectionContext } from '@/lib/sections/context'
import FramedArt from '@/components/shop/FramedArt'
import '@/app/frame.css'
import '@/app/shop/shop.css'

/**
 * The print wall: the shop's three header lines, its categories, and every
 * published print hung in even columns.
 *
 * This is the markup app/shop/page.tsx used to draw by hand. What it does NOT
 * own is the wall itself — the texture, the heading typeface and the closing
 * quote. Those are shared with each print's own page, which is not edited in
 * the canvas, so they stay in Shop settings and are applied around the whole
 * page by lib/sections/frame.tsx.
 */
export default function ShopSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  const shop = ctx.shop
  const eyebrow = str(settings, 'eyebrow')
  const heading = str(settings, 'heading')
  const subheading = str(settings, 'subheading')
  const intro = str(settings, 'intro')
  const columns = Math.min(5, Math.max(2, Math.round(num(settings, 'columns', 3))))

  const categories = shop?.categories ?? []
  const active = shop?.active ?? null
  const entries = shop?.entries ?? []
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))

  return (
    <div className="shop-body">
      <div className="shop-inner">
        <header className="wall-head">
          {(eyebrow || ctx.editable) && (
            <p className="wall-overline" {...editable(ctx, 'eyebrow')}>
              {eyebrow}
            </p>
          )}

          <h1 className="wall-title" {...editable(ctx, 'heading')}>
            {heading || 'Prints'}
          </h1>

          {(subheading || ctx.editable) && (
            <p className="wall-subhead" {...editable(ctx, 'subheading')}>
              {subheading}
            </p>
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

        {(intro || ctx.editable) && (
          <p className="wall-intro" {...editable(ctx, 'intro')}>
            {intro}
          </p>
        )}

        {entries.length > 0 ? (
          <div
            className="wall-grid"
            // The column count is written as the custom property the grid
            // reads, on the element the editor repaints while the slider moves.
            style={{ '--cols-wide': String(columns) } as React.CSSProperties}
            {...live(ctx, ['columns'])}
          >
            {entries.map((entry, index) => {
              const title = displayTitle(entry, entry.photo)

              const from = entry.products.length
                ? Math.min(...entry.products.map((p) => p.price_cents))
                : null

              // One quiet line under the title. Each part can be switched off,
              // and an empty line simply isn't rendered rather than leaving a gap.
              const sub = [
                settings.show_location !== false ? entry.location?.trim() : null,
                settings.show_collection !== false
                  ? categoryName.get(entry.categoryIds[0] ?? '')
                  : null,
                settings.show_price !== false && from !== null
                  ? formatMoney(from, ctx.settings.shop_currency)
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
            {shop?.failed
              ? "The prints couldn't be loaded just now. Please try again shortly."
              : active
                ? `Nothing in ${active.name} yet.`
                : 'No prints available just yet — check back shortly.'}
          </p>
        )}
      </div>
    </div>
  )
}
