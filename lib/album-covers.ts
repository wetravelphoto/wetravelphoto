import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import { srcSetFor, displayUrl, srcSetFromPath } from '@/lib/srcset'
import type { Derivatives } from '@/lib/image-sizes'

/**
 * Loads public galleries with exactly the photograph each one needs for its
 * cover, and nothing else.
 *
 * The previous query was `albums(*, photos(id, storage_path))`, which pulled
 * every photo row of every public gallery on every render — thousands of rows
 * to choose one image per gallery. On a small catalogue that's merely wasteful;
 * past a certain size PostgREST gives up and the page shows "bad gateway".
 *
 * Two bounded queries instead: the albums, then only the specific cover
 * photographs. Cost no longer grows with how many photos you upload.
 */

export type CoverPhoto = {
  id: string
  storage_path: string
  derivatives: Derivatives | null
}

export type AlbumWithCover = Record<string, unknown> & {
  id: string
  cover_photo_id: string | null
  cover_custom_path: string | null
  coverUrl: string | null
  coverSrcSet: string | undefined
}

/** Fills in coverUrl and coverSrcSet for a set of albums. */
export async function attachCovers<T extends { id: string; cover_photo_id: string | null; cover_custom_path: string | null }>(
  albums: T[]
): Promise<(T & { coverUrl: string | null; coverSrcSet: string | undefined })[]> {
  if (albums.length === 0) return []

  const supabase = await createClient()

  // Galleries with an explicit cover: fetch just that photo.
  const explicitIds = albums
    .filter((a) => !a.cover_custom_path && a.cover_photo_id)
    .map((a) => a.cover_photo_id as string)

  // Galleries with no explicit cover fall back to their first photograph, so
  // ask for one row per album rather than all of them.
  const fallbackAlbumIds = albums
    .filter((a) => !a.cover_custom_path && !a.cover_photo_id)
    .map((a) => a.id)

  const [explicitResult, fallbackResult] = await Promise.all([
    explicitIds.length > 0
      ? supabase
          .from('photos')
          .select('id, album_id, storage_path, derivatives')
          .in('id', explicitIds)
      : Promise.resolve({ data: [] }),

    fallbackAlbumIds.length > 0
      ? supabase
          .from('photos')
          .select('id, album_id, storage_path, derivatives')
          .in('album_id', fallbackAlbumIds)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] }),
  ])

  type Row = CoverPhoto & { album_id: string }

  const byId = new Map<string, Row>()
  for (const row of (explicitResult.data ?? []) as Row[]) byId.set(row.id, row)

  // First photo per album wins; the query is already sorted
  const firstByAlbum = new Map<string, Row>()
  for (const row of (fallbackResult.data ?? []) as Row[]) {
    if (!firstByAlbum.has(row.album_id)) firstByAlbum.set(row.album_id, row)
  }

  return albums.map((album) => {
    if (album.cover_custom_path) {
      const url = photoUrl(album.cover_custom_path)
      return {
        ...album,
        coverUrl: url,
        // Custom covers have no derivatives column, so the ladder is derived
        // from the path. Covers uploaded before that existed return undefined
        // and simply fall back to the single file.
        coverSrcSet: srcSetFromPath(url),
      }
    }

    const photo = pickCover(album, byId, firstByAlbum)

    return {
      ...album,
      coverUrl: photo ? displayUrl(photo) : null,
      coverSrcSet: photo ? srcSetFor(photo) : undefined,
    }
  })
}

/**
 * WHICH PHOTOGRAPH IS AN ALBUM'S COVER — one rule, for the admin grid and the
 * public site alike: the chosen photograph when there is one to be had, else
 * the album's first. (A custom cover is decided before this is asked.)
 */
export function pickCover<R>(
  album: { id: string; cover_photo_id: string | null },
  byId: ReadonlyMap<string, R>,
  firstByAlbum: ReadonlyMap<string, R>
): R | undefined {
  return album.cover_photo_id
    ? byId.get(album.cover_photo_id) ?? firstByAlbum.get(album.id)
    : firstByAlbum.get(album.id)
}

// ── The public site's covers ─────────────────────────────────────────────────

/** A cover photograph's row, as a public page may draw it. */
export type CoverRow = CoverPhoto & { album_id: string; asset_id: string | null; alt_text: string | null }

/** Where one album's cover comes from. */
export type CoverSource =
  | { kind: 'custom'; path: string }
  | { kind: 'member'; row: CoverRow }
  | { kind: 'none' }

const COVER_COLUMNS = 'id, album_id, storage_path, derivatives, asset_id, alt_text'

/**
 * What a gallery card is drawn from — and nothing else. Explicitly not `*`: a
 * public album may still carry a password_hash from an earlier privacy
 * setting, and whatever this selects can end up in a page's data.
 */
export const PUBLIC_ALBUM_COLUMNS = [
  'id', 'slug', 'title', 'location', 'trip_start_date', 'created_at',
  'cover_photo_id', 'cover_custom_path', 'cover_video_path', 'cover_focal_x', 'cover_focal_y',
  'cover_title_enabled', 'cover_title_text', 'cover_subtitle', 'cover_preset', 'cover_font',
  'cover_title_scale', 'cover_title_color', 'cover_overlay_type', 'cover_overlay_opacity',
  'cover_show_location', 'cover_show_date', 'cover_date_format',
] as const

