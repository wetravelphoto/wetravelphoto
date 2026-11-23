import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import { bundleDir } from './picker-editor-fakes'

/**
 * THE CLIENTS PAGE'S SHARE / UNSHARE STAY ON THE EDITOR'S SITE
 * ════════════════════════════════════════════════════════════
 *
 * The REAL server actions `shareAlbumWithClient` and `unshareAlbumWithClient`
 * (`app/actions/clients.ts`), bundled by esbuild with only their boundaries
 * replaced: the session, the database client and the cache.
 *
 * The fake database applies ONLY the filters the code writes — it answers as
 * a platform admin is answered (RLS passes everything) — so a missing tenant
 * predicate shows as a cross-site share or unshare rather than being hidden by
 * a policy. Each refusal is attributed to the layer that made it: the album
 * read or the client read, both naming the editor's site, and no write after.
 *
 * Then the same checks run against in-memory mutants of the action's source
 * (the real file is only read, never written); each must fail.
 *
 * Run: node node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs .mk/legacy-share-scoping.ts
 */

type Row = Record<string, unknown>
type Call = { table: string; op: string; filters: Array<[string, unknown]> }

class FakeDb {
  rows: Row[] = []
  calls: Call[] = []
  from(table: string) {
    return new Query(this, table)
  }
}

class Query {
  private op = 'select'
  private filters: Array<[string, unknown]> = []
  private row: Row | null = null
  constructor(private db: FakeDb, private table: string) {}
  select() {
    if (this.op !== 'insert') this.op = 'select'
    return this
  }
  insert(row: Row) {
    this.op = 'insert'
    this.row = row
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }
  private matching() {
    return this.db.rows.filter((r) => r.__table === this.table && this.filters.every(([c, v]) => r[c] === v))
  }
  private run() {
    this.db.calls.push({ table: this.table, op: this.op, filters: [...this.filters] })
    if (this.op === 'insert') {
      const r = { __table: this.table, ...this.row }
      this.db.rows.push(r)
      return { data: r, error: null }
    }
    if (this.op === 'delete') {
      const gone = new Set(this.matching())
      this.db.rows = this.db.rows.filter((r) => !gone.has(r))
      return { data: null, error: null }
    }
    return { data: this.matching(), error: null }
  }
  async maybeSingle() {
    const r = this.run()
    const d = Array.isArray(r.data) ? r.data : r.data ? [r.data] : []
    if (d.length > 1) return { data: null, error: { message: 'more than one row' } }
    return { data: d[0] ?? null, error: r.error }
  }
  async single() {
    return this.maybeSingle()
  }
  then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
    try {
      return Promise.resolve(this.run()).then(resolve, reject)
    } catch (e) {
      return Promise.reject(e).then(resolve, reject)
    }
  }
}

const H: { db: FakeDb; editor: unknown } = { db: new FakeDb(), editor: null }
;(globalThis as Record<string, unknown>).__share = H

const SOURCE_RE = /app[\\/]actions[\\/]clients\.ts$/

type Actions = {
  shareAlbumWithClient: (albumId: string, fd: FormData) => Promise<void>
  unshareAlbumWithClient: (albumId: string, clientId: string) => Promise<void>
}

async function bundle(patch: (src: string) => string, tag: string): Promise<Actions> {
  const req = createRequire(join(process.cwd(), 'package.json'))
  const esbuild = req(join(process.cwd(), 'node_modules/.p4-runtime/node_modules/esbuild')) as typeof import('esbuild')
  const fakes: Record<string, string> = {
    '@/lib/supabase/server': 'export async function createClient(){ return globalThis.__share.db }',
    '@/lib/auth':
      'export async function requireEditor(){ const e = globalThis.__share.editor; if (!e) throw new Error("signed out"); return e }',
    'next/cache': 'export function revalidatePath(){}\nexport function revalidateTag(){}',
  }
  const outfile = join(bundleDir(), `clients-${tag}.cjs`)
  await esbuild.build({
    stdin: { contents: "export * from '@/app/actions/clients'", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    tsconfig: join(process.cwd(), 'tsconfig.json'),
    packages: 'external',
    logLevel: 'silent',
    plugins: [
      {
        name: 'boundaries',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => (args.path in fakes ? { path: args.path, namespace: 'fake' } : undefined))
          b.onLoad({ filter: /.*/, namespace: 'fake' }, (args) => ({ contents: fakes[args.path], loader: 'js' }))
          b.onLoad({ filter: SOURCE_RE }, (args) => ({
            contents: patch(readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')),
            loader: 'ts',
            resolveDir: dirname(args.path),
          }))
        },
      },
    ],
  })
  delete req.cache[req.resolve(outfile)]
  return req(outfile) as Actions
}

