import { getSiteSettings } from '@/lib/site'
import { updateAboutPage } from '@/app/actions/site'
import PageImagePicker from '@/components/admin/PageImagePicker'
import SaveBar from '@/components/admin/SaveBar'
import Toggle from '@/components/admin/Toggle'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AboutPageEditor() {
  const settings = await getSiteSettings()
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

  return (
    <div style={{ maxWidth: 680 }}>
      <form action={updateAboutPage} autoComplete="off">
        <SaveBar label="Save about page" title="About" />

        <p className="admin-crumb" style={{ marginBottom: '1.25rem' }}>
          <Link href="/admin/pages">← Pages</Link>
        </p>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <Toggle
            name="show_about"
            label="Publish this page"
            defaultChecked={settings.show_about !== false}
            note="Switching it off removes the page from the menu and footer, and the address stops resolving."
          />

          <label className="admin-field" style={{ marginBottom: 0 }}>
            Menu label
            <input
              type="text"
              name="nav_about_label"
              defaultValue={settings.nav_about_label ?? ''}
              placeholder="About"
              className="admin-input"
            />
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              How this page is named in the menu and footer.
            </span>
          </label>
        </div>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Photograph</h2>

          <PageImagePicker
            name="about_image_path"
            label="Image"
            initialPath={settings.about_image_path}
            publicUrl={publicUrl}
            note="Fills one half of the page. Leave empty for a text-only layout."
          />

          <label className="admin-field">
            Position
            <select
              name="about_image_side"
              defaultValue={settings.about_image_side || 'left'}
              className="admin-select"
            >
              <option value="left">Photo left, text right</option>
              <option value="right">Photo right, text left</option>
            </select>
          </label>
        </div>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Copy</h2>

          <label className="admin-field">
            Eyebrow
            <input
              type="text"
              name="about_eyebrow"
              defaultValue={settings.about_eyebrow ?? ''}
              placeholder="Who we are"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Heading
            <input
              type="text"
              name="about_heading"
              defaultValue={settings.about_heading ?? ''}
              placeholder="About"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Body
            <textarea
              name="about_body"
              defaultValue={settings.about_body ?? ''}
              rows={10}
              placeholder="Leave a blank line between paragraphs."
              className="admin-input"
              style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 }}
            />
          </label>

          <div className="size-row">
            <label className="admin-field">
              Button label
              <input
                type="text"
                name="about_cta_label"
                defaultValue={settings.about_cta_label ?? ''}
                placeholder="See the galleries"
                className="admin-input"
              />
            </label>

            <label className="admin-field">
              Button link
              <input
                type="text"
                name="about_cta_href"
                defaultValue={settings.about_cta_href ?? ''}
                placeholder="/trips"
                className="admin-input"
              />
            </label>
          </div>

          <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
            Typography follows the intro section&apos;s settings on the{' '}
            <Link href="/edit/home" style={{ borderBottom: '0.5px solid currentColor' }}>
              homepage editor
            </Link>
            .
          </p>
        </div>
      </form>
    </div>
  )
}
