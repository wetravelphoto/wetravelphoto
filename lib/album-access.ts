import 'server-only'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClientOrNull } from '@/lib/supabase/admin'
import { verifyPassword } from '@/lib/password'
import { currentSiteTenantId } from '@/lib/tenant'
import { albumGrantAdmits, grantCookieName, issueAlbumGrant } from '@/lib/album-grant'

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

// album_id and asset_id since P5: the page resolves each photograph's canonical
// file and the album's cover from these rows, server-side. Neither reaches the
// browser — the page hands its client components a trimmed view.
const PHOTO_COLUMNS =
  'id, album_id, asset_id, storage_path, derivatives, caption, alt_text, width, height, is_for_sale, taken_at, sort_order'

/**
 * Never let the hash out of this module, whatever a page asks for. The access
 * revision is not a secret (it is MAC input, not key — lib/album-grant.ts),
 * but no page needs it either, so it stays here too.
 */
function withoutHash(row: Record<string, unknown>): PublicAlbum {
  const { password_hash: _hash, access_revision: _revision, ...safe } = row
  void _hash
  void _revision
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

  // P5 F1: this row decides whether a gallery opens, so a read that failed is
  // "no album" — never the row an errored reply happened to carry, and never
  // an exception that escapes to a caller with its own idea of a fallback.
  // Only a clean "no row" from the anon key moves on to the privileged read.
  try {
    // Public albums: the anon key and RLS, same as every other public page.
    const anon = await createClient()
    const { data: open, error: openError } = await anon
      .from('albums')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('slug', slug)
      .maybeSingle()

    if (openError) return null
    if (open) return ownRow(open, tenantId)

    // Nothing came back, so it is unlisted, gated — or simply not there.
    const admin = createAdminClientOrNull()
    if (!admin) return null

    const { data, error } = await admin
      .from('albums')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('slug', slug)
      .maybeSingle()

    if (error || !data) return null
    return ownRow(data, tenantId)
  } catch {
    return null
  }
}

/** A row only if it is an object on this site; anything else is no album. */
function ownRow(row: unknown, tenantId: string): PublicAlbum | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  if ((row as Record<string, unknown>).tenant_id !== tenantId) return null
  return withoutHash(row as Record<string, unknown>)
}

/** The privacy modes the database allows (albums_privacy_type_check). Anything else opens nothing. */
const OPEN_BY_ADDRESS = new Set(['public', 'unlisted'])

/**
 * THE GATE OF /trips/<slug>, exactly as the page has always applied it:
 *
 *   no such album on this site → missing
 *   client-only                → missing (only a share link opens one)
 *   password, no valid grant   → locked (the album row, never its photographs)
 *   otherwise                  → open — public, unlisted by its address, or a
 *                                password album this browser holds a grant for
 *
 * "A valid grant" is lib/album-grant.ts albumGrantAdmits(): a signed grant
 * bound to this site, this album and the album's CURRENT access revision,
 * inside its thirty days, checked against a fresh read of the row. The old
 * literal `granted` cookie proves nothing and opens nothing (P5 F1).
 *
 * Moved here from the page in P5 so the page and the photograph resolver ask
 * the SAME question: nothing about an album's photographs is read until this
 * has answered `open`.
 */
export type AlbumGate =
  | { status: 'missing' }
  | { status: 'locked'; album: PublicAlbum }
  | { status: 'open'; album: PublicAlbum }

export async function openAlbum(slug: string): Promise<AlbumGate> {
  const album = await albumBySlug(slug)
  if (!album) return { status: 'missing' }
  if (album.privacy_type === 'client_only') return { status: 'missing' }

  if (album.privacy_type === 'password') {
    const cookieStore = await cookies()
    const admitted = await albumGrantAdmits(
      createAdminClientOrNull(),
      await currentSiteTenantId(),
      album.id as string,
      cookieStore.get(grantCookieName(album.id as string))?.value
    )
    if (admitted !== true) return { status: 'locked', album }
    return { status: 'open', album }
  }
  // Open by address only in a mode that is open by address. A privacy value
  // the database should never hold is not a reason to show the photographs.
  if (typeof album.privacy_type === 'string' && OPEN_BY_ADDRESS.has(album.privacy_type)) return { status: 'open', album }
  return { status: 'missing' }
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

  // The album came from this site's own row, but the privileged read ignores
  // row-level security and a platform admin passes it anyway — so the site is
  // named here too, and a photograph filed under another site's id is never
  // returned with this album's.
  const tenantId = await currentSiteTenantId()
  if (!tenantId) return []

  const { data } = await supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('album_id', albumId)
    .order(orderColumn, { ascending, nullsFirst: false })

  return data ?? []
}

/**
 * Checks a password against an album and, only if it is right, mints the
 * grant for it (lib/album-grant.ts issueAlbumGrant). Null on every failure —
 * a wrong slug, a wrong password, an album not in password mode, a missing
 * key — so they are indistinguishable from outside.
 *
 * The hash is read, compared and bound in ONE snapshot inside the issuer; it
 * is never returned, logged, or passed to a caller. A gated album is
 * invisible to the anon key by design, so this genuinely needs the service
 * role — and the site, from the Host header, is the scoping: a password typed
 * on one site must never open another's.
 */
export async function issueAlbumAccessGrant(slug: unknown, password: unknown) {
  return issueAlbumGrant(createAdminClientOrNull(), await currentSiteTenantId(), slug, password, verifyPassword)
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
