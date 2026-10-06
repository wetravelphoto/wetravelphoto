import { isSamplePhoto } from '@/lib/images'

/**
 * WHICH UPLOAD A STORED PATH BELONGS TO — EVERY ERA
 * ═════════════════════════════════════════════════
 *
 * P4 (claude/photo-migration-plan.md). `lib/photos/key-base.ts` knows the four
 * shapes new uploads are minted in; this knows every shape any upload route
 * has ever minted, because the backfill has to give each of those files its
 * asset. A CLOSED grammar: what it does not recognise is refused with a
 * reason, never guessed at.
 *
 *   photos/<album>/<upload>             gallery        before the site prefix
 *   covers/<album>/<upload>             custom cover   before the site prefix
 *   journal/<upload>                    journal image  before the site prefix
 *   t/<site>/photos/<album>/<upload>    and t/<site>/covers/…, t/<site>/journal/…,
 *   t/<site>/site-images/<upload>       since the prefix (site-images never had another)
 *
 * every id a lower-case uuid. A path is a file of that upload when it is:
 *
 *   <base>                                        the base itself (idempotent)
 *   <base>/original.<jpg|png|webp|tif|avif>       folder eras
 *   <base>/<400|800|1600|2400>.webp               folder eras
 *   <base>.jpg                                    the FLAT era — unprefixed
 *                                                 photos/covers/journal only:
 *                                                 one resized JPEG, nothing else
 *
 * `photo_backfill_key_base()` in db/migrations/2026-10-05_photo_backfill.sql
 * is the SQL twin, and .mk/backfill.ts holds the two to the same answer on
 * every case it can think of.
 *
 * Grammar is not ownership. `keyBaseFor()` adds the site's rules on top:
 * a prefixed key must carry THIS site's id; an unprefixed gallery or cover key
 * must name an album of this site; an unprefixed journal key — which names no
 * album and so says nothing about whose it is — needs an operator-reviewed
 * provenance entry for exactly this site and key. A saved reference alone is
 * never proof: a document can hold any string.
 */

export type LegacyRoute = 'photos' | 'covers' | 'journal' | 'site-images'

export type ParsedKey = {
  ok: true
  keyBase: string
  route: LegacyRoute
  /** The site id in a `t/<site>/` prefix; null for an unprefixed key. */
  prefixTenant: string | null
  albumId: string | null
  uploadId: string
  /** What the path itself is, relative to its base. */
  shape: 'base' | 'flat' | 'original' | 'size'
}

