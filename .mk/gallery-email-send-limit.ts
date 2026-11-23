import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * THE GALLERY EMAIL SEND LIMIT — the application half. No database, no network.
 *
 *   node node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs .mk/gallery-email-send-limit.ts [--mutations]
 *
 * lib/gallery-email-send.ts must reserve every provider attempt through
 * `reserve_gallery_email_send` on the editor's own client, send ONLY on a clean
 * answer of exactly `reserved:<64 lowercase hex>` whose digest is SHA-256 of
 * `<canonical site id>:<lower(btrim(to))>` for the very `to` handed to the
 * provider, never retry or refund, and re-read the client, share and album
 * after the reservation, refusing on any drift. The SQL function itself
 * (locking, counting, the digest it returns, authorisation as the real roles)
 * is proved by db/verify-gallery-email-recipient-binding.sql and
 * .mk/gallery-email-recipient-binding-db.ts; here the RPC is a fake that
 * charges like the deployed function (it reads the address itself, at call
 * time, and answers with that address's digest) or answers whatever a case
 * chooses, and every call — read, rpc, answer, provider — is logged in order
 * so each refusal is attributed to the layer that made it.
 *
 * --mutations rebuilds the module with one defect at a time (in the bundle
 * only; the real file is never written) and requires each to fail a named
 * check.
 */

const ROOT = resolve(__dirname, '..')
const req = createRequire(join(ROOT, 'package.json'))
const SEND_FILE = join(ROOT, 'lib/gallery-email-send.ts')

type Row = Record<string, unknown>
type Log = string[]
type RpcReply = { data: unknown; error: unknown; status?: number }
type World = Record<string, Row[]>
type RpcImpl = (args: Record<string, unknown>, world: World, signal: AbortSignal | null) => Promise<RpcReply> | RpcReply

// Canonical UUIDs: the digest is over `p_tenant::text`, so the site id must be one.
const T = '7e000000-0000-4000-8000-00000000000a'
const T2 = '7e000000-0000-4000-8000-00000000000b'
const AL = 'aaaaaaaa-0000-4000-8000-000000000001'
const C1 = 'cccccccc-0000-4000-8000-000000000001'
const C2 = 'cccccccc-0000-4000-8000-000000000002'
const SECRET = 'synthetic-resend-key-never-shown'

const world = (tenant = T): World => ({
  albums: [{ id: AL, tenant_id: tenant, title: 'Davis family', cover_title_text: null, cover_photo_id: null, cover_custom_path: null }],
  clients: [
    { id: C1, tenant_id: tenant, name: 'Ana Davis', email: 'Ana@Example.com', access_token: 'tokA' },
    { id: C2, tenant_id: tenant, name: 'Not shared', email: 'ns@example.com', access_token: 'tokN' },
  ],
  album_clients: [{ album_id: AL, client_id: C1 }],
  site_settings: [{ tenant_id: tenant, site_title: 'Karla Mata' }],
  profiles: [{ id: 'u1', tenant_id: tenant, email: 'karla@example.com' }],
})

// The deployed function's digest, computed here independently of the module
// under test: sha256(utf8(p_tenant::text || ':' || lower(btrim(email)))), hex.
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const dbNormalize = (e: string) => e.replace(/^ +| +$/g, '').toLowerCase()
const digestOf = (tenant: string, email: string) => sha(`${tenant.toLowerCase()}:${dbNormalize(email)}`)
const answerFor = (tenant: string, email: string) => `reserved:${digestOf(tenant, email)}`

/** Charges like reserve_gallery_email_send: reads the client's address NOW and answers with its digest. */
const charge = (a: Record<string, unknown>, w: World): RpcReply => {
  const c = (w.clients ?? []).find((r) => r.id === a.p_client && r.tenant_id === a.p_tenant)
  const shared = (w.album_clients ?? []).some((s) => s.album_id === a.p_album && s.client_id === a.p_client)
  if (!c || !shared) return { data: null, error: { code: '42501', message: 'not shared' }, status: 403 }
  const email = typeof c.email === 'string' ? dbNormalize(c.email) : ''
  if (!email) return { data: null, error: { code: '22023', message: 'no address' }, status: 400 }
  return { data: `reserved:${sha(`${String(a.p_tenant).toLowerCase()}:${email}`)}`, error: null, status: 200 }
}
const bound: RpcImpl = (a, w) => charge(a, w)

/** A fake editor client: filters in-memory rows by the filters actually sent; rpc answers per case. */
function fakeDb(w: World, log: Log, rpc: RpcImpl | null, failReads: Set<string> = new Set()) {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = []
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      maybeSingle: async () => {
        log.push(`read:${table}`)
        if (failReads.has(table)) return { data: null, error: { message: 'boom' } }
        const rows = (w[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v))
        return { data: rows[0] ?? null, error: null }
      },
    }
    return q
  }
  const db: Record<string, unknown> = { from }
  if (rpc) {
    db.rpc = (fn: string, args: Record<string, unknown>) => {
      log.push(`rpc:${fn}:${JSON.stringify(args)}`)
      let signal: AbortSignal | null = null
      const builder = {
        abortSignal: (s: AbortSignal): unknown => ((signal = s), builder),
        then: (res: (v: RpcReply) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve()
            .then(() => rpc(args, w, signal))
            .then((v) => (log.push(`answer:${JSON.stringify(v?.data ?? null)}`), v))
            .then(res, rej),
      }
      return builder
    }
  }
  return db
}

