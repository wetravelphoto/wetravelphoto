import { getSiteSettings } from '@/lib/site'
import { updateGalleriesPage } from '@/app/actions/site'
import SaveBar from '@/components/admin/SaveBar'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function GalleriesPageEditor() {
  const settings = await getSiteSettings()

  return (
    <div style={{ maxWidth: 660 }}>
      <form action={updateGalleriesPage} autoComplete="off">
        <SaveBar label="Save galleries page" title="Galleries" />

        <p className="admin-crumb" style={{ marginBottom: '1.25rem' }}>
          <Link href="/admin/pages">← Pages</Link>
        </p>

        <div className="admin-panel">
          <h2 className="admin-h2">Heading</h2>

          <label className="admin-field">
            Eyebrow
            <input
              type="text"
              name="galleries_eyebrow"
              defaultValue={settings.galleries_eyebrow ?? ''}
              placeholder="Collections"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Page title
            <input
              type="text"
              name="galleries_heading"
              defaultValue={settings.galleries_heading ?? ''}
              placeholder="Galleries"
              className="admin-input"
            />
          </label>

          <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
            Galleries appear in the order set on the{' '}
            <Link href="/admin/trips" style={{ borderBottom: '0.5px solid currentColor' }}>
              galleries screen
            </Link>
            .
          </p>
        </div>
      </form>
    </div>
  )
}
