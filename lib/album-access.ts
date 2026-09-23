import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClientOrNull } from '@/lib/supabase/admin'
import { verifyPassword } from '@/lib/password'
import { currentSiteTenantId } from '@/lib/tenant'

/**
 * Albums opened by slug on the public site — public ones, and the ones behind
 * a gate.
 *
 * ── Anon first, service role only when it has to ────────────────────────────
 *
 * A PUBLIC album is readable with the ordinary anon key: row level security
 * says so, and that policy is the point. Only an album that is unlisted,
 * password-gated or client-only needs a privileged read, because RLS
 * deliberately hides those.
 *
 * So every read here tries the anon client first and falls back. That matters
 * for three reasons, and the second one took the site down:
 *
 *   1. The common path keeps RLS as a real check instead of bypassing it.
 *   2. A missing SUPABASE_SERVICE_ROLE_KEY stops private albums working — it
 *      does not 500 the public site. The first version of this file read
 *      everything through the service role; the key was not set in Vercel, and
 *      every gallery returned a 500.
 *   3. Least privilege: the service role is reached for exactly the rows that
 *      cannot be served without it.
 *
 * What it must never do is let a gate be skipped. `password_hash` is read and
 * compared inside this file and never returned, and a gated album's
 * photographs come from a separate call the page makes only after the gate has
 * passed.
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

/** Never let the hash out of this module, whatever a page asks for. */
function withoutHash(row: Record<string, unknown>): PublicAlbum {
  const { password_hash: _hash, ...safe } = row
  void _hash
  return safe as PublicAlbum
}

/**
 * An album by slug.
 *
 * Returns client-only albums too — the caller decides what to do with them, so
 * that "hidden" and "does not exist" stay one decision in one place rather
 * than two behaviours spread across this file and the page.
 */
export async function albumBySlug(slug: string): Promise<PublicAlbum | null> {
  // A slug is unique per site, not globally. No site, no album — this used to
  // read "no tenant, no filter", which was right while there was one site and
  // is a cross-site read as soon as there are two.
  const tenantId = await currentSiteTenantId()
  if (!tenantId) return null

  // Public albums: the anon key and RLS, same as every other public page.
  const anon = await createClient()
  const { data: open } = await anon
    .from('albums')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('slug', slug)
    .maybeSingle()

  if (open) return withoutHash(open as Record<string, unknown>)

  // Nothing came back, so it is unlisted, gated — or simply not there.
  const admin = createAdminClientOrNull()
  if (!admin) return null

  const { data } = await admin
    .from('albums')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('slug', slug)
    .maybeSingle()

  if (!data) return null
  return withoutHash(data as Record<string, unknown>)
}

/**
 * An album's photographs.
 *
 * `isPublic` decides which key reads them, and the caller knows because it has
 * already loaded the album. A public album's photographs come back under RLS;
 * anything else needs the privileged read, and the page only asks once its
 * gate has passed.
 */
export async function photosForAlbum(
  albumId: string,
  orderColumn: string,
  ascending: boolean,
  isPublic: boolean
) {
  const supabase = isPublic ? await createClient() : createAdminClientOrNull()
  if (!supabase) return []

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
 * passed to a caller. A gated album is invisible to the anon key by design, so
 * this is one of the places that genuinely needs the service role.
 */
export async function verifyAlbumPassword(
  slug: string,
  password: string
): Promise<string | null> {
  if (!password) return null

  const supabase = createAdminClientOrNull()
  if (!supabase) return null

  // The service-role key ignores row-level security, so the scoping here IS
  // the security: a password typed on one site must never open another's.
  const tenantId = await currentSiteTenantId()
  if (!tenantId) return null

  const { data: album } = await supabase
    .from('albums')
    .select('id, password_hash')
    .eq('tenant_id', tenantId)
    .eq('slug', slug)
    .maybeSingle()

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
  // The id comes from the address bar, so it is scoped like a slug would be.
  const tenantId = await currentSiteTenantId()
  if (!tenantId) return null

  // Only ever true for a public album, which the anon key can read.
  const supabase = await createClient()

  const { data } = await supabase
    .from('albums')
    .select('id, title, slug, privacy_type, allow_downloads')
    .eq('tenant_id', tenantId)
    .eq('id', albumId)
    .maybeSingle()

  if (!data) return null
  // A private album is never downloadable without a token, whatever its
  // allow_downloads flag says.
  if (data.privacy_type !== 'public') return null
  if (data.allow_downloads !== true) return null

  return data
}

/** Photographs for a public album's zip. Reached only via the check above. */
export async function photosForZip(albumId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('photos')
    .select('storage_path, original_path, caption')
    .eq('album_id', albumId)
    .order('sort_order')

  return data ?? []
}
