import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { markSite } from '@/lib/observability-server'

/**
 * WHICH SITE A REQUEST IS FOR
 * ═══════════════════════════
 *
 * The address decides. `Host` is matched against `tenant_domains`, and that
 * one answer is what every public read scopes itself to. Before this the
 * answer was always "site 1", which was correct exactly as long as there was
 * only one site.
 *
 * **The host decides, not the session.** A signed-in photographer visiting
 * someone else's address sees that person's site, not their own — the
 * alternative is a page that shows different content depending on who is
 * looking at it, which is not a website. Editing is where the session matters,
 * and `requireEditor()` refuses when the two disagree.
 *
 * **An address nobody has claimed gets nothing.** `null`, and the caller shows
 * "no site here" rather than quietly serving whoever happens to be first in
 * the table. That silent fallback is precisely the bug this replaces, and it
 * would come back the first time a beta tester's DNS pointed at us a day
 * before their row existed.
 *
 * The exception is development: localhost, a Vercel preview build and anything
 * named in DEV_HOSTS resolve to the oldest tenant, because a preview
 * deployment has no real address and refusing to render would make previews
 * useless. Those cases are marked `assumed`, so a caller can tell the
 * difference between "this is Ana's site" and "this is a guess".
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

export type Site = {
  tenantId: string
  /** The address this request arrived on: lower-case, no port. */
  host: string
  /** The address this site calls home. Canonical URLs and share links use it. */
  primaryHost: string
  /** True when the host was not recognised and a development tenant was used. */
  assumed: boolean
}

/**
 * Addresses that fall back to the oldest site rather than to nothing.
 *
 * Three of them, and the third is the one that matters. A laptop and a Vercel
 * preview have no real address and never will. But the address in
 * NEXT_PUBLIC_SITE_URL is the one this deployment was configured for, and
 * trusting it is what stops the live site going blank in the window between
 * this code deploying and its migration being run — the row that would match
 * it does not exist yet.
 */
function usesFallbackTenant(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (host.endsWith('.localhost')) return true
  // Vercel's own preview addresses, which change on every deployment.
  if (host.endsWith('.vercel.app')) return true

  const configured = hostFromHeader(
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, '').split('/')[0]
  )
  if (configured && host === configured) return true

  return (process.env.DEV_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .includes(host)
}

/** `Host` as a bare hostname: lower-case, no port, no trailing dot. */
export function hostFromHeader(raw: string | null | undefined): string | null {
  if (!raw) return null
  // An IPv6 host arrives bracketed — [::1]:3000 — so the port is whatever
  // follows the last colon that is not inside brackets.
  const trimmed = raw.trim().toLowerCase()
  const bare = trimmed.startsWith('[')
    ? trimmed.slice(1, trimmed.indexOf(']'))
    : trimmed.split(':')[0]
  const clean = bare.replace(/\.$/, '')
  return clean || null
}

/**
 * The site this request is for, resolved once per request.
 *
 * `cache()` matters here: the layout, the page, the sitemap and half a dozen
 * loaders all ask, and without it that is a database round trip each.
 */
export const currentSite = cache(async (): Promise<Site | null> => {
  const host = hostFromHeader((await headers()).get('host'))
  if (!host) return null

  const supabase = await createClient()

  const { data: match } = await supabase
    .from('tenant_domains')
    .select('tenant_id, host')
    .eq('host', host)
    .maybeSingle()

  if (match?.tenant_id) {
    const tenantId = match.tenant_id as string
    const site = {
      tenantId,
      host,
      primaryHost: (await primaryHostFor(tenantId)) ?? host,
      assumed: false,
    }
    // Every error reported for the rest of this request now says which site
    // it came from. Cheap, and the difference between a useful report and
    // "something, somewhere, broke".
    markSite(site)
    return site
  }

  // Not a claimed address. A laptop, a preview build or the address this
  // deployment was configured for gets the oldest site so the app is usable;
  // anything else gets nothing, because serving a stranger someone else's
  // website is worse than serving them an explanation.
  if (!usesFallbackTenant(host)) {
    markSite(null)
    return null
  }

  const { data: oldest } = await supabase
    .from('tenants')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!oldest?.id) return null

  const tenantId = oldest.id as string
  const site = {
    tenantId,
    host,
    primaryHost: (await primaryHostFor(tenantId)) ?? host,
    assumed: true,
  }
  markSite(site)
  return site
})

/** The address a site calls home, or null if it has none yet. */
async function primaryHostFor(tenantId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenant_domains')
    .select('host')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  return (data?.host as string) ?? null
}

/** The site's id, or null. What a query scopes itself to. */
export async function currentSiteTenantId(): Promise<string | null> {
  return (await currentSite())?.tenantId ?? null
}
