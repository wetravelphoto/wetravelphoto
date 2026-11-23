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
 * **Except under `next dev` with DEV_TENANT_HOST set.** There a loopback
 * address gets the site that registered address belongs to, or nothing — never
 * the oldest site. A compiled build cannot take that path at all. See
 * `developmentStandIn()`.
 *
 * **Except on a deployment Vercel itself calls a preview** (`VERCEL_ENV` is
 * `preview`). There an unclaimed address never gets the oldest site: it gets
 * the one site named in GALLERY_PREVIEW_TENANT_ID, and only on this
 * deployment's own immutable address (`VERCEL_URL`), and only once that site
 * is confirmed to exist — otherwise nothing. See `previewSite()`. A preview
 * that shows real photographs must show the right photographer's or none.
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

  // `next dev` on this machine, asked to stand in for one registered address.
  // Anywhere else this is `undefined` and nothing below changes.
  const standIn = developmentStandIn(host)
  if (standIn !== undefined) {
    const site = standIn ? await registeredSite(standIn, host, supabase) : null
    markSite(site)
    return site
  }

  // A Vercel preview deployment never reaches the oldest-site guess below.
  // Production and development (VERCEL_ENV unset, `development` or
  // `production`) are untouched by this line.
  if (process.env.VERCEL_ENV === 'preview') {
    const site = await previewSite(host, supabase)
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The three loopback names a laptop answers to. Not `*.localhost`. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])
/** A bare, lower-case DNS name with a dot and an alphabetic last label: no port, scheme, path, space or IP. */
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * THE ADDRESS A LAPTOP MAY STAND IN FOR
 * ═════════════════════════════════════
 *
 * `next dev` on localhost normally gets the oldest site. DEV_TENANT_HOST
 * (`karlamata.lensgrid.co`) makes it get the site that address belongs to
 * instead, so one photographer's site can be worked on locally.
 *
 * Returns `undefined` — "not in play, carry on exactly as before" — unless
 * every one of these holds:
 *
 *   - this is the development server. Next replaces `process.env.NODE_ENV`
 *     and `process.env.__NEXT_DEV_SERVER` with constants when it compiles
 *     (node_modules/next/dist/build/define-env.js): in any `next build` they
 *     are `'production'` (unless `allowDevelopmentBuild`, which this project
 *     does not set) and `''`, so the comparisons below are false in the
 *     compiled code whatever the deployment's environment says at run time;
 *   - not on Vercel at all (`VERCEL` / `VERCEL_ENV` unset) — a second,
 *     run-time refusal for production and preview deployments;
 *   - the request arrived on a loopback name (by its `Host`);
 *   - DEV_TENANT_HOST is set and non-empty.
 *
 * In play, it returns the address to look up, or `null` when the setting is
 * not a bare lower-case hostname — and `null` means NO site, never the oldest
 * one. The address is only a key into `tenant_domains`; an address nobody has
 * claimed resolves to nothing there too. Nothing from the request but `Host`
 * takes part, and `Host` can only switch the stand-in on or leave it off.
 *
 * `Host` is the request's own claim: the socket's address is not visible from
 * here, and `x-forwarded-for` is filled by the client first. So "loopback"
 * means "addressed to localhost". Bind the dev server to loopback
 * (`next dev -H 127.0.0.1`) if other machines can reach it.
 */
function developmentStandIn(host: string): string | null | undefined {
  if (process.env.NODE_ENV !== 'development') return undefined
  if (process.env.__NEXT_DEV_SERVER !== '1') return undefined
  if (process.env.VERCEL || process.env.VERCEL_ENV) return undefined
  if (!LOOPBACK.has(host)) return undefined
  const wanted = process.env.DEV_TENANT_HOST
  if (!wanted) return undefined
  return HOSTNAME.test(wanted) ? wanted : null
}

/**
 * The site `lookupHost` is registered to, served on `requestHost` — or null
 * when no row claims it or the read fails. `assumed` is false: the site comes
 * from a row, so `requireEditor()` treats it exactly as on that address.
 */
async function registeredSite(
  lookupHost: string,
  requestHost: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Site | null> {
  const { data, error } = await supabase
    .from('tenant_domains')
    .select('tenant_id, host')
    .eq('host', lookupHost)
    .maybeSingle()
  if (error || data?.host !== lookupHost || typeof data?.tenant_id !== 'string') return null

  const tenantId = data.tenant_id
  return {
    tenantId,
    host: requestHost,
    primaryHost: (await primaryHostFor(tenantId)) ?? lookupHost,
    assumed: false,
  }
}

/**
 * THE ONE SITE A PREVIEW DEPLOYMENT MAY SHOW
 * ══════════════════════════════════════════
 *
 * Reached only when `VERCEL_ENV` is `preview` and the address is not in
 * `tenant_domains`. Every condition must hold, or the answer is null:
 *
 *   - the address is exactly this deployment's own immutable one, as Vercel
 *     reports it in `VERCEL_URL` — not a branch alias, not another preview,
 *     not anything ending in `.vercel.app`;
 *   - GALLERY_PREVIEW_TENANT_ID is a canonical lower-case uuid (lower-case
 *     because the id is compared as a string elsewhere — `requireEditor()`);
 *   - `tenants` holds that id.
 *
 * Both inputs are server-side environment, set by whoever deploys the preview.
 * Nothing from the request but its `Host` takes part, and `Host` can only
 * select between "this deployment's address" and "nothing" — no query
 * parameter, header or body can name a site.
 *
 * `assumed` is false: the site is configured, not guessed, so the editor's
 * "this is not your site" check applies here exactly as on a claimed address.
 */
async function previewSite(
  host: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Site | null> {
  const tenantId = process.env.GALLERY_PREVIEW_TENANT_ID
  if (!tenantId || !UUID.test(tenantId)) return null

  const ownHost = hostFromHeader(process.env.VERCEL_URL?.replace(/^https?:\/\//, '').split('/')[0])
  if (!ownHost || host !== ownHost) return null

  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle()
  if (error || data?.id !== tenantId) return null

  return {
    tenantId,
    host,
    primaryHost: (await primaryHostFor(tenantId)) ?? host,
    assumed: false,
  }
}

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
