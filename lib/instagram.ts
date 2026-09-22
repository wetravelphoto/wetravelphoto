import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export type InstagramPost = {
  id: string
  media_url: string
  thumbnail_url: string | null
  permalink: string
  caption: string | null
  media_type: string | null
  posted_at: string | null
}

type GraphMedia = {
  id: string
  media_url?: string
  thumbnail_url?: string
  permalink: string
  caption?: string
  media_type?: string
  timestamp?: string
}

const GRAPH = 'https://graph.instagram.com'

/**
 * Which site, and through which database connection.
 *
 * An editor pressing "Sync now" passes their own signed-in client: row-level
 * security then scopes every read and write to their site. The scheduled job
 * has no signed-in user at all — which is why, once the tables were scoped by
 * site, it quietly stopped being able to read the token or replace the feed —
 * so it passes the service-role client and says which site it is working on,
 * explicitly, on every query.
 */
export type InstagramTarget = {
  db: SupabaseClient
  tenantId: string
}

/**
 * The access token lives in site_secrets, not site_settings. site_settings is
 * readable by anyone with the public key — the site needs its colours before
 * anybody signs in — and a long-lived Instagram token in that row was readable
 * by anyone who asked PostgREST for it.
 */
async function readToken({ db, tenantId }: InstagramTarget): Promise<string | null> {
  const { data } = await db
    .from('site_secrets')
    .select('instagram_token')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  return (data?.instagram_token as string | null) ?? null
}

/**
 * Pulls the latest media and caches it in our own table. The feed is read
 * from that cache, so a visitor never waits on Meta and a rate limit or
 * outage can't blank the section.
 */
export async function syncInstagram(
  target: InstagramTarget,
  limit = 9
): Promise<{ ok: boolean; message: string; count?: number }> {
  const { db, tenantId } = target
  const token = await readToken(target)
  if (!token) return { ok: false, message: 'No Instagram token saved yet.' }

  const fields = 'id,media_url,thumbnail_url,permalink,caption,media_type,timestamp'
  const url = `${GRAPH}/me/media?fields=${fields}&limit=${limit}&access_token=${token}`

  let payload: { data?: GraphMedia[]; error?: { message: string } }

  try {
    const response = await fetch(url, { cache: 'no-store' })
    payload = await response.json()
  } catch {
    return { ok: false, message: 'Could not reach Instagram.' }
  }

  if (payload.error) return { ok: false, message: payload.error.message }
  if (!payload.data) return { ok: false, message: 'Instagram returned no media.' }

  // Videos have no media_url usable as a still, so fall back to the thumbnail
  const rows = payload.data
    .filter((item) => item.media_url || item.thumbnail_url)
    .map((item, index) => ({
      id: item.id,
      tenant_id: tenantId,
      media_url: (item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url) ?? item.media_url ?? '',
      thumbnail_url: item.thumbnail_url ?? null,
      permalink: item.permalink,
      caption: item.caption ?? null,
      media_type: item.media_type ?? null,
      posted_at: item.timestamp ?? null,
      sort_order: index,
      fetched_at: new Date().toISOString(),
    }))
    .filter((row) => row.media_url)

  // Replace this site's cache wholesale so deleted posts disappear too
  const { error: clearError } = await db.from('instagram_media').delete().eq('tenant_id', tenantId)
  if (clearError) return { ok: false, message: clearError.message }

  if (rows.length > 0) {
    const { error } = await db.from('instagram_media').insert(rows)
    if (error) return { ok: false, message: error.message }
  }

  await db
    .from('site_settings')
    .update({ instagram_synced_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)

  return { ok: true, message: `Fetched ${rows.length} posts.`, count: rows.length }
}

/**
 * Long-lived tokens last about 60 days and can be exchanged for a fresh one
 * any time after 24 hours. We refresh well inside that window.
 */
export async function refreshInstagramToken(
  target: InstagramTarget
): Promise<{ ok: boolean; message: string }> {
  const { db, tenantId } = target
  const token = await readToken(target)
  if (!token) return { ok: false, message: 'No token to refresh.' }

  try {
    const response = await fetch(
      `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`,
      { cache: 'no-store' }
    )
    const payload = await response.json()

    if (payload.error) return { ok: false, message: payload.error.message }
    if (!payload.access_token) return { ok: false, message: 'No token returned.' }

    const expires = new Date(Date.now() + (payload.expires_in ?? 5184000) * 1000)

    await db
      .from('site_secrets')
      .update({ instagram_token: payload.access_token, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)

    // The expiry date is not a secret, and the settings screen shows it.
    await db
      .from('site_settings')
      .update({ instagram_token_expires: expires.toISOString() })
      .eq('tenant_id', tenantId)

    return { ok: true, message: `Token refreshed, valid until ${expires.toLocaleDateString()}.` }
  } catch {
    return { ok: false, message: 'Could not reach Instagram.' }
  }
}

/** Whether this site has a token saved, without handing the token back. */
export async function hasInstagramToken(target: InstagramTarget): Promise<boolean> {
  return (await readToken(target)) !== null
}

export async function getInstagramFeed(limit = 9): Promise<InstagramPost[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('instagram_media')
    .select('id, media_url, thumbnail_url, permalink, caption, media_type, posted_at')
    .order('sort_order', { ascending: true })
    .limit(limit)

  return (data ?? []) as InstagramPost[]
}
