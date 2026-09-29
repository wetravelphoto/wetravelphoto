/**
 * WHAT A VISIT IS ALLOWED TO SAY ABOUT SOMEBODY
 * ═════════════════════════════════════════════
 *
 * Pure functions, no imports, safe in the browser and on the server — which is
 * the point: the reductions below have to happen on BOTH sides of the wire.
 *
 * The rule is the same every time: **reduce first, then send.** The browser
 * sends a pathname rather than a URL and a hostname rather than a referrer, so
 * the query string and the referring page's own path never leave the tab at
 * all; the server reduces again, because what arrives over a network is never
 * what was sent. Neither reduction on its own is the guarantee. Both together
 * mean there is no point at which the discarded part exists anywhere we keep.
 *
 * ── The three buckets, and why the string is thrown away ────────────────────
 *
 * A user-agent is a fingerprint. Not in the loose sense — in the literal one:
 * the exact string a browser sends, taken with a screen size and a language
 * list, identifies a great many people uniquely, which is the whole basis of
 * the tracking industry this codebase is not part of. What a photographer
 * actually wants to know is whether people are arriving on a phone, because
 * that decides how much of their design work matters. Three words answer that.
 *
 * So the string is read once, in memory, turned into one of three words, and
 * dropped. `device` has a CHECK constraint naming exactly those three words,
 * which is what makes it impossible for a later change to start keeping the
 * string here — it would not fit.
 */

export const DEVICES = ['phone', 'tablet', 'desktop'] as const
export type Device = (typeof DEVICES)[number]

/** 16 random bytes, hex, lower case. See lib/analytics/session.ts. */
export const SESSION_SHAPE = /^[0-9a-f]{32}$/

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_SHAPE.test(value)
}

/**
 * EVERYTHING THE BROWSER IS ALLOWED TO SAY, IN ONE PLACE
 * ═════════════════════════════════════════════════════
 *
 * Three fields. A fourth would be something the browser had been trusted to
 * say about which site, gallery or story this was, and that is the mistake S4
 * exists to correct.
 *
 * It is a function rather than an object literal inside the tracker for two
 * reasons. It is the only thing about the request that can be asserted without
 * a browser — `.mk/analytics.ts` calls it directly. And it is where the
 * **session is optional** rule lives:
 *
 * `session` comes back null when `sessionStorage` threw or was blocked, and
 * that is an ordinary outcome, not a reason to send nothing: the page view is
 * still recorded and that one row cannot take part in a within-visit funnel.
 * Treating a private window as an uncounted visitor is systematic
 * undercounting of the people most likely to have blocked storage.
 *
 * A session id of the wrong SHAPE is also sent as null rather than sent as it
 * is. It did not come from `randomSessionId()`, so whatever it is, it is not a
 * session id — and the database refuses a malformed one anyway, which would
 * lose the whole view over a field that is optional.
 */
export type VisitBody = {
  path: string
  session: string | null
  ref: string | null
}

export function visitBody(
  path: string,
  session: string | null,
  ref: string | null
): VisitBody {
  return {
    path,
    session: isSessionId(session) ? session : null,
    ref: typeof ref === 'string' && ref ? ref : null,
  }
}

/**
 * Addresses that are not a visitor looking at a website.
 *
 * `/gallery/…` and `/review/…` are on this list for a reason beyond not being
 * public pages: their second segment is a SECRET. A share link is the
 * credential — anybody holding it can open the gallery — so putting one in
 * `path` would write a working password into a table the photographer's own
 * dashboard reads, and into any export of it. Sentry already scrubs these for
 * the same reason.
 *
 * `/shop/…` — a single print's page — is excluded for a different reason,
 * written up in `db/migrations/2026-09-29_analytics.sql`: its identity is a
 * photograph id, there is no column to hold one, and an unvalidated id inside
 * `path` is exactly the boundary this phase exists to close. The shop's front
 * page IS tracked. Recorded in `claude/open-items.md`.
 */
