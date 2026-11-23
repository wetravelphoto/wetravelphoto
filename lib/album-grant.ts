import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE ALBUM ACCESS GRANT — what a password gallery's cookie has to prove
 * ═════════════════════════════════════════════════════════════════════
 *
 * Before P5's F1 correction the cookie said `granted`, and both readers took
 * it at its word: anybody could type `album_access_<id>=granted` into a
 * browser and open any password gallery whose id they knew. The password was
 * checked once, when the cookie was SET, and never again — and the cookie
 * itself proved nothing.
 *
 * A grant is now a message authenticated with HMAC-SHA256 under a dedicated
 * server-only key (`ALBUM_ACCESS_SECRET`), binding
 *
 *   the site        the tenant the Host header resolved to
 *   the album       the row's own id, never one the browser named
 *   the revision    albums.access_revision — a UUID the DATABASE replaces
 *                   whenever the album's privacy, password, site or id
 *                   changes (db/migrations/2026-10-08_album_access_revision.sql)
 *   the expiry      at most thirty days after issue, enforced HERE
 *   a nonce         sixteen random bytes
 *
 * Nothing derived from the password or its hash is in it. The revision is not
 * a secret (anyone who can read a public album's row can read it); forging a
 * grant needs the key.
 *
 * ── Fail closed, everywhere ────────────────────────────────────────────────
 *
 * A missing or malformed key, a malformed grant, a lookup that errored, threw
 * or answered something odd, an album no longer in password mode or without a
 * well-formed password hash, a revision that moved: each is `false`. There is
 * no fallback to the old literal cookie, no cross-request cache of an answer,
 * and no sliding renewal — a grant is checked against the database's CURRENT
 * row on every request and dies at its own expiry.
 *
 * Rotating or removing the key invalidates every grant at once; that is the
 * response to a restored database (a restore restores old revisions too).
 *
 * Never log a grant, the key or a hash. Never hand any of them to a browser
 * except the grant itself, in an HttpOnly cookie.
 */

export const GRANT_VERSION = 'v1'
/** Domain separation: this key signs album grants and nothing else. */
export const GRANT_DOMAIN = 'lensgrid.album-access.v1'
/**
 * The absolute lifetime: thirty days from issue, never renewed. Strict, with
 * no clock-skew allowance: a grant is accepted only while
 * `now < expiry <= now + 30 days`, `now` being the CHECKING server's clock —
 * so whatever a grant says, it is never honoured more than thirty days ahead
 * of the moment it is checked.
 */
export const GRANT_LIFETIME_SECONDS = 30 * 24 * 60 * 60
/** No legitimate grant is longer than this; anything longer is refused before it is parsed. */
export const GRANT_MAX_LENGTH = 128
/** The longest password the issuer will hash-compare (scrypt is deliberately slow). */
export const PASSWORD_MAX_LENGTH = 1024
export const KEY_ENV = 'ALBUM_ACCESS_SECRET'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Ten decimal digits, no leading zero: 2001-09-09 … 2286-11-20 in Unix seconds. */
const EXPIRY = /^[1-9][0-9]{9}$/
const B64URL = /^[A-Za-z0-9_-]+$/
/** What lib/password.ts hashPassword() writes: 16-byte salt and 64-byte scrypt, hex. */
const PASSWORD_HASH = /^[0-9a-f]{32}:[0-9a-f]{128}$/

const NONCE_BYTES = 16
const MAC_BYTES = 32
const KEY_BYTES = 32

/** Base64url without padding, and only the ONE spelling that decodes to these bytes. */
function canonicalB64url(s: string, bytes: number): Buffer | null {
  if (s.length !== Math.ceil((bytes * 4) / 3) || !B64URL.test(s)) return null
  const b = Buffer.from(s, 'base64url')
  if (b.length !== bytes || b.toString('base64url') !== s) return null
  return b
}

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
export const isWellFormedPasswordHash = (v: unknown): v is string => typeof v === 'string' && PASSWORD_HASH.test(v)

declare const keyBrand: unique symbol
/** A parsed signing key. Opaque: nothing outside this file reads its bytes. */
export type GrantKey = { readonly [keyBrand]: true }
const keyBytes = new WeakMap<GrantKey, Buffer>()

/**
 * The key, from its one accepted spelling: 43 characters of canonical,
 * unpadded base64url encoding exactly 32 bytes. A key of one repeated byte is
 * a placeholder, not a key, and is refused too.
 */
export function parseGrantKey(raw: unknown): GrantKey | null {
  if (typeof raw !== 'string') return null
  const b = canonicalB64url(raw, KEY_BYTES)
  if (!b || b.every((x) => x === b[0])) return null
  const key = Object.freeze({}) as GrantKey
  keyBytes.set(key, b)
  return key
}

/** The configured key, read at call time. Null — and so every grant refused — when absent or malformed. */
export function grantKeyFromEnv(): GrantKey | null {
  return parseGrantKey(process.env[KEY_ENV])
}

export type GrantSubject = { tenantId: string; albumId: string; revision: string }

const validSubject = (s: GrantSubject) => isUuid(s.tenantId) && isUuid(s.albumId) && isUuid(s.revision)

/** Every field length-prefixed, so no two different messages share a byte string. */
function macOf(key: GrantKey, s: GrantSubject, expiry: string, nonce: string): Buffer {
  const k = keyBytes.get(key)
  if (!k) throw new Error('album grant: not a parsed key')
  const h = createHmac('sha256', k)
  for (const field of [GRANT_DOMAIN, GRANT_VERSION, s.tenantId, s.albumId, s.revision, expiry, nonce]) {
    const bytes = Buffer.from(field, 'utf8')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(bytes.length)
    h.update(len)
    h.update(bytes)
  }
  return h.digest()
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/**
 * A new grant for exactly this subject, valid for the full lifetime from
 * `now`. Null if the subject is not three UUIDs or `now` is not a plausible
 * time — a grant is never minted from doubtful input.
 */
export function issueGrant(
  key: GrantKey,
  subject: GrantSubject,
  now: number = nowSeconds(),
  nonce: Buffer = randomBytes(NONCE_BYTES)
): { value: string; maxAge: number } | null {
  if (!keyBytes.has(key) || !validSubject(subject)) return null
  if (!Number.isSafeInteger(now) || nonce.length !== NONCE_BYTES) return null
  const expiry = String(now + GRANT_LIFETIME_SECONDS)
  if (!EXPIRY.test(expiry)) return null
  const n = nonce.toString('base64url')
  const mac = macOf(key, subject, expiry, n).toString('base64url')
  return { value: `${GRANT_VERSION}.${expiry}.${n}.${mac}`, maxAge: GRANT_LIFETIME_SECONDS }
}

/**
 * Whether `value` is a grant this key issued for exactly this subject, and is
 * inside its lifetime at `now`. Strict: one spelling, bounded length, fixed
 * version, constant-time comparison of the MAC, server-side expiry — and an
 * expiry further out than a grant minted at this very second would carry
 * (`now + 30 days`) is refused as well, with no skew allowance, so no grant is
 * honoured beyond thirty days whatever it says.
 */
export function checkGrant(key: GrantKey | null, value: unknown, subject: GrantSubject, now: number = nowSeconds()): boolean {
  if (!key || !keyBytes.has(key) || !validSubject(subject) || !Number.isSafeInteger(now)) return false
  if (typeof value !== 'string' || value.length > GRANT_MAX_LENGTH) return false
  const parts = value.split('.')
  if (parts.length !== 4) return false
  const [version, expiry, nonce, mac] = parts as [string, string, string, string]
  if (version !== GRANT_VERSION || !EXPIRY.test(expiry)) return false
  if (!canonicalB64url(nonce, NONCE_BYTES)) return false
  const given = canonicalB64url(mac, MAC_BYTES)
  if (!given) return false
  const expected = macOf(key, subject, expiry, nonce)
  if (!timingSafeEqual(expected, given)) return false
  const exp = Number(expiry)
  if (exp <= now) return false
  if (exp > now + GRANT_LIFETIME_SECONDS) return false
  return true
}

/** The cookie a grant travels in. The album id comes from the row, never the browser. */
export const grantCookieName = (albumId: string) => `album_access_${albumId}`

// ════════════════════════════════════════════════════════════════════════════
// The album's CURRENT access policy, and the two decisions made from it
// ════════════════════════════════════════════════════════════════════════════

const ACCESS_COLUMNS = 'id, tenant_id, privacy_type, password_hash, access_revision'

/** One album's access row. The hash stays inside this file. */
type AccessState = { albumId: string; tenantId: string; privacy: string; revision: string; hash: string | null }

/**
 * The album's access policy as the database holds it NOW, through the given
 * (service-role) client, on this site only — or null on any doubt: an error
 * (with or without data), a throw, a row of the wrong site, a revision that is
 * not a UUID (the column missing, the migration not applied).
 */
async function readAccessState(
  db: SupabaseClient,
  tenantId: string,
  by: { id: string } | { slug: string }
): Promise<AccessState | null> {
  if (!isUuid(tenantId)) return null
  try {
    const q = db.from('albums').select(ACCESS_COLUMNS).eq('tenant_id', tenantId)
    const { data, error } = await ('id' in by ? q.eq('id', by.id) : q.eq('slug', by.slug)).maybeSingle()
    if (error || !data) return null
    const row = data as Record<string, unknown>
    if (!isUuid(row.id) || row.tenant_id !== tenantId || !isUuid(row.access_revision)) return null
    if ('id' in by && row.id !== by.id) return null
    if (typeof row.privacy_type !== 'string') return null
    const hash = row.password_hash
    if (hash !== null && typeof hash !== 'string') return null
    return { albumId: row.id, tenantId, privacy: row.privacy_type, revision: row.access_revision, hash }
  } catch {
    return null
  }
}

/**
 * THE SHARED VERIFIER — the one question both the gallery page
 * (lib/album-access.ts openAlbum) and the analytics route (app/api/view) ask:
 * does this cookie value admit this visitor to this password album, now?
 *
 * Only an album in password mode with a well-formed password configured can
 * be admitted to, and only by a grant bound to its current revision.
 * Resolves to exactly `true` or `false`; never throws.
 */
export async function albumGrantAdmits(
  db: SupabaseClient | null,
  tenantId: string | null,
  albumId: string,
  cookieValue: unknown,
  now: number = nowSeconds()
): Promise<boolean> {
  try {
    const key = grantKeyFromEnv()
    if (!key || !db || !tenantId || !isUuid(albumId) || typeof cookieValue !== 'string') return false
    const state = await readAccessState(db, tenantId, { id: albumId })
    if (!state || state.privacy !== 'password' || !isWellFormedPasswordHash(state.hash)) return false
    return checkGrant(key, cookieValue, { tenantId, albumId: state.albumId, revision: state.revision }, now)
  } catch {
    return false
  }
}

/**
 * THE ISSUER. One read — the exact snapshot the password is verified against
 * is the snapshot the grant is bound to. If the policy changes after that
 * read, the database has already given the album a new revision and this
 * grant fails at its first check; it is never re-bound to a newer row.
 *
 * Null for every failure, indistinguishably: no key, no site, no album, not
 * password mode, no or malformed hash, wrong password, malformed input.
 */
export async function issueAlbumGrant(
  db: SupabaseClient | null,
  tenantId: string | null,
  slug: unknown,
  password: unknown,
  verify: (password: string, hash: string) => boolean,
  now: number = nowSeconds()
): Promise<{ albumId: string; value: string; maxAge: number } | null> {
  try {
    if (typeof slug !== 'string' || slug.length === 0 || slug.length > 200) return null
    if (typeof password !== 'string' || password.length === 0 || password.length > PASSWORD_MAX_LENGTH) return null
    const key = grantKeyFromEnv()
    if (!key) {
      // A configuration fault, said without the value.
      console.error('[album-grant] ALBUM_ACCESS_SECRET is missing or malformed; password galleries stay locked')
      return null
    }
    if (!db || !tenantId) return null
    const state = await readAccessState(db, tenantId, { slug })
    if (!state || state.privacy !== 'password' || !isWellFormedPasswordHash(state.hash)) return null
    let good = false
    try {
      good = verify(password, state.hash) === true
    } catch {
      good = false
    }
    if (!good) return null
    const grant = issueGrant(key, { tenantId, albumId: state.albumId, revision: state.revision }, now)
    return grant ? { albumId: state.albumId, ...grant } : null
  } catch {
    return null
  }
}
