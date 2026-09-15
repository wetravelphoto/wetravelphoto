import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { currentSiteTenantId } from '@/lib/tenant'

/**
 * THE ONLY WAY INTO A CLIENT GALLERY
 * ══════════════════════════════════
 *
 * A share link carries a token. Until 2026-09-15 the token was checked in each
 * place that used it, while the underlying tables were readable by anyone with
 * the public anon key — so the check was decoration. The tables are closed now
 * (db/migrations/2026-09-15_share_links.sql) and this module is the only thing
 * that reads them on a visitor's behalf.
 *
 * The shape is deliberate. `accessForToken` is the one function that takes a
 * token, and it is the only way to obtain a `ShareAccess`. Every other
 * function here demands one, and scopes what it returns to the albums that
 * token actually opened. A caller cannot skip the check, because without a
 * `ShareAccess` there is nothing to call.
 *
 * It runs with the service-role key, which ignores row level security — so the
 * scoping in this file IS the security. Two rules when editing it:
 *
 *   1. Never take an album or photo id from the caller and trust it. Check it
 *      against `access.albumIds` first — `assertAlbum` below.
 *   2. Never export something that returns rows without a `ShareAccess`.
 *
 * Everything here is server-only; the token never reaches the browser's
 * database client, because the browser does not have one on these pages.
 */

export type ShareAccess = {
  clientId: string
  clientName: string | null
  /** Exactly the albums this token opens. Nothing else is reachable. */
  albumIds: string[]
}

const PHOTO_COLUMNS =
  'id, album_id, storage_path, derivatives, caption, alt_text, width, height, is_for_sale, taken_at, sort_order'

/**
 * Verifies a share token. Null means "no such token" — callers should render
 * a 404 rather than anything that distinguishes a wrong token from a revoked
 * one.
 */
export async function accessForToken(token: string): Promise<ShareAccess | null> {
  if (!token || token.length < 8) return null

  const supabase = createAdminClient()
  const tenantId = await currentSiteTenantId()

  const query = supabase.from('clients').select('id, name').eq('access_token', token)
  const { data: client } = await (tenantId ? query.eq('tenant_id', tenantId) : query).maybeSingle()

  if (!client) return null

  const { data: shares } = await supabase
    .from('album_clients')
    .select('album_id')
    .eq('client_id', client.id)

  return {
    clientId: client.id as string,
    clientName: (client.name as string) ?? null,
    albumIds: (shares ?? []).map((s) => s.album_id as string).filter(Boolean),
  }
}

/** Throws unless this album is one the token opened. */
function assertAlbum(access: ShareAccess, albumId: string): void {
  if (!access.albumIds.includes(albumId)) {
    throw new Error('That gallery was not shared with this link.')
  }
}

export async function albumsForAccess(access: ShareAccess) {
  if (access.albumIds.length === 0) return []

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('albums')
    // Explicitly not '*': that would carry password_hash into a page rendered
    // for someone who is not the owner.
    .select(
      'id, title, slug, cover_photo_id, cover_title_text, cover_focal_x, cover_focal_y, allow_downloads'
    )
    .in('id', access.albumIds)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function photosForAccess(access: ShareAccess) {
  if (access.albumIds.length === 0) return []

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .in('album_id', access.albumIds)
    .order('sort_order', { ascending: true })

  return data ?? []
}

export async function favoritePhotoIds(access: ShareAccess): Promise<string[]> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('favorites')
    .select('photo_id')
    .eq('client_id', access.clientId)

  return (data ?? []).map((f) => f.photo_id as string)
}

export async function setFavorite(
  access: ShareAccess,
  albumId: string,
  photoId: string,
  favorited: boolean
): Promise<void> {
  assertAlbum(access, albumId)

  const supabase = createAdminClient()

  if (favorited) {
    await supabase
      .from('favorites')
      .delete()
      .eq('album_id', albumId)
      .eq('photo_id', photoId)
      .eq('client_id', access.clientId)
  } else {
    await supabase.from('favorites').insert({
      album_id: albumId,
      photo_id: photoId,
      client_id: access.clientId,
    })
  }
}

/**
 * The file behind a single download, or null if this token does not open the
 * album that photograph belongs to.
 */
export async function photoForDownload(access: ShareAccess, photoId: string) {
  const supabase = createAdminClient()

  const { data: photo } = await supabase
    .from('photos')
    .select('id, album_id, storage_path, original_path')
    .eq('id', photoId)
    .maybeSingle()

  if (!photo) return null
  if (!access.albumIds.includes(photo.album_id as string)) return null

  return photo
}

/** An album a token opens, for the zip route. Null if it does not. */
export async function albumForZip(access: ShareAccess, albumId: string) {
  if (!access.albumIds.includes(albumId)) return null

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('albums')
    .select('id, title, slug, allow_downloads')
    .eq('id', albumId)
    .maybeSingle()

  return data ?? null
}

export async function photosForZip(access: ShareAccess, albumId: string) {
  assertAlbum(access, albumId)

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('photos')
    .select('storage_path, original_path, caption')
    .eq('album_id', albumId)
    .order('sort_order')

  return data ?? []
}

export async function recordDownload(
  access: ShareAccess,
  photoId: string | null
): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase.from('downloads').insert({
    photo_id: photoId,
    client_id: access.clientId,
  })

  // A download that happened should not fail because its audit row did.
  if (error) console.warn('[gallery] could not log a download:', error.message)
}
