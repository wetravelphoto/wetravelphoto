/**
 * WITHIN ONE VISIT, AND NOT ONE MINUTE LONGER
 * ═══════════════════════════════════════════
 *
 * Two identifiers live on a `page_views` row and they are opposites. Keeping
 * them straight is most of the privacy design, so:
 *
 *   `visitor_hash`  sha256(ip | user-agent | today's date), computed on the
 *                   server and never stored in either part. It answers "how
 *                   many people", and it rotates at midnight, so the same
 *                   person tomorrow is a different hash and nobody can be
 *                   followed from one day to the next. It is DERIVED from the
 *                   request — which is why it must rotate.
 *
 *   `session_hash`  16 random bytes minted in the tab, kept in
 *                   `sessionStorage`, gone when the tab closes. It answers
 *                   "did this visit go from the homepage to a gallery". It is
 *                   derived from NOTHING: not the address, not the browser,
 *                   not an account, not the screen. There is nothing in it to
 *                   reverse, and two tabs open side by side are two visits
 *                   because that is what they are.
 *
 * ── Why sessionStorage and not the two obvious alternatives ─────────────────
 *
 * A COOKIE would be sent on every request to the site including images, would
 * need a consent banner in most of the world, and would outlive the visit —
 * which is the definition of the thing this is not. `localStorage` is worse
 * still: it is permanent, so the "session" id would quietly become a durable
 * identifier for one person across months, which is the failure mode where an
 * analytics feature turns into tracking without anybody deciding to.
 *
 * `sessionStorage` is per-TAB and is cleared by the browser when the tab goes.
 * Nothing here has to expire it, and nothing here could extend it.
 *
 * ── Why the store is a parameter ────────────────────────────────────────────
 *
 * `sessionIdIn(store, random)` takes both, so the behaviour can be asserted
 * without a browser: the same store handed to two calls is what navigating
 * within a tab looks like, and a fresh store is what a new tab looks like. The
 * wrapper below is the only part that touches globals, and it is three lines
 * with nothing to get wrong.
 *
 * Every access is wrapped, and **null is an ordinary answer.** `sessionStorage`
 * throws outright in a Safari private window and wherever a site's data is
 * blocked. That costs the funnel and nothing else: the page view is still
 * recorded, with `session_hash` null.
 *
 * It used to cost the whole view — no id meant no request — which made a
 * browser that respects its user an uncounted visitor, and undercounted exactly
 * the people most likely to have blocked storage. The temptation in the other
 * direction is worse: a cookie or a `localStorage` key would always work and
 * would outlive the visit, which is the one thing this must not do. There is no
 * substitute for a random per-tab value, so when there is none, the column is
 * left empty.
 */

/** Just enough of `Storage` to hold one string. */
export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const SESSION_KEY = 'lg.visit'

const SHAPE = /^[0-9a-f]{32}$/

/** 16 random bytes as hex, from the platform's CSPRNG. */
export function randomSessionId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The id for this visit: whatever is already in the store, or a new one put
 * there. A stored value that is not the right shape is replaced rather than
 * trusted — it did not come from here.
 */
export function sessionIdIn(store: StorageLike, random: () => string = randomSessionId): string | null {
  try {
    const existing = store.getItem(SESSION_KEY)
    if (typeof existing === 'string' && SHAPE.test(existing)) return existing

    const fresh = random()
    if (!SHAPE.test(fresh)) return null
    store.setItem(SESSION_KEY, fresh)
    return fresh
  } catch {
    return null
  }
}

/**
 * The same thing, in a browser. Null when there is no tab-scoped store to put
 * it in, which is a reason not to record rather than a reason to fall back to
 * something that lasts longer.
 */
export function browserSessionId(): string | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null
    return sessionIdIn(window.sessionStorage)
  } catch {
    return null
  }
}
