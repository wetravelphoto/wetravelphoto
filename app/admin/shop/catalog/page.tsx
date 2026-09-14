import { getCatalog, displayTitle } from '@/lib/catalog'
import { getShopCategories, formatMoney } from '@/lib/shop'
import { displayUrl, srcSetFor, SIZES_ATTR } from '@/lib/srcset'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function CatalogPage() {
  const [entries, categories] = await Promise.all([getCatalog(), getShopCategories()])

  const categoryName = new Map(categories.map((c) => [c.id, c.name]))

  const published = entries.filter((e) => e.is_published).length
  const needsWork = entries.filter((e) => !e.title || e.products.filter((p) => p.is_active).length === 0)

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="gallery-head">
        <div>
          <h1 className="admin-h1">Catalogue</h1>
          <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>
            {entries.length} print{entries.length === 1 ? '' : 's'} · {published} published
            {needsWork.length > 0 && <> · {needsWork.length} need attention</>}
          </p>
        </div>
        <Link href="/admin/shop" className="admin-btn admin-btn-ghost admin-btn-sm">
          Sizes &amp; categories
        </Link>
      </div>

      <p className="admin-meta" style={{ margin: '0 0 1.5rem', lineHeight: 1.6, maxWidth: '44rem' }}>
        Everything you&apos;ve marked with the <strong>$</strong> button inside a gallery lands here.
        Give each print a title, a description and its own sizes before publishing it to the shop.
      </p>

      {entries.length === 0 ? (
        <div className="admin-empty">
          <p style={{ margin: '0 0 1rem' }}>Nothing marked for sale yet.</p>
          <Link href="/admin/trips" className="admin-btn">
            Go to galleries
          </Link>
        </div>
      ) : (
        <div className="catalog-rows">
          {entries.map((entry) => {
            const active = entry.products.filter((p) => p.is_active)
            const from = active.length ? Math.min(...active.map((p) => p.price_cents)) : null
            const untitled = !entry.title

            return (
              <Link
                key={entry.photo_id}
                href={`/admin/shop/catalog/${entry.photo_id}`}
                className="catalog-row"
                data-unpublished={!entry.is_published}
              >
                <div className="catalog-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={displayUrl(entry.photo)}
                    srcSet={srcSetFor(entry.photo)}
                    sizes={SIZES_ATTR.thumb}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </div>

                <div className="catalog-main">
                  <span className="catalog-title" data-muted={untitled}>
                    {displayTitle(entry, entry.photo)}
                  </span>

                  <span className="admin-meta">
                    {active.length > 0 ? (
                      <>
                        {active.length} size{active.length === 1 ? '' : 's'}
                        {from !== null && <> · from {formatMoney(from)}</>}
                      </>
                    ) : (
                      <span style={{ color: 'var(--admin-danger)' }}>No sizes yet</span>
                    )}
                  </span>

                  {entry.categoryIds.length > 0 && (
                    <span className="catalog-cats">
                      {entry.categoryIds.map((id) => (
                        <span key={id} className="admin-tag">
                          {categoryName.get(id) ?? '—'}
                        </span>
                      ))}
                    </span>
                  )}
                </div>

                <div className="catalog-state">
                  {!entry.is_published && <span className="admin-tag">Hidden</span>}
                  {untitled && <span className="admin-tag">Needs a title</span>}
                  <span className="catalog-chevron" aria-hidden>
                    ›
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