const reply = (data: unknown, extra: Partial<RpcReply> = {}): RpcImpl => () => ({ data, error: null, status: 200, ...extra })

type Mods = { SEND: typeof import('../lib/gallery-email-send'); EM: typeof import('../lib/gallery-email') }

async function build(tag: string, mutate?: (src: string) => string): Promise<Mods> {
  const esbuild = req(join(ROOT, 'node_modules/.p4-runtime/node_modules/esbuild')) as typeof import('esbuild')
  const dir = join(ROOT, 'node_modules/.cache/gallery-email-send-limit', tag)
  mkdirSync(dir, { recursive: true })
  await esbuild.build({
    entryPoints: [SEND_FILE, join(ROOT, 'lib/gallery-email.ts')],
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
        name: 'mutate',
        setup(b) {
          if (!mutate) return
          b.onLoad({ filter: /gallery-email-send\.ts$/ }, (a) => {
            const src = readFileSync(a.path, 'utf8').replace(/\r\n/g, '\n')
            const out = mutate(src)
            if (out === src) throw new Error(`mutant ${tag} did not apply`)
            return { contents: out, loader: 'ts' }
          })
        },
      },
    ],
  })
  const load = <M>(p: string): M => {
    const f = join(dir, p)
    delete req.cache[req.resolve(f)]
    return req(f) as M
  }
  return { SEND: load('lib/gallery-email-send.cjs'), EM: load('lib/gallery-email.cjs') }
}

// Which layer refused, by the outcome's own words.
const NOT_RESERVED_TEXT = 'could not be sent right now'
const DRIFT_TEXT = 'changed while sending'