export type KeyRefusal = {
  ok: false
  reason:
    | 'empty'
    | 'sample'
    | 'url'
    | 'encoded'
    | 'traversal'
    | 'bad_uuid'
    | 'unknown_shape'
    | 'foreign_prefix'
    | 'album_not_owned'
    | 'needs_provenance'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A uuid in any case — to say "bad uuid" rather than "unknown shape" for an upper-case one. */
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEAF = /^(original\.(jpg|png|webp|tif|avif)|(400|800|1600|2400)\.webp)$/

const refuse = (reason: KeyRefusal['reason']): KeyRefusal => ({ ok: false, reason })

/** The grammar alone. Pure; no site involved. */
export function parseLegacyKey(path: unknown): ParsedKey | KeyRefusal {
  if (typeof path !== 'string' || path === '') return refuse('empty')
  if (isSamplePhoto(path)) return refuse('sample')
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return refuse('url')
  // Percent-encoding, backslashes, whitespace, control characters, query
  // strings and fragments: each can make one path mean two files.
  if (/[%\\?#\s\u0000-\u001f\u007f]/.test(path) || /[^\x21-\x7e]/.test(path)) return refuse('encoded')
  if (path.startsWith('/') || path.endsWith('/') || path.includes('//') || path.split('/').some((s) => s === '.' || s === '..')) {
    return refuse('traversal')
  }

  let segs = path.split('/')
  let prefixTenant: string | null = null
  if (segs[0] === 't') {
    if (segs.length < 3) return refuse('unknown_shape')
    if (!UUID.test(segs[1]!)) return refuse(UUIDISH.test(segs[1]!) ? 'bad_uuid' : 'unknown_shape')
    prefixTenant = segs[1]!
    segs = segs.slice(2)
  }

  const route = segs[0] as LegacyRoute
  let albumId: string | null = null
  let rest: string[]
  switch (route) {
    case 'photos':
    case 'covers':
      if (segs.length < 3) return refuse('unknown_shape')
      if (!UUID.test(segs[1]!)) return refuse('bad_uuid')
      albumId = segs[1]!
      rest = segs.slice(2)
      break
    case 'journal':
      rest = segs.slice(1)
      break
    case 'site-images':
      if (prefixTenant === null) return refuse('unknown_shape')
      rest = segs.slice(1)
      break
    default:
      return refuse('unknown_shape')
  }

  const head = segs.slice(0, segs.length - rest.length)
  const baseOf = (upload: string) => [...(prefixTenant ? ['t', prefixTenant] : []), ...head, upload].join('/')

  if (rest.length === 1) {
    const last = rest[0]!
    if (UUID.test(last)) {
      return { ok: true, keyBase: baseOf(last), route, prefixTenant, albumId, uploadId: last, shape: 'base' }
    }
    if (last.endsWith('.jpg') && UUID.test(last.slice(0, -4))) {
      // The flat era never had a prefix, and never stored site-images.
      if (prefixTenant !== null) return refuse('unknown_shape')
      const upload = last.slice(0, -4)
      return { ok: true, keyBase: baseOf(upload), route, prefixTenant, albumId, uploadId: upload, shape: 'flat' }
    }
    return refuse(UUIDISH.test(last) || UUIDISH.test(last.replace(/\.jpg$/i, '')) ? 'bad_uuid' : 'unknown_shape')
  }
  if (rest.length === 2) {
    const [upload, leaf] = rest as [string, string]
    if (!UUID.test(upload)) return refuse(UUIDISH.test(upload) ? 'bad_uuid' : 'unknown_shape')
    if (!LEAF.test(leaf)) return refuse('unknown_shape')
    return {
      ok: true,
      keyBase: baseOf(upload),
      route,
      prefixTenant,
      albumId,
      uploadId: upload,
      shape: leaf.startsWith('original.') ? 'original' : 'size',
    }
  }
  return refuse('unknown_shape')
}

/** What a site is allowed to claim, beyond the grammar. */
export type OwnershipContext = {
  /** This site's album ids. */
  albums: ReadonlySet<string>
  /** Unprefixed journal key bases an operator has reviewed for THIS site. */
  provenance: ReadonlySet<string>
}

/**
 * The key base `path` belongs to, for this site — or why it cannot be one of
 * this site's files. Idempotent: `keyBaseFor(keyBaseFor(p).keyBase)` is the
 * same base.
 */
export function keyBaseFor(path: unknown, tenantId: string, ctx: OwnershipContext): ParsedKey | KeyRefusal {
  const parsed = parseLegacyKey(path)
  if (!parsed.ok) return parsed
  if (parsed.prefixTenant !== null) {
    return parsed.prefixTenant === tenantId ? parsed : refuse('foreign_prefix')
  }
  if (parsed.route === 'photos' || parsed.route === 'covers') {
    return ctx.albums.has(parsed.albumId!) ? parsed : refuse('album_not_owned')
  }
  // Unprefixed journal: the only shape that names nothing it could be owned through.
  return ctx.provenance.has(parsed.keyBase) ? parsed : refuse('needs_provenance')
}

/** The flat file of a base — meaningful only for an unprefixed photos/covers/journal base. */
export const flatFileOf = (keyBase: string) => `${keyBase}.jpg`

export const ORIGINAL_EXTENSIONS = ['jpg', 'png', 'webp', 'tif', 'avif'] as const
export const LADDER = ['400', '800', '1600', '2400'] as const