/**
 * The public galleries of a site, in the order the photographer set. Scoped by
 * name: albums is readable by anyone when public, and a platform admin passes
 * every row-level check, so the filter is what keeps this to one site.
 */
export async function publicAlbumRows(tenantId: string) {
  const supabase = await createClient()
  return supabase
    .from('albums')
    .select(PUBLIC_ALBUM_COLUMNS.join(', '))
    .eq('tenant_id', tenantId)
    .eq('privacy_type', 'public')
    .order('display_order', { ascending: true })
}

/**
 * Each album's cover source, for albums the caller has ALREADY authorised (a
 * public listing, a gallery past its gate, a share link's albums). Same choice
 * as attachCovers, with two things a public page needs that the admin grid
 * did not: every photograph lookup names the site, and a chosen photograph
 * counts only if it is a member of THAT album — a cover is a gallery
 * photograph, never another album's.
 *
 * `rows` lets a page that has already loaded the album's photographs (behind
 * its own gate) answer from them instead of asking again.
 *
 * A failed photograph read is reported as `failed`, never as "no cover": the
 * albums that needed it get NO source at all (not `none`), so a caller cannot
 * mistake an outage for a gallery without photographs, and nothing about a
 * cover is looked up from a read that did not happen. A custom cover needs no
 * photograph read and keeps its source.
 */
export type CoverSourcesResult = { sources: Map<string, CoverSource>; failed: boolean }

export async function coverSources(
  tenantId: string,
  albums: ReadonlyArray<{ id: string; cover_photo_id: string | null; cover_custom_path: string | null }>,
  rows?: ReadonlyArray<CoverRow>
): Promise<CoverSourcesResult> {
  const out = new Map<string, CoverSource>()
  if (albums.length === 0) return { sources: out, failed: false }

  // `chosen`: rows a chosen cover may be found among. `ordered`: each album's
  // photographs in display order, whose first is the fallback.
  let chosenRows: CoverRow[]
  let ordered: CoverRow[]
  let failed = false
  if (rows) {
    chosenRows = ordered = [...rows]
  } else {
    const supabase = await createClient()
    const explicitIds = albums.filter((a) => !a.cover_custom_path && a.cover_photo_id).map((a) => a.cover_photo_id as string)
    // As attachCovers: only an album with no chosen photograph reads its
    // photographs to find a first one. (A chosen photograph that is gone, or
    // not this album's, leaves the album without a cover — as it did.)
    const fallbackIds = albums.filter((a) => !a.cover_custom_path && !a.cover_photo_id).map((a) => a.id)
    const none = { data: [] as CoverRow[], error: null }
    const [explicit, fallback] = await Promise.all([
      explicitIds.length
        ? supabase.from('photos').select(COVER_COLUMNS).eq('tenant_id', tenantId).in('id', explicitIds)
        : Promise.resolve(none),
      fallbackIds.length
        ? supabase
            .from('photos')
            .select(COVER_COLUMNS)
            .eq('tenant_id', tenantId)
            .in('album_id', fallbackIds)
            .order('sort_order', { ascending: true })
        : Promise.resolve(none),
    ])
    if (explicit.error || fallback.error || !Array.isArray(explicit.data) || !Array.isArray(fallback.data)) {
      // Counts only: never a message, which could quote a path or an id.
      console.error('[covers] cover photographs could not be read', { albums: albums.length })
      failed = true
      chosenRows = ordered = []
    } else {
      chosenRows = explicit.data as CoverRow[]
      ordered = fallback.data as CoverRow[]
    }
  }

  const byId = new Map<string, CoverRow>()
  for (const row of chosenRows) byId.set(row.id, row)
  const firstByAlbum = new Map<string, CoverRow>()
  for (const row of ordered) if (!firstByAlbum.has(row.album_id)) firstByAlbum.set(row.album_id, row)

  for (const album of albums) {
    if (album.cover_custom_path) {
      out.set(album.id, { kind: 'custom', path: album.cover_custom_path })
      continue
    }
    // Its photographs were not read: no source, not "no cover".
    if (failed) continue
    const chosen = album.cover_photo_id ? byId.get(album.cover_photo_id) : undefined
    const member = chosen && chosen.album_id === album.id ? chosen : firstByAlbum.get(album.id)
    out.set(album.id, member && member.album_id === album.id ? { kind: 'member', row: member } : { kind: 'none' })
  }
  return { sources: out, failed }
}

/** Counts photos per album without fetching any of them. */
export async function photoCounts(albumIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (albumIds.length === 0) return counts

  const supabase = await createClient()

  // One column only — the point is to avoid dragging storage paths and
  // derivative maps across the wire just to produce a number
  const { data } = await supabase.from('photos').select('album_id').in('album_id', albumIds)

  for (const row of (data ?? []) as { album_id: string }[]) {
    counts.set(row.album_id, (counts.get(row.album_id) ?? 0) + 1)
  }

  return counts
}
