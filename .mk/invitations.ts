import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * INVITATIONS — resend, and the switched-off change of address. No database,
 * no network, no real provider: every Supabase call goes to a fake.
 *
 *   node node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs .mk/invitations.ts [--mutations]
 *
 * What it holds lib/invitations.ts to:
 *   • only a PROVABLY pending person is re-invited: the profile read on the
 *     named site, not a platform admin, an auth account that exists, is
 *     readable, is the same id, carries the same address and has neither
 *     confirmed nor signed in — missing/unknown/unreadable is a refusal;
 *   • a resend is ONE inviteUserByEmail to that address and nothing else; a
 *     refusal or failure from the provider (including a person accepting
 *     between the check and the send) changes nothing and can be retried;
 *   • no account and no profile is ever deleted or inserted, by any path
 *     (the fake offers deleteUser / insert / delete and logs any use);
 *   • no message claims an earlier link was revoked;
 *   • changing the address refuses before any read or send;
 *   • the server actions keep their platform-admin gate (source check).
 *
 * --mutations re-runs the suite against altered copies of the module (in
 * node_modules/.cache, never the real file) and requires each to be caught.
 */

const ROOT = resolve(__dirname, '..')
const req = createRequire(join(ROOT, 'package.json'))
const SRC = join(ROOT, 'lib/invitations.ts')
const SITES = join(ROOT, 'app/actions/sites.ts')

type Row = Record<string, unknown>
type Inv = typeof import('../lib/invitations')

const T = 'tttttttt-0000-4000-8000-00000000000a'
const T2 = 'tttttttt-0000-4000-8000-00000000000b'
const U1 = 'uuuuuuuu-0000-4000-8000-000000000001'
const REDIRECT = 'https://ana.lensgrid.co/admin/login'

