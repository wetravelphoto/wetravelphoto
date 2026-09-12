import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import { photoUrl } from '@/lib/images'
import { updateIdentity, updateNewsletter } from '@/app/actions/site'
import { updateBranding } from '@/app/actions/branding'
import { saveInstagramToken } from '@/app/actions/instagram'
import InstagramPanel from '@/components/admin/InstagramPanel'
import ChromeEditor from '@/components/admin/ChromeEditor'
import SaveBar from '@/components/admin/SaveBar'
import BackfillPanel from '@/components/admin/BackfillPanel'
import { countUnprocessed } from '@/app/actions/backfill'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const settings = await getSiteSettings()
  const supabase = await createClient()

  const { count: signupCount } = await supabase
    .from('newsletter_signups')
    .select('id', { count: 'exact', head: true })

  const { count: igCount } = await supabase
    .from('instagram_media')
    .select('id', { count: 'exact', head: true })

  const { data: team } = await supabase.from('profiles').select('id, email, display_name, role')

  const unprocessed = await countUnprocessed()

  // A real cover makes the header preview honest about legibility
  const { data: samples } = await supabase
    .from('photos')
    .select('storage_path')
    .order('created_at', { ascending: false })
    .limit(1)

  const url = (path: string | null) => (path ? photoUrl(path) : null)

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="admin-h1" style={{ marginBottom: '1.5rem' }}>
        Settings
      </h1>

      <form action={updateBranding} autoComplete="off">
        <ChromeEditor
          siteTitle={settings.site_title}
          headerLogoUrl={url(settings.logo_header_path)}
          footerLogoUrl={url(settings.logo_footer_path)}
          birdLogoUrl={url(settings.logo_bird_path)}
          sampleImageUrl={samples?.[0] ? photoUrl(samples[0].storage_path) : null}
          initial={{
            headerHeight: settings.logo_header_height ?? 34,
            headerAlign: settings.header_align || 'split',
            navFont: settings.header_nav_font || 'Oswald',
            navScale: settings.header_nav_scale ?? 1,
            footerHeight: settings.logo_footer_height ?? 130,
            footerAlign: settings.footer_align || 'left',
            footerFont: settings.footer_font || 'Karla',
            footerScale: settings.footer_scale ?? 1,
            birdSize: settings.logo_bird_size ?? 64,
            showBird: settings.show_bird !== false,
            tagline: settings.tagline,
          }}
        />

        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Naming</h2>

          <label className="admin-field">
            Site name
            <input type="text" name="site_title" defaultValue={settings.site_title} className="admin-input" />
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              Used in page titles, link previews and image alt text.
            </span>
          </label>

          <label className="admin-field">
            Owner name
            <input
              type="text"
              name="owner_name"
              defaultValue={settings.owner_name ?? ''}
              placeholder="Used in the copyright line"
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Copyright line
            <input
              type="text"
              name="footer_copy"
              defaultValue={settings.footer_copy ?? ''}
              placeholder={`© ${new Date().getFullYear()} ${settings.owner_name || settings.site_title}`}
              className="admin-input"
            />
            <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
              Leave blank to build it from the owner name and current year.
            </span>
          </label>
        </div>
      </form>

      <form action={updateIdentity} autoComplete="off">
        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Contact &amp; social</h2>

          <input type="hidden" name="site_title" value={settings.site_title} />

          <label className="admin-field">
            Tagline
            <input type="text" name="tagline" defaultValue={settings.tagline ?? ''} className="admin-input" />
          </label>

          <label className="admin-field">
            Public email
            <input type="email" name="email_public" defaultValue={settings.email_public ?? ''} className="admin-input" />
          </label>

          <label className="admin-field">
            Instagram URL
            <input type="url" name="instagram_url" defaultValue={settings.instagram_url ?? ''} className="admin-input" />
          </label>

          <label className="admin-field">
            Facebook URL
            <input type="url" name="facebook_url" defaultValue={settings.facebook_url ?? ''} className="admin-input" />
          </label>

          <label className="admin-field">
            YouTube URL
            <input type="url" name="youtube_url" defaultValue={settings.youtube_url ?? ''} className="admin-input" />
          </label>

          <SaveBar label="Save contact details" />
        </div>
      </form>

      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Instagram feed</h2>
        <p className="admin-meta" style={{ margin: '0 0 1rem', lineHeight: 1.6 }}>
          Connection and syncing live here. Whether the block appears is set on the homepage editor.
        </p>

        <form action={saveInstagramToken} autoComplete="off" style={{ marginBottom: '1rem' }}>
          <label className="admin-field">
            Handle
            <input
              type="text"
              name="instagram_handle"
              defaultValue={settings.instagram_handle ?? ''}
              className="admin-input"
            />
          </label>

          <label className="admin-field">
            Long-lived access token
            <input
              type="password"
              name="instagram_token"
              placeholder={settings.instagram_token ? 'Saved — paste a new one to replace it' : 'IGQ…'}
              className="admin-input"
              autoComplete="new-password"
            />
          </label>

          <SaveBar label="Save connection" />
        </form>

        <div style={{ borderTop: '0.5px solid var(--admin-line)', paddingTop: '1rem' }}>
          <InstagramPanel
            connected={!!settings.instagram_token}
            expiresAt={settings.instagram_token_expires}
            syncedAt={settings.instagram_synced_at}
            postCount={igCount ?? 0}
          />
        </div>
      </div>

      <form action={updateNewsletter} autoComplete="off">
        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Newsletter</h2>
          <p className="admin-meta" style={{ margin: '0 0 0.85rem' }}>
            {signupCount ?? 0} signup{signupCount === 1 ? '' : 's'}. Stored in your database — not yet
            connected to a mailing service.
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

          <SaveBar label="Save newsletter" />
        </div>
      </form>

      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Photograph sizes</h2>
        <BackfillPanel initialRemaining={unprocessed} />
      </div>

      <div className="admin-panel">
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
          Adding an editor still means creating the user in Supabase by hand.
        </p>
      </div>
    </div>
  )
}
