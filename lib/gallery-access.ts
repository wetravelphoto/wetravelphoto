import 'server-only'

import { createAdminClientOrNull } from '@/lib/supabase/admin'
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
  /** The site that minted the token — the request's own, checked in accessForToken. */
  tenantId: string
  clientId: string
  clientName: string | null
  /** Exactly the albums this token opens. Nothing else is reachable. */
  albumIds: string[]
}

// asset_id since P5: the page resolves each photograph's canonical file from
// it, server-side; the browser is handed a trimmed view, never the row.
const PHOTO_COLUMNS =
  'id, album_id, asset_id, storage_path, derivatives, caption, alt_text, width, height, is_for_sale, taken_at, sort_order'

/** What a shared album's page draws: its title, its cover, its layout, its download switch. Never the hash. */
const SHARED_ALBUM_COLUMNS = [
  'id', 'title', 'slug', 'allow_downloads', 'layout_style', 'gallery_hero', 'sort_order',
  'cover_preset', 'cover_title_enabled', 'cover_title_text', 'cover_subtitle', 'cover_show_date',
  'cover_show_location', 'cover_show_button', 'cover_date_format', 'cover_button_text', 'cover_font',
  'cover_title_scale', 'cover_title_color', 'cover_background', 'cover_focal_x', 'cover_focal_y', 'cover_zoom',
  'cover_photo_id', 'cover_secondary_photo_id', 'cover_custom_path', 'cover_overlay_type', 'cover_overlay_opacity',
  'location', 'trip_start_date', 'created_at',
].join(', ')

/**
 * Verifies a share token. Null means "no such token" — callers should render
 * a 404 rather than anything that distinguishes a wrong token from a revoked
 * one.
 */
