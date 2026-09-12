import { getSiteSettings } from '@/lib/site'
import { updateContactPage } from '@/app/actions/site'
import PageImagePicker from '@/components/admin/PageImagePicker'
import SaveBar from '@/components/admin/SaveBar'
import Toggle from '@/components/admin/Toggle'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ContactPageEditor() {
  const settings = await getSiteSettings()
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

  return (
    <div style={{ maxWidth: 680 }}>
      <form action={updateContactPage} autoComplete="off">
        <SaveBar label="Save contact" title="Contact" />

        <p className="admin-crumb" style={{ marginBottom: '1.25rem' }}>
          <Link href="/admin/pages">← Pages</Link>
        </p>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
            These settings drive both the contact page and the contact section at the foot of the homepage.
          </p>

          <Toggle
            name="show_contact_section"
            label="Show the contact section on the homepage"
            defaultChecked={settings.show_contact_section !== false}
          />

          <label className="admin-field" style={{ marginBottom: 0 }}>
            Menu label
            <input
              type="text"
              name="nav_contact_label"
              defaultValue={settings.nav_contact_label ?? ''}
              placeholder="Contact"
              className="admin-input"
            />
          </label>
        </div>

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Photograph</h2>

          <PageImagePicker
            name="contact_image_path"
            label="Image"
            initialPath={settings.contact_image_path}
            publicUrl={publicUrl}
            note="Shown in black and white beside the form."
          />

          <label className="admin-field">
            Position
            <select
              name="contact_image_side"
              defaultValue={settings.contact_image_side || 'left'}
              className="admin-select"
            >
              <option value="left">Photo left, form right</option>
              <option value="right">Photo right, form left</option>
            </select>
          </label>

          <label className="admin-field">
            Caption over the photo
            <input
              type="text"
              name="contact_tagline"
              defaultValue={settings.contact_tagline ?? ''}
              placeholder="A wilder tomorrow is a brighter tomorrow."
              className="admin-input"
            />
          </label>
        </div>

        <div className="admin-panel">
          <h2 className="admin-h2">Copy</h2>

          <label className="admin-field">
            Eyebrow
            <input
              type="text"
              name="contact_eyebrow"
              defaultValue={settings.contact_eyebrow ?? ''}
              placeholder="Let's keep in touch"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Heading
            <input
              type="text"
              name="contact_heading"
              defaultValue={settings.contact_heading ?? ''}
              placeholder="Let's connect"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Intro line
            <input
              type="text"
              name="contact_intro"
              defaultValue={settings.contact_intro ?? ''}
              placeholder="For collaborations, licensing, prints and assignments."
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Note beside the button
            <input
              type="text"
              name="contact_note"
              defaultValue={settings.contact_note ?? ''}
              placeholder="Response within 48 hours."
              className="admin-input"
            />
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
            Messages arrive in{' '}
            <Link href="/admin/messages" style={{ borderBottom: '0.5px solid currentColor' }}>
              your inbox
            </Link>
            . They aren&apos;t emailed anywhere yet.
          </p>
        </div>
      </form>
    </div>
  )
}