// ── The fixture ────────────────────────────────────────────────────────────
const A = randomUUID() // the editor's site
const B = randomUUID() // somebody else's
const albumA = randomUUID()
const albumB = randomUUID()
const clientA = randomUUID()
const clientB = randomUUID()

function seed(links: Array<[string, string]> = []) {
  H.db = new FakeDb()
  H.editor = { tenantId: A, userId: randomUUID() }
  H.db.rows = [
    { __table: 'albums', id: albumA, tenant_id: A },
    { __table: 'albums', id: albumB, tenant_id: B },
    { __table: 'clients', id: clientA, tenant_id: A, name: 'Ana', email: 'ana@example.com', access_token: 't-a' },
    { __table: 'clients', id: clientB, tenant_id: B, name: 'Bea', email: 'bea@example.com', access_token: 't-b' },
    ...links.map(([album_id, client_id]) => ({ __table: 'album_clients', album_id, client_id })),
  ]
}
const fd = (clientId: string) => {
  const f = new FormData()
  f.set('client_id', clientId)
  return f
}
const linked = (album: string, client: string) =>
  H.db.rows.some((r) => r.__table === 'album_clients' && r.album_id === album && r.client_id === client)
const writes = () => H.db.calls.filter((c) => c.table === 'album_clients')
const scopedRead = (table: string) =>
  H.db.calls.some((c) => c.table === table && c.op === 'select' && c.filters.some(([k, v]) => k === 'tenant_id' && v === A))
async function threw(p: Promise<unknown>) {
  try {
    await p
    return false
  } catch {
    return true
  }
}