async function build(src: string, tag: string): Promise<Inv> {
  const esbuild = req(join(ROOT, 'node_modules/.p4-runtime/node_modules/esbuild')) as typeof import('esbuild')
  const out = join(ROOT, 'node_modules/.cache/invitations', `${tag}.cjs`)
  await esbuild.build({
    entryPoints: [src],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    logLevel: 'silent',
    plugins: [
      {
        name: 'root-alias',
        setup(b) {
          b.onResolve({ filter: /^@\// }, (a) => ({ path: join(ROOT, a.path.slice(2)) + '.ts' }))
        },
      },
    ],
  })
  delete req.cache[req.resolve(out)]
  return req(out) as Inv
}

/** Comments out, so a source check sees code rather than the header's prose. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

async function suite(INV: Inv, invSource: string): Promise<{ pass: number; fail: string[] }> {
  let pass = 0
  const fail: string[] = []
  const ok = (n: string, good: boolean, d = '') => (good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`))

  // ── the fake service-role client ──────────────────────────────────────────
  type Users = Record<string, Row>
  type InviteAnswer = { data: { user: Row | null } | null; error: { message: string } | null }
  function world(opts: {
    users?: Users
    profiles?: Row[]
    readUser?: Array<{ user?: Row | null; error?: { message: string } }> // scripted getUserById answers, in order
    invite?: Array<(email: string) => InviteAnswer> // scripted inviteUserByEmail answers, in order
    failRead?: Set<string>
  }) {
    const tables: Record<string, Row[]> = {
      profiles: opts.profiles ?? [{ id: U1, tenant_id: T, email: 'ana@example.com', role: 'owner', display_name: null, is_platform_admin: false }],
      tenant_domains: [{ tenant_id: T, host: 'ana.lensgrid.co', is_primary: true }],
    }
    const users: Users = opts.users ?? { [U1]: { id: U1, email: 'ana@example.com', invited_at: 't0' } }
    const log: string[] = []
    const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
    let readN = 0
    let inviteN = 0
    const from = (table: string) => {
      const filters: Array<[string, unknown]> = []
      reads.push({ table, filters })
      log.push(`from:${table}`)
      let lim = Infinity
      const run = () => {
        if (opts.failRead?.has(table)) return { data: null, error: { message: 'boom' } }
        const rows = (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v))
        return { data: rows.slice(0, lim), error: null }
      }
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        order: () => q,
        limit: (n: number) => ((lim = n), q),
        maybeSingle: async () => {
          const r = run()
          return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error }
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
        // Destructive verbs exist on the fake ONLY so their use is caught.
        insert: (row: Row) => (log.push(`insert:${table}:${String(row.id)}`), q),
        delete: () => (log.push(`delete-rows:${table}`), q),
        update: () => (log.push(`update-rows:${table}`), q),
        upsert: () => (log.push(`upsert-rows:${table}`), q),
      }
      return q
    }
    const a = {
      from,
      auth: {
        admin: {
          getUserById: async (id: string) => {
            log.push(`getUser:${id}`)
            const s = opts.readUser?.[readN++]
            if (s?.error) return { data: null, error: s.error }
            if (s && 'user' in s) return { data: { user: s.user ?? null }, error: null }
            return { data: { user: users[id] ?? null }, error: null }
          },
          inviteUserByEmail: async (email: string, o: { redirectTo: string }) => {
            log.push(`invite:${email}:${o.redirectTo}`)
            const s = opts.invite?.[inviteN++]
            if (s) return s(email)
            // Supabase's documented shape: an existing unconfirmed account is
            // re-sent the invitation (same id); a confirmed one is refused.
            const existing = Object.values(users).find((u) => u.email === email)
            if (existing && (existing.email_confirmed_at || existing.last_sign_in_at)) {
              return { data: null, error: { message: 'A user with this email address has already been registered' } }
            }
            if (existing) return { data: { user: existing }, error: null }
            const id = `new-${inviteN}`
            users[id] = { id, email, invited_at: 'now' }
            return { data: { user: users[id] }, error: null }
          },
          deleteUser: async (id: string) => (log.push(`deleteUser:${id}`), delete users[id], { error: null }),
          updateUserById: async (id: string) => (log.push(`updateUser:${id}`), { data: null, error: null }),
          createUser: async () => (log.push('createUser'), { data: null, error: null }),
        },
      },
    }
    return { a, log, reads, tables, users }
  }
  const resend = (w: ReturnType<typeof world>, tenantId = T, userId = U1) =>
    INV.resendInvitationWith(w.a as never, { tenantId, userId, fallbackDomain: 'lensgrid.co' })
  const invites = (w: ReturnType<typeof world>) => w.log.filter((l) => l.startsWith('invite:'))
  const destructive = (w: ReturnType<typeof world>) =>
    w.log.filter((l) => /^(insert|delete-rows|update-rows|upsert-rows|deleteUser|updateUser|createUser)/.test(l))
  const all: Array<ReturnType<typeof world>> = []
  const W = (o: Parameters<typeof world>[0] = {}) => {
    const w = world(o)
    all.push(w)
    return w
  }
  const REVOKE_CLAIM = /revoked|no longer works|stops? working|stopped working|invalidat|old (link|invitation)/i

  // ── status ────────────────────────────────────────────────────────────────
  ok('status: confirmed / confirmed_at / signed in → accepted',
    ['email_confirmed_at', 'confirmed_at', 'last_sign_in_at'].every((k) => INV.invitationStatus({ id: 'x', [k]: 't' }) === 'accepted'))
  ok('status: invited only → pending', INV.invitationStatus({ id: 'x', invited_at: 't' }) === 'pending')
  ok('status: no account → unknown', INV.invitationStatus(null) === 'unknown' && INV.invitationStatus(undefined) === 'unknown')

  // ── unknown / unreadable auth is never "pending" ─────────────────────────
  {
    let w = W({ users: {} })
    let r = await resend(w)
    ok('unknown auth: a profile whose auth account is missing is refused, nothing sent', !r.ok && invites(w).length === 0, JSON.stringify(w.log))
    ok('unknown auth: refused by the auth read (it was asked), not earlier', w.log.includes(`getUser:${U1}`))

    w = W({ readUser: [{ error: { message: 'timeout' } }] })
    r = await resend(w)
    ok('unreadable auth: a provider error reading the account is refused, nothing sent', !r.ok && invites(w).length === 0)

    w = W({ readUser: [{ user: { id: 'someone-else', email: 'ana@example.com', invited_at: 't' } }] })
    r = await resend(w)
    ok('auth answers with a different id → refused, nothing sent', !r.ok && invites(w).length === 0)

    w = W({ users: { [U1]: { id: U1, email: 'other@example.com', invited_at: 't' } } })
    r = await resend(w)
    ok('auth address differs from the profile → refused (would mint a second account), nothing sent', !r.ok && invites(w).length === 0)

    w = W({ users: { [U1]: { id: U1, email: null, invited_at: 't' } } })
    r = await resend(w)
    ok('auth account without an address → refused, nothing sent', !r.ok && invites(w).length === 0)
  }

  // ── tenant and platform-admin controls ───────────────────────────────────
  {
    let w = W()
    let r = await resend(w, T2)
    ok('tenant: a person read on another site is refused, nothing sent', !r.ok && invites(w).length === 0)
    const p = w.reads.find((x) => x.table === 'profiles')
    ok('tenant: the profile is read with the site named and the person named',
      !!p && p.filters.some(([c, v]) => c === 'tenant_id' && v === T2) && p.filters.some(([c, v]) => c === 'id' && v === U1))
    ok('tenant: the refusal came from the profile read (auth never asked)', !w.log.some((l) => l.startsWith('getUser')))

    w = W({ failRead: new Set(['profiles']) })
    r = await resend(w)
    ok('profile read error → refused, nothing sent', !r.ok && invites(w).length === 0 && !w.log.some((l) => l.startsWith('getUser')))

    w = W({ profiles: [{ id: U1, tenant_id: T, email: 'ana@example.com', role: 'owner', is_platform_admin: true }] })
    r = await resend(w)
    ok('platform admin: never re-invited from here', !r.ok && invites(w).length === 0)

    w = W()
    r = await INV.resendInvitationWith(w.a as never, { tenantId: '', userId: U1, fallbackDomain: 'lensgrid.co' })
    ok('empty site id → refused before any read', !r.ok && w.log.length === 0)

    w = W({ users: { [U1]: { id: U1, email: 'ana@example.com', email_confirmed_at: 't' } } })
    r = await resend(w)
    ok('accepted: refused, nothing sent', !r.ok && invites(w).length === 0)

    w = W({ failRead: new Set(['tenant_domains']) })
    r = await resend(w)
    ok('site address unreadable → refused, nothing sent', !r.ok && invites(w).length === 0)
  }

  // ── the happy path ───────────────────────────────────────────────────────
  {
    const w = W()
    const r = await resend(w)
    ok('resend: pending → exactly one invitation, to the same address, landing on the site’s own sign-in',
      r.ok && JSON.stringify(invites(w)) === JSON.stringify([`invite:ana@example.com:${REDIRECT}`]), JSON.stringify(w.log))
    ok('resend: the same account remains, profile untouched', !!w.users[U1] && w.tables.profiles.length === 1 && w.tables.profiles[0]!.id === U1)
    ok('resend: the message does not claim the earlier link was revoked', !REVOKE_CLAIM.test(r.message), r.message)
  }

  // ── acceptance race: pending at the check, accepted by the send ─────────
  {
    // The person confirms between getUserById and inviteUserByEmail: Supabase
    // refuses the re-invite as "already registered".
    let w = W({
      invite: [() => ({ data: null, error: { message: 'A user with this email address has already been registered' } })],
    })
    let r = await resend(w)
    ok('race: accepted between check and send → not ok, one send attempted, nothing else', !r.ok && invites(w).length === 1, JSON.stringify(w.log))
    ok('race: the accepted person’s account and profile are untouched', !!w.users[U1] && w.tables.profiles.some((p) => p.id === U1))
    ok('race: the message says they seem to have accepted', /accepted/i.test(r.message), r.message)

    // A provider that instead answers with the (now confirmed) account.
    w = W({ invite: [(email) => ({ data: { user: { id: U1, email, email_confirmed_at: 'now' } }, error: null })] })
    r = await resend(w)
    ok('race: the send answers with a confirmed account → not ok', !r.ok && /accepted/i.test(r.message))
  }

  // ── send failure, then recovery ──────────────────────────────────────────
  {
    const w = W({
      invite: [
        () => ({ data: null, error: { message: 'For security purposes, you can only request this after 52 seconds.' } }),
        () => ({ data: null, error: { message: 'Error sending invite email' } }),
      ],
    })
    let r = await resend(w)
    ok('send failure (rate limit): not ok, reported with the provider’s reason', !r.ok && r.message.includes('52 seconds'), r.message)
    r = await resend(w)
    ok('send failure (provider/SMTP): not ok', !r.ok && r.message.includes('Error sending invite email'))
    ok('send failure: the account and profile are exactly as before', !!w.users[U1] && w.tables.profiles.length === 1 && w.tables.profiles[0]!.id === U1)
    r = await resend(w)
    ok('recovery: the next try (provider healthy) succeeds against the same account', r.ok && invites(w).length === 3, JSON.stringify(w.log))
    ok('recovery: the person is still listed as pending (status read from the same account)', INV.invitationStatus(w.users[U1] as never) === 'pending')

    const w2 = W({ invite: [() => ({ data: null, error: null })] })
    r = await resend(w2)
    ok('send answers with no account and no error → not ok', !r.ok)

    const w3 = W({ invite: [(email) => ({ data: { user: { id: 'new-x', email, invited_at: 'now' } }, error: null })] })
    r = await resend(w3)
    ok('send answers with a DIFFERENT account → not ok, and that account is not deleted from here',
      !r.ok && r.message.includes('new-x') && !w3.log.some((l) => l.startsWith('deleteUser')))
  }

  // ── change of address: switched off ──────────────────────────────────────
  {
    for (const email of ['right@example.com', 'ANA@example.com', 'nope', 42]) {
      const w = W()
      const r = await INV.changeInvitationEmailWith(w.a as never, { tenantId: T, userId: U1, email, fallbackDomain: 'lensgrid.co' })
      ok(`change (${String(email)}): refused before any read or send`, !r.ok && w.log.length === 0, JSON.stringify(w.log))
      ok(`change (${String(email)}): says nothing was changed and claims no revocation`, /nothing was changed/i.test(r.message) && !/no longer works|revoked/i.test(r.message))
    }
  }

  // ── never destructive, in any scenario above ─────────────────────────────
  {
    const bad = all.flatMap((w) => destructive(w))
    ok('no scenario deleted, inserted, updated or created an account or profile', bad.length === 0, JSON.stringify(bad))
  }

  // ── source: no destructive verb in the module; the actions keep their gate ─
  {
    const inv = code(invSource)
    ok('source: lib/invitations.ts calls no deleteUser / createUser / updateUserById',
      !/\b(deleteUser|createUser|updateUserById)\b/.test(inv))
    ok('source: lib/invitations.ts calls no .insert/.delete/.update/.upsert', !/\.(insert|delete|update|upsert)\s*\(/.test(inv))

    const sites = readFileSync(SITES, 'utf8')
    const at = sites.indexOf('// INVITATIONS')
    const section = at >= 0 ? code(sites.slice(at)) : ''
    ok('source: sites.ts has the invitations section', at >= 0)
    ok('source: the invitations section deletes and inserts nothing', !/\b(deleteUser|createUser)\b|\.(insert|delete|upsert)\s*\(/.test(section))
    ok('source: the gate requires a platform admin before the service-role client',
      /async function platformAdminDb[\s\S]*?requireEditor\(\)[\s\S]*?if \(!editor\.platformAdmin\) return[\s\S]*?createAdminClient\(\)/.test(section))
    for (const name of ['resendInvitation', 'changeInvitationEmail']) {
      const m = section.match(new RegExp(`export async function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`))
      const body = m?.[1] ?? ''
      ok(`source: ${name} passes the platform-admin gate first`,
        /^\s*const gate = await platformAdminDb\(\)\s*\n\s*if \('message' in gate\) return/.test(body), body.slice(0, 160))
    }
  }

  return { pass, fail }
}

// ── mutants: each must make the suite fail ───────────────────────────────────
// (Ignoring the auth read's error is not listed: Supabase answers an error with
// no user, so the unknown-account refusal catches it — an equivalent mutant.)
// `expect`, where given, names checks that must fail — each by its exact name,
// and its detail matching where a pattern is given — and the mutant must not
// throw: it counts as caught only for that reason.
type Expect = { check: string; detail?: RegExp }
const MUTANTS: Array<{ name: string; from: string; to: string; expect?: Expect[] }> = [
  { name: 'unknown auth treated as pending', from: "if (status === 'unknown' || !user || user.id !== userId) {", to: "if (status === 'unknown' && false) {" },
  { name: 'address-match guard removed', from: 'if (!same(user.email, profile.email)) {', to: 'if (false) {' },
  { name: 'tenant filter dropped', from: ".eq('tenant_id', tenantId)\n    .eq('id', userId)", to: ".eq('id', userId)" },
  { name: 'platform-admin guard removed', from: 'if (profile.is_platform_admin) return', to: 'if (false) return' },
  {
    name: 'delete fallback reintroduced on "already"',
    from: "if (why.toLowerCase().includes('already')) {",
    to: "if (why.toLowerCase().includes('already')) { await (db.auth.admin as any).deleteUser(input.userId);",
  },
  { name: 'provider error reported as success', from: 'if (error) {\n    const why', to: 'if (error) { return { ok: true, message: "sent" }\n    const why' },
  { name: 'success message claims revocation', from: 'Ask them to use the newest email.', to: 'The old link no longer works.' },
  { name: 'different account accepted as success', from: 'if (user.id !== input.userId) {', to: 'if (false) {' },
  {
    name: 'change path re-enabled (sends an invite)',
    from: '  return { ok: false, message: CHANGE_DISABLED }',
    to: "  await db.auth.admin.inviteUserByEmail(String(input.email), { redirectTo: 'x' })\n  return { ok: true, message: 'sent' }",
    // It must actually send: each address's "refused before any read or send"
    // fails with that address's invite in the log, and its message check fails.
    expect: ['right@example.com', 'ANA@example.com', 'nope', 42].flatMap((e) => [
      { check: `change (${String(e)}): refused before any read or send`, detail: new RegExp(`"invite:${String(e)}:x"`) },
      { check: `change (${String(e)}): says nothing was changed and claims no revocation` },
    ]),
  },
]

async function main() {
  mkdirSync(join(ROOT, 'node_modules/.cache/invitations'), { recursive: true })
  const source = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
  const base = await suite(await build(SRC, 'real'), source)
  console.log(`invitations: ${base.pass} passed, ${base.fail.length} failed`)
  for (const f of base.fail) console.log('  FAIL ' + f)
  if (base.fail.length) process.exit(1)

  if (process.argv.includes('--mutations')) {
    let caught = 0
    const missed: string[] = []
    for (const [i, m] of MUTANTS.entries()) {
      if (!source.includes(m.from)) {
        missed.push(`${m.name} — anchor not found (the mutant does not apply)`)
        continue
      }
      const file = join(ROOT, 'node_modules/.cache/invitations', `mutant-${i}.ts`)
      const mutated = source.replace(m.from, m.to)
      writeFileSync(file, mutated)
      let r: { pass: number; fail: string[] }
      let threw = false
      try {
        r = await suite(await build(file, `mutant-${i}`), mutated)
      } catch (e) {
        // A mutant that crashes the call is detected (the real action would throw).
        threw = true
        r = { pass: 0, fail: [`threw: ${e instanceof Error ? e.message : String(e)}`] }
      }
      if (m.expect) {
        const why: string[] = []
        if (threw) why.push(r.fail[0]!)
        for (const x of m.expect) {
          const f = r.fail.find((l) => l === x.check || l.startsWith(x.check + '\n'))
          if (!f) why.push(`expected check did not fail: ${x.check}`)
          else if (x.detail && !x.detail.test(f)) why.push(`${x.check} failed for another reason: ${f.split('\n')[1]?.trim() ?? ''}`)
        }
        if (why.length) {
          missed.push(`${m.name} — not caught for the intended reason:\n    ${why.join('\n    ')}`)
          continue
        }
      }
      if (r.fail.length) {
        caught++
        console.log(`  caught  ${m.name}  (${r.fail.length} failing: ${r.fail[0]!.split('\n')[0]})`)
      } else missed.push(m.name)
    }
    const after = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
    console.log(`mutations: ${caught}/${MUTANTS.length} caught; real lib/invitations.ts ${after === source ? 'unchanged' : 'CHANGED'}`)
    for (const m of missed) console.log('  MISSED ' + m)
    if (missed.length || after !== source) process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
