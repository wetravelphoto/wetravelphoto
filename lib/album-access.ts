import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { verifyPassword } from '@/lib/password'
import { currentSiteTenantId, scopeToSite } from '@/lib/tenant'

/**
 * Albums opened by slug on the public site — public ones, and the
 * password-gated ones.
 *
 * A password-protected album cannot be read with the anon key, and should not
 * be: its row carries `password_hash`, and the old "shared albums are
 * readable" policy handed that to anyone who asked. So the read happens here,
 * with the service-role key, and this module decides what a visitor is allowed
 * to see.
 *
 * The gate itself stays in the page, where the cookie is — this only refuses
 * to hand out anything that would let someone skip it: `password_hash` is
 * never selected into a page, and the photographs of a gated album come from a
 * separate call the page makes only after the gate has passed.
 */

/**
 * The album row as the database returns it, minus password_hash.
 *
 * Not spelled out column by column on purpose: albums has forty-odd, and
 * db/README.md records what a hand-maintained duplicate of a table's shape
 * costs — it drifts, silently, and the compiler says nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PublicAlbum = Record<string, any>

const PHOTO_COLUMNS =
  'id, storage_path, derivatives, caption, alt_text, width, height, is_for_sale, taken_at, sort_order'

/**
 * An album by slug, with its password hash removed before it can reach a page.
 *
 * Returns client-only albums too — the caller decides what to do with them, so
 * that "hidden" and "does not exist" stay one decision in one place rather
 * than two behaviours spread across this file and the page.
 */
export async function albumBySlug(slug: string): Promise<PublicAlbum | null> {
  const supabase = createAdminClient()
  const tenantId = await currentSiteTenantId()

  const { data } = await scopeToSite(
    supabase.from('albums').select('*').eq('slug', slug),
    tenantId
  ).maybeSingle()

  if (!data) return null

  // Never let the hash out of this module, whatever a page asks for.
  const { password_hash: _hash, ...safe } = data as Record<string, unknown>
  void _hash

  return safe as PublicAlbum
}

export async function photosForAlbum(
  albumId: string,
  orderColumn: string,
  ascending: boolean
) {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .eq('album_id', albumId)
    .order(orderColumn, { ascending, nullsFirst: false })

  return data ?? []
}

/**
 * Checks a password against an album. Returns the album id on success and null
 * on failure — including when the album has no password, so a wrong slug and a
 * wrong password are indistinguishable from outside.
 *
 * The hash is read here and compared here. It is never returned, logged, or
 * passed to a caller.
 */
export async function verifyAlbumPassword(
  slug: string,
  password: string
): Promise<string | null> {
  if (!password) return null

  const supabase = createAdminClient()
  const tenantId = await currentSiteTenantId()

  const { data: album } = await scopeToSite(
    supabase.from('albums').select('id, password_hash').eq('slug', slug),
    tenantId
  ).maybeSingle()

  if (!album?.password_hash) return null

  try {
    return verifyPassword(password, album.password_hash as string) ? (album.id as string) : null
  } catch {
    // A malformed stored hash is a failed login, not a 500.
    return null
  }
}

/** Whether a zip of this album is allowed without a share token. */
export async function albumAllowsPublicDownload(albumId: string) {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('albums')
    .select('id, title, slug, privacy_type, allow_downloads')
    .eq('id', albumId)
    .maybeSingle()

  if (!data) return null
  // A private album is never downloadable without a token, whatever its
  // allow_downloads flag says.
  if (data.privacy_type !== 'public') return null
  if (data.allow_downloads !== true) return null

  return data
}

export async function photosForZip(albumId: string) {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('photos')
    .select('storage_path, original_path, caption')
    .eq('album_id', albumId)
    .order('sort_order')

  return data ?? []
}
