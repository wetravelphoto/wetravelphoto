/**
 * WHERE A SITE'S FILES LIVE IN THE BUCKET
 * ═══════════════════════════════════════
 *
 * Every photographer's files share one R2 bucket. Before this, keys were only
 * `photos/<album>/…`, `branding/…`, `covers/…` — nothing in the key said whose
 * file it was, so the only thing stopping one site from naming another's file
 * was that nobody had tried.
 *
 * New files go under `t/<tenant id>/…`. And every action that is handed a key
 * by the browser — "I just uploaded this, please register it" — checks the key
 * is under the caller's own prefix before reading it. Without that check, a
 * signed-in account on one site could register another site's original, full
 * resolution, into its own gallery and download it.
 *
 * Files uploaded before this keep their old keys; they are only ever read
 * through rows that already point at them, never registered again.
 */

export function tenantPrefix(tenantId: string): string {
  return `t/${tenantId}`
}

/** A key under this site's prefix. */
export function tenantKey(tenantId: string, path: string): string {
  return `${tenantPrefix(tenantId)}/${path.replace(/^\/+/, '')}`
}

/**
 * Whether a key handed over by the browser belongs to this site. Rejects
 * anything outside the prefix and any attempt to climb out of it.
 */
export function ownsKey(tenantId: string, key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.startsWith(`${tenantPrefix(tenantId)}/`) &&
    !key.includes('..') &&
    !key.includes('//')
  )
}
