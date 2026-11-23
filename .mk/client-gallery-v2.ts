import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * CLIENT GALLERY v2 — the application logic, no database, no network.
 *
 *   node node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs .mk/client-gallery-v2.ts
 *
 * Covers what .ai-handoff/client-gallery-v2-prompt.md asks to be tested:
 *   A. the favorites zip is scoped by the token's handle (client, album, site)
 *   B. the inline create-and-share action stays on the editor's site
 *   C. invitation resend / change-address, platform-admin logic and ordering
 *   D. the email composer's fallback when there is no RESEND_API_KEY
 * plus the cover registry, the cover model and the layout arithmetic.
 *
 * The fakes FILTER in-memory tables by the filters the code actually sends, so
 * a dropped `tenant_id` or `client_id` filter shows up as a leaked row, not as
 * a passing count — and each refusal is attributed to the layer that made it
 * (calls are logged). The modules are bundled by esbuild with `server-only`,
 * next/* and the service-role client stubbed, as the other .mk suites do.
 */

const ROOT = resolve(__dirname, '..')
const req = createRequire(join(ROOT, 'package.json'))
let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') => (good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`))
const is = (n: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  ok(n, g === w, g === w ? '' : `got ${g}\n    wanted ${w}`)
}

// ── a fake PostgREST client over in-memory tables ───────────────────────────

type Row = Record<string, unknown>
type Call = { table: string; op: 'select' | 'insert' | 'delete'; filters: Array<[string, string, unknown]>; row?: Row }
type FakeOpts = {
  fail?: Set<string> // tables whose reads answer with an error
  insertError?: Record<string, { code?: string; message?: string }>
  deleteError?: Record<string, { message?: string }>
}

function fakeDb(tables: Record<string, Row[]>, opts: FakeOpts = {}) {
  const calls: Call[] = []
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] }
    calls.push(call)
    let lim = Infinity
    let inserted: Row | null = null
    const matches = (r: Row) =>
      call.filters.every(([kind, col, v]) => (kind === 'eq' ? r[col] === v : (v as unknown[]).includes(r[col])))
    const run = (): { data: unknown; error: unknown } => {
      if (call.op === 'insert') {
        const e = opts.insertError?.[table]
        if (e) return { data: null, error: e }
        return { data: inserted, error: null }
      }
      if (call.op === 'delete') {
        const e = opts.deleteError?.[table]
        if (e) return { data: null, error: e }
        tables[table] = (tables[table] ?? []).filter((r) => !matches(r))
        return { data: null, error: null }
      }
      if (opts.fail?.has(table)) return { data: null, error: { message: 'boom' } }
      return { data: (tables[table] ?? []).filter(matches).slice(0, lim), error: null }
    }
    const q = {
      select: () => q,
      insert: (row: Row) => {
        call.op = 'insert'
        call.row = row
        if (!opts.insertError?.[table]) {
          inserted = { access_token: `tok-${(tables[table]?.length ?? 0) + 1}`, id: row.id ?? `${table}-${(tables[table]?.length ?? 0) + 1}`, ...row }
          ;(tables[table] ??= []).push(inserted)
        }
        return q
      },
      delete: () => {
        call.op = 'delete'
        return q
      },
      eq: (c: string, v: unknown) => (call.filters.push(['eq', c, v]), q),
      in: (c: string, v: unknown[]) => (call.filters.push(['in', c, v]), q),
      order: () => q,
      limit: (n: number) => ((lim = n), q),
      maybeSingle: async () => {
        const r = run()
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }
      },
      single: async () => {
        const r = run()
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return q
  }
  return { from, calls, tables }
}

const T = 'tttttttt-0000-4000-8000-00000000000a'
const T2 = 'tttttttt-0000-4000-8000-00000000000b'
const AL = 'aaaaaaaa-0000-4000-8000-000000000001'
const AL2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const C1 = 'cccccccc-0000-4000-8000-000000000001'
const C2 = 'cccccccc-0000-4000-8000-000000000002'

