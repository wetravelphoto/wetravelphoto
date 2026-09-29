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
import { currentSite } from '@/lib/tenant'
import { photoUrl } from '@/lib/images'
import Icon from '@/components/admin/Icon'
import SettingsNav from '@/components/admin/SettingsNav'
import SettingsRail from '@/components/admin/SettingsRail'
import { sectionFor } from '@/lib/admin/settings-sections'

export const dynamic = 'force-dynamic'

/**
 * SETTINGS
 * ════════
 *
 * Three columns: which section, the section, and what the section adds up to.
 *
 * ── Why a section list and not one long page ────────────────────────────────
 *
 * It was one column of eleven panels, around 2,400 pixels tall. Every visit
 * began with scrolling to find out whether the thing you wanted was above or
 * below the Instagram token, and no setting had an address you could send
 * anyone. The list makes the screen a constant height and gives every section a
 * URL; see lib/admin/settings-sections.ts for why the id is in the query string.
 *
 * ── Why each panel still saves itself ───────────────────────────────────────
 *
 * There is no single Save at the bottom. The panels here are five independent
 * server actions over four different tables — `updateBranding`, `updateIdentity`,
 * `updateMenu`, `saveInstagramToken`, and the panels that save themselves — and
 * one button over the lot of them would either have to claim it saved things it
 * did not touch, or run five writes and have no honest thing to say when the
 * third fails. One form, one save, one confirmation for what that form actually
 * wrote.
 *
 * ── Nothing here is fetched for a section you are not looking at ────────────
 *
 * The old page ran six counted queries, two secret lookups and the team list on
 * every visit, including a visit that only changed the site's name. Each block
 * below is asked for only by the section that draws it.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantId } = await requireEditor()
  const section = sectionFor((await searchParams)?.s)

  const [settings, site, editor] = await Promise.all([getSiteSettings(), currentSite(), currentEditor()])
  const supabase = await createClient()

  // ── Only what this section needs ──────────────────────────────────────────

  /** The newsletter connection, WITHOUT its key: only the service and list. */
  const newsletter =
    section.id === 'newsletter' && editor ? await readConnection(supabase, editor.tenantId) : null

  const counts =
    section.id === 'newsletter'
      ? await (async () => {
          const [total, waiting, failed] = await Promise.all([
            supabase
              .from('newsletter_signups')
              .select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId),
            // Sign-ups not yet sent to the connected mailing service, and how
            // many of those failed. (Both read 0 before the columns exist.)
            supabase
              .from('newsletter_signups')
              .select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId)
              .is('synced_at', null),
            supabase
              .from('newsletter_signups')
              .select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId)
              .not('sync_error', 'is', null),
          ])
          return { total: total.count ?? 0, waiting: waiting.count ?? 0, failed: failed.count ?? 0 }
        })()
      : null

  /** Whether a token is saved — asked of site_secrets, which only this site's
      editors can read. The token itself never comes back to the page. */
  const instagram =
    section.id === 'integrations'
      ? await (async () => {
          const [connected, media] = await Promise.all([
            editor ? hasInstagramToken({ db: supabase, tenantId: editor.tenantId }) : false,
            supabase
              .from('instagram_media')
              .select('id', { count: 'exact', head: true })
              .eq('tenant_id', tenantId),
          ])
          return { connected, posts: media.count ?? 0 }
        })()
      : null

  /*
   * Whose team. Left unscoped this listed every profile on the platform —
   * narrowed by row-level security for an ordinary photographer, but a platform
   * admin passes every tenant check, so opening Settings would have shown every
   * tester's email address in one list. "Row-level security will handle it" is
   * not a filter; this is.
   */
  const team =
    section.id === 'team'
      ? (
          await supabase
            .from('profiles')
            .select('id, email, display_name, role')
            .eq('tenant_id', tenantId)
        ).data
      : null

  const unprocessed = section.id === 'advanced' ? await countUnprocessed() : 0

  const host = site?.primaryHost ?? null

  return (
    <div className="st">
      <header className="pb-head st-head">
        <div className="pb-head-words">
          <h1 className="pb-title">Settings</h1>
          <p className="pb-sub">Your site&apos;s name, its contacts, and what it is connected to.</p>
        </div>
      </header>

      <div className="st-grid">
        <SettingsNav active={section.id} />

        <div className="st-body">
          <div className="st-body-head">
            <h2 className="st-h2">{section.label}</h2>
            <p className="st-body-note">{section.blurb}</p>
          </div>

          {/* ── General ──────────────────────────────────────────────────── */}
          {section.id === 'general' && (
            <>
              <form action={updateBranding} autoComplete="off">
                <div className="admin-panel st-panel">
                  <h3 className="admin-h2">Naming</h3>

                  <label className="admin-field">
                    Site name
                    <input
                      type="text"
                      name="site_title"
                      defaultValue={settings.site_title}
                      className="admin-input"
                    />
                    <span className="admin-meta st-hint">
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

              <div className="admin-panel st-panel">
                <h3 className="admin-h2">Site icon</h3>
                <FaviconPanel path={settings.favicon_path ?? null} />
              </div>

              {/* The header and footer moved into the editor, where they are
                  seen on the page as they change and go live with Publish like
                  everything else. */}
              <div className="admin-panel st-panel st-panel-quiet">
                <h3 className="admin-h2">Header &amp; footer</h3>
                <p className="admin-meta st-note">
                  Logos, layout, menu typeface and sizes, the copyright line and the newsletter
                  block are edited in the editor now: click the header or footer on any page.
                  Changes show on the page as you make them and go live when you Publish.
                </p>
                <Link href="/edit/home" className="lg-btn">
                  <Icon name="design" size={15} />
                  Open the editor
                </Link>
              </div>
            </>
          )}

          {/* ── Contact & social ─────────────────────────────────────────── */}
          {section.id === 'contact' && (
            <form action={updateIdentity} autoComplete="off">
              <div className="admin-panel st-panel">
                {/* The action writes the whole identity row, so the name it is
                    not editing here has to travel with it. */}
                <input type="hidden" name="site_title" value={settings.site_title} />

                <label className="admin-field">
                  Tagline
                  <input
                    type="text"
                    name="tagline"
                    defaultValue={settings.tagline ?? ''}
                    className="admin-input"
                  />
                  <span className="admin-meta st-hint">
                    One line under your name, where a theme shows one.
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
                  <span className="admin-meta st-hint">
                    Shown on the site. Where the contact form sends its messages is under Email
                    notifications.
                  </span>
                </label>

                <div className="st-fields">
                  <label className="admin-field st-field-flat">
                    Instagram URL
                    <input
                      type="url"
                      name="instagram_url"
                      defaultValue={settings.instagram_url ?? ''}
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field st-field-flat">
                    Facebook URL
                    <input
                      type="url"
                      name="facebook_url"
                      defaultValue={settings.facebook_url ?? ''}
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field st-field-flat">
                    YouTube URL
                    <input
                      type="url"
                      name="youtube_url"
                      defaultValue={settings.youtube_url ?? ''}
                      className="admin-input"
                    />
                  </label>
                </div>

                <SaveBar label="Save contact details" />
              </div>
            </form>
          )}

          {/* ── Email notifications ──────────────────────────────────────── */}
          {section.id === 'email' && (
            <div className="admin-panel st-panel">
              <h3 className="admin-h2">Contact form messages</h3>
              <ContactEmailPanel
                notify={settings.contact_notify !== false}
                address={settings.contact_notify_email ?? null}
                publicEmail={settings.email_public ?? null}
                emailReady={emailConfigured()}
              />
            </div>
          )}

          {/* ── Navigation & menu ────────────────────────────────────────── */}
          {section.id === 'menu' && (
            <form action={updateMenu} autoComplete="off">
              <div className="admin-panel st-panel">
                <p className="admin-meta st-note">
                  What each built-in page is called in the header and footer. Leave one blank to use
                  the name shown in grey. The menu&apos;s order, dropdowns, your own pages and links
                  to other sites are arranged in the editor, under <strong>Pages &amp; menu</strong>.
                </p>

                <div className="st-fields st-fields-grid">
                  <label className="admin-field st-field-flat">
                    Galleries
                    <input
                      type="text"
                      name="nav_galleries_label"
                      defaultValue={settings.nav_galleries_label ?? ''}
                      placeholder="Galleries"
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field st-field-flat">
                    Journal
                    <input
                      type="text"
                      name="nav_journal_label"
                      defaultValue={settings.nav_journal_label ?? ''}
                      placeholder="Journal"
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field st-field-flat">
                    About
                    <input
                      type="text"
                      name="nav_about_label"
                      defaultValue={settings.nav_about_label ?? ''}
                      placeholder="About"
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field st-field-flat">
                    Contact
                    <input
                      type="text"
                      name="nav_contact_label"
                      defaultValue={settings.nav_contact_label ?? ''}
                      placeholder="Contact"
                      className="admin-input"
                    />
                  </label>

                  <label className="admin-field st-field-flat">
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
          )}

          {/* ── Search & sharing ─────────────────────────────────────────────
              A signpost, and said to be one. These settings are real and they
              are per page, so the only honest thing this section can do is say
              where they are. */}
          {section.id === 'seo' && (
            <div className="admin-panel st-panel st-panel-quiet">
              <h3 className="admin-h2">These belong to each page</h3>
              <p className="admin-meta st-note">
                A page&apos;s browser title, its description in a search result, the image a link
                preview shows and whether search engines are asked to skip it are all set on the page
                itself — under <strong>Search &amp; sharing</strong> on its card. There is nothing
                site-wide to set here: a single description for every page is the thing that makes a
                site invisible.
              </p>
              <Link href="/admin/pages" className="lg-btn">
                <Icon name="pages" size={15} />
                Go to Pages
              </Link>
            </div>
          )}

          {/* ── Integrations ─────────────────────────────────────────────── */}
          {section.id === 'integrations' && instagram && (
            <div className="admin-panel st-panel">
              <h3 className="admin-h2">Instagram feed</h3>
              <p className="admin-meta st-note">
                Connection and syncing live here. Whether the block appears on the homepage is set in
                the editor.
              </p>

              <form action={saveInstagramToken} autoComplete="off">
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
                    placeholder={instagram.connected ? 'Saved — paste a new one to replace it' : 'IGQ…'}
                    className="admin-input"
                    autoComplete="new-password"
                  />
                  <span className="admin-meta st-hint">
                    Stored where only this site&apos;s editors can read it, and never sent back to
                    this page.
                  </span>
                </label>

                <SaveBar label="Save connection" />
              </form>

              <div className="st-panel-split">
                <InstagramPanel
                  connected={instagram.connected}
                  expiresAt={settings.instagram_token_expires}
                  syncedAt={settings.instagram_synced_at}
                  postCount={instagram.posts}
                />
              </div>
            </div>
          )}

          {/* ── Newsletter ───────────────────────────────────────────────── */}
          {section.id === 'newsletter' && counts && (
            <div className="admin-panel st-panel">
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
                  total: counts.total,
                  // Waiting and failed only mean anything once there is
                  // somewhere for them to go.
                  waiting: newsletter ? counts.waiting : 0,
                  failed: newsletter ? counts.failed : 0,
                }}
              />
            </div>
          )}

          {/* ── Team & permissions ───────────────────────────────────────── */}
          {section.id === 'team' && (
            <div className="admin-panel st-panel">
              <h3 className="admin-h2">Who can sign in</h3>
              <ul className="st-team">
                {(team ?? []).map((member) => (
                  <li key={member.id}>
                    <span className="st-team-who">
                      <span className="st-team-name">{member.display_name || member.email}</span>
                      {member.display_name && <span className="st-team-mail">{member.email}</span>}
                    </span>
                    <span className="admin-tag">{member.role}</span>
                  </li>
                ))}
              </ul>
              <p className="admin-meta st-note" style={{ margin: 0 }}>
                Adding an editor still means creating the user in Supabase by hand. There is no
                invitation flow in this build, so there is no button here that would look like one.
              </p>
            </div>
          )}

          {/* ── Advanced ─────────────────────────────────────────────────────
              New uploads build their own display sizes, so this is a recovery
              tool — it matters again if photographs ever arrive without them,
              such as a library imported from another platform. */}
          {section.id === 'advanced' && (
            <div className="admin-panel st-panel">
              <h3 className="admin-h2">Photograph sizes</h3>
              {unprocessed > 0 ? (
                <BackfillPanel initialRemaining={unprocessed} />
              ) : (
                <p className="admin-meta st-note" style={{ margin: 0 }}>
                  Every photograph in this site has its display sizes. Nothing to rebuild. This tool
                  appears here when some do not — a library imported from another platform, for
                  instance.
                </p>
              )}
            </div>
          )}
        </div>

        <SettingsRail
          siteName={settings.site_title}
          host={host}
          faviconUrl={settings.favicon_path ? photoUrl(settings.favicon_path) : null}
        />
      </div>
    </div>
  )
}