export const UNTRACKED_PREFIXES = [
  '/admin',
  '/edit',
  '/preview',
  '/api',
  '/gallery/',
  '/review/',
  '/shop/',
  '/_next',
  '/.',
] as const

/**
 * A pathname, or null.
 *
 * Everything after `?` or `#` goes, whatever it was — this is the function
 * that means a link somebody shared with `?email=…` on the end cannot be
 * written down. A trailing slash is removed so `/about` and `/about/` are one
 * page rather than two rows that never add up.
 */
export function cleanPathname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null

  let path = raw.trim()
  if (!path.startsWith('/')) return null

  // A protocol-relative address — //evil.example/x — is a host, not a path.
  if (path.startsWith('//')) return null

  path = path.split('?')[0]!.split('#')[0]!
  if (/[\s\\]/.test(path)) return null
  if (path.length > 255) return null

  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  return path || '/'
}

/** Whether a pathname is one a public visitor can be counted on. */
export function isTrackablePath(path: string): boolean {
  if (!path.startsWith('/')) return false
  return !UNTRACKED_PREFIXES.some((p) => path === p || path.startsWith(p))
}

/**
 * The host a visitor came from, or null.
 *
 * Null rather than our own address for an internal click: a referrer column
 * full of the site's own name answers nothing, and "where do people find me"
 * is the only question this column exists for. Null also for anything that is
 * not a plain hostname — no scheme, no port, no path, no search, and a dot in
 * it, because a single label is either `localhost` or somebody probing.
 */
export function referrerHost(raw: unknown, ownHost: string | null): string | null {
  if (typeof raw !== 'string') return null

  // Accept either a bare host (what our own tracker sends) or a full URL (what
  // a hand-written request might), and keep only the host either way.
  let host = raw.trim().toLowerCase()
  if (!host) return null

  if (host.includes('/') || host.includes(':')) {
    try {
      host = new URL(host.includes('//') ? host : `https://${host}`).hostname.toLowerCase()
    } catch {
      return null
    }
  }

  host = host.replace(/\.$/, '')
  if (host.length > 253) return null
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return null
  if (!host.includes('.')) return null
  if (ownHost && host === ownHost.toLowerCase()) return null

  return host
}

/**
 * One of three words, from what the request already carried.
 *
 * Tablets are tested for FIRST, because every tablet also matches one of the
 * phone patterns: an iPad's user-agent contains "Mobile", and an Android
 * tablet's contains "Android". Reversing these two lines is the classic way
 * this function goes quietly wrong — nothing breaks, tablets just stop
 * existing.
 *
 * `sec-ch-ua-mobile` is a client hint that Chromium sends and that says
 * `?1`/`?0` with no version numbers or model in it. It is used as a
 * tie-breaker only: it cannot tell a tablet from a phone, and it is absent in
 * Safari and Firefox.
 */
export function deviceFrom(userAgent: string | null, mobileHint?: string | null): Device {
  const ua = userAgent ?? ''

  const tablet =
    /\biPad\b/i.test(ua) ||
    /\bTablet\b/i.test(ua) ||
    /\b(Kindle|Silk|PlayBook)\b/i.test(ua) ||
    // Android's own convention: a tablet omits "Mobile" from an otherwise
    // identical string.
    (/\bAndroid\b/i.test(ua) && !/\bMobile\b/i.test(ua)) ||
    // Samsung tablets, whose model codes begin SM-T where phones use SM-G/A/N.
    /\bSM-T\d/i.test(ua)

  if (tablet) return 'tablet'

  const phone =
    /\b(iPhone|iPod)\b/i.test(ua) ||
    /\bMobi\b/i.test(ua) ||
    /\bAndroid\b/i.test(ua) ||
    /\b(Windows Phone|BlackBerry|BB10|Opera Mini|IEMobile)\b/i.test(ua) ||
    mobileHint?.trim() === '?1'

  return phone ? 'phone' : 'desktop'
}