async function main() {
  const esbuild = req(join(ROOT, 'node_modules/.p4-runtime/node_modules/esbuild')) as typeof import('esbuild')
  const dir = join(ROOT, 'node_modules/.cache/client-gallery-v2')
  mkdirSync(dir, { recursive: true })
  const entries = [
    'lib/gallery-access.ts',
    'lib/clients/share.ts',
    'lib/invitations.ts',
    'lib/gallery-email.ts',
    'lib/gallery-email-send.ts',
    'lib/covers/registry.ts',
    'lib/covers/model.ts',
    'lib/covers/album-cover.ts',
    'lib/gallery/layouts.ts',
    'lib/cover-layouts.ts',
  ]
  await esbuild.build({
    entryPoints: entries.map((e) => join(ROOT, e)),
    outdir: dir,
    outbase: ROOT,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: { '.js': '.cjs' },
    packages: 'external',
    logLevel: 'silent',
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /^(server-only|next\/headers|next\/cache|@\/lib\/supabase\/admin|@\/lib\/tenant)$/ }, (a) => ({ path: a.path, namespace: 'stub' }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
            contents:
              a.path === '@/lib/supabase/admin'
                ? 'exports.createAdminClientOrNull = () => null; exports.createAdminClient = () => { throw new Error("no key") }'
                : a.path === '@/lib/tenant'
                  ? 'exports.currentSiteTenantId = async () => null; exports.currentSite = async () => null'
                  : '',
            loader: 'js',
          }))
        },
      },
    ],
  })
  const load = <M>(p: string): M => {
    const f = join(dir, p.replace(/\.ts$/, '.cjs'))
    delete req.cache[req.resolve(f)]
    return req(f) as M
  }
  const GA = load<typeof import('../lib/gallery-access')>('lib/gallery-access.ts')
  const SH = load<typeof import('../lib/clients/share')>('lib/clients/share.ts')
  const INV = load<typeof import('../lib/invitations')>('lib/invitations.ts')
  const EM = load<typeof import('../lib/gallery-email')>('lib/gallery-email.ts')
  const SEND = load<typeof import('../lib/gallery-email-send')>('lib/gallery-email-send.ts')
  const REG = load<typeof import('../lib/covers/registry')>('lib/covers/registry.ts')
  const MOD = load<typeof import('../lib/covers/model')>('lib/covers/model.ts')
  const LAY = load<typeof import('../lib/gallery/layouts')>('lib/gallery/layouts.ts')
  const LEG = load<typeof import('../lib/cover-layouts')>('lib/cover-layouts.ts')
  const COV = load<typeof import('../lib/covers/album-cover')>('lib/covers/album-cover.ts')

  // ══ A. the favorites zip ═══════════════════════════════════════════════
  {
    const access = { tenantId: T, clientId: C1, clientName: 'Ana', albumIds: [AL] }
    const world = () => ({
      favorites: [
        { album_id: AL, photo_id: 'p1', client_id: C1 },
        { album_id: AL, photo_id: 'p2', client_id: C1 },
        { album_id: AL, photo_id: 'p3', client_id: C2 }, // another client's favorite
        { album_id: AL, photo_id: 'pX', client_id: C1 }, // points at another site's photograph
        { album_id: AL2, photo_id: 'p9', client_id: C1 }, // another album
      ],
      photos: [
        { id: 'p1', album_id: AL, tenant_id: T, storage_path: 'k1', original_path: 'o1', caption: null, sort_order: 1 },
        { id: 'p2', album_id: AL, tenant_id: T, storage_path: 'k2', original_path: null, caption: null, sort_order: 2 },
        { id: 'p3', album_id: AL, tenant_id: T, storage_path: 'k3', original_path: null, caption: null, sort_order: 3 },
        { id: 'pX', album_id: AL, tenant_id: T2, storage_path: 'kx', original_path: null, caption: null, sort_order: 4 },
        { id: 'p9', album_id: AL2, tenant_id: T, storage_path: 'k9', original_path: null, caption: null, sort_order: 1 },
      ],
      albums: [
        { id: AL, tenant_id: T, title: 'Davis', slug: 'davis', allow_downloads: true },
        { id: AL2, tenant_id: T2, title: 'Other', slug: 'other', allow_downloads: true },
      ],
    })

    const db = fakeDb(world())
    const got = await GA.favoritePhotosForZip(access, AL, db as never)
    is('favorites zip: only this client’s favorites of this album, on this site', got.map((r) => r.storage_path), ['k1', 'k2'])
    const favCall = db.calls.find((c) => c.table === 'favorites')!
    ok('favorites zip: favorites read is narrowed by the token’s client and the album', favCall.filters.some(([, c, v]) => c === 'client_id' && v === C1) && favCall.filters.some(([, c, v]) => c === 'album_id' && v === AL))
    const photoCall = db.calls.find((c) => c.table === 'photos')!
    ok('favorites zip: photographs read on the token’s site, inside the album', photoCall.filters.some(([, c, v]) => c === 'tenant_id' && v === T) && photoCall.filters.some(([, c, v]) => c === 'album_id' && v === AL))
    ok('favorites zip: a favorite pointing at another site’s photograph draws nothing (the tenant filter refused it)', !got.some((r) => r.storage_path === 'kx'))

    const db2 = fakeDb(world())
    let threw = false
    try {
      await GA.favoritePhotosForZip(access, AL2, db2 as never)
    } catch {
      threw = true
    }
    ok('favorites zip: an album the token does not open throws before any read (assertAlbum)', threw && db2.calls.length === 0)

    const db3 = fakeDb({ ...world(), favorites: [] })
    is('favorites zip: no favorites → empty, and no photographs read', [(await GA.favoritePhotosForZip(access, AL, db3 as never)).length, db3.calls.filter((c) => c.table === 'photos').length], [0, 0])

    const db4 = fakeDb(world(), { fail: new Set(['favorites']) })
    let failed = false
    try {
      await GA.favoritePhotosForZip(access, AL, db4 as never)
    } catch {
      failed = true
    }
    ok('favorites zip: a failed favorites read is an error, never an empty zip', failed)

    const db5 = fakeDb(world(), { fail: new Set(['photos']) })
    let failed5 = false
    try {
      await GA.favoritePhotosForZip(access, AL, db5 as never)
    } catch {
      failed5 = true
    }
    ok('favorites zip: a failed photographs read is an error too', failed5)

    // album_clients carries no site: a link row naming another site's album.
    const crossAccess = { ...access, albumIds: [AL, AL2] }
    const db6 = fakeDb(world())
    is('album for zip: another site’s album named by a share row → null (tenant filter)', await GA.albumForZip(crossAccess, AL2, db6 as never), null)
    is('album for zip: this site’s album, with its download switch', (await GA.albumForZip(crossAccess, AL, db6 as never))?.allow_downloads, true)
    const db7 = fakeDb(world())
    is('album for zip: an album the token does not open → null, nothing read', [await GA.albumForZip(access, AL2, db7 as never), db7.calls.length], [null, 0])
    const db8 = fakeDb(world())
    is('photos for zip: every photograph of the album on this site, none of another site’s', (await GA.photosForZip(access, AL, db8 as never)).map((r) => r.storage_path), ['k1', 'k2', 'k3'])
  }

  // ══ B. inline create-and-share ═════════════════════════════════════════
  {
    const world = () => ({
      albums: [
        { id: AL, tenant_id: T },
        { id: AL2, tenant_id: T2 },
      ],
      clients: [
        { id: C1, tenant_id: T, name: 'Ana Davis', email: 'ana@example.com', access_token: 'tokA' },
        { id: C2, tenant_id: T2, name: 'Bea', email: 'bea@example.com', access_token: 'tokB' },
      ],
      album_clients: [] as Row[],
    })

    let db = fakeDb(world())
    let r = await SH.addClientToAlbumWith(db as never, T, AL2, { clientId: C1 })
    ok('share: another site’s album is refused, nothing written', !r.ok && !db.calls.some((c) => c.op === 'insert'))

    db = fakeDb(world())
    r = await SH.addClientToAlbumWith(db as never, T, AL, { clientId: C2 })
    ok('share: another site’s contact is "not found", never shared', !r.ok && db.tables.album_clients.length === 0)

    db = fakeDb(world())
    r = await SH.addClientToAlbumWith(db as never, T, AL, { clientId: C1 })
    is('share: an existing contact of this site is shared', [r.ok, db.tables.album_clients.map((s) => [s.album_id, s.client_id])], [true, [[AL, C1]]])

    db = fakeDb(world())
    r = await SH.addClientToAlbumWith(db as never, T, AL, { name: '  Carla  Ruiz ', email: 'Carla@Example.com ' })
    const created = db.tables.clients.find((c) => c.email === 'carla@example.com')
    ok('share: a new contact is created on THIS site (tenant named), cleaned, and shared in one step', r.ok && created?.tenant_id === T && created?.name === 'Carla Ruiz' && db.tables.album_clients.length === 1)
    ok('share: the result carries the client’s private-link token', r.ok && r.client.token === created?.access_token)

    db = fakeDb(world())
    r = await SH.addClientToAlbumWith(db as never, T, AL, { name: 'Ana again', email: 'ANA@example.com' })
    ok('share: an address this site already has reuses that contact (no twin)', r.ok && r.client.id === C1 && db.tables.clients.length === 2)

    db = fakeDb(world())
    r = await SH.addClientToAlbumWith(db as never, T, AL, { name: 'Bea here', email: 'bea@example.com' })
    ok('share: the same address on ANOTHER site is not reused — a new contact here', r.ok && r.client.id !== C2 && db.tables.clients.some((c) => c.email === 'bea@example.com' && c.tenant_id === T))

    db = fakeDb(world())
    r = await SH.addClientToAlbumWith(db as never, T, AL, { name: 'X', email: 'not-an-email' })
    ok('share: a malformed address is refused before anything is written', !r.ok && !db.calls.some((c) => c.op === 'insert'))
    r = await SH.addClientToAlbumWith(db as never, T, AL, { name: '   ', email: 'x@example.com' })
    ok('share: a blank name is refused', !r.ok)

    db = fakeDb(world(), { insertError: { album_clients: { code: '23505' } } })
    r = await SH.addClientToAlbumWith(db as never, T, AL, { clientId: C1 })
    ok('share: already shared (23505) is success', r.ok)
    db = fakeDb(world(), { insertError: { album_clients: { code: '42501', message: 'denied' } } })
    r = await SH.addClientToAlbumWith(db as never, T, AL, { clientId: C1 })
    ok('share: any other link failure is reported', !r.ok)

    db = fakeDb({ ...world(), album_clients: [{ album_id: AL, client_id: C2 }] })
    const rm = await SH.removeClientFromAlbumWith(db as never, T, AL, C2)
    ok('unshare: another site’s client is refused and no delete is sent', !rm.ok && !db.calls.some((c) => c.op === 'delete'))
    db = fakeDb({ ...world(), album_clients: [{ album_id: AL, client_id: C1 }] })
    const rm2 = await SH.removeClientFromAlbumWith(db as never, T, AL, C1)
    ok('unshare: this site’s share is removed', rm2.ok && db.tables.album_clients.length === 0)
  }

  // ══ C. invitations ═════════════════════════════════════════════════════
  // The safe flow (lib/invitations.ts header): a resend re-sends to the SAME
  // account and never deletes, inserts or re-issues anybody; changing the
  // address is switched off and touches nothing. The fake still offers
  // deleteUser, createUser, emailOwner and profile writes — and logs them — so
  // a regression back to the old delete/re-issue flow shows up as a logged
  // call. (Exhaustive coverage, with mutations, is .mk/invitations.ts.)
  {
    const U1 = 'uuuuuuuu-0000-4000-8000-000000000001'
    const ADDR = 'wrong@example.com'
    type Users = Record<string, Record<string, unknown>>
    type InviteAnswer = { data: { user: never } | null; error: { message: string } | null }
    function admin(opts: {
      users: Users
      profiles: Row[]
      failTables?: string[]
      getUserError?: boolean
      invite?: (email: string) => InviteAnswer | null // null → the default provider
    }) {
      const db = fakeDb(
        { profiles: opts.profiles, tenant_domains: [{ tenant_id: T, host: 'ana.lensgrid.co', is_primary: true }] },
        { fail: new Set(opts.failTables ?? []) }
      )
      const log: string[] = []
      let n = 0
      const a = {
        from: db.from,
        emailOwner: async (email: string) => (log.push(`owner:${email}`), null),
        auth: {
          admin: {
            getUserById: async (id: string) =>
              opts.getUserError
                ? { data: null, error: { message: 'boom' } }
                : { data: { user: (opts.users[id] as never) ?? null }, error: null },
            // Supabase's documented behaviour: an unconfirmed existing account
            // with this address is re-invited AS ITSELF; otherwise a new one.
            inviteUserByEmail: async (email: string, o: { redirectTo: string }): Promise<InviteAnswer> => {
              log.push(`invite:${email}:${o.redirectTo}`)
              const custom = opts.invite?.(email)
              if (custom) return custom
              const existing = Object.values(opts.users).find((u) => u.email === email)
              if (existing) return { data: { user: existing as never }, error: null }
              const id = `new-${++n}`
              opts.users[id] = { id, email, invited_at: 'now' }
              return { data: { user: opts.users[id] as never }, error: null }
            },
            deleteUser: async (id: string) => {
              log.push(`delete:${id}`)
              delete opts.users[id]
              return { error: null }
            },
            createUser: async () => (log.push('createUser'), { data: null, error: { message: 'no' } }),
          },
        },
      }
      return { a, db, log, users: opts.users }
    }
    const pendingProfile = () => [{ id: U1, tenant_id: T, email: ADDR, role: 'owner', display_name: null, is_platform_admin: false }]
    const pendingUser = (): Users => ({ [U1]: { id: U1, email: ADDR, invited_at: 't' } })
    const sent = (x: { log: string[] }) => x.log.some((l) => l.startsWith('invite'))
    // Nothing destructive or creative, by any route: no account deleted or
    // made, no address-ownership probe, no profile written or removed, and
    // the auth accounts exactly as they were.
    const untouched = (x: ReturnType<typeof admin>, accounts: string[] = [U1]) =>
      !x.log.some((l) => l.startsWith('delete') || l.startsWith('owner') || l === 'createUser') &&
      !x.db.calls.some((c) => c.op !== 'select') &&
      JSON.stringify(x.db.tables.profiles) === JSON.stringify(pendingProfile()) &&
      JSON.stringify(Object.keys(x.users)) === JSON.stringify(accounts)
    const claimsOldLinkDead = (m: string) => /(no longer|stopped|stops) work|invalidat|old link/i.test(m)

    is('status: confirmed or signed in → accepted', [INV.invitationStatus({ id: 'x', email_confirmed_at: 't' }), INV.invitationStatus({ id: 'x', last_sign_in_at: 't' })], ['accepted', 'accepted'])
    is('status: invited only → pending; no account → unknown', [INV.invitationStatus({ id: 'x', invited_at: 't' }), INV.invitationStatus(null)], ['pending', 'unknown'])

    const RESEND = { tenantId: T, userId: U1, fallbackDomain: 'lensgrid.co' }
    let x = admin({ users: pendingUser(), profiles: pendingProfile() })
    let r = await INV.resendInvitationWith(x.a as never, { ...RESEND, tenantId: T2 })
    ok('resend: a person read on another site is refused, nothing sent', !r.ok && !sent(x) && untouched(x))
    const profileCall = x.db.calls.find((c) => c.table === 'profiles')!
    ok('resend: the profile is read with the site named', profileCall.filters.some(([, c, v]) => c === 'tenant_id' && v === T2))

    x = admin({ users: pendingUser(), profiles: pendingProfile(), failTables: ['profiles'] })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: the site’s people unreadable → refused, nothing sent (never "pending")', !r.ok && !sent(x) && untouched(x))

    x = admin({ users: { [U1]: { id: U1, email: ADDR, email_confirmed_at: 't' } }, profiles: pendingProfile() })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: an accepted invitation is refused', !r.ok && !sent(x) && untouched(x))

    x = admin({ users: pendingUser(), profiles: [{ ...pendingProfile()[0]!, is_platform_admin: true }] })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: a platform admin is never re-invited from here', !r.ok && !sent(x))

    x = admin({ users: {}, profiles: pendingProfile() })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: no sign-in account → refused, nothing sent or created', !r.ok && !sent(x) && untouched(x, []))

    x = admin({ users: pendingUser(), profiles: pendingProfile(), getUserError: true })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: the account unreadable → refused, nothing sent', !r.ok && !sent(x) && untouched(x))

    x = admin({ users: { [U1]: { id: U1, email: 'other@example.com', invited_at: 't' } }, profiles: pendingProfile() })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: the account’s address differs from the profile’s → refused before sending (no second, unattached account)', !r.ok && !sent(x) && untouched(x))

    x = admin({ users: pendingUser(), profiles: pendingProfile(), failTables: ['tenant_domains'] })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: the site’s address unreadable → refused, nothing sent', !r.ok && !sent(x) && untouched(x))

    x = admin({ users: pendingUser(), profiles: pendingProfile() })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    is('resend: pending → the same address, landing on the site’s own sign-in', [r.ok, x.log], [true, [`invite:${ADDR}:https://ana.lensgrid.co/admin/login`]])
    ok('resend: success re-sends to the SAME account — nothing deleted, created, written or re-attached', r.ok && untouched(x))
    ok('resend: the success message does not claim the earlier link stopped working', r.ok && !claimsOldLinkDead(r.message), r.message)

    // A provider that refuses a second invitation ("already registered"): the
    // person accepted in the meantime. Refused, and NOTHING is re-issued — the
    // old flow deleted the account here and invited afresh.
    x = admin({
      users: pendingUser(),
      profiles: pendingProfile(),
      invite: () => ({ data: null, error: { message: 'A user with this email address has already been registered' } }),
    })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: a provider refusing a second invite → refused, never re-issued (no delete, one attempt, profile intact)', !r.ok && untouched(x) && x.log.filter((l) => l.startsWith('invite')).length === 1, JSON.stringify(x.log))

    x = admin({ users: pendingUser(), profiles: pendingProfile(), invite: () => ({ data: null, error: { message: 'rate limited' } }) })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: any other provider error → refused, nothing changed, the reason shown', !r.ok && untouched(x) && r.message.includes('rate limited'))

    x = admin({ users: pendingUser(), profiles: pendingProfile(), invite: () => ({ data: { user: { id: 'stranger', email: ADDR, invited_at: 't' } as never }, error: null }) })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: the provider answers with a different account → refused and reported, nothing cleaned up', !r.ok && untouched(x) && r.message.includes('stranger'))

    x = admin({ users: pendingUser(), profiles: pendingProfile(), invite: () => ({ data: { user: { id: U1, email: ADDR, email_confirmed_at: 't' } as never }, error: null }) })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: the provider reports the account accepted meanwhile → not a success, nothing changed', !r.ok && untouched(x))

    x = admin({ users: pendingUser(), profiles: pendingProfile(), invite: () => ({ data: { user: null as never }, error: null }) })
    r = await INV.resendInvitationWith(x.a as never, RESEND)
    ok('resend: the provider confirms no account → not a success', !r.ok && untouched(x))

    // Changing the address is switched off: every input — malformed, a new
    // address (any case), the same one, a non-string — is refused before
    // anything is read, probed, sent, deleted or written.
    for (const email of ['nope', 'right@example.com', 'Right@Example.com', ADDR, 42, null]) {
      x = admin({ users: pendingUser(), profiles: pendingProfile() })
      r = await INV.changeInvitationEmailWith(x.a as never, { ...RESEND, email })
      ok(`change (${JSON.stringify(email)}): disabled — refused with the stated reason; nothing read, probed, sent, deleted or written`, !r.ok && r.message === INV.CHANGE_DISABLED && x.db.calls.length === 0 && x.log.length === 0 && untouched(x), JSON.stringify({ r, log: x.log, calls: x.db.calls.length }))
    }
    ok('change: the refusal tells the photographer nothing was changed', /Nothing was changed/.test(INV.CHANGE_DISABLED))
  }

  // ══ D. the email, and its fallback without a key ═══════════════════════
  {
    // The reservation's digest is over p_tenant::text, so this section's site
    // is a canonical UUID (the suite-wide T is not hex).
    const TD = '7d000000-0000-4000-8000-00000000000a'
    const { createHash } = req('node:crypto') as typeof import('node:crypto')
    const world = () => ({
      albums: [{ id: AL, tenant_id: TD, title: 'Davis family', cover_title_text: null, cover_photo_id: 'p1', cover_custom_path: null }],
      clients: [
        { id: C1, tenant_id: TD, name: 'Ana Davis', email: 'ana@example.com', access_token: 'tokA' },
        { id: C2, tenant_id: TD, name: 'Not shared', email: 'ns@example.com', access_token: 'tokN' },
      ],
      album_clients: [{ album_id: AL, client_id: C1 }],
      site_settings: [{ tenant_id: TD, site_title: 'Karla Mata' }],
      profiles: [{ id: 'u1', tenant_id: TD, email: 'karla@example.com' }],
      photos: [{ id: 'p1', tenant_id: TD, album_id: AL, storage_path: 't/x/p1.webp' }],
    })
    // A fake reserve_gallery_email_send that charges like the deployed one:
    // it reads the client's address itself and answers
    // reserved:<sha256(p_tenant::text || ':' || lower(btrim(email)))>.
    const rpcCalls: Array<Record<string, unknown>> = []
    const withRpc = (db: ReturnType<typeof fakeDb>) =>
      Object.assign(db, {
        rpc: (fn: string, args: Record<string, unknown>) => {
          rpcCalls.push({ fn, ...args })
          const c = (db.tables.clients ?? []).find((r) => r.id === args.p_client && r.tenant_id === args.p_tenant)
          const shared = (db.tables.album_clients ?? []).some((s) => s.album_id === args.p_album && s.client_id === args.p_client)
          const email = typeof c?.email === 'string' ? c.email.replace(/^ +| +$/g, '').toLowerCase() : ''
          const out = !c || !shared || !email
            ? { data: null, error: { code: '42501', message: 'refused' }, status: 403 }
            : { data: `reserved:${createHash('sha256').update(`${String(args.p_tenant).toLowerCase()}:${email}`, 'utf8').digest('hex')}`, error: null, status: 200 }
          return Promise.resolve(out)
        },
      })
    const sent: unknown[] = []
    const deps = (configured: boolean) => ({
      db: withRpc(fakeDb(world())) as never,
      send: async (i: unknown) => (sent.push(i), { ok: true as const, id: 'e1' }),
      configured: () => configured,
      imageUrl: (p: string) => `https://cdn.example/${p}`,
      origin: 'https://karla.lensgrid.co',
    })
    const editor = { tenantId: TD, userId: 'u1' }

    delete process.env.RESEND_API_KEY
    is('fallback: no RESEND_API_KEY → not configured', EM.galleryEmailConfigured(), false)
    let r = await SEND.sendGalleryEmailWith({ ...deps(false), configured: undefined }, editor, AL, C1, { subject: 's', message: 'm' })
    ok('fallback: without the key the answer is not_configured, nothing is reserved and nothing is sent', !r.ok && r.reason === 'not_configured' && sent.length === 0 && rpcCalls.length === 0)
    process.env.RESEND_API_KEY = 'synthetic-not-a-key'
    is('the key is the switch', EM.galleryEmailConfigured(), true)
    delete process.env.RESEND_API_KEY

    r = await SEND.sendGalleryEmailWith(deps(true), editor, AL, C2, { subject: 's', message: 'm' })
    ok('send: a client the album is not shared with is refused before anything else', !r.ok && r.reason === 'not_found' && sent.length === 0)
    r = await SEND.sendGalleryEmailWith(deps(true), { tenantId: T2, userId: 'u1' }, AL, C1, { subject: 's', message: 'm' })
    ok('send: another site’s editor finds neither album nor client', !r.ok && r.reason === 'not_found')
    r = await SEND.sendGalleryEmailWith(deps(true), editor, AL, C1, { subject: '  ', message: 'm' })
    ok('send: an empty subject is refused', !r.ok && r.reason === 'invalid' && sent.length === 0)
    ok('send: none of the refusals above made a reservation', rpcCalls.length === 0, JSON.stringify(rpcCalls))

    r = await SEND.sendGalleryEmailWith(deps(true), editor, AL, C1, { subject: 'Your gallery is ready: Davis family', message: 'Hi Ana,\n\n<b>yes</b>' })
    ok('send: one reservation, for this site, album and client, then one email', rpcCalls.length === 1 && rpcCalls[0]!.fn === 'reserve_gallery_email_send' && rpcCalls[0]!.p_tenant === TD && rpcCalls[0]!.p_album === AL && rpcCalls[0]!.p_client === C1 && sent.length === 1, JSON.stringify({ r, rpcCalls, sent: sent.length }))
    const mail = (sent[0] ?? { to: '', fromName: '', fromAddress: '', replyTo: '', html: '', text: '' }) as { to: string; fromName: string; fromAddress: string; replyTo: string; html: string; text: string }
    ok('send: to the client, from "<photographer> via Lens Grid" at galleries@lensgrid.co, reply to the photographer', r.ok && mail.to === 'ana@example.com' &&mail.fromName === 'Karla Mata via Lens Grid' && mail.fromAddress === 'galleries@lensgrid.co' && mail.replyTo === 'karla@example.com', JSON.stringify({ ...mail, html: undefined }))
    ok('send: one View gallery button to /gallery/<token>; the message is escaped', mail.html.includes('>View gallery</a>') && mail.html.includes('https://karla.lensgrid.co/gallery/tokA') && mail.html.includes('&lt;b&gt;yes&lt;/b&gt;') && !mail.html.includes('<b>yes</b>'))
    ok('send: the cover photograph leads the email', mail.html.includes('https://cdn.example/t/x/p1.webp'))
    ok('send: the raw link appears once more only in the small fallback line', mail.html.split('https://karla.lensgrid.co/gallery/tokA').length - 1 <= 4 && mail.html.includes('Button not working?'))

    // The pre-correction answer, and a digest of somebody else: nothing sent.
    const sentBefore = sent.length
    for (const [name, data] of [
      ['bare "reserved"', 'reserved'],
      ['another recipient’s digest', `reserved:${createHash('sha256').update(`${TD}:someone@else.com`, 'utf8').digest('hex')}`],
    ] as const) {
      const db = Object.assign(fakeDb(world()), { rpc: () => Promise.resolve({ data, error: null, status: 200 }) })
      r = await SEND.sendGalleryEmailWith({ ...deps(true), db: db as never }, editor, AL, C1, { subject: 's', message: 'm' })
      ok(`send: a reservation answered with ${name} sends nothing`, !r.ok && r.reason === 'failed' && sent.length === sentBefore, JSON.stringify(r))
    }

    // Limiter: one recipient at most three an hour.
    const lim = EM.createRateLimiter(EM.GALLERY_EMAIL_LIMITS)
    const takes = [1, 2, 3, 4].map(() => lim.take({ tenant: T, recipient: 'a' }, 1000))
    is('limit: a fourth email to one client within the hour is refused', takes, [true, true, true, false])
    ok('limit: the window passes', lim.take({ tenant: T, recipient: 'a' }, 1000 + 60 * 60 * 1000 + 1))

    is('template: the approved subject', EM.defaultGalleryEmail({ albumTitle: 'Davis', clientName: 'Ana Davis', photographerName: 'Karla' }).subject, 'Your gallery is ready: Davis')
    ok('template: greets the client by first name and signs with the photographer', /^Hi Ana,/.test(EM.defaultGalleryEmail({ albumTitle: 'Davis', clientName: 'Ana Davis', photographerName: 'Karla' }).message) && /Karla$/.test(EM.defaultGalleryEmail({ albumTitle: 'Davis', clientName: 'Ana Davis', photographerName: 'Karla' }).message))
    is('safeUrl: only http(s)', [EM.safeUrl('javascript:alert(1)'), EM.safeUrl('https://x.co/a')], [null, 'https://x.co/a'])
    ok('html: a javascript: gallery URL never reaches an href', !EM.renderGalleryEmailHtml({ subject: 's', message: 'm', albumTitle: 'a', photographerName: 'p', coverUrl: null, galleryUrl: 'javascript:alert(1)' }).includes('javascript:'))
    is('from name cannot break the header', EM.galleryFromName('Evil <x@y>, "z"', 'Lens Grid'), 'Evil x@y z via Lens Grid')
  }

  // ══ E. the cover registry, the model and the layouts ═══════════════════
  {
    is('registry: the fourteen approved keys, in order', REG.COVER_STYLE_KEYS, ['lightbox', 'cinemascope', 'panorama_band', 'portrait_split', 'diptych', 'museum_print', 'chapter', 'full_bleed', 'folio', 'marquee', 'colophon', 'overlay', 'plate', 'frontispiece'])
    const legacy = new Set([...LEG.COVER_LAYOUTS.map((l) => l.value), 'bottom_left'])
    const KEYS = REG.COVER_STYLE_KEYS
    // `plate` is BOTH an approved semantic key and an existing legacy
    // cover_preset. The semantic key stays; what is STORED must never be
    // ambiguous, so every new style is stored as `v2:<key>`.
    ok('registry: the semantic key plate is kept — and plate is also a legacy layout (why stored values are prefixed)', REG.isCoverStyleKey('plate') && legacy.has('plate'))
    is('registry: every style is stored as v2:<key>', KEYS.map((k) => REG.coverPresetValue(k)), KEYS.map((k) => `v2:${k}`))
    ok('registry: no STORED style value collides with a legacy cover_preset', KEYS.every((k) => !legacy.has(REG.coverPresetValue(k))))
    ok('registry: no legacy value starts with the style prefix', [...legacy].every((v) => !v.startsWith(REG.COVER_STYLE_PREFIX)))
    ok('registry: every legacy value resolves to no style (keeps the old renderer) — plate included', [...legacy].every((v) => REG.coverStyle(v) === null) && REG.coverStyle('plate') === null)
    ok('registry: every stored style value resolves to its own style', KEYS.every((k) => REG.coverStyle(REG.coverPresetValue(k))?.key === k))
    ok('registry: a bare new-style key resolves to no style (never written; no ambiguous reuse)', KEYS.every((k) => REG.coverStyle(k) === null))
    is('registry: near-misses resolve to nothing', ['V2:plate', 'v2:Plate', ' v2:plate', 'v2:plate ', 'v2:', 'v2:v2:plate', 'v2:constructor', 'v2:__proto__', 'v2:toString', 'v2:anchor'].map((v) => REG.coverStyle(v)), Array(10).fill(null))
    is('registry: the legacy preset set is lib/cover-layouts.ts plus bottom_left', [...REG.LEGACY_COVER_PRESETS].sort(), [...legacy].sort())
    is('legacy: the Plate layout is still the full-bleed plate design', [LEG.getLayout('plate').value, LEG.getLayout('plate').kind, LEG.getLayout('plate').decoration], ['plate', 'fullbleed', 'plate'])

    // Save validation (updateAlbumSettings keeps the album's value on null).
    is('save: cover_preset accepts exactly a legacy layout or a prefixed style',
      ['plate', 'v2:plate', 'anchor', 'bottom_left', 'journal', 'v2:lightbox', 'v2:diptych', 'lightbox', 'diptych', 'V2:plate', 'v2:nope', 'v2:', '', ' plate', null, 42, 'javascript:alert(1)'].map((v) => REG.storableCoverPreset(v)),
      ['plate', 'v2:plate', 'anchor', 'bottom_left', 'journal', 'v2:lightbox', 'v2:diptych', null, null, null, null, null, null, null, null, null, null])

    // Render mapping: the same album fields, routed by the stored value alone.
    {
      const view = { src: 'https://cdn.example/a.webp', srcSet: 'https://cdn.example/a-800.webp 800w', alt: '' }
      const photos = [{ id: 'a', width: 3, height: 2, caption: null, view, full: view }]
      const base = {
        title: 'Davis', cover_photo_id: 'a', cover_custom_path: null, cover_title_enabled: true, cover_title_text: '', location: 'Baja',
        cover_font: 'Bebas Neue', cover_title_color: '#123456', cover_title_scale: 1.4, cover_overlay_type: 'grain', cover_overlay_opacity: 0.5,
        cover_show_location: true, cover_show_button: true, cover_button_text: 'See it', cover_focal_x: 0.2, cover_focal_y: 0.7,
      }
      const draw = (preset: string) => COV.albumCover({ album: { ...base, cover_preset: preset }, cover: view, photos: photos as never, siteTitle: 'Karla' })
      is('render: an album saved as legacy plate is drawn by the legacy renderer (no style)', draw('plate'), null)
      const s = COV.legacyCoverSettings({ ...base, cover_preset: 'plate' }, view, null)
      is('render: …with exactly its legacy settings — layout, face, colour, size, overlay, focal point, location, button',
        [s.layout, s.font, s.color, s.titleScale, s.overlayType, s.overlayOpacity, s.focalX, s.focalY, s.showLocation, s.location, s.showButton, s.buttonText, s.imageUrl],
        ['plate', 'Bebas Neue', '#123456', 1.4, 'grain', 0.5, 0.2, 0.7, true, 'Baja', true, 'See it', view.src])
      const v2 = draw('v2:plate')
      is('render: an album saved as v2:plate is drawn as the Plate STYLE, with the style’s own face over a legacy one', [v2?.styleKey, v2?.model.font.name], ['plate', 'Cormorant Garamond'])
      is('render: a bare lightbox is not a style', draw('lightbox'), null)
      is('render: a legacy album keeps every legacy layout’s own renderer', [...legacy].map((v) => draw(v)), [...legacy].map(() => null))
    }
    ok('registry: background is a control of EVERY style', REG.COVER_STYLE_KEYS.every((k) => REG.COVER_STYLES[k].controls.includes('background')))
    ok('registry: every crop between 4:5 and 2:1 (full bleed’s phone excepted)', REG.COVER_STYLE_KEYS.every((k) => REG.cropWithinBounds(REG.COVER_STYLES[k])))
    ok('registry: every style declares the orientation it suits; diptych takes two photographs', REG.COVER_STYLE_KEYS.every((k) => REG.COVER_STYLES[k].suits.length > 0) && REG.COVER_STYLES.diptych.photos === 2)
    ok('registry: every default face is one of the six', REG.COVER_STYLE_KEYS.every((k) => REG.titleFont(REG.COVER_STYLES[k].defaults.font) !== null))
    is('registry: the six faces', REG.COVER_TITLE_FONTS.map((f) => `${f.name}:${f.weight}`), ['Bodoni Moda:400', 'Cormorant Garamond:400', 'Playfair Display:400', 'Archivo Black:400', 'Inter Tight:800', 'Oswald:500'])
    ok('registry: Archivo Black is asked for without a weight axis', !REG.titleFontHref(REG.titleFont('Archivo Black')!).includes('wght'))
    is('hexColor: only #RRGGBB', [REG.hexColor('#aBc123'), REG.hexColor('red'), REG.hexColor('#abc'), REG.hexColor('#abcdef;x:y')], ['#ABC123', null, null, null])
    is('zoom: NULL → 1, clamped to 1–2.5', [REG.clampZoom(null), REG.clampZoom(''), REG.clampZoom(9), REG.clampZoom(0.2), REG.clampZoom('1.5')], [1, 1, 2.5, 1, 1.5])

    const style = REG.COVER_STYLES.cinemascope
    const m = MOD.resolveCoverModel(style, {
      albumTitle: 'Davis', subtitle: 'eyebrow', showDate: true, dateLabel: 'Nov 2026', font: 'Bebas Neue', titleScale: 9,
      titleColor: 'url(x)', background: null, siteTitle: 'Karla', photo: null,
    })
    is('model: legacy face → style default; bad colours → defaults; size clamped; eyebrow dropped where unused', [m.font.name, m.titleColor, m.background, m.titleScale, m.eyebrow, m.dateLabel], ['Oswald', '#F4F1EA', '#0A0A09', 1.6, null, 'Nov 2026'])
    is('model: date shown only when switched on', MOD.resolveCoverModel(style, { albumTitle: 'D', dateLabel: 'x', siteTitle: '', photo: null }).dateLabel, null)

    const ph = [
      { id: 'a', width: 3, height: 2 },
      { id: 'b', width: 3, height: 2 },
      { id: 'c', width: 2, height: 3 },
      { id: 'd', width: 2, height: 3 },
    ]
    is('second photo: the next portrait after the cover', MOD.secondPhotoFor(ph, 'a', null)?.id, 'c')
    is('second photo: wraps round past the end', MOD.secondPhotoFor(ph, 'd', null)?.id, 'c')
    is('second photo: a chosen one wins; the cover itself is never second', [MOD.secondPhotoFor(ph, 'a', 'b')?.id, MOD.secondPhotoFor(ph, 'a', 'a')?.id], ['b', 'c'])

    // 1 → single; 2–4 → justified whatever the style; from 5 each style is
    // its own again, except masonry, which waits until 6.
    is('layouts: small-count thresholds', [LAY.SMALL_COUNT_MAX, LAY.MASONRY_MIN], [4, 6])
    is('layouts: small-count rules', ['grid', 'masonry', 'single_column', 'square', 'editorial'].map((s) => [0, 1, 2, 3, 4, 5, 6].map((n) => LAY.arrangementFor(s as never, n))), [
      ['none', 'single', 'justified', 'justified', 'justified', 'justified', 'justified'],
      ['none', 'single', 'justified', 'justified', 'justified', 'justified', 'masonry'],
      ['none', 'single', 'justified', 'justified', 'justified', 'column', 'column'],
      ['none', 'single', 'justified', 'justified', 'justified', 'square', 'square'],
      ['none', 'single', 'justified', 'justified', 'justified', 'editorial', 'editorial'],
    ])
    // What the deployed square migration (20261122233837) admits — read from
    // the file itself, so the application and the CHECK cannot drift apart.
    const sq = readFileSync(join(ROOT, 'db/migrations/2026-11-22_album_layout_square.sql'), 'utf8')
    const cNew = /c_new\s+constant text := '([^\n]*)';/.exec(sq)?.[1] ?? ''
    const admitted = [...cNew.matchAll(/''([a-z_]+)''::text/g)].map((m) => m[1]!)
    is('layouts: the square migration admits masonry, grid, single_column, square', admitted, ['masonry', 'grid', 'single_column', 'square'])
    is('layouts: storable = exactly what albums_layout_style_check now accepts', [...LAY.STORABLE_LAYOUTS].sort(), [...admitted].sort())
    is('layouts: square saves; editorial (not admitted) and near-misses do not', ['square', 'grid', 'editorial', 'Square', 'square ', '', null].map((v) => LAY.storableLayout(v)), ['square', 'grid', null, null, null, null, null])
    ok('layouts: every offered layout but editorial is storable', LAY.LAYOUT_STYLES.filter((l) => !LAY.STORABLE_LAYOUTS.includes(l.key)).map((l) => l.key).join() === 'editorial')
    is('layouts: justified is the default; legacy values keep their meaning', [LAY.DEFAULT_LAYOUT, LAY.layoutStyleOf('nonsense'), LAY.layoutStyleOf('masonry')], ['grid', 'grid', 'masonry'])

    const ratios = Array.from({ length: 40 }, (_, i) => (i % 3 === 2 ? 2 / 3 : 3 / 2))
    const W = 1200
    const gap = 14
    const rows = LAY.justifiedRows(ratios, W, gap)
    const full = rows.filter((r) => r.filled && r !== rows[rows.length - 1])
    ok('justified: every full row is exactly the width', full.every((r) => Math.abs(r.items.reduce((a, b) => a + b.width, 0) + gap * (r.items.length - 1) - W) < 0.5))
    ok('justified: no row taller than the cap', rows.every((r) => r.height <= LAY.targetRowHeight(W) * 1.6 + 1e-9))
    ok('justified: every photograph placed once, in order', rows.flatMap((r) => r.items.map((i) => i.index)).join() === ratios.map((_, i) => i).join())
    const lonely = LAY.justifiedRows([1.5], W, gap)
    ok('justified: a short last row is not stretched into a giant', lonely[0]!.height <= LAY.targetRowHeight(W) + 1e-9 && !lonely[0]!.filled)
    ok('justified: each tile keeps its photograph’s ratio', rows.every((r) => r.items.every((it) => Math.abs(it.width / it.height - ratios[it.index]!) < 1e-9)))
    const cols = LAY.masonryDeal(ratios, 4)
    const heights = cols.map((c) => c.reduce((a, i) => a + 1 / ratios[i]!, 0))
    ok('masonry: columns end within one photograph of each other', Math.max(...heights) - Math.min(...heights) <= 1.5 + 1e-9)
    is('masonry: never more columns than photographs make sensible', [LAY.masonryColumns(1400, 6), LAY.masonryColumns(1400, 40), LAY.masonryColumns(390, 40)], [3, 4, 2])
  }

  console.log(`client-gallery-v2: ${pass} passed, ${fail.length} failed`)
  if (fail.length) {
    for (const f of fail) console.log(`  FAIL ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
