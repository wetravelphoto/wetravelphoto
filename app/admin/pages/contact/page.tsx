import { getSiteSettings } from '@/lib/site'
import { updateContactPage } from '@/app/actions/site'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ContactPageEditor() {
  const settings = await getSiteSettings()

  return (
    <div style={{ maxWidth: 660 }}>
      <p className="admin-crumb">
        <Link href="/admin/pages">← Pages</Link>
      </p>

      <div className="page-editor-head">
        <h1 className="admin-h1">Contact</h1>
        <Link href="/contact" target="_blank" className="admin-btn admin-btn-ghost admin-btn-sm">
          View ↗
        </Link>
      </div>

      <form action={updateContactPage} autoComplete="off">
        <div className="admin-panel">
          <label className="admin-field">
            Intro copy
            <textarea
              name="contact_intro"
              defaultValue={settings.contact_intro ?? ''}
              rows={4}
              placeholder="A line or two above the form."
              className="admin-input"
              style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
            />
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              Also used by the contact section on the homepage.
            </span>
          </label>

          <label className="admin-field">
            Public email
            <input
              type="email"
              name="email_public"
              defaultValue={settings.email_public ?? ''}
              className="admin-input"
            />
          </label>

          <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
            Messages land in{' '}
            <Link href="/admin/messages" style={{ borderBottom: '0.5px solid currentColor' }}>
              your inbox
            </Link>
            . They aren&apos;t emailed anywhere yet.
          </p>
        </div>

        <div className="page-save-bar">
          <button type="submit" className="admin-btn">
            Save contact page
          </button>
        </div>
      </form>
    </div>
  )
}
