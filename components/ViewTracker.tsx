'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { browserSessionId } from '@/lib/analytics/session'
import { cleanPathname, isTrackablePath, visitBody } from '@/lib/analytics/visit'

/**
 * ONE ROW PER PAGE A VISITOR OPENS
 * ════════════════════════════════
 *
 * This used to be dropped into two pages by hand — the album page and the
 * journal post — and told which gallery or story it was looking at. So the
 * homepage, About, Contact and every page a photographer made themselves were
 * never counted at all, and the two that were counted were counted by an
 * identity the browser supplied.
 *
 * Now it is mounted once, in the root layout, and it sends a pathname. The
 * server works out what is at that address on this site. Nothing about the
 * identity of the page travels from here.
 *
 * ── Why the root layout, given that the root layout is not public ───────────
 *
 * The public pages are not under a shared segment: `app/page.tsx`,
 * `app/about`, `app/contact`, `app/journal`, `app/trips`, `app/shop` and
 * `app/[slug]` are siblings at the top, alongside `app/admin`, `app/edit` and
 * `app/preview`. The only layout all the public ones share is the root one,
 * which the private ones share too.
 *
 * Introducing a route group to separate them would move seven directories and
 * every import that points into them, to make a mount point tidier. The
 * invariant that matters — **every public page fires exactly once, and no
 * private page fires at all** — is held instead by `isTrackablePath`, and held
 * a second time by the server, which refuses an address that is not a page of
 * the site whatever asks it to. Two cheap checks beat one large refactor.
 *
 * ── Once per page, including after a client-side navigation ──────────────────
 *
 * A layout is not re-rendered when a visitor clicks through to another page;
 * `usePathname()` is a hook, so this component re-renders even though the
 * layout does not, and the effect runs again with the new address. The ref is
 * what stops a re-render for any other reason from counting the same page
 * twice: it holds the last address actually sent, not a "have I ever run" flag,
 * because the answer needed is per-address.
 */
export default function ViewTracker() {
  const pathname = usePathname()
  const sent = useRef<string | null>(null)

  useEffect(() => {
    const path = cleanPathname(pathname)
    if (!path || !isTrackablePath(path)) return
    if (sent.current === path) return
    sent.current = path

    // Null in a private window and wherever site data is blocked. That is NOT
    // a reason to send nothing: the page view still goes, with no session, and
    // that one row simply cannot take part in a within-visit funnel. The first
    // version of this returned early here, which made a browser that respects
    // its user an uncounted visitor — systematic undercounting of exactly the
    // people most likely to have blocked storage. What must not happen is a
    // fallback that outlives the tab, so there is none: no cookie, no
    // localStorage, nothing derived from the request.
    const session = browserSessionId()

    // The referring host, reduced HERE, so the page somebody came from — its
    // path, its search terms — never leaves the tab. `document.referrer` is
    // empty on a direct arrival and on a same-site click in most browsers.
    let ref: string | null = null
    try {
      if (document.referrer) {
        const host = new URL(document.referrer).hostname.toLowerCase()
        if (host && host !== location.hostname.toLowerCase()) ref = host
      }
    } catch {
      ref = null
    }

    fetch('/api/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(visitBody(path, session, ref)),
      keepalive: true,
    }).catch(() => {
      // Analytics should never break the page.
    })
  }, [pathname])

  return null
}