async function checks({ SEND, EM }: Mods): Promise<{ pass: number; fail: string[] }> {
  let pass = 0
  const fail: string[] = []
  const ok = (n: string, good: boolean, d = '') => (good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`))

  type Sent = { to: string; html: string; text: string }
  const run = async (o: {
    rpc?: RpcImpl | null
    configured?: boolean | 'env'
    editor?: { tenantId: string; userId: string }
    client?: string
    fields?: { subject: unknown; message: unknown }
    w?: World
    failReads?: Set<string>
    provider?: (i: Sent) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
    timeoutMs?: number
  }) => {
    const w = o.w ?? world()
    const log: Log = []
    const sent: Sent[] = []
    const db = fakeDb(w, log, o.rpc === undefined ? bound : o.rpc, o.failReads)
    const r = await SEND.sendGalleryEmailWith(
      {
        db: db as never,
        send: async (i) => {
          log.push(`send:${i.to}`)
          sent.push(i as Sent)
          return o.provider ? o.provider(i as Sent) : { ok: true as const, id: 'e1' }
        },
        configured: o.configured === 'env' ? undefined : () => o.configured ?? true,
        imageUrl: (p) => `https://cdn.example/${p}`,
        origin: 'https://karla.lensgrid.co',
        reserveTimeoutMs: o.timeoutMs ?? 2000,
      },
      o.editor ?? { tenantId: T, userId: 'u1' },
      AL,
      o.client ?? C1,
      o.fields ?? { subject: 'Your gallery is ready', message: 'Hi Ana' }
    )
    const rpcs = log.filter((l) => l.startsWith('rpc:'))
    const sends = log.filter((l) => l.startsWith('send:'))
    const answers = log.filter((l) => l.startsWith('answer:')).map((l) => JSON.parse(l.slice('answer:'.length)) as unknown)
    return { r, log, sent, rpcs, sends, answers, w }
  }
  type Run = Awaited<ReturnType<typeof run>>
  const noSend = (x: { sends: string[] }) => x.sends.length === 0
  const said = (x: Run, text: string) => !x.r.ok && x.r.error.includes(text)
  /** Every send went to the recipient whose digest the database answered with, under this site. */
  const sentIsCharged = (x: Run, tenant = T) =>
    x.sent.every((m) => x.answers.length === 1 && x.answers[0] === answerFor(tenant, m.to))

  // ── the happy path, and its order ─────────────────────────────────────────
  {
    const x = await run({})
    const iRpc = x.log.findIndex((l) => l.startsWith('rpc:'))
    const iSend = x.log.findIndex((l) => l.startsWith('send:'))
    const reReads = x.log.slice(iRpc + 1, iSend)
    ok('happy: a clean "reserved:<digest>" for this recipient sends exactly once', x.r.ok && x.sends.length === 1, JSON.stringify(x.log))
    ok('happy: exactly one reservation, named and argued as the function expects, tenant from the editor', x.rpcs.length === 1 && x.rpcs[0] === `rpc:reserve_gallery_email_send:${JSON.stringify({ p_tenant: T, p_album: AL, p_client: C1 })}`, x.rpcs[0])
    ok('happy: the reservation comes before the provider call', iRpc >= 0 && iSend > iRpc)
    ok('happy: client, album and share are read AGAIN between reservation and send', ['read:albums', 'read:clients', 'read:album_clients'].every((t) => reReads.includes(t)), JSON.stringify(reReads))
    ok('happy: sent to the stored address (trimmed), with the link of the re-read token', x.sent[0]?.to === 'Ana@Example.com' && x.sent[0]!.html.includes('https://karla.lensgrid.co/gallery/tokA'))
    ok('happy: the address sent to is the one the database charged (digest of the provider’s own "to")', x.sent.length === 1 && sentIsCharged(x), JSON.stringify({ to: x.sent[0]?.to, answers: x.answers }))

    // The stored address with surrounding spaces: btrim's recipient, sent trimmed.
    const w = world()
    w.clients[0]!.email = '  Ana@Example.com '
    const y = await run({ w })
    ok('happy: surrounding spaces in the stored address — sent to the trimmed address, which is the one charged', y.r.ok && y.sent[0]?.to === 'Ana@Example.com' && sentIsCharged(y), JSON.stringify(y.log))

    // A site id in upper case: the database hashes p_tenant::text, which is lower case.
    const U = T.toUpperCase()
    const z = await run({ w: world(U), editor: { tenantId: U, userId: 'u1' } })
    ok('happy: an upper-case site id is hashed in its canonical lower-case form, as p_tenant::text prints it', z.r.ok && z.sends.length === 1 && sentIsCharged(z, T), JSON.stringify(z.log))
  }

  // ── nothing reserved, nothing sent, before the reservation ────────────────
  {
    delete process.env.RESEND_API_KEY
    let x = await run({ configured: 'env' })
    ok('not configured (no RESEND_API_KEY): not_configured, no reservation, no send', !x.r.ok && x.r.reason === 'not_configured' && x.rpcs.length === 0 && noSend(x), JSON.stringify(x.log))
    x = await run({ configured: false })
    ok('not configured (switch): no reservation, no send', !x.r.ok && x.r.reason === 'not_configured' && x.rpcs.length === 0 && noSend(x))

    process.env.RESEND_API_KEY = SECRET
    const outs: unknown[] = []
    for (const rpc of [reply('site_limited'), (() => ({ data: null, error: { message: SECRET } })) as RpcImpl, bound]) {
      outs.push((await run({ rpc, configured: 'env', provider: async () => ({ ok: false, error: SECRET }) })).r)
    }
    delete process.env.RESEND_API_KEY
    ok('secrets: no outcome ever carries the key or a provider/database error text', outs.every((o) => !JSON.stringify(o).includes(SECRET)), JSON.stringify(outs))

    x = await run({ fields: { subject: '  ', message: 'm' } })
    ok('invalid subject: no reservation, no send', !x.r.ok && x.r.reason === 'invalid' && x.rpcs.length === 0 && noSend(x))

    for (const [name, email] of [
      ['null', null],
      ['empty', '   '],
      ['header injection', 'ana@example.com\r\nBcc: x@y.z'],
      ['two recipients', 'a@x.co, b@y.co'],
      ['no @', 'ana.example.com'],
      // Unsupported normalisation: lower() outside ASCII is the database's
      // locale's business, so these are refused rather than guessed at.
      ['non-ASCII local part', 'ána@example.com'],
      ['non-ASCII domain', 'ana@exämple.com'],
      ['Turkish dotted capital I', 'İnci@example.com'],
      ['Kelvin sign', 'Kate@example.com'],
    ] as const) {
      const w = world()
      w.clients[0]!.email = email
      x = await run({ w })
      ok(`unusable address (${name}): invalid, no reservation, no send`, !x.r.ok && x.r.reason === 'invalid' && x.rpcs.length === 0 && noSend(x), JSON.stringify(x.log))
    }
    const w = world()
    w.clients[0]!.access_token = null
    x = await run({ w })
    ok('no gallery token: invalid, no reservation, no send', !x.r.ok && x.r.reason === 'invalid' && x.rpcs.length === 0 && noSend(x))

    // A site id the digest cannot be computed over with certainty.
    for (const bad of ['not-a-uuid', `{${T}}`, T.replace(/-/g, '')]) {
      x = await run({ w: world(bad), editor: { tenantId: bad, userId: 'u1' } })
      ok(`non-canonical site id (${bad}): failed, no reservation, no send`, !x.r.ok && x.r.reason === 'failed' && said(x, NOT_RESERVED_TEXT) && x.rpcs.length === 0 && noSend(x), JSON.stringify(x.log))
    }

    x = await run({ client: C2 })
    ok('unshared client: not_found, no reservation, no send', !x.r.ok && x.r.reason === 'not_found' && x.rpcs.length === 0 && noSend(x))
    x = await run({ editor: { tenantId: T2, userId: 'u1' } })
    ok('another site’s editor: not_found, no reservation, no send', !x.r.ok && x.r.reason === 'not_found' && x.rpcs.length === 0 && noSend(x))
    x = await run({ failReads: new Set(['clients']) })
    ok('a failed client read: not_found, no reservation, no send', !x.r.ok && x.r.reason === 'not_found' && x.rpcs.length === 0 && noSend(x))
  }

  // ── the reservation itself: anything but a clean, exact answer sends nothing ─
  {
    const good = answerFor(T, 'Ana@Example.com')
    const hex = good.slice('reserved:'.length)

    let x = await run({ rpc: reply('site_limited') })
    ok('site_limited: rate_limited, one reservation attempt, no send', !x.r.ok && x.r.reason === 'rate_limited' && x.rpcs.length === 1 && noSend(x))
    x = await run({ rpc: reply('recipient_limited') })
    ok('recipient_limited: rate_limited, no send', !x.r.ok && x.r.reason === 'rate_limited' && noSend(x))

    x = await run({ rpc: () => ({ data: null, error: { code: '42501', message: 'That is not your site.' }, status: 403 }) })
    ok('rpc error (42501): failed at the reservation, no send, no retry', said(x, NOT_RESERVED_TEXT) && x.rpcs.length === 1 && noSend(x))
    x = await run({ rpc: () => ({ data: good, error: { code: '55P03', message: 'lock timeout' } }) })
    ok('rpc error beside a valid "reserved:<digest>" body: failed at the reservation, no send', said(x, NOT_RESERVED_TEXT) && noSend(x))
    x = await run({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'function not found' }, status: 404 }) })
    ok('missing function: failed, no send', said(x, NOT_RESERVED_TEXT) && noSend(x))
    x = await run({ rpc: () => Promise.reject(new Error('network down')) })
    ok('rpc throws: failed (no exception escapes), no send', said(x, NOT_RESERVED_TEXT) && noSend(x))
    x = await run({ rpc: () => { throw new Error('sync throw') } })
    ok('rpc throws synchronously: failed, no send', said(x, NOT_RESERVED_TEXT) && noSend(x))
    x = await run({ rpc: null })
    ok('no rpc on the client (no fallback of any kind): failed, no send', said(x, NOT_RESERVED_TEXT) && noSend(x))
    x = await run({ rpc: reply(good, { status: 201 }) })
    ok('a non-200 status with a valid "reserved:<digest>" body: failed at the reservation, no send', said(x, NOT_RESERVED_TEXT) && noSend(x))

    for (const [name, data] of [
      ['bare "reserved" (the pre-correction answer, e.g. an in-flight call on the old body)', 'reserved'],
      ['"reserved:" with no digest', 'reserved:'],
      ['upper-case hex', `reserved:${hex.toUpperCase()}`],
      ['63 hex digits', `reserved:${hex.slice(1)}`],
      ['65 hex digits', `reserved:${hex}0`],
      ['non-hex digit', `reserved:${hex.slice(0, 63)}g`],
      ['trailing newline', `${good}\n`],
      ['leading space', ` ${good}`],
      ['space after the colon', `reserved: ${hex}`],
      ['RESERVED: prefix', `RESERVED:${hex}`],
      ['the digest alone', hex],
      ['RESERVED', 'RESERVED'],
      [' reserved', ' reserved'],
      ['null', null],
      ['true', true],
      ['[answer]', [good]],
      ['{fn: answer}', { reserve_gallery_email_send: good }],
      ['unknown word', 'ok'],
    ] as const) {
      x = await run({ rpc: reply(data) })
      ok(`unexpected answer ${name}: failed at the reservation, no send`, said(x, NOT_RESERVED_TEXT) && x.rpcs.length === 1 && noSend(x), JSON.stringify(x.r))
    }

    let aborted = false
    const t0 = Date.now()
    x = await run({
      timeoutMs: 50,
      rpc: (a, w, signal) =>
        new Promise<RpcReply>((res) => {
          signal?.addEventListener('abort', () => (aborted = true))
          setTimeout(() => res(charge(a, w)), 400) // too late
        }),
    })
    ok('timeout: failed at the reservation, no send — even though the database later answers a valid digest', said(x, NOT_RESERVED_TEXT) && noSend(x) && Date.now() - t0 < 350)
    ok('timeout: the request is aborted', aborted)
    await new Promise((r) => setTimeout(r, 400))
    ok('timeout: the late answer never turns into a send', noSend(x))
  }

  // ── the digest must name the recipient handed to the provider ─────────────
  {
    const wrong = async (name: string, data: string) => {
      const x = await run({ rpc: reply(data) })
      ok(`digest mismatch (${name}): failed, nothing sent, one reservation spent, no retry`, said(x, DRIFT_TEXT) && x.rpcs.length === 1 && noSend(x), JSON.stringify(x.log))
    }
    await wrong('another address', answerFor(T, 'someone@else.com'))
    await wrong('the same address under another site', answerFor(T2, 'Ana@Example.com'))
    await wrong('the address without lower()', `reserved:${sha(`${T}:Ana@Example.com`)}`)
    await wrong('a digest of nothing', `reserved:${sha('')}`)

    // A → B → A around the call: the function charged B; the re-read sees A
    // again. Only the digest can tell, and it must.
    let x = await run({
      rpc: (a, w) => {
        w.clients[0]!.email = 'b@example.com'
        const out = charge(a, w)
        w.clients[0]!.email = 'Ana@Example.com'
        return out
      },
    })
    ok('A→B→A: B charged, A restored before the re-read → failed, nothing sent, no retry', said(x, DRIFT_TEXT) && x.rpcs.length === 1 && noSend(x) && x.answers[0] === answerFor(T, 'b@example.com'), JSON.stringify(x.log))

    // A → B and left there: both the digest and the re-read refuse.
    x = await run({ rpc: (a, w) => ((w.clients[0]!.email = 'b@example.com'), charge(a, w)) })
    ok('A→B before the charge: B charged → failed, nothing sent (to A or to B)', !x.r.ok && x.rpcs.length === 1 && noSend(x))

    // The same recipient spelled differently while the function read it: the
    // database's recipient is the same, the stored text is back as it was.
    x = await run({
      rpc: (a, w) => {
        w.clients[0]!.email = ' ANA@EXAMPLE.COM'
        const out = charge(a, w)
        w.clients[0]!.email = 'Ana@Example.com'
        return out
      },
    })
    ok('equivalent spelling charged, original restored: sent once, to the original address, which is the charged recipient', x.r.ok && x.sends.length === 1 && x.sent[0]?.to === 'Ana@Example.com' && sentIsCharged(x), JSON.stringify(x.log))

    // Charged A, then A→B→A after the answer: A was charged, A is sent to.
    x = await run({
      rpc: (a, w) => {
        const out = charge(a, w)
        w.clients[0]!.email = 'b@example.com'
        w.clients[0]!.email = 'Ana@Example.com'
        return out
      },
    })
    ok('A charged, then A→B→A before the re-read: sent once, to A, which is what was charged', x.r.ok && x.sends.length === 1 && x.sent[0]?.to === 'Ana@Example.com' && sentIsCharged(x))
  }

  // ── the address reserved is the address sent to: the re-read ─────────────
  {
    // The function charges the address it reads; the change comes after.
    const drift = async (name: string, change: (w: World) => void) => {
      const x = await run({ rpc: (a, w) => { const out = charge(a, w); change(w); return out } })
      ok(`drift (${name}): failed, nothing sent, one reservation spent`, said(x, DRIFT_TEXT) && x.rpcs.length === 1 && noSend(x), JSON.stringify(x.log))
    }
    await drift('another address', (w) => void (w.clients[0]!.email = 'someone@else.com'))
    await drift('case only', (w) => void (w.clients[0]!.email = 'ana@example.com'))
    await drift('surrounding spaces only', (w) => void (w.clients[0]!.email = ' Ana@Example.com '))
    await drift('address cleared', (w) => void (w.clients[0]!.email = null))
    await drift('gallery token rotated', (w) => void (w.clients[0]!.access_token = 'tokB'))
    await drift('share removed', (w) => void (w.album_clients = []))
    await drift('client deleted', (w) => void (w.clients = w.clients.filter((c) => c.id !== C1)))
    await drift('client moved to another site', (w) => void (w.clients[0]!.tenant_id = T2))
    await drift('album deleted', (w) => void (w.albums = []))
    // A read that fails after the reservation is drift too: fail closed.
    const fr = new Set<string>()
    const x = await run({ failReads: fr, rpc: (a, w) => { const out = charge(a, w); fr.add('album_clients'); return out } })
    ok('drift (re-read fails): failed, nothing sent', said(x, DRIFT_TEXT) && noSend(x))
  }

  // ── provider failure keeps its reservation; one reservation per attempt ──
  {
    let x = await run({ provider: async () => ({ ok: false, error: 'resend 500' }) })
    ok('provider failure: failed, exactly one reservation and one provider call, nothing given back', !x.r.ok && x.r.reason === 'failed' && x.rpcs.length === 1 && x.sends.length === 1 && x.log.filter((l) => l.startsWith('rpc:')).every((l) => l.includes('reserve_gallery_email_send')))
    x = await run({ provider: async () => { throw new Error('socket') } })
    ok('provider throws: failed, no exception escapes, one reservation', !x.r.ok && x.r.reason === 'failed' && x.rpcs.length === 1)

    // No success is reused: five sends to one client the database allows are
    // five reservations, each answered and compared on its own.
    const w = world()
    let sends = 0
    let rpcs = 0
    let charged = true
    for (let i = 0; i < 5; i++) {
      const y = await run({ w })
      sends += y.sends.length
      rpcs += y.rpcs.length
      charged &&= sentIsCharged(y)
    }
    ok('no in-memory limit and no reuse: five reserved attempts → five reservations, five sends, each to its charged recipient', sends === 5 && rpcs === 5 && charged, `${sends}/${rpcs}`)
  }

  // ── concurrent semantics, against a fake that counts like the function ───
  // (the real serialisation is proved against Postgres by the DB suites)
  {
    const limiter = () => {
      const byRecipient = new Map<string, number>()
      let site = 0
      return ((a, w) => {
        const c = w.clients.find((r) => r.id === a.p_client)!
        const k = dbNormalize(String(c.email))
        if (site >= 30) return { data: 'site_limited', error: null, status: 200 }
        if ((byRecipient.get(k) ?? 0) >= 3) return { data: 'recipient_limited', error: null, status: 200 }
        site++
        byRecipient.set(k, (byRecipient.get(k) ?? 0) + 1)
        return charge(a, w)
      }) as RpcImpl
    }
    let rpc = limiter()
    let w = world()
    let xs = await Promise.all(Array.from({ length: 10 }, () => run({ w, rpc })))
    ok('concurrent: ten at once to one client → exactly three sent, seven rate_limited', xs.filter((x) => x.r.ok).length === 3 && xs.filter((x) => !x.r.ok && x.r.reason === 'rate_limited').length === 7 && xs.reduce((n, x) => n + x.sends.length, 0) === 3)
    ok('concurrent: every send went to its own charged recipient', xs.every((x) => sentIsCharged(x)))

    rpc = limiter()
    w = world()
    for (let i = 0; i < 45; i++) {
      w.clients.push({ id: `c-${i}`, tenant_id: T, name: `n${i}`, email: `p${i}@example.com`, access_token: `t${i}` })
      w.album_clients.push({ album_id: AL, client_id: `c-${i}` })
    }
    xs = await Promise.all(Array.from({ length: 45 }, (_, i) => run({ w, rpc, client: `c-${i}` })))
    ok('concurrent: 45 at once to 45 clients → exactly 30 sent; every send had its own reservation and its own recipient', xs.filter((x) => x.r.ok).length === 30 && xs.every((x) => x.rpcs.length === 1 && x.sends.length <= 1 && sentIsCharged(x)))

    // Two at once while the address changes under the first: neither sends to an unreserved address.
    rpc = limiter()
    w = world()
    let first = true
    const racing: RpcImpl = (a, ww, s) => {
      const out = rpc(a, ww, s)
      if (first) {
        first = false
        ww.clients[0]!.email = 'new@example.com'
      }
      return out
    }
    xs = await Promise.all([run({ w, rpc: racing }), run({ w, rpc: racing })])
    ok('concurrent drift: the address replaced at the first reservation is never sent to, and nothing uncharged is sent', xs.every((x) => x.sent.every((m) => m.to !== 'Ana@Example.com') && sentIsCharged(x)), JSON.stringify(xs.map((x) => x.log)))
  }

  // ── reserveGallerySend directly ───────────────────────────────────────────
  {
    const log: Log = []
    const good = answerFor(T, 'Ana@Example.com')
    const is = async (n: string, rpc: RpcImpl | null, want: string, digest?: string) => {
      const got = await SEND.reserveGallerySend(fakeDb(world(), log, rpc) as never, { tenantId: T, albumId: AL, clientId: C1 }, 100)
      const g = got as { status: string; digest?: string }
      ok(`reserveGallerySend: ${n} → ${want}`, g.status === want && g.digest === digest, JSON.stringify(got))
    }
    await is('reserved:<digest>', reply(good), 'reserved', good.slice('reserved:'.length))
    await is('bare reserved (old format)', reply('reserved'), 'failed')
    await is('reserved: + upper-case hex', reply(good.toUpperCase().replace('RESERVED:', 'reserved:')), 'failed')
    await is('site_limited', reply('site_limited'), 'limited')
    await is('recipient_limited', reply('recipient_limited'), 'limited')
    await is('error', () => ({ data: null, error: { message: 'x' } }), 'failed')
    await is('no rpc', null, 'failed')
    await is('never answers', () => new Promise(() => {}), 'failed')
  }

  // ── the recipient rules mirror the SQL ───────────────────────────────────
  ok('normalizeRecipient: lower(btrim()) — spaces only, as btrim does', EM.normalizeRecipient('  Ana@Example.COM ') === 'ana@example.com' && EM.normalizeRecipient('\tA@b.c') === '\ta@b.c' && EM.normalizeRecipient(null) === '')
  ok('recipientDigest: SHA-256 of "<site id>:<lower(btrim(email))>", lowercase hex — computed independently here', SEND.recipientDigest(T, ' Ana@Example.COM ') === digestOf(T, 'Ana@Example.COM') && /^[0-9a-f]{64}$/.test(SEND.recipientDigest(T, 'a@b.co') ?? ''))
  ok('recipientDigest: refuses what it cannot reproduce (non-ASCII — including the Kelvin sign JavaScript folds to "k" — a tab, a non-canonical site id)', SEND.recipientDigest(T, 'ána@x.co') === null && SEND.recipientDigest(T, 'Kate@x.co') === null &&SEND.recipientDigest(T, '\ta@b.co') === null && SEND.recipientDigest('nope', 'a@b.co') === null)
  ok('canonicalTenantId: hyphenated hex, lower-cased; anything else null', EM.canonicalTenantId(T.toUpperCase()) === T && EM.canonicalTenantId(`{${T}}`) === null && EM.canonicalTenantId(T.replace(/-/g, '')) === null && EM.canonicalTenantId(42) === null)
  ok('reservationDigest: exactly reserved:<64 lowercase hex>', EM.reservationDigest(`reserved:${'a'.repeat(64)}`) === 'a'.repeat(64) && EM.reservationDigest('reserved') === null && EM.reservationDigest(`reserved:${'a'.repeat(64)}\n`) === null && EM.reservationDigest(`reserved:${'A'.repeat(64)}`) === null)
  ok('the mirrored limits are 30 per site and 3 per recipient per hour', JSON.stringify(EM.GALLERY_EMAIL_LIMITS.map((l) => [l.key, l.max, l.windowMs])) === JSON.stringify([['tenant', 30, 3600000], ['recipient', 3, 3600000]]))

  return { pass, fail }
}

