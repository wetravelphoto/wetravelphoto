'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import AdminSidebar from '@/components/admin/AdminSidebar'
import Icon from '@/components/admin/Icon'
import { publish } from '@/app/actions/canvas'

/**
 * THE SHELL AROUND EVERY ADMIN SCREEN
 * ═══════════════════════════════════
 *
 * The rail, the top bar, and whatever screen is open between them.
 *
 * ── Why the top bar is here and not on each screen ──────────────────────────
 *
 * Previewing the site and publishing it are the two things you do from
 * anywhere. Put them on each screen and they end up in a slightly different
 * place on each screen; put them in the shell and they are always in the same
 * corner, which is the whole value of a chrome.
 *
 * ── The count is real or it is absent ───────────────────────────────────────
 *
 * It counts the things actually waiting in the draft: each edited page, plus
 * style and the site's own settings if either has been touched. When nothing
 * is waiting, the button is not a disabled Publish — it says the site is up to
 * date, because a greyed-out button is the same picture whether you have just
 * published or have not opened the editor all week. (The same reasoning as the
 * editor's own Publish button; see components/canvas/Canvas.tsx.)
 */

/** What each admin path is called in the breadcrumb, and which area it is in. */
const WHERE: { match: string; area?: string; name: string; exact?: boolean }[] = [
  { match: '/admin', name: 'Overview', exact: true },
  { match: '/admin/pages', area: 'Website', name: 'Pages' },
  { match: '/admin/design', area: 'Website', name: 'Design' },
  { match: '/admin/trips', area: 'Content', name: 'Galleries' },
  { match: '/admin/journal', area: 'Content', name: 'Journal' },
  { match: '/admin/shop', area: 'Business', name: 'Store' },
  { match: '/admin/clients', area: 'Business', name: 'Clients' },
  { match: '/admin/messages', area: 'Business', name: 'Inquiries' },
  { match: '/admin/settings', name: 'Settings' },
  { match: '/admin/sites', name: 'Sites' },
]

function crumb(pathname: string): { area?: string; name: string } {
  // Longest match wins, so /admin/shop/catalog is the Store and not Overview.
  const found = [...WHERE]
    .sort((a, b) => b.match.length - a.match.length)
    .find((w) => (w.exact ? pathname === w.match : pathname.startsWith(w.match)))
  return found ?? { name: 'Workspace' }
}

export default function AdminShell({
  children,
  email,
  unreadCount,
  platformAdmin,
  siteName,
  siteLogoUrl,
  role,
  /** How many things are waiting to publish. 0 means the site is up to date. */
  waiting,
}: {
  children: React.ReactNode
  email: string
  unreadCount: number
  platformAdmin: boolean
  siteName: string
  siteLogoUrl: string | null
  role: string | null
  waiting: number
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [drawer, setDrawer] = useState(false)
  const [pending, startTransition] = useTransition()
  const [failed, setFailed] = useState<string | null>(null)
  const here = crumb(pathname)

  return (
    <div className="admin-shell">
      <AdminSidebar
        email={email}
        unreadCount={unreadCount}
        platformAdmin={platformAdmin}
        siteName={siteName}
        siteLogoUrl={siteLogoUrl}
        role={role}
        open={drawer}
        onClose={() => setDrawer(false)}
      />

      {/* Only drawn on small screens (workspace.css), where the rail is a
          drawer over the page rather than a column beside it. */}
      {drawer && (
        <button
          type="button"
          className="lg-rail-scrim"
          aria-label="Close navigation"
          onClick={() => setDrawer(false)}
        />
      )}

      <main className="admin-main">
        <header className="lg-top">
          <p className="lg-crumb">
            <button
              type="button"
              className="lg-ico lg-rail-toggle"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
              aria-expanded={drawer}
            >
              <Icon name="menu" />
            </button>
            {/* The area is dropped on a phone, where the name is the only part
                there is room for and the only part that is news. */}
            {here.area && (
              <span className="lg-crumb-area">
                <span>{here.area}</span>
                <span className="lg-crumb-sep" aria-hidden>
                  /
                </span>
              </span>
            )}
            <span className="lg-crumb-here">{here.name}</span>
          </p>

          <div className="lg-top-actions">
            {failed && (
              <span role="alert" style={{ fontSize: 12.5, color: 'var(--admin-danger)' }}>
                {failed}
              </span>
            )}

            {/* On a phone this is the icon alone — the label is the first thing
                that can go, and the name stays on the control for anyone who
                cannot see the picture. */}
            <Link
              href="/"
              target="_blank"
              rel="noreferrer"
              className="lg-btn lg-btn-shrink"
              aria-label="Preview site in a new tab"
            >
              <span className="lg-btn-label">Preview site</span>
              <Icon name="external" size={14} />
            </Link>

            {waiting > 0 ? (
              <button
                type="button"
                className="lg-btn lg-btn-primary"
                disabled={pending}
                onClick={() => {
                  setFailed(null)
                  startTransition(async () => {
                    try {
                      await publish()
                      router.refresh()
                    } catch (e) {
                      setFailed(e instanceof Error ? e.message : 'Could not publish.')
                    }
                  })
                }}
              >
                <span className="lg-btn-label-wide">
                  {pending ? 'Publishing…' : 'Publish changes'}
                </span>
                <span className="lg-btn-label-narrow" aria-hidden>
                  {pending ? 'Publishing…' : 'Publish'}
                </span>
                {!pending && <span className="lg-btn-count">{waiting}</span>}
              </button>
            ) : (
              /* Nothing is waiting. Said, rather than drawn as a button you
                 cannot press — which looks identical to one you have not
                 earned the right to press yet. */
              <span className="lg-published-note">
                <Icon name="check" size={14} />
                All changes published
              </span>
            )}
          </div>
        </header>

        <div className="lg-screen">{children}</div>
      </main>
    </div>
  )
}
