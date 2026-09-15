import 'server-only'

/**
 * Which site a public request is for.
 *
 * There is one site today, so this returns null and every caller treats that
 * as "do not filter". It exists as a named seam rather than an absence,
 * because the places that will need it — a gallery opened by slug, a share
 * token, a settings row — are being written now, and a seam that is already
 * threaded through them is a one-function change later instead of a hunt.
 *
 * When domain routing lands, this reads the Host header and matches it against
 * tenants.domain:
 *
 *   const host = (await headers()).get('host')?.split(':')[0]
 *   → select id from tenants where domain = host
 *
 * with a fallback to the first tenant so localhost and preview deployments
 * keep working.
 */
export async function currentSiteTenantId(): Promise<string | null> {
  return null
}

/**
 * Applies that filter to a PostgREST query, or leaves it alone while there is
 * one site. Keeps the `if (tenantId)` dance out of every call site.
 */
export function scopeToSite<T extends { eq: (column: string, value: unknown) => T }>(
  query: T,
  tenantId: string | null
): T {
  return tenantId ? query.eq('tenant_id', tenantId) : query
}
