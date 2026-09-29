import { sanitizeCustomPages, type CustomPage } from '@/lib/sections/pages'
import { builtinKeyAt } from '@/lib/analytics/pages'
import { isTrackablePath, type Device } from '@/lib/analytics/visit'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * WHOSE PAGE THIS WAS, DECIDED HERE AND NOT IN THE BROWSER
 * ═══════════════════════════════════════════════════════
 *
 * The old tracker POSTed `{ albumId }`. That is an identity chosen by the
 * client, and the table's policy was `with check (true)`, so a visitor could
 * name any gallery on the platform — including one belonging to a photographer
 * whose site they had never opened — and a row would be written against it.
 * Nothing read those rows as a security decision, so the consequence was
 * numbers rather than access; that is a reason it was never noticed, not a
 * reason it was all right.
 *
 * After S4 the browser sends **a pathname and nothing else that identifies
 * anything**. Everything that says whose view this was is worked out here:
 *
 *   the site      from the `Host` header, by lib/tenant.ts, before this is
 *                 called. A visitor cannot forge the address they arrived on.
 *   the page      by looking the pathname up in THIS SITE'S own pages,
 *                 galleries and stories. A gallery belonging to somebody else
 *                 is not at any address on this site, so the lookup simply
 *                 does not find it — the spoof cannot be expressed rather
 *                 than being caught and refused.
 *   the path      written back out from what was found, never echoed. So the
 *                 `/trips/<slug>` in the row is the slug the album row carries,
 *                 not a string that arrived over a network.
 *
 * And then `record_page_view` checks all of it again in the database, which is
 * where the guarantee actually lives: this file could have a bug, and the
 * function would still refuse to file a view of one site's gallery against
 * another site.
 *
 * ── Why the three lookups are handed in ─────────────────────────────────────
 *
 * `identify()` takes them rather than making them, for the same reason
 * `drain()` takes a client in lib/jobs/run.ts: the thing worth testing here is
 * the RESOLUTION — which address maps to which page, which ones map to nothing,
 * what happens at a gate — and that logic is unreachable behind a live Supabase
 * client. `liveLookups()` below is the production wiring and is three queries
 * long, each naming `tenant_id` (which `npm run check:tenants` insists on).
 *
 * `.mk/analytics.ts` supplies lookups that run the SAME SQL against a real
 * Postgres carrying the fixture. Not a fake that answers what the real one
 * would — a fake like that is how a green suite comes to mean nothing, which is
 * the lesson S1 cost three incidents.
 *
 * ── A locked gallery is not a view ─────────────────────────────────────────
 *
 * `/trips/<slug>` on a password-protected album shows a password box, not
 * photographs. The old tracker was mounted below that gate so it never fired;
 * the new one is mounted once for the whole site and cannot see the gate, so
 * the gate is re-checked here — the same cookie, read from the same request.
 * Otherwise every locked gallery would start accumulating views nobody had.
 */

export type Identity =
  | { kind: 'page'; pageKey: string; path: string }
  | { kind: 'album'; albumId: string; path: string }
  | { kind: 'post'; postId: string; path: string }

/** The three questions resolution needs to ask about a site. */
export type SiteLookups = {
  albumBySlug(slug: string): Promise<{ id: string; slug: string; privacy: string } | null>
  postBySlug(slug: string): Promise<{ id: string; slug: string } | null>
  customPages(): Promise<CustomPage[]>
}

export type Visit = {
  tenantId: string
  /** Already reduced by `cleanPathname`. */
  path: string
  visitorHash: string
  /**
   * Null when the browser would not keep a per-tab value — a private window,
   * or site data blocked. An ordinary outcome: the view is recorded and that
   * one row cannot take part in a within-visit funnel. There is deliberately
   * no fallback that outlives the tab.
   */
  sessionHash: string | null
  device: Device
  referrerHost: string | null
  /** True when the visitor holds `album_access_<id>` for this album. */
  albumAccess: (albumId: string) => boolean
}

