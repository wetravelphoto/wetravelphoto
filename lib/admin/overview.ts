import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import type { Window } from '@/lib/admin/audience-window'

export { WINDOWS, windowOf, type Window } from '@/lib/admin/audience-window'

/**
 * WHAT THE OVERVIEW IS ALLOWED TO SAY
 * ═══════════════════════════════════
 *
 * Every number on that screen comes from here, and every one of them is
 * counted rather than estimated. A dashboard that rounds, extrapolates or
 * shows a plausible-looking zero is worse than no dashboard: it is consulted
 * exactly when somebody wants to know whether anything is happening.
 *
 * ── The tenant filter that was missing ──────────────────────────────────────
 *
 * `page_views` had no `tenant_id` of its own — a row hung off EITHER an album
 * or a story, one of the two being null. Row-level security scoped it through
 * whichever parent it had, and the old dashboard leaned on that and selected
 * the table with no filter at all.
 *
 * Which is fine for a photographer and wrong for a platform admin, who passes
 * `is_platform_admin()` in every policy and therefore sees EVERY SITE'S views
 * counted as their own. Same shape as the `deleteDraft` fault found on
 * 2026-09-25: a comment saying "row-level security handles it" over a query
 * that names no tenant. The parents are resolved here and the views are asked
 * for by id.
 *
 * ── And since S4, the site is on the row ────────────────────────────────────
 *
 * `page_views.tenant_id` exists (2026-09-29), backfilled from exactly those
 * parents, so the two filters below name it as well. That is not a second
 * belt: it is what `npm run check:tenants` now insists on for this table, and
 * it turns "this query is scoped because of the ids in it" into something a
 * reader can see without following the ids.
 *
 * **What it deliberately does NOT do is widen the number.** S4 instruments
 * every public page, so `page_views` now holds homepage and About views too —
 * and this still counts galleries and stories only, because that is what the
 * tile below it says. Widening it is a decision about what a dashboard claims,
 * not a side effect of a migration; the `views` field's own comment stays true
 * until somebody makes it.
 */

export type Audience = {
  days: Window
  /** Unique people who opened a gallery or a story. */
  visitors: number
  /** Views of those galleries and stories. NOT every page of the site — the
      site's own pages are not instrumented, and saying "page views" without
      saying which pages is the kind of number nobody can act on. */
  views: number
  inquiries: number
  subscribers: number
  /** True when subscribers could only be counted all-time. */
  subscribersAllTime: boolean
}

export type RecentItem = {
  id: string
  title: string
  kind: 'gallery' | 'story'
  href: string
  /** What it says under the name: "Gallery · 6 photos", "Journal". */
  note: string
  thumbUrl: string | null
  /** 'live' | 'idle' with its own words, same vocabulary as the page cards. */
  state: 'live' | 'idle'
  stateLabel: string
  /** The sample content a new site arrives with, marked as such. */
  sample: boolean
  updatedAt: string | null
}

const SAMPLE_ALBUM_SLUG = 'sample-gallery'

/**
 * Views in the window, counted only for THIS site's galleries and stories.
 *
 * Two queries rather than one `or(...)`: the parents are two different tables,
 * and an `in` list of ids is a filter Postgres can answer from an index
 * without the policy having to resolve `tenant_of` per row.
 */
async function audienceViews(
  tenantId: string,
  since: string
): Promise<{ visitors: number; views: number }> {
  const supabase = await createClient()

  const [albums, posts] = await Promise.all([
    supabase.from('albums').select('id').eq('tenant_id', tenantId),
    supabase.from('blog_posts').select('id').eq('tenant_id', tenantId),
  ])

  const albumIds = (albums.data ?? []).map((a) => a.id)
  const postIds = (posts.data ?? []).map((p) => p.id)
  if (albumIds.length === 0 && postIds.length === 0) return { visitors: 0, views: 0 }

  const rows = await Promise.all([
    albumIds.length
      ? supabase
          .from('page_views')
          .select('visitor_hash')
          .eq('tenant_id', tenantId)
          .gte('viewed_at', since)
          .in('album_id', albumIds)
      : Promise.resolve({ data: [] as { visitor_hash: string }[] }),
    postIds.length
      ? supabase
          .from('page_views')
          .select('visitor_hash')
          .eq('tenant_id', tenantId)
          .gte('viewed_at', since)
          .in('post_id', postIds)
      : Promise.resolve({ data: [] as { visitor_hash: string }[] }),
  ])

  const all = [...(rows[0].data ?? []), ...(rows[1].data ?? [])]
  return { visitors: new Set(all.map((v) => v.visitor_hash)).size, views: all.length }
}

