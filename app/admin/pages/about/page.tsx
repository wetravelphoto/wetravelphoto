import { getSiteSettings } from '@/lib/site'
import { updateAboutPage } from '@/app/actions/site'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AboutPageEditor() {
  const settings = await getSiteSettings()

  return (
    <div style={{ maxWidth: 660 }}>
      <p className="admin-crumb">
        <Link href="/admin/pages">← Pages</Link>
      </p>

      <div className="page-editor-head">
        <h1 className="admin-h1">About</h1>
        <Link href="/about" target="_blank" className="admin-btn admin-btn-ghost admin-btn-sm">
          View ↗
        </Link>
      </div>

      <form action={updateAboutPage} autoComplete="off">
        <div className="admin-panel">
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
              rows={12}
              placeholder="Leave a blank line between paragraphs."
              className="admin-input"
              style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 }}
            />
          </label>

          <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
            Your Instagram link and public email come from{' '}
            <Link href="/admin/settings" style={{ borderBottom: '0.5px solid currentColor' }}>
              settings
            </Link>
            .
          </p>
        </div>

        <div className="page-save-bar">
          <button type="submit" className="admin-btn">
            Save about page
          </button>
        </div>
      </form>
    </div>
  )
}
