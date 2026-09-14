import { getCatalogEntry, displayTitle, orientationOf, frameFor } from '@/lib/catalog'
import { getShopCategories, centsToInput } from '@/lib/shop'
import { getSiteSettings } from '@/lib/site'
import { saveCatalogItem } from '@/app/actions/catalog'
import { displayUrl, srcSetFor, SIZES_ATTR } from '@/lib/srcset'
import SaveBar from '@/components/admin/SaveBar'
import Toggle from '@/components/admin/Toggle'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function CatalogItemEditor({
  params,
}: {
  params: Promise<{ photoId: string }>
}) {
  const { photoId } = await params

  const [entry, categories, settings] = await Promise.all([
    getCatalogEntry(photoId),
    getShopCategories(),
    getSiteSettings(),
  ])

  if (!entry) notFound()

  const save = saveCatalogItem.bind(null, photoId)

  const orientation = orientationOf(entry.photo.width, entry.photo.height)
  const frame = frameFor(settings.shop_frames, orientation)

  return (
    <div style={{ maxWidth: 980 }}>
      <form action={save} autoComplete="off">
        <SaveBar label="Save print" title="Catalogue" />

        <p className="admin-crumb" style={{ marginBottom: '1.25rem' }}>
          <Link href="/admin/shop/catalog">← Catalogue</Link>
        </p>

        <div className="catalog-editor">
          {/* ---------- PREVIEW ---------- */}
          <div>
            <div className="catalog-frame" style={{ backgroundImage: `url(${frame.path})` }}>
              <div
                className="catalog-frame-opening"
                style={{
                  top: `${frame.top}%`,
                  left: `${frame.left}%`,
                  width: `${frame.width}%`,
                  height: `${frame.height}%`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displayUrl(entry.photo)}
                  srcSet={srcSetFor(entry.photo)}
                  sizes={SIZES_ATTR.halfWidth}
                  alt=""
                  decoding="async"
                />
              </div>
            </div>

            <p className="admin-meta" style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>
              {orientation === 'landscape' && 'Landscape frame'}
              {orientation === 'portrait' && 'Portrait frame'}
              {orientation === 'square' && 'Square frame'}
              {entry.photo.width && entry.photo.height && (
                <> · {entry.photo.width} × {entry.photo.height}px</>
              )}
              . This is how the print appears in the shop.
            </p>
          </div>

          {/* ---------- DETAILS ---------- */}
          <div>
            <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
              <h2 className="admin-h2">Listing</h2>

              <Toggle
                name="is_published"
                label="Show in the shop"
                defaultChecked={entry.is_published}
                note="Turning this off hides the print without unmarking the photograph. Its sizes and copy are kept."
              />

              <label className="admin-field">
                Title
                <input
                  type="text"
                  name="title"
                  defaultValue={entry.title ?? ''}
                  placeholder={displayTitle({ title: null }, entry.photo)}
                  className="admin-input"
                />
                <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
                  What the customer sees. Separate from the gallery caption.
                </span>
              </label>

              <label className="admin-field">
                Description
                <textarea
                  name="description"
                  defaultValue={entry.description ?? ''}
                  rows={5}
                  placeholder="Where it was taken, how it's printed, anything that helps someone picture it on their wall."
                  className="admin-input"
                />
              </label>

              <label className="admin-field">
                Tags
                <input
                  type="text"
                  name="tags"
                  defaultValue={(entry.tags ?? []).join(', ')}
                  placeholder="sunrise, horses, mist"
                  className="admin-input"
                />
                <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
                  Comma separated. Your own selling tags — not the keywords imported with the file.
                </span>
              </label>
            </div>

            <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
              <h2 className="admin-h2">Categories</h2>
              {categories.length > 0 ? (
                <div className="catalog-cat-grid">
                  {categories.map((category) => (
                    <label key={category.id} className="shop-check">
                      <input
                        type="checkbox"
                        name="category_id"
                        value={category.id}
                        defaultChecked={entry.categoryIds.includes(category.id)}
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="admin-meta" style={{ margin: 0 }}>
                  No categories yet — add some under <Link href="/admin/shop">Shop</Link>.
                </p>
              )}
            </div>

            <div className="admin-panel">
              <h2 className="admin-h2">Sizes for this print</h2>
              <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
                These belong to this print alone. The shop price list only seeds them, so a
                panorama can sell in different formats to a portrait.
              </p>

              {entry.products.length > 0 ? (
                <div className="shop-rows">
                  {entry.products.map((product) => (
                    <div key={product.id} className="shop-row" data-inactive={!product.is_active}>
                      <input type="hidden" name="product_id" value={product.id} />

                      <input
                        type="text"
                        name={`label_${product.id}`}
                        defaultValue={product.size_label ?? ''}
                        aria-label="Size"
                        className="admin-input"
                      />

                      <select
                        name={`kind_${product.id}`}
                        defaultValue={product.type ?? 'print'}
                        aria-label="Kind"
                        className="admin-select"
                      >
                        <option value="print">Print</option>
                        <option value="framed">Framed</option>
                        <option value="canvas">Canvas</option>
                      </select>

                      <div className="shop-price">
                        <span aria-hidden>$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          name={`price_${product.id}`}
                          defaultValue={centsToInput(product.price_cents)}
                          aria-label="Price in dollars"
                          className="admin-input"
                        />
                      </div>

                      <label className="shop-check" title="Offered to customers">
                        <input
                          type="checkbox"
                          name={`active_${product.id}`}
                          defaultChecked={product.is_active}
                        />
                        Offered
                      </label>

                      <label className="shop-check shop-check-danger" title="Delete on save">
                        <input type="checkbox" name={`remove_${product.id}`} />
                        Remove
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="admin-empty" style={{ marginBottom: '1rem' }}>
                  <p style={{ margin: 0 }}>No sizes yet. Add one below.</p>
                </div>
              )}

              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <h3 className="admin-meta" style={{ margin: '0 0 0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Add a size
                </h3>
                <div className="shop-add">
                  <input
                    type="text"
                    name="new_label"
                    placeholder={'20 × 30"'}
                    aria-label="New size"
                    className="admin-input"
                  />
                  <select name="new_kind" defaultValue="print" aria-label="Kind" className="admin-select">
                    <option value="print">Print</option>
                    <option value="framed">Framed</option>
                    <option value="canvas">Canvas</option>
                  </select>
                  <div className="shop-price">
                    <span aria-hidden>$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      name="new_price"
                      placeholder="245.00"
                      aria-label="New price"
                      className="admin-input"
                    />
                  </div>
                  <span className="admin-meta">Added when you save</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