export async function audience(tenantId: string, days: Window): Promise<Audience> {
  const supabase = await createClient()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const [seen, inquiries, subs] = await Promise.all([
    audienceViews(tenantId, since),
    supabase
      .from('contact_messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', since),
    supabase
      .from('newsletter_signups')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', since),
  ])

  /*
   * If signups are not timestamped in this database, the windowed count is an
   * error rather than a zero — and reporting an error as "0 subscribers" is
   * the exact lie this file exists to avoid. Fall back to the total, and say
   * in the tile that it is the total.
   */
  let subscribers = subs.count ?? 0
  let subscribersAllTime = false
  if (subs.error) {
    const all = await supabase
      .from('newsletter_signups')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    subscribers = all.count ?? 0
    subscribersAllTime = true
  }

  return {
    days,
    visitors: seen.visitors,
    views: seen.views,
    inquiries: inquiries.count ?? 0,
    subscribers,
    subscribersAllTime,
  }
}

/**
 * The galleries and stories touched most recently, newest first.
 *
 * ── Two plain queries, and the counting done here ───────────────────────────
 *
 * The first version asked for the albums with `photos(id)` embedded, to get
 * the photo count in one round trip. PostgREST answers an embed it cannot
 * resolve — a relationship it does not see, a policy that blocks the child —
 * with an ERROR for the whole request, not with an album and no photos. So a
 * site with a gallery showed none, and the panel read "nothing yet" to
 * somebody looking at a gallery they had just made. The old dashboard had the
 * same embed and the same hole.
 *
 * Two flat selects cannot fail that way, and the tally is arithmetic.
 *
 * Ordering is done here too: `updated_at` is null on a row nobody has edited
 * since it was made, and where the database puts nulls in an ordering is not
 * something worth depending on. Sorted on "whichever of the two it has".
 */
export async function recentContent(tenantId: string, limit = 4): Promise<RecentItem[]> {
  const supabase = await createClient()

  const [albums, posts, photos] = await Promise.all([
    supabase.from('albums').select('*').eq('tenant_id', tenantId).limit(40),
    supabase
      .from('blog_posts')
      .select('id, title, status, updated_at, created_at, featured_custom_path')
      .eq('tenant_id', tenantId)
      .limit(40),
    supabase.from('photos').select('album_id').eq('tenant_id', tenantId).limit(5000),
  ])

  /** How many photographs each gallery has. */
  const counts = new Map<string, number>()
  for (const photo of photos.data ?? []) {
    const key = photo.album_id as string | null
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const rows = (albums.data ?? []) as Record<string, unknown>[]
  const { attachCovers } = await import('@/lib/album-covers')
  const withCovers = await attachCovers(
    rows as unknown as { id: string; cover_photo_id: string | null; cover_custom_path: string | null }[]
  )
  const coverById = new Map(withCovers.map((a) => [a.id, a.coverUrl]))

  const when = (row: { updated_at?: unknown; created_at?: unknown }) =>
    (row.updated_at as string) || (row.created_at as string) || ''

  const galleries: RecentItem[] = rows.map((a) => {
    const id = a.id as string
    const count = counts.get(id) ?? 0
    return {
      id,
      title: (a.title as string) || 'Untitled gallery',
      kind: 'gallery',
      href: `/admin/trips/${id}`,
      note: `Gallery · ${count} ${count === 1 ? 'photo' : 'photos'}`,
      thumbUrl: coverById.get(id) ?? null,
      state: a.privacy_type === 'public' ? 'live' : 'idle',
      stateLabel: a.privacy_type === 'public' ? 'Public' : 'Private',
      sample: a.slug === SAMPLE_ALBUM_SLUG,
      updatedAt: when(a) || null,
    }
  })

  const stories: RecentItem[] = (posts.data ?? []).map((p) => ({
    id: p.id,
    title: p.title || 'Untitled story',
    kind: 'story',
    href: `/admin/journal/${p.id}`,
    note: 'Journal',
    thumbUrl: p.featured_custom_path ? photoUrl(p.featured_custom_path as string) : null,
    state: p.status === 'published' ? 'live' : 'idle',
    stateLabel: p.status === 'published' ? 'Published' : 'Draft',
    sample: false,
    updatedAt: when(p) || null,
  }))

  return [...galleries, ...stories]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, limit)
}
