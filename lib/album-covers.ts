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

    const photo = album.cover_photo_id
      ? byId.get(album.cover_photo_id) ?? firstByAlbum.get(album.id)
      : firstByAlbum.get(album.id)

    return {
      ...album,
      coverUrl: photo ? displayUrl(photo) : null,
      coverSrcSet: photo ? srcSetFor(photo) : undefined,
    }
  })
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