async function checks(act: Actions): Promise<{ pass: number; fail: string[] }> {
  let pass = 0
  const fail: string[] = []
  const ok = (n: string, good: boolean, d = '') => (good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`))

  // ── share ──
  seed()
  ok('share: same-site album and client succeeds', !(await threw(act.shareAlbumWithClient(albumA, fd(clientA)))))
  ok('share: same-site link written', linked(albumA, clientA))
  ok('share: album read named the editor’s site', scopedRead('albums'))
  ok('share: client read named the editor’s site', scopedRead('clients'))

  seed()
  ok('share: foreign album refused', await threw(act.shareAlbumWithClient(albumB, fd(clientA))))
  ok('share: foreign album — no album_clients call at all', writes().length === 0, JSON.stringify(writes()))
  ok('share: foreign album — refused at the scoped album read', scopedRead('albums') && !H.db.calls.some((c) => c.table === 'clients'))

  seed()
  ok('share: foreign client refused', await threw(act.shareAlbumWithClient(albumA, fd(clientB))))
  ok('share: foreign client — no album_clients call at all', writes().length === 0, JSON.stringify(writes()))
  ok('share: foreign client — refused at the scoped client read', scopedRead('albums') && scopedRead('clients'))

  seed()
  ok('share: both foreign refused', await threw(act.shareAlbumWithClient(albumB, fd(clientB))))
  ok('share: both foreign — nothing linked', !linked(albumB, clientB) && writes().length === 0)

  seed()
  ok('share: empty client id is a no-op', !(await threw(act.shareAlbumWithClient(albumA, fd('')))) && H.db.calls.length === 0)

  seed()
  H.editor = null
  ok('share: signed out refused before any read', (await threw(act.shareAlbumWithClient(albumA, fd(clientA)))) && H.db.calls.length === 0)

  // ── unshare ──
  seed([[albumA, clientA]])
  ok('unshare: same-site succeeds', !(await threw(act.unshareAlbumWithClient(albumA, clientA))))
  ok('unshare: same-site link removed', !linked(albumA, clientA))
  ok('unshare: album and client reads named the editor’s site', scopedRead('albums') && scopedRead('clients'))

  seed([[albumB, clientA]])
  ok('unshare: foreign album refused', await threw(act.unshareAlbumWithClient(albumB, clientA)))
  ok('unshare: foreign album — link kept, no delete issued', linked(albumB, clientA) && writes().length === 0)

  seed([[albumA, clientB]])
  ok('unshare: foreign client refused', await threw(act.unshareAlbumWithClient(albumA, clientB)))
  ok('unshare: foreign client — link kept, no delete issued', linked(albumA, clientB) && writes().length === 0)

  seed([[albumB, clientB]])
  ok('unshare: both foreign refused', await threw(act.unshareAlbumWithClient(albumB, clientB)))
  ok('unshare: both foreign — link kept', linked(albumB, clientB) && writes().length === 0)

  seed([[albumA, clientA]])
  H.editor = null
  ok('unshare: signed out refused before any read', (await threw(act.unshareAlbumWithClient(albumA, clientA))) && H.db.calls.length === 0)

  return { pass, fail }
}

// The pre-fix bodies, restored in memory only.
const OLD_SHARE = `export async function shareAlbumWithClient(albumId: string, formData: FormData) {
  await requireEditor()
  const clientId = formData.get('client_id') as string
  if (!clientId) return
  const supabase = await createClient()
  const { error } = await supabase.from('album_clients').insert({ album_id: albumId, client_id: clientId })
  if (error && error.code !== '23505') throw new Error('The gallery could not be shared.')
}
`
const OLD_UNSHARE = `export async function unshareAlbumWithClient(albumId: string, clientId: string) {
  await requireEditor()
  const supabase = await createClient()
  const { error } = await supabase.from('album_clients').delete().eq('album_id', albumId).eq('client_id', clientId)
  if (error) throw new Error(error.message)
}
`
function replaceFn(src: string, name: string, body: string) {
  const start = src.indexOf(`export async function ${name}(`)
  if (start < 0) throw new Error(`mutant: ${name} not found`)
  const end = src.indexOf('\n}\n', start)
  if (end < 0) throw new Error(`mutant: end of ${name} not found`)
  return src.slice(0, start) + body + src.slice(end + 3)
}
function swap(src: string, from: string, to: string) {
  if (!src.includes(from)) throw new Error(`mutant: text not found: ${from}`)
  return src.replace(from, to)
}

const MUTANTS: Array<{ name: string; patch: (s: string) => string; mustFail: RegExp }> = [
  { name: 'share restored to the pre-fix unscoped insert', patch: (s) => replaceFn(s, 'shareAlbumWithClient', OLD_SHARE), mustFail: /^share: foreign/ },
  { name: 'unshare restored to the pre-fix unscoped delete', patch: (s) => replaceFn(s, 'unshareAlbumWithClient', OLD_UNSHARE), mustFail: /^unshare: foreign/ },
  {
    name: 'share result ignored',
    patch: (s) => swap(s, "{ clientId })\n  if (!result.ok) throw new Error(result.error)", '{ clientId })\n  void result'),
    mustFail: /^share: foreign .* refused$/,
  },
  {
    name: 'unshare named a site other than the editor’s',
    patch: (s) => swap(s, 'removeClientFromAlbumWith(supabase as unknown as ShareDb, tenantId,', "removeClientFromAlbumWith(supabase as unknown as ShareDb, 'not-' + tenantId,"),
    mustFail: /^unshare: same-site/,
  },
]

async function main() {
  const real = await checks(await bundle((s) => s, 'real'))
  console.log(`legacy share scoping: ${real.pass} passed, ${real.fail.length} failed`)
  for (const f of real.fail) console.log('  FAIL ' + f)

  let caught = 0
  const missed: string[] = []
  for (const [i, m] of MUTANTS.entries()) {
    const r = await checks(await bundle(m.patch, `m${i}`))
    const named = r.fail.filter((f) => m.mustFail.test(f))
    if (named.length > 0) caught++
    else missed.push(`${m.name} — failures: ${JSON.stringify(r.fail)}`)
  }
  console.log(`mutants: ${caught} of ${MUTANTS.length} caught by their named checks`)
  for (const m of missed) console.log('  MISSED ' + m)

  if (real.fail.length || missed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
