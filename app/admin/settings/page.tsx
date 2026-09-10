import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { updateIdentity, updateNewsletter } from '@/app/actions/site'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const settings = await getSiteSettings()
  const supabase = await createClient()

  const { count: signupCount } = await supabase
    .from('newsletter_signups')
    .select('id', { count: 'exact', head: true })

  const { data: team } = await supabase.from('profiles').select('id, email, display_name, role')

  return (
    <div style={{ maxWidth: 660 }}>
      <h1 className="admin-h1" style={{ marginBottom: '1.5rem' }}>
        Settings
      </h1>

      <form action={updateIdentity} autoComplete="off">
        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Identity</h2>

          <label className="admin-field">
            Site title
            <input type="text" name="site_title" defaultValue={settings.site_title} className="admin-input" />
          </label>

          <label className="admin-field">
            Tagline
            <input
              type="text"
              name="tagline"
              defaultValue={settings.tagline ?? ''}
              placeholder="Travel photography and field notes"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Public email
            <input type="email" name="email_public" defaultValue={settings.email_public ?? ''} className="admin-input" />
          </label>

          <label className="admin-field">
            Instagram URL
            <input
              type="url"
              name="instagram_url"
              defaultValue={settings.instagram_url ?? ''}
              placeholder="https://instagram.com/…"
              className="admin-input"
            />
          </label>

          <button type="submit" className="admin-btn">
            Save identity
          </button>
        </div>
      </form>

      <form action={updateNewsletter} autoComplete="off">
        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Newsletter</h2>
          <p className="admin-meta" style={{ margin: '0 0 0.85rem' }}>
            {signupCount ?? 0} signup{signupCount === 1 ? '' : 's'}. Stored in the database — not yet connected
            to a mailing service.
          </p>

          <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" name="show_newsletter" defaultChecked={settings.show_newsletter !== false} />
            Show the signup block
          </label>

          <label className="admin-field">
            Heading
            <input
              type="text"
              name="newsletter_heading"
              defaultValue={settings.newsletter_heading ?? ''}
              placeholder="New trips, straight to your inbox"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Body
            <textarea
              name="newsletter_body"
              defaultValue={settings.newsletter_body ?? ''}
              rows={3}
              className="admin-input"
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </label>

          <button type="submit" className="admin-btn">
            Save newsletter
          </button>
        </div>
      </form>

      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Team</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.85rem' }}>
          {team?.map((member) => (
            <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
              <span style={{ flex: 1 }}>{member.display_name || member.email}</span>
              <span className="admin-tag">{member.role}</span>
            </div>
          ))}
        </div>
        <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
          Adding an editor still means creating the user in Supabase by hand. A proper invite flow is on the
          list.
        </p>
      </div>

      <div className="admin-panel">
        <h2 className="admin-h2">Integrations</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <IntegrationRow name="Cloudflare R2" note="Photo storage" status="connected" />
          <IntegrationRow name="Supabase" note="Database and sign-in" status="connected" />
          <IntegrationRow name="Stripe" note="Print sales" status="not set up" />
          <IntegrationRow name="Email delivery" note="Contact and client galleries" status="not set up" />
          <IntegrationRow name="Instagram" note="Feed on the homepage" status="not set up" />
        </div>
      </div>
    </div>
  )
}

function IntegrationRow({ name, note, status }: { name: string; note: string; status: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
      <span style={{ flex: 1 }}>
        {name} <span className="admin-meta">· {note}</span>
      </span>
      <span className="admin-tag" data-tone={status === 'connected' ? 'live' : undefined}>
        {status}
      </span>
    </div>
  )
}