// ── static wiring: the real source, read as text ────────────────────────────
function staticChecks(): { pass: number; fail: string[] } {
  let pass = 0
  const fail: string[] = []
  const ok = (n: string, good: boolean) => (good ? pass++ : fail.push(n))
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const action = strip(readFileSync(join(ROOT, 'app/actions/gallery-email.ts'), 'utf8'))
  const send = strip(readFileSync(SEND_FILE, 'utf8'))
  ok('action: requireEditor() runs first, before any client is made', action.indexOf('await requireEditor()') >= 0 && action.indexOf('await requireEditor()') < action.indexOf('await createClient()'))
  ok('action: the editor’s cookie client (lib/supabase/server) is the db', /import \{ createClient \} from '@\/lib\/supabase\/server'/.test(action) && /db: supabase as unknown as SendDb/.test(action))
  ok('action: no service-role client, no admin import, no service key', !/supabase\/admin|createAdminClient|SERVICE_ROLE|service_role/i.test(action))
  ok('send: no service-role client and no admin import', !/supabase\/admin|createAdminClient|SERVICE_ROLE/i.test(send))
  ok('send: no in-memory limiter is used', !/createRateLimiter|new Map\(/.test(send))
  ok('send: exactly one reserve_gallery_email_send call site', (send.match(/reserve_gallery_email_send/g) ?? []).length === 1 && (send.match(/reserveGallerySend\(/g) ?? []).length === 2)
  ok('send: exactly one rpc call of any kind (no refund, no release)', (send.match(/\.rpc\(/g) ?? []).length === 1)
  ok('send: exactly one provider call site', (send.match(/deps\.send\(/g) ?? []).length === 1)
  ok('send: the digest is computed from `to`, and `to` is what the provider receives', /recipientDigest\(tenantId, to\)/.test(send) && /deps\.send\(\{\s*to,/.test(send))
  return { pass, fail }
}

const MUTANTS: Array<{ name: string; from: string; to: string }> = [
  { name: 'accept any non-null answer as a digest', from: 'const digest = reservationDigest(reply.data)', to: 'const digest = reply.data == null ? null : String(reply.data)' },
  { name: 'ignore the rpc error', from: "if (reply.error != null) return failed", to: '' },
  { name: 'ignore the status', from: "if (typeof reply.status === 'number' && reply.status !== 200) return failed", to: '' },
  { name: 'send without a reservation', from: "if (reservation.status !== 'reserved') return NOT_RESERVED", to: '' },
  { name: 'no digest comparison', from: 'if (reservation.digest !== expected) return DRIFTED', to: '' },
  { name: 'retry the reservation on a digest mismatch', from: 'if (reservation.digest !== expected) return DRIFTED', to: "if (reservation.digest !== expected && (await reserveGallerySend(db, { tenantId, albumId, clientId }, deps.reserveTimeoutMs)).status !== 'reserved') return DRIFTED" },
  { name: 'hash without lower()', from: 'const text = recipientBindingText(tenantId, recipient)', to: 'const text = recipientBindingText(tenantId, recipient) && `${tenantId}:${recipient}`' },
  { name: 'hash the site id as given, not canonical', from: 'const text = recipientBindingText(tenantId, recipient)', to: 'const text = recipientBindingText(tenantId, recipient) && `${tenantId}:${recipient.toLowerCase()}`' },
  { name: 'skip the unsupported-address refusal', from: 'if (!expected) return BAD_ADDRESS', to: '' },
  { name: 'skip the canonical site id refusal', from: 'if (!canonicalTenantId(tenantId)) return NOT_RESERVED', to: '' },
  { name: 'no drift refusal', from: 'if (after.email !== before.email || after.token !== before.token) return DRIFTED', to: '' },
  { name: 'compare only the token', from: 'after.email !== before.email || ', to: '' },
  { name: 'no re-read after reservation', from: 'const after = await readBinding()', to: 'const after = before' },
  { name: 'retry the reservation on failure', from: "if (reservation.status !== 'reserved') return NOT_RESERVED", to: "if (reservation.status !== 'reserved' && (await reserveGallerySend(db, { tenantId, albumId, clientId }, deps.reserveTimeoutMs)).status !== 'reserved') return NOT_RESERVED" },
  { name: 'reserve before the configuration check', from: '  const before = await readBinding()\n  if (!before) return NOT_FOUND', to: '  const before = await readBinding()\n  if (!before) return NOT_FOUND\n  await reserveGallerySend(db, { tenantId, albumId, clientId }, 10)' },
  { name: 'timeout counts as reserved', from: "if (reply === 'timeout' || !reply", to: "if (reply === 'timeout') return { status: 'reserved', digest: '' }\n    if (!reply" },
]

async function main() {
  const mutations = process.argv.includes('--mutations')
  const st = staticChecks()
  const base = await checks(await build('baseline'))
  const pass = st.pass + base.pass
  const fail = [...st.fail, ...base.fail]
  console.log(`gallery-email-send-limit: ${pass} passed, ${fail.length} failed`)
  for (const f of fail) console.log(`  FAIL ${f}`)
  if (fail.length) process.exit(1)
  if (!mutations) return

  let caught = 0
  const missed: string[] = []
  for (const m of MUTANTS) {
    const r = await checks(await build(`m-${caught + missed.length}`, (src) => src.replace(m.from, m.to)))
    if (r.fail.length > 0) {
      caught++
      console.log(`  caught  ${m.name}: ${r.fail[0]!.split('\n')[0]}`)
    } else missed.push(m.name)
  }
  console.log(`mutations: ${caught} of ${MUTANTS.length} caught`)
  for (const m of missed) console.log(`  MISSED ${m}`)
  if (missed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
