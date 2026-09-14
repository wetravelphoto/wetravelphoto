import { getSiteSettings } from '@/lib/site'
import { updateShopPage } from '@/app/actions/site'
import { countPhotosForSale, centsToInput } from '@/lib/shop'
import SaveBar from '@/components/admin/SaveBar'
import Toggle from '@/components/admin/Toggle'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ShopPageEditor() {
  const [settings, forSale] = await Promise.all([getSiteSettings(), countPhotosForSale()])

  return (
    <div style={{ maxWidth: 660 }}>
      <form action={updateShopPage} autoComplete="off">
        <SaveBar label="Save shop page" title="Shop" />

        <p className="admin-crumb" style={{ marginBottom: '1.25rem' }}>
          <Link href="/admin/pages">← Pages</Link>
        </p>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Visibility</h2>

          <Toggle
            name="show_shop"
            label="Show the shop"
            defaultChecked={settings.show_shop === true}
            note="Adds Shop to the menu and publishes the page. Leave off while you're setting prices."
          />
        </div>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">What's for sale</h2>
          <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
            {forSale} photograph{forSale === 1 ? ' is' : 's are'} currently marked for sale.
          </p>

          <label className="admin-field">
            Mode
            <select
              name="shop_mode"
              defaultValue={settings.shop_mode ?? 'curated'}
              className="admin-select"
            >
              <option value="curated">Only photographs I choose</option>
              <option value="all">Every photograph in a public gallery</option>
            </select>
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              Curated sells only what you mark with the $ button inside a gallery. Everything
              sells your whole public catalogue at the current price list.
            </span>
          </label>
        </div>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Heading</h2>

          <label className="admin-field">
            Menu label
            <input
              type="text"
              name="nav_shop_label"
              defaultValue={settings.nav_shop_label ?? ''}
              placeholder="Prints"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Eyebrow
            <input
              type="text"
              name="shop_eyebrow"
              defaultValue={settings.shop_eyebrow ?? ''}
              placeholder="Limited prints"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Page title
            <input
              type="text"
              name="shop_heading"
              defaultValue={settings.shop_heading ?? ''}
              placeholder="Prints"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Intro
            <textarea
              name="shop_intro"
              defaultValue={settings.shop_intro ?? ''}
              placeholder="A line or two about how the prints are made."
              className="admin-input"
              rows={3}
            />
          </label>
        </div>

        <div className="admin-panel">
          <h2 className="admin-h2">Orders</h2>

          <label className="admin-field">
            Flat shipping — US dollars
            <input
              type="text"
              inputMode="decimal"
              name="shop_shipping_flat"
              defaultValue={centsToInput(settings.shop_shipping_flat_cents ?? 0)}
              className="admin-input"
            />
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              Added once per order, whatever the size of the basket.
            </span>
          </label>

          <label className="admin-field">
            Note shown at checkout
            <textarea
              name="shop_order_note"
              defaultValue={settings.shop_order_note ?? ''}
              placeholder="Prints are made to order and ship within two weeks."
              className="admin-input"
              rows={3}
            />
          </label>
        </div>
      </form>
    </div>
  )
}
