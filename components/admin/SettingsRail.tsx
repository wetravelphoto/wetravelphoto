import Link from 'next/link'
import Icon from '@/components/admin/Icon'
import PageThumb from '@/components/admin/PageThumb'

/**
 * WHAT THE SETTINGS ON THIS SCREEN ADD UP TO
 * ══════════════════════════════════════════
 *
 * Six of the fields in Settings are invisible where they are edited and visible
 * only somewhere else: the site name is a browser tab and a link preview, the
 * icon is sixteen pixels beside it, the address is what somebody types. Editing
 * them in a column of text inputs means guessing at the result and then opening
 * the site in another tab to check.
 *
 * So the rail draws the result: a tab, an address bar, and the real homepage
 * under them.
 *
 * ── Nothing here is decorated ───────────────────────────────────────────────
 *
 * Every value in the frame is this site's own — the saved name, the saved icon,
 * the address it is served at, and the homepage rendered through the same route
 * the editor previews through. With no icon saved it draws the blank mark a
 * browser draws, not a placeholder square with a letter in it, because the
 * point of the preview is to show what a visitor sees.
 */
export default function SettingsRail({
  siteName,
  host,
  faviconUrl,
}: {
  siteName: string
  /** Null when no address is attached to this site yet. */
  host: string | null
  /** Null when no site icon has been uploaded. */
  faviconUrl: string | null
}) {
  return (
    <aside className="st-rail" aria-label="Preview">
      <section className="st-card">
        <h2 className="st-card-h">Identity preview</h2>
        <p className="st-card-note">How the site introduces itself in a browser.</p>

        <div className="st-chrome">
          <div className="st-chrome-bar" aria-hidden>
            <span className="st-chrome-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="st-chrome-tab">
              <span className="st-chrome-fav">
                {faviconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={faviconUrl} alt="" width={14} height={14} />
                ) : (
                  /* The blank page mark, which is what a tab with no icon
                     actually shows. */
                  <span className="st-chrome-fav-none" />
                )}
              </span>
              <span className="st-chrome-name">{siteName || 'Untitled site'}</span>
            </span>
          </div>

          <div className="st-chrome-url" aria-hidden>
            <Icon name="shield" size={12} />
            <span>{host ?? 'no address yet'}</span>
          </div>

          {/* 16/10 exactly: the miniature is rendered at SHOT_WIDTH × SHOT_HEIGHT
              and scaled by width, so a frame any TALLER than that ratio leaves a
              strip of its own background under the page. 16/11 did, and it read
              as the homepage having a white band at the bottom. */}
          <PageThumb page="home" ratio="16 / 10" className="st-chrome-shot" />
        </div>

        {host ? (
          <Link href={`https://${host}`} target="_blank" rel="noreferrer" className="st-card-go">
            Open the live site
            <Icon name="external" size={12} />
          </Link>
        ) : (
          <p className="st-card-note" style={{ marginTop: 'var(--lg-3)', marginBottom: 0 }}>
            The homepage above is rendered from your own content; it is not
            reachable by anyone until an address is attached.
          </p>
        )}
      </section>

      {/*
        * ── THE SETTINGS THAT ARE NOT IN SETTINGS ──────────────────────────────
        *
        * A page's own title, its description, its share image and whether it is
        * hidden belong to that page, and they are edited on it. Somebody who
        * opens Settings looking for them should be told where they are, once,
        * rather than concluding the feature does not exist.
        */}
      <section className="st-card">
        <h2 className="st-card-h">Looking for page settings?</h2>
        <p className="st-card-note">
          A page&apos;s title, description, share image and whether it is hidden belong to the page
          itself, not to the site. They are on each page&apos;s card.
        </p>
        <Link href="/admin/pages" className="lg-btn st-card-btn">
          <Icon name="pages" size={15} />
          Go to Pages
        </Link>
        <p className="st-card-note" style={{ margin: 'var(--lg-3) 0 0' }}>
          Logos, the menu&apos;s order, the footer and the typefaces are in the editor — click the
          header or footer on any page.
        </p>
      </section>
    </aside>
  )
}