export type Outcome =
  /** A row was written. */
  | { ok: true }
  /** Nothing to count: not a public page, or not a page of this site at all. */
  | { ok: false; why: 'not-a-page' }
  /** The database refused it, or could not be reached. Logged, never thrown. */
  | { ok: false; why: 'refused' | 'unavailable' }

/** The production wiring: three tenant-scoped reads through the given client. */
export function liveLookups(db: SupabaseClient, tenantId: string): SiteLookups {
  return {
    async albumBySlug(slug) {
      const { data } = await db
        .from('albums')
        .select('id, slug, privacy_type')
        .eq('tenant_id', tenantId)
        .eq('slug', slug)
        .maybeSingle()
      return data
        ? { id: data.id as string, slug: data.slug as string, privacy: data.privacy_type as string }
        : null
    },

    async postBySlug(slug) {
      const { data } = await db
        .from('blog_posts')
        .select('id, slug')
        .eq('tenant_id', tenantId)
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle()
      return data ? { id: data.id as string, slug: data.slug as string } : null
    },

    async customPages() {
      const { data } = await db
        .from('site_settings')
        .select('custom_pages')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      return sanitizeCustomPages(data?.custom_pages)
    },
  }
}

/**
 * The page, gallery or story at an address on this site — or null.
 *
 * Order matters and mirrors Next's own: every fixed route in `app/` is matched
 * before `app/[slug]`, and a photographer cannot take one of those addresses
 * (RESERVED in lib/sections/pages.ts). So built-ins are tried first here too,
 * and one of the photographer's own pages last.
 */
export async function identify(
  look: SiteLookups,
  path: string,
  albumAccess: (albumId: string) => boolean
): Promise<Identity | null> {
  if (!isTrackablePath(path)) return null

  const builtin = builtinKeyAt(path)
  if (builtin) return { kind: 'page', pageKey: builtin, path }

  const segments = path.split('/').filter(Boolean)

  if (segments.length === 2 && segments[0] === 'trips') {
    const album = await look.albumBySlug(segments[1]!)
    if (!album) return null

    // What the page itself does: a client-only gallery is not served at this
    // address at all, and a password one is not served until the cookie is
    // there. app/trips/[slug]/page.tsx.
    if (album.privacy === 'client_only') return null
    if (album.privacy === 'password' && !albumAccess(album.id)) return null

    return { kind: 'album', albumId: album.id, path: `/trips/${album.slug}` }
  }

  if (segments.length === 2 && segments[0] === 'journal') {
    const post = await look.postBySlug(segments[1]!)
    if (!post) return null
    return { kind: 'post', postId: post.id, path: `/journal/${post.slug}` }
  }

  if (segments.length === 1) {
    const page = (await look.customPages()).find((p) => p.slug === segments[0])
    if (page) return { kind: 'page', pageKey: page.key, path: `/${page.slug}` }
  }

  return null
}

/** One view, recorded or not, and never an exception either way. */
export async function recordVisit(
  db: SupabaseClient | null,
  look: SiteLookups | null,
  visit: Visit
): Promise<Outcome> {
  if (!db || !look) return { ok: false, why: 'unavailable' }

  const identity = await identify(look, visit.path, visit.albumAccess)
  if (!identity) return { ok: false, why: 'not-a-page' }

  const { error } = await db.rpc('record_page_view', {
    p_tenant: visit.tenantId,
    p_path: identity.path,
    p_visitor: visit.visitorHash,
    p_session: visit.sessionHash,
    p_device: visit.device,
    p_page_key: identity.kind === 'page' ? identity.pageKey : null,
    p_album: identity.kind === 'album' ? identity.albumId : null,
    p_post: identity.kind === 'post' ? identity.postId : null,
    p_referrer_host: visit.referrerHost,
  })

  if (error) {
    // Loud, because the only things that reach here are a bug in this file and
    // somebody trying it on, and both are worth reading in the morning.
    console.error('[analytics] record_page_view refused a view:', error.message)
    return { ok: false, why: 'refused' }
  }

  return { ok: true }
}
