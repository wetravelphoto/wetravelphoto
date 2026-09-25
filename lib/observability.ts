import type { ErrorEvent, Event } from '@sentry/nextjs'

/**
 * KNOWING SOMETHING BROKE, WITHOUT BEING TOLD
 * ═══════════════════════════════════════════
 *
 * When one person uses a site, a broken page is a thing they notice. When a
 * friend uses it, it is a thing they work around and never mention — not out
 * of politeness exactly, more that "it did something odd" does not feel worth
 * a message. Every fault found that way arrives days late and without detail.
 *
 * Three decisions worth defending, because each is a place this could have
 * been worse:
 *
 * **1. It is inert without a DSN.** No key, nothing initialises, nothing is
 * sent, and no code path behaves differently. A monitoring tool that can break
 * the thing it monitors is a bad trade, and someone cloning this repo should
 * not have to sign up for anything to run it.
 *
 * **2. Every event says WHICH SITE.** An error with no tenant on it is
 * "something, somewhere, broke" — true, useless, and it gets worse with every
 * photographer who joins. `markSite()` is called once per request from
 * `currentSite()`, which is the one place that already knows.
 *
 * **3. Share-link tokens never leave the building.** This is the part that
 * would have been a real leak. `/gallery/<token>` and `/review/<token>` are
 * not identifiers — they are BEARER CREDENTIALS. Anyone holding one opens a
 * client's private gallery. Sent to an error tracker they would sit in a URL
 * field, readable by anyone with access to that account, for as long as the
 * event is retained. The same is true of the auth tokens that land on
 * `/admin/login` as `#access_token`, `?code` and `?token_hash`.
 *
 * So the URL is scrubbed before anything is sent, in one function, applied to
 * the request, the referrer and every breadcrumb. It replaces rather than
 * removes — `/gallery/<token>` still tells you a share link broke, which is
 * the information worth having.
 */

/**
 * `TransactionEvent` is exported by @sentry/core but not re-exported by
 * @sentry/nextjs, and reaching into a transitive dependency for one type is
 * how a build breaks on an unrelated upgrade. Structurally it is this.
 */
type Transaction = Event & { type: 'transaction' }

/** Public by design: a DSN identifies a project, it does not grant access to it. */
export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? ''

/** False everywhere no DSN is configured — locally, in forks, in CI. */
export const watching = SENTRY_DSN.trim() !== ''

/**
 * Query and fragment parameters that are credentials rather than context.
 * Lower-cased; matched exactly.
 */
const SECRET_PARAMS = new Set([
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'token',
  'token_hash',
  'code',
  'password',
  'secret',
  'key',
  'api_key',
  'apikey',
])

/**
 * What replaces a credential. Deliberately plain characters: `<token>` reads
 * better in prose but `URL` percent-encodes the angle brackets, so what
 * actually arrives is `%3Ctoken%3E` — noise in every stack trace, and the sort
 * of thing somebody later mistakes for the real value.
 */
const TOKEN_MARK = 'token-redacted'
const SECRET_MARK = 'redacted'

/** Path prefixes whose NEXT segment is a bearer token. */
const TOKEN_PATHS = ['gallery', 'review']

/**
 * A URL with its credentials taken out and its shape left in.
 *
 * Deliberately string-first with a URL parse as the happy path: this runs
 * inside `beforeSend`, and an exception thrown here would lose the very event
 * we are trying to keep. Anything unparseable is returned as a bare marker
 * rather than passed through — when in doubt, send less.
 */
export function redactUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined

  try {
    // Relative URLs are common in breadcrumbs; a base makes them parseable and
    // is stripped again below.
    const relative = !/^[a-z][a-z0-9+.-]*:/i.test(raw)
    const url = new URL(raw, relative ? 'https://redacted.invalid' : undefined)

    const parts = url.pathname.split('/')
    for (let i = 0; i < parts.length - 1; i++) {
      if (TOKEN_PATHS.includes(parts[i].toLowerCase()) && parts[i + 1]) {
        parts[i + 1] = TOKEN_MARK
      }
    }
    url.pathname = parts.join('/')

    for (const name of Array.from(url.searchParams.keys())) {
      if (SECRET_PARAMS.has(name.toLowerCase())) url.searchParams.set(name, SECRET_MARK)
    }

    // The fragment is where Supabase puts an access token, and URL does not
    // parse it for us.
    if (url.hash.length > 1) {
      const frag = new URLSearchParams(url.hash.slice(1))
      let touched = false
      for (const name of Array.from(frag.keys())) {
        if (SECRET_PARAMS.has(name.toLowerCase())) {
          frag.set(name, SECRET_MARK)
          touched = true
        }
      }
      if (touched) url.hash = `#${frag.toString()}`
    }

    const out = url.toString()
    return relative ? out.replace('https://redacted.invalid', '') : out
  } catch {
    return '<unparseable url>'
  }
}

/**
 * Applied to every event on its way out: the request URL, the referrer, and
 * each breadcrumb that carries one.
 */
export function scrub<T extends Event>(event: T): T {
  if (event.request?.url) event.request.url = redactUrl(event.request.url)

  if (event.request?.query_string) {
    // Sentry may hand this over as a string, an object or pairs. Only the
    // string form is worth rewriting; the others are dropped rather than
    // half-cleaned.
    event.request.query_string =
      typeof event.request.query_string === 'string'
        ? (redactUrl(`?${event.request.query_string.replace(/^\?/, '')}`)?.replace(/^\?/, '') ?? '')
        : undefined
  }

  const referer = event.request?.headers?.Referer ?? event.request?.headers?.referer
  if (event.request?.headers && typeof referer === 'string') {
    const clean = redactUrl(referer)
    if (event.request.headers.Referer) event.request.headers.Referer = clean ?? ''
    if (event.request.headers.referer) event.request.headers.referer = clean ?? ''
  }

  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      const from = crumb.data?.url ?? crumb.data?.from ?? crumb.data?.to
      if (typeof from !== 'string' || !crumb.data) continue
      if (typeof crumb.data.url === 'string') crumb.data.url = redactUrl(crumb.data.url)
      if (typeof crumb.data.from === 'string') crumb.data.from = redactUrl(crumb.data.from)
      if (typeof crumb.data.to === 'string') crumb.data.to = redactUrl(crumb.data.to)
    }
  }

  return event
}

/**
 * The settings every runtime shares. Kept here rather than repeated in the
 * three config files, because three copies of a privacy rule is two copies
 * that will drift.
 */
export function baseOptions() {
  return {
    dsn: SENTRY_DSN,
    enabled: watching,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,

    // No email addresses, no IP addresses, no request bodies. What is wanted
    // is "the gallery page threw on site X", not who was looking at it.
    sendDefaultPii: false,

    // Errors only, to begin with. Performance tracing is genuinely useful and
    // is also what fills a free plan in a week; with two photographers there
    // is nothing to learn from a sample of their traffic. Raise it when there
    // is traffic worth sampling.
    tracesSampleRate: 0,

    beforeSend: (event: ErrorEvent) => scrub(event),
    beforeSendTransaction: (event: Transaction) => scrub(event),
    beforeBreadcrumb: (crumb: { data?: Record<string, unknown> }) => {
      if (crumb.data && typeof crumb.data.url === 'string') {
        crumb.data.url = redactUrl(crumb.data.url)
      }
      return crumb
    },
  }
}
