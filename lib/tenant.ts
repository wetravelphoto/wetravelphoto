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
 *
 * ── Why there is no scopeToSite() helper here ────────────────────────────────
 *
 * There was one. It took a query builder and returned it with `.eq()` applied,
 * generic over the builder's own type:
 *
 *   function scopeToSite<T extends { eq: (c: string, v: unknown) => T }>(...)
 *
 * which reads nicely and broke the build. Supabase's builder type is deeply
 * recursive — each `.eq()` returns a new type parameterised by the last — so
 * constraining a generic to "returns itself" sends the compiler round that
 * loop until it gives up with TS2589, "type instantiation is excessively deep
 * and possibly infinite". The error surfaces at the CALL SITE, in a file that
 * looks fine, which is a bad afternoon for whoever finds it.
 *
 * The call sites do it in two plain lines instead:
 *
 *   const query = supabase.from('albums').select('*').eq('slug', slug)
 *   const { data } = await (tenantId ? query.eq('tenant_id', tenantId) : query).maybeSingle()
 *
 * Three repetitions of something obvious beats one abstraction that fights the
 * type system.
 */
export async function currentSiteTenantId(): Promise<string | null> {
  return null
}
