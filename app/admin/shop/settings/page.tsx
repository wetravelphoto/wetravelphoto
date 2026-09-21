import { getSiteSettings } from '@/lib/site'
import { updateShopSettings } from '@/app/actions/site'
import { countPhotosForSale, centsToInput } from '@/lib/shop'
import SaveBar from '@/components/admin/SaveBar'
import Toggle from '@/components/admin/Toggle'
import { FEATURE_ICONS } from '@/components/shop/FeatureIcon'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ShopSettingsPage() {
  const [settings, forSale] = await Promise.all([getSiteSettings(), countPhotosForSale()])

  return (
    <div style={{ maxWidth: 660 }}>
      <form action={updateShopSettings} autoComplete="off">
        <SaveBar label="Save shop settings" title="Shop settings" />

        <p className="admin-crumb" style={{ marginBottom: '1.25rem' }}>
          <Link href="/admin/shop">← Shop</Link>
        </p>

        <p className="admin-meta admin-lede">
          How the shop runs, and what both of its pages share. The shop page itself — its
          title lines, how many prints across, the captions — is laid out in{' '}
          <Link href="/edit/shop">the editor</Link>, like every other page.
        </p>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">The shop <span className="admin-where">on or off</span></h2>

          <Toggle
            name="show_shop"
            label="Show the shop"
            defaultChecked={settings.show_shop === true}
            note="Adds Shop to the menu and publishes the page. Leave off while you're setting prices."
          />
        </div>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">What&rsquo;s for sale</h2>
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

        {/* ---------- THE WALL ---------- */}

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">The wall <span className="admin-where">both shop pages</span></h2>
          <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
            What the prints hang on, and the typeface of the shop&rsquo;s headings — shared by the
            shop page and every print&rsquo;s own page.
          </p>

          <label className="admin-field">
            Wall texture
            <input
              type="text"
              name="shop_wall_texture"
              defaultValue={settings.shop_wall_texture ?? ''}
              placeholder="/textures/plaster.webp"
              className="admin-input"
            />
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              Tiles edge to edge behind the whole page. Leave blank for the plaster that comes
              with the site.
            </span>
          </label>

          <Toggle
            name="shop_plain_wall"
            label="Plain wall"
            defaultChecked={settings.shop_wall_texture === ''}
            note="No texture at all — a flat gallery wall. Overrides the field above."
          />

          <label className="admin-field">
            Heading typeface
            <input
              type="text"
              name="shop_title_font"
              defaultValue={settings.shop_title_font ?? ''}
              placeholder="Cormorant Garamond"
              className="admin-input"
            />
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              Any Google font, by name. Sets the page title, the collection lines and the quote.
              Blank uses your site&rsquo;s display font.
            </span>
          </label>
        </div>

        {/* ---------- PRODUCT PAGE ---------- */}

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Product page <span className="admin-where">the top of the page</span></h2>
          <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
            Each print gets its own page: the piece on a wall, in every room you&rsquo;ve added
            under <Link href="/admin/shop/scenes">Rooms</Link>, with the buying column beside it.
          </p>

          <Toggle
            name="shop_show_breadcrumbs"
            label="Breadcrumbs"
            defaultChecked={settings.shop_show_breadcrumbs !== false}
            note="Home / Prints / the print's name. Off gives a plain back link instead."
          />

          <label className="admin-field">
            Line in the top corner
            <input
              type="text"
              name="shop_corner_line"
              defaultValue={settings.shop_corner_line ?? ''}
              placeholder="Art lives brighter on your walls"
              className="admin-input"
            />
          </label>
        </div>

        {/* ---------- REASSURANCE ---------- */}

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Product page <span className="admin-where">the row under the buy button</span></h2>
          <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
            The row under the buy button — paper, shipping, however you print. Leave a title
            blank and that one is left out; leave all three blank and the row goes away.
          </p>

          {([1, 2, 3] as const).map((n) => {
            const icon = settings[`shop_feature${n}_icon` as const] ?? ''
            const title = settings[`shop_feature${n}_title` as const] ?? ''
            const body = settings[`shop_feature${n}_body` as const] ?? ''

            return (
              <div key={n} className="shop-feature-row">
                <label className="admin-field">
                  Title
                  <input
                    type="text"
                    name={`shop_feature${n}_title`}
                    defaultValue={title}
                    placeholder={
                      n === 1
                        ? 'Museum-quality fine art paper'
                        : n === 2
                          ? 'Worldwide shipping'
                          : 'Sustainable printing'
                    }
                    className="admin-input"
                  />
                </label>

                <label className="admin-field">
                  Detail
                  <input
                    type="text"
                    name={`shop_feature${n}_body`}
                    defaultValue={body}
                    placeholder={
                      n === 1
                        ? 'Archival, gallery-grade materials.'
                        : n === 2
                          ? 'Carefully packaged and fully insured.'
                          : 'Thoughtful production for a brighter tomorrow.'
                    }
                    className="admin-input"
                  />
                </label>

                <label className="admin-field">
                  Icon
                  <select
                    name={`shop_feature${n}_icon`}
                    defaultValue={icon}
                    className="admin-select"
                  >
                    <option value="">Leaf</option>
                    {FEATURE_ICONS.map((key) => (
                      <option key={key} value={key}>
                        {key[0].toUpperCase() + key.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )
          })}
        </div>

        {/* ---------- RELATED ---------- */}

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Product page <span className="admin-where">more prints, at the foot</span></h2>

          <label className="admin-field">
            Line above the heading
            <input
              type="text"
              name="shop_related_overline"
              defaultValue={settings.shop_related_overline ?? ''}
              placeholder="Curated for your space"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Heading
            <input
              type="text"
              name="shop_related_heading"
              defaultValue={settings.shop_related_heading ?? ''}
              placeholder="You may also like"
              className="admin-input"
            />
          </label>
        </div>

        {/* ---------- CLOSING QUOTE ---------- */}

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Both pages <span className="admin-where">the band across the bottom</span></h2>
          <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
            A quote across the foot of the shop. Leave blank and the band isn&rsquo;t drawn.
          </p>

          <label className="admin-field">
            Quote
            <input
              type="text"
              name="shop_quote"
              defaultValue={settings.shop_quote ?? ''}
              placeholder="Photographs are a return ticket to feeling."
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Attributed to
            <input
              type="text"
              name="shop_quote_by"
              defaultValue={settings.shop_quote_by ?? ''}
              placeholder="Anonymous"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Left of the quote
            <textarea
              name="shop_footer_left"
              defaultValue={settings.shop_footer_left ?? ''}
              placeholder={'Fine art photographs\nfor modern living'}
              className="admin-input"
              rows={2}
            />
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              Up to two lines — put each on its own line.
            </span>
          </label>

          <label className="admin-field">
            Right of the quote
            <textarea
              name="shop_footer_right"
              defaultValue={settings.shop_footer_right ?? ''}
              placeholder={'Worldwide shipping\nArt lives brighter'}
              className="admin-input"
              rows={2}
            />
          </label>
        </div>

        <div className="admin-panel">
          <h2 className="admin-h2">Orders <span className="admin-where">shipping and checkout</span></h2>

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
