import { EMAIL_PATTERN } from '@/lib/email'

/**
 * SHARING AN ALBUM WITH A CLIENT — the logic behind the Sharing tab
 * ═════════════════════════════════════════════════════════════════
 *
 * `createContact` + `shareAlbumWithClient`, composed: pick an existing contact
 * or create one (name + email) and share the album with them, in one step.
 * The server actions in app/actions/clients.ts call these after
 * requireEditor(); the database client is passed in so the suites can drive
 * them with a fake (.mk/client-gallery-v2.ts).
 *
 * Tenant scoping is restated here rather than left to row-level security: a
 * platform admin passes every tenant check, so an unqualified query that is
 * safe for an ordinary photographer is not safe at all. The album AND the
 * client are each read with the editor's site named; a client id from another
 * site is "not found", never shared.
 */

type Result<T> = { data: T; error: { code?: string; message?: string } | null }

export type ShareDb = {
  from: (table: string) => ShareQuery
}
type ShareQuery = {
  select: (cols: string) => ShareQuery
  insert: (row: Record<string, unknown>) => ShareQuery
  delete: () => ShareQuery
  eq: (col: string, v: unknown) => ShareQuery
  maybeSingle: () => PromiseLike<Result<unknown>>
  single: () => PromiseLike<Result<unknown>>
  then: PromiseLike<Result<unknown>>['then']
}

export type SharedClient = { id: string; name: string; email: string; token: string }

export type ShareResult = { ok: true; client: SharedClient } | { ok: false; error: string }

const CLIENT_COLUMNS = 'id, name, email, access_token'

function toClient(row: unknown): SharedClient | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  return { id: r.id, name: String(r.name ?? ''), email: String(r.email ?? ''), token: String(r.access_token ?? '') }
}

/** Trims and bounds a contact's name; lower-cases and checks the address. */
export function cleanContact(name: unknown, email: unknown): { name: string; email: string } | { error: string } {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  const e = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!n) return { error: 'Add the client’s name.' }
  if (!EMAIL_PATTERN.test(e) || e.length > 254) return { error: 'That email doesn’t look right.' }
  return { name: n, email: e }
}

/** Inserts a contact on this site. The one insert both the clients page and the Sharing tab use. */
export async function insertContact(db: ShareDb, tenantId: string, name: string, email: string): Promise<SharedClient | null> {
  const { data, error } = await db.from('clients').insert({ name, email, tenant_id: tenantId }).select(CLIENT_COLUMNS).single()
  if (error) return null
  return toClient(data)
}

/** Links an album to a client. A duplicate share is already the answer wanted. */
export async function linkAlbumClient(db: ShareDb, albumId: string, clientId: string): Promise<boolean> {
  const { error } = await db.from('album_clients').insert({ album_id: albumId, client_id: clientId })
  return !error || error.code === '23505'
}

async function ownAlbum(db: ShareDb, tenantId: string, albumId: string): Promise<boolean> {
  if (typeof albumId !== 'string' || !albumId) return false
  const { data, error } = await db.from('albums').select('id').eq('tenant_id', tenantId).eq('id', albumId).maybeSingle()
  return !error && !!data
}

async function ownClient(db: ShareDb, tenantId: string, clientId: string): Promise<SharedClient | null> {
  if (typeof clientId !== 'string' || !clientId) return null
  const { data, error } = await db.from('clients').select(CLIENT_COLUMNS).eq('tenant_id', tenantId).eq('id', clientId).maybeSingle()
  return error ? null : toClient(data)
}

/**
 * Shares an album with an existing contact (`clientId`) or with a new one
 * (`name` + `email`). A new address that already belongs to one of this
 * site's contacts reuses that contact rather than making a twin.
 */
export async function addClientToAlbumWith(
  db: ShareDb,
  tenantId: string,
  albumId: string,
  input: { clientId?: unknown; name?: unknown; email?: unknown }
): Promise<ShareResult> {
  if (!(await ownAlbum(db, tenantId, albumId))) return { ok: false, error: 'That gallery could not be found.' }

  let client: SharedClient | null
  if (typeof input.clientId === 'string' && input.clientId) {
    client = await ownClient(db, tenantId, input.clientId)
    if (!client) return { ok: false, error: 'That contact could not be found.' }
  } else {
    const clean = cleanContact(input.name, input.email)
    if ('error' in clean) return { ok: false, error: clean.error }
    const existing = await db.from('clients').select(CLIENT_COLUMNS).eq('tenant_id', tenantId).eq('email', clean.email).maybeSingle()
    if (existing.error) return { ok: false, error: 'The contact could not be saved. Try again.' }
    client = toClient(existing.data) ?? (await insertContact(db, tenantId, clean.name, clean.email))
    if (!client) return { ok: false, error: 'The contact could not be saved. Try again.' }
  }

  if (!(await linkAlbumClient(db, albumId, client.id))) return { ok: false, error: 'The gallery could not be shared. Try again.' }
  return { ok: true, client }
}

/** Stops sharing an album with a client — both must be this site's. */
export async function removeClientFromAlbumWith(
  db: ShareDb,
  tenantId: string,
  albumId: string,
  clientId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!(await ownAlbum(db, tenantId, albumId)) || !(await ownClient(db, tenantId, clientId))) {
    return { ok: false, error: 'That share could not be found.' }
  }
  const { error } = await db.from('album_clients').delete().eq('album_id', albumId).eq('client_id', clientId)
  return error ? { ok: false, error: 'It could not be removed. Try again.' } : { ok: true }
}
