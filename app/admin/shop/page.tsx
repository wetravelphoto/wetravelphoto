import { getPrintOptions, getShopCategories, countPhotosForSale, centsToInput, formatMoney } from '@/lib/shop'
import {
  createPrintOption,
  savePrintOptions,
  createShopCategory,
  saveShopCategories,
} from '@/app/actions/shop'
import SaveBar from '@/components/admin/SaveBar'

export const dynamic = 'force-dynamic'

export default async function ShopAdminPage() {
  const [options, categories, forSale] = await Promise.all([
    getPrintOptions(true),
    getShopCategories(),
    countPhotosForSale(),
  ])

  const activeOptions = options.filter((o) => o.is_active)
  const cheapest = activeOptions.length
    ? Math.min(...activeOptions.map((o) => o.price_cents))
    : null

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="gallery-head">
        <div>
          <h1 className="admin-h1">Shop</h1>
          <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>
            {forSale} photograph{forSale === 1 ? '' : 's'} for sale · {activeOptions.length} size
            {activeOptions.length === 1 ? '' : 's'}
            {cheapest !== null && <> · from {formatMoney(cheapest)}</>}
          </p>
        </div>
      </div>

      {/* ---------- PRINT SIZES ---------- */}

      <form action={savePrintOptions} autoComplete="off">
        <SaveBar label="Save sizes" title="Shop" />

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Sizes and prices</h2>
          <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
            Your price list, defined once. Marking a photograph for sale gives it these options.
            Changing a price here affects new listings only — photographs already for sale keep
            what they were listed at, so a customer never sees a price change mid-visit.
          </p>

          {options.length > 0 ? (
            <div className="shop-rows">
              {options.map((option) => (
                <div key={option.id} className="shop-row" data-inactive={!option.is_active}>
                  <input type="hidden" name="option_id" value={option.id} />

                  <input
                    type="text"
                    name={`label_${option.id}`}
                    defaultValue={option.label}
                    aria-label="Size"
                    className="admin-input"
                  />

                  <select
                    name={`kind_${option.id}`}
                    defaultValue={option.kind}
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
                      name={`price_${option.id}`}
                      defaultValue={centsToInput(option.price_cents)}
                      aria-label="Price in dollars"
                      className="admin-input"
                    />
                  </div>

                  <label className="shop-check" title="Shown in the shop">
                    <input
                      type="checkbox"
                      name={`active_${option.id}`}
                      defaultChecked={option.is_active}
                    />
                    Listed
                  </label>

                  <label className="shop-check shop-check-danger" title="Delete on save">
                    <input type="checkbox" name={`remove_${option.id}`} />
                    Remove
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <div className="admin-empty">
              <p style={{ margin: 0 }}>No sizes yet. Add one below.</p>
            </div>
          )}
        </div>
      </form>

      <div className="admin-panel" style={{ marginBottom: '2rem' }}>
        <h2 className="admin-h2">Add a size</h2>
        <form action={createPrintOption} autoComplete="off" className="shop-add">
          <input
            type="text"
            name="label"
            placeholder={'20 × 30"'}
            aria-label="Size"
            className="admin-input"
            required
          />
          <select name="kind" defaultValue="print" aria-label="Kind" className="admin-select">
            <option value="print">Print</option>
            <option value="framed">Framed</option>
            <option value="canvas">Canvas</option>
          </select>
          <div className="shop-price">
            <span aria-hidden>$</span>
            <input
              type="text"
              inputMode="decimal"
              name="price"
              placeholder="245.00"
              aria-label="Price in dollars"
              className="admin-input"
              required
            />
          </div>
          <button type="submit" className="admin-btn">
            Add
          </button>
        </form>
      </div>

      {/* ---------- CATEGORIES ---------- */}

      <form action={saveShopCategories} autoComplete="off">
        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Categories</h2>
          <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
            How the shop is browsed. Separate from the keywords imported with your photographs —
            those stay available for search, but they&apos;re too inconsistent to use as a menu.
            Renaming a category changes its web address.
          </p>

          {categories.length > 0 ? (
            <div className="shop-rows">
              {categories.map((category) => (
                <div key={category.id} className="shop-row shop-row-category">
                  <input type="hidden" name="category_id" value={category.id} />

                  <input
                    type="text"
                    name={`name_${category.id}`}
                    defaultValue={category.name}
                    aria-label="Category name"
                    className="admin-input"
                  />

                  <span className="admin-meta">/shop/{category.slug}</span>

                  <label className="shop-check shop-check-danger" title="Delete on save">
                    <input type="checkbox" name={`remove_${category.id}`} />
                    Remove
                  </label>
                </div>
              ))}
            </div>
          ) : (
            <div className="admin-empty">
              <p style={{ margin: 0 }}>No categories yet.</p>
            </div>
          )}

          <div style={{ marginTop: '1rem' }}>
            <button type="submit" className="admin-btn">
              Save categories
            </button>
          </div>
        </div>
      </form>

      <div className="admin-panel">
        <h2 className="admin-h2">Add a category</h2>
        <form action={createShopCategory} autoComplete="off" className="shop-add">
          <input
            type="text"
            name="name"
            placeholder="Underwater"
            aria-label="Category name"
            className="admin-input"
            required
          />
          <button type="submit" className="admin-btn">
            Add
          </button>
        </form>
      </div>

      <p className="admin-meta" style={{ marginTop: '1.5rem', lineHeight: 1.6 }}>
        Next: choosing which photographs to sell, from inside each gallery.
      </p>
    </div>
  )
}