export async function accessForToken(token: string): Promise<ShareAccess | null> {
  if (!token || token.length < 8) return null

  // clients and album_clients answer to nobody but their own site now, so
  // there is no anon path here — this genuinely needs the service role. When
  // the key is missing it returns null and the gallery 404s, with the reason
  // in the server log, rather than throwing a 500 at the visitor.
  const supabase = createAdminClientOrNull()
  if (!supabase) return null

  // A share link belongs to the site that minted it. Without this a token
  // from one photographer's gallery would open on another's address — the
  // service-role key below ignores row-level security, so this IS the check.
  const tenantId = await currentSiteTenantId()
  if (!tenantId) return null

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('access_token', token)
    .maybeSingle()

  if (!client) return null

  const { data: shares } = await supabase
    .from('album_clients')
    .select('album_id')
    .eq('client_id', client.id)

  return {
    tenantId,
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

  const supabase = createAdminClientOrNull()
  if (!supabase) return []

  const { data } = await supabase
    .from('albums')
    // Explicitly not '*': that would carry password_hash into a page rendered
    // for someone who is not the owner. The cover columns are the ones the
    // cover registry reads (lib/covers/album-cover.ts COVER_COLUMNS) — the
    // three cover-v2 columns exist since migration 20261122233150.
    .select(SHARED_ALBUM_COLUMNS)
    // album_clients carries no site of its own, so a link row pointing at
    // another site's album must not open it here.
    .eq('tenant_id', access.tenantId)
    .in('id', access.albumIds)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function photosForAccess(access: ShareAccess) {
  if (access.albumIds.length === 0) return []

  const supabase = createAdminClientOrNull()
  if (!supabase) return []

  const { data } = await supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .eq('tenant_id', access.tenantId)
    .in('album_id', access.albumIds)
    .order('sort_order', { ascending: true })

  return data ?? []
}

export async function favoritePhotoIds(access: ShareAccess): Promise<string[]> {
  const supabase = createAdminClientOrNull()
  if (!supabase) return []

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

  const supabase = createAdminClientOrNull()
  if (!supabase) return

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
  const supabase = createAdminClientOrNull()
  if (!supabase) return null

  const { data: photo } = await supabase
    .from('photos')
    .select('id, album_id, storage_path, original_path')
    .eq('tenant_id', access.tenantId)
    .eq('id', photoId)
    .maybeSingle()

  if (!photo) return null
  if (!access.albumIds.includes(photo.album_id as string)) return null

  // The album's own download switch decides, here as well as on the page: a
  // hidden button is not a closed door (client-gallery-v2, Part 1 item 6).
  const album = await albumForZip(access, photo.album_id as string)
  if (album?.allow_downloads !== true) return null

  return photo
}

/** Minimal query surface the zip helpers use — the service-role client, or a test's fake. */
export type ZipDb = { from: (table: string) => ZipQuery }
type ZipQuery = {
  select: (cols: string) => ZipQuery
  eq: (col: string, v: unknown) => ZipQuery
  in: (col: string, v: readonly unknown[]) => ZipQuery
  order: (col: string, opts?: { ascending?: boolean }) => ZipQuery
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>
  then: PromiseLike<{ data: unknown; error: unknown }>['then']
}

const adminDb = () => createAdminClientOrNull() as unknown as ZipDb | null

/** An album a token opens, for the zip route. Null if it does not. */
export async function albumForZip(access: ShareAccess, albumId: string, db: ZipDb | null = adminDb()) {
  if (!access.albumIds.includes(albumId)) return null
  if (!db) return null

  const { data } = await db
    .from('albums')
    .select('id, title, slug, allow_downloads')
    // album_clients carries no site; a link row naming another site's album
    // must not open it here (the same rule as albumsForAccess).
    .eq('tenant_id', access.tenantId)
    .eq('id', albumId)
    .maybeSingle()

  return (data as { id: string; title: string; slug: string; allow_downloads: boolean | null } | null) ?? null
}

export async function photosForZip(access: ShareAccess, albumId: string, db: ZipDb | null = adminDb()) {
  assertAlbum(access, albumId)
  if (!db) return []

  const { data } = await db
    .from('photos')
    .select('storage_path, original_path, caption')
    .eq('tenant_id', access.tenantId)
    .eq('album_id', albumId)
    .order('sort_order')

  return (data as Record<string, unknown>[] | null) ?? []
}

/**
 * The photographs of ONE album that THIS client favourited — the favourites
 * zip. Scoped three ways, each by the token's handle and nothing the caller
 * sends: the album must be one the token opens (assertAlbum), the favourites
 * are this client's own (`client_id`), and the photographs are read on the
 * token's site and inside that album, so a favourite row pointing anywhere
 * else draws nothing. Two flat reads, never an embed (PostgREST answers an
 * embed it cannot resolve by failing the whole request).
 *
 * A failed read is an error, never "no favourites": the route then refuses
 * rather than handing over an empty or partial zip.
 */
export async function favoritePhotosForZip(
  access: ShareAccess,
  albumId: string,
  db: ZipDb | null = adminDb()
): Promise<Record<string, unknown>[]> {
  assertAlbum(access, albumId)
  if (!db) throw new Error('favourites unavailable')

  const favs = await db
    .from('favorites')
    .select('photo_id')
    .eq('client_id', access.clientId)
    .eq('album_id', albumId)
  if (favs.error || !Array.isArray(favs.data)) throw new Error('favourites unavailable')

  const ids = [...new Set((favs.data as { photo_id: unknown }[]).map((f) => f.photo_id).filter((v): v is string => typeof v === 'string'))]
  if (ids.length === 0) return []

  const photos = await db
    .from('photos')
    .select('storage_path, original_path, caption')
    .eq('tenant_id', access.tenantId)
    .eq('album_id', albumId)
    .in('id', ids)
    .order('sort_order')
  if (photos.error || !Array.isArray(photos.data)) throw new Error('favourites unavailable')

  return photos.data as Record<string, unknown>[]
}

export async function recordDownload(
  access: ShareAccess,
  photoId: string | null
): Promise<void> {
  const supabase = createAdminClientOrNull()
  if (!supabase) return

  const { error } = await supabase.from('downloads').insert({
    photo_id: photoId,
    client_id: access.clientId,
  })

  // A download that happened should not fail because its audit row did.
  if (error) console.warn('[gallery] could not log a download:', error.message)
}
