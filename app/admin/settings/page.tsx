import { createClient } from '@/lib/supabase/server'
import { getSiteSettings } from '@/lib/site'
import Link from 'next/link'
import { updateIdentity, updateMenu } from '@/app/actions/site'
import { updateBranding } from '@/app/actions/branding'
import { saveInstagramToken } from '@/app/actions/instagram'
import InstagramPanel from '@/components/admin/InstagramPanel'
import ContactEmailPanel from '@/components/admin/ContactEmailPanel'
import FaviconPanel from '@/components/admin/FaviconPanel'
import NewsletterPanel from '@/components/admin/NewsletterPanel'
import { emailConfigured } from '@/lib/email'
import { providerInfo } from '@/lib/newsletter/providers'
import { readConnection } from '@/lib/newsletter/connection'
import SaveBar from '@/components/admin/SaveBar'
import Toggle from '@/components/admin/Toggle'
import BackfillPanel from '@/components/admin/BackfillPanel'
import { countUnprocessed } from '@/app/actions/backfill'
import { currentEditor, requireEditor } from '@/lib/auth'
import { hasInstagramToken } from '@/lib/instagram'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { tenantId } = await requireEditor()
  const settings = await getSiteSettings()
  const supabase = await createClient()

  const { count: signupCount } = await supabase
    .from('newsletter_signups')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  // Sign-ups not yet sent to the connected mailing service, and how many of
  // those failed. (Both read 0 before the columns exist.)
  const { count: waitingCount } = await supabase
    .from('newsletter_signups')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('synced_at', null)
  const { count: failedCount } = await supabase
    .from('newsletter_signups')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .not('sync_error', 'is', null)

  const { count: igCount } = await supabase
    .from('instagram_media')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  // Whose team. Left unscoped this listed every profile on the platform —
  // narrowed by row-level security for an ordinary photographer, but a
  // platform admin passes every tenant check, so opening Settings would have
  // shown every tester's email address in one list. "Row-level security will
  // handle it" is not a filter; this is.
  const { data: team } = await supabase
    .from('profiles')
    .select('id, email, display_name, role')
    .eq('tenant_id', tenantId)

  const unprocessed = await countUnprocessed()

  // Whether a token is saved — asked of site_secrets, which only this site's
  // editors can read. The token itself never comes back to the page.
  const editor = await currentEditor()
  const instagramConnected = editor
    ? await hasInstagramToken({ db: supabase, tenantId: editor.tenantId })
    : false

  // The newsletter connection, WITHOUT its key: only the service and list go
  // to the page.
  const newsletter = editor ? await readConnection(supabase, editor.tenantId) : null

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="admin-h1" style={{ marginBottom: '1.5rem' }}>
        Settings
      </h1>

      {/* The header and footer moved into the editor, where they are seen on
          the page as they change and go live with Publish like everything else. */}
      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Header &amp; footer</h2>
        <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
          Logos, layout, menu typeface and sizes, the copyright line and the newsletter block are
          edited in the editor now: click the header or footer on any page. Changes show on the page
          as you make them and go live when you Publish.
        </p>
        <Link href="/edit/home" className="admin-btn">
          Open the editor
        </Link>
      </div>

      <form action={updateBranding} autoComplete="off">
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

          <SaveBar label="Save names" />
        </div>
      </form>

      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Site icon</h2>
        <FaviconPanel path={settings.favicon_path ?? null} />
      </div>

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
        <h2 className="admin-h2">Contact form messages</h2>
        <ContactEmailPanel
          notify={settings.contact_notify !== false}
          address={settings.contact_notify_email ?? null}
          publicEmail={settings.email_public ?? null}
          emailReady={emailConfigured()}
        />
      </div>

      {/* The site's navigation, in one place. Each link used to be named on its
          own page's form; the header belongs to the site, not to a page. */}
      <form action={updateMenu} autoComplete="off">
        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Menu</h2>
          <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
            What each built-in page is called in the header and footer. Leave one blank to use
            the name shown in grey. The menu&apos;s order, dropdowns, your own pages and links to
            other sites are arranged in the editor, under <strong>Pages &amp; menu</strong>.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <label className="admin-field" style={{ margin: 0 }}>
              Galleries
              <input
                type="text"
                name="nav_galleries_label"
                defaultValue={settings.nav_galleries_label ?? ''}
                placeholder="Galleries"
                className="admin-input"
              />
            </label>

            <label className="admin-field" style={{ margin: 0 }}>
              Journal
              <input
                type="text"
                name="nav_journal_label"
                defaultValue={settings.nav_journal_label ?? ''}
                placeholder="Journal"
                className="admin-input"
              />
            </label>

            <label className="admin-field" style={{ margin: 0 }}>
              About
              <input
                type="text"
                name="nav_about_label"
                defaultValue={settings.nav_about_label ?? ''}
                placeholder="About"
                className="admin-input"
              />
            </label>

            <label className="admin-field" style={{ margin: 0 }}>
              Contact
              <input
                type="text"
                name="nav_contact_label"
                defaultValue={settings.nav_contact_label ?? ''}
                placeholder="Contact"
                className="admin-input"
              />
            </label>

            <label className="admin-field" style={{ margin: 0 }}>
              Prints
              <input
                type="text"
                name="nav_shop_label"
                defaultValue={settings.nav_shop_label ?? ''}
                placeholder="Prints"
                className="admin-input"
              />
            </label>
          </div>

          <Toggle
            name="show_about"
            label="Show the About page"
            note="Off removes it from the menu and makes the page itself unavailable."
            defaultChecked={settings.show_about !== false}
          />

          <SaveBar label="Save menu" />
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
              placeholder={instagramConnected ? 'Saved — paste a new one to replace it' : 'IGQ…'}
              className="admin-input"
              autoComplete="new-password"
            />
          </label>

          <SaveBar label="Save connection" />
        </form>

        <div style={{ borderTop: '0.5px solid var(--admin-line)', paddingTop: '1rem' }}>
          <InstagramPanel
            connected={instagramConnected}
            expiresAt={settings.instagram_token_expires}
            syncedAt={settings.instagram_synced_at}
            postCount={igCount ?? 0}
          />
        </div>
      </div>

      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <h2 className="admin-h2">Newsletter</h2>
        <NewsletterPanel
          providers={providerInfo()}
          connection={
            newsletter
              ? {
                  provider: newsletter.provider,
                  listId: newsletter.listId,
                  listName: newsletter.listName,
                  doubleOptIn: newsletter.doubleOptIn,
                }
              : null
          }
          counts={{
            total: signupCount ?? 0,
            waiting: newsletter ? (waitingCount ?? 0) : 0,
            failed: newsletter ? (failedCount ?? 0) : 0,
          }}
        />
      </div>

      {/* Only shown when there's actually something to process. New uploads
          build their own display sizes, so this is a recovery tool — it
          matters again if photographs ever arrive without them, such as a
          library imported from another platform. */}
      {unprocessed > 0 && (
        <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
          <h2 className="admin-h2">Photograph sizes</h2>
          <BackfillPanel initialRemaining={unprocessed} />
        </div>
      )}

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
