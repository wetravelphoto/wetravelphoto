import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * THE DEVELOPMENT TENANT STAND-IN (DEV_TENANT_HOST) — no database, no network,
 * no secret, no .env file.
 *
 *   node node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs .mk/dev-tenant.ts [--mutations]
 *
 * The real lib/tenant.ts and lib/auth.ts, bundled by esbuild three ways:
 *
 *   dev    — `process.env.NODE_ENV` and `process.env.__NEXT_DEV_SERVER`
 *            replaced with the constants `next dev` gives them;
 *   build  — replaced with the constants every `next build` gives them
 *            (production AND preview deployments are both `next build`);
 *   raw    — not replaced, so each run-time guard can be tested on its own.
 *
 * Both replacement sets are checked against node_modules/next's own
 * define-env.js first, so the simulation cannot drift from the Next in use.
 * In `build`, the run-time environment is then set as maliciously as possible
 * (NODE_ENV=development, __NEXT_DEV_SERVER=1, DEV_TENANT_HOST, no VERCEL) and
 * the stand-in must still be ignored.
 *
 * The fake database filters by the filters the code sends and logs every call,
 * so "no oldest-site guess" and "looked up by that host" are read from the
 * call log. Every id and host is SYNTHETIC.
 *
 * `--mutations` copies the two source files into ignored scratch under
 * .ai-handoff/, breaks one guard at a time and requires the named check to
 * fail against the copy. The real tree is never edited.
 */

const ROOT = resolve(__dirname, '..')
const req = createRequire(join(ROOT, 'package.json'))

const OLD = '00000000-0000-4000-8000-0000000000a1' // the oldest site
const KARLA = '00000000-0000-4000-8000-0000000000b2'
const OTHER = '00000000-0000-4000-8000-0000000000c3'
const KARLA_HOST = 'karlamata.lensgrid.co'
const ENV_KEYS = [
  'NODE_ENV', '__NEXT_DEV_SERVER', 'DEV_TENANT_HOST', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL',
  'GALLERY_PREVIEW_TENANT_ID', 'NEXT_PUBLIC_SITE_URL', 'DEV_HOSTS',
] as const
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>

const DEV_DEFINE = { 'process.env.NODE_ENV': '"development"', 'process.env.__NEXT_DEV_SERVER': '"1"' }
const BUILD_DEFINE = { 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_DEV_SERVER': '""' }

type Row = Record<string, unknown>
type Call = { table: string; filters: Array<[string, unknown]>; ordered: boolean }
type Scope = {
  host: string | null
  headerReads: string[]
  calls: Call[]
  failTables: Set<string>
  marked: unknown[]
  user: { id: string } | null
}

const world = (): Record<string, Row[]> => ({
  tenants: [
    { id: OTHER, created_at: '2022-01-01' },
    { id: OLD, created_at: '2020-01-01' },
    { id: KARLA, created_at: '2021-01-01' },
  ],
  tenant_domains: [
    { tenant_id: KARLA, host: KARLA_HOST, is_primary: true },
    { tenant_id: OTHER, host: 'gon.lensgrid.co', is_primary: true },
    { tenant_id: OLD, host: 'wetravelphoto.com', is_primary: true },
  ],
  profiles: [
    { id: 'u-karla', tenant_id: KARLA, role: 'owner', is_platform_admin: false },
    { id: 'u-gon', tenant_id: OTHER, role: 'owner', is_platform_admin: false },
    { id: 'u-admin', tenant_id: OLD, role: 'owner', is_platform_admin: true },
  ],
})

function fakeDb(s: Scope) {
  const tables = world()
  return {
    auth: { getUser: async () => ({ data: { user: s.user } }) },
    from(table: string) {
      const call: Call = { table, filters: [], ordered: false }
      s.calls.push(call)
      let lim = Infinity
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (call.filters.push([c, v]), q),
        order: (c: string) => {
          call.ordered = true
          tables[table] = [...(tables[table] ?? [])].sort((a, b) => String(a[c]).localeCompare(String(b[c])))
          return q
        },
        limit: (n: number) => ((lim = n), q),
        maybeSingle: async () => {
          if (s.failTables.has(table)) return { data: null, error: { message: 'boom' } }
          const rows = (tables[table] ?? []).filter((r) => call.filters.every(([c, v]) => r[c] === v)).slice(0, lim)
          if (rows.length > 1) return { data: null, error: { message: 'more than one row' } }
          return { data: rows[0] ?? null, error: null }
        },
      }
      return q
    },
  }
}

const STUBS: Record<string, string> = {
  'server-only': '',
  react: 'exports.cache = (f) => f',
  'next/headers': `
    exports.headers = async () => ({ get: (n) => { globalThis.__dt.headerReads.push(n.toLowerCase()); return n.toLowerCase() === 'host' ? globalThis.__dt.host : 'forged-' + n } })`,
  '@/lib/supabase/server': 'exports.createClient = async () => globalThis.__dt.db()',
  '@/lib/observability-server': 'exports.markSite = (s) => { globalThis.__dt.marked.push(s) }',
}

async function bundle(src: string, entry: string, out: string, define: Record<string, string>) {
  const esbuild = req(join(ROOT, 'node_modules/.p4-runtime/node_modules/esbuild')) as typeof import('esbuild')
  const names = Object.keys(STUBS).map((k) => k.replace(/[/.@-]/g, (c) => '\\' + c))
  await esbuild.build({
    entryPoints: [join(src, entry)], bundle: true, platform: 'node', format: 'cjs', outfile: out,
    packages: 'external', logLevel: 'silent', tsconfig: join(ROOT, 'tsconfig.json'), define,
    plugins: [{ name: 'stubs', setup(b) {
      // lib/auth.ts imports '@/lib/tenant': the copy under test, never the real tree's.
      b.onResolve({ filter: /^@\/lib\/tenant$/ }, () => ({ path: join(src, 'lib/tenant.ts') }))
      b.onResolve({ filter: new RegExp(`^(${names.join('|')})$`) }, (a) => ({ path: a.path, namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path] ?? '', loader: 'js' }))
    } }],
  })
  delete req.cache[req.resolve(out)]
  return { mod: req(out) }
}

type Result = { pass: number; fail: string[] }

async function suite(src: string, tag: string): Promise<Result> {
  let pass = 0
  const fail: string[] = []
  const ok = (n: string, good: boolean, d = '') => (good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`))
  const is = (n: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got)
    const w = JSON.stringify(want)
    ok(n, g === w, g === w ? '' : `got ${g}\n    wanted ${w}`)
  }

  // ── 0. the simulation is Next's own ───────────────────────────────────────
  const defineEnv = readFileSync(join(ROOT, 'node_modules/next/dist/build/define-env.js'), 'utf8')
  ok("Next's define-env replaces NODE_ENV with 'development' only for dev (or allowDevelopmentBuild)",
    defineEnv.includes("'process.env.NODE_ENV': dev || config.experimental.allowDevelopmentBuild ? 'development' : 'production'"))
  ok("Next's define-env replaces __NEXT_DEV_SERVER with '1' only for dev", defineEnv.includes("'process.env.__NEXT_DEV_SERVER': dev ? '1' : ''"))
  const configs = readdirSync(ROOT).filter((f) => /^next\.config\./.test(f))
  ok('a next.config exists and none sets allowDevelopmentBuild',
    configs.length > 0 && configs.every((f) => !readFileSync(join(ROOT, f), 'utf8').includes('allowDevelopmentBuild')), JSON.stringify(configs))

  const dir = join(ROOT, 'node_modules/.cache/dev-tenant', tag)
  mkdirSync(dir, { recursive: true })
  type T = typeof import('../lib/tenant')
  type A = typeof import('../lib/auth')
  const builds = {
    dev: (await bundle(src, 'lib/tenant.ts', join(dir, 'tenant-dev.cjs'), DEV_DEFINE)),
    build: (await bundle(src, 'lib/tenant.ts', join(dir, 'tenant-build.cjs'), BUILD_DEFINE)),
    raw: (await bundle(src, 'lib/tenant.ts', join(dir, 'tenant-raw.cjs'), {})),
  }
  const auth = {
    dev: (await bundle(src, 'lib/auth.ts', join(dir, 'auth-dev.cjs'), DEV_DEFINE)).mod as A,
    build: (await bundle(src, 'lib/auth.ts', join(dir, 'auth-build.cjs'), BUILD_DEFINE)).mod as A,
  }

  // NODE_ENV is typed read-only; this suite sets it on purpose.
  const penv = process.env as Record<string, string | undefined>
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, penv[k]]))
  const setEnv = (e: Env) => {
    for (const k of ENV_KEYS) delete penv[k]
    for (const [k, v] of Object.entries(e)) if (v !== undefined) penv[k] = v
  }
  const fresh = (host: string | null, failTables: string[] = [], user: Scope['user'] = null): Scope => {
    const s: Scope = { host, headerReads: [], calls: [], failTables: new Set(failTables), marked: [], user }
    ;(globalThis as Record<string, unknown>).__dt = Object.assign(s, { db: () => fakeDb(s) })
    return s
  }
  const resolveIn = async (which: keyof typeof builds, host: string | null, env: Env, failTables: string[] = []) => {
    setEnv(env)
    const s = fresh(host, failTables)
    const site = await (builds[which].mod as T).currentSite()
    return { site, s }
  }
  const touchedOldest = (s: Scope) => s.calls.some((c) => c.table === 'tenants' && c.ordered)
  const domainLookups = (s: Scope) => s.calls.filter((c) => c.table === 'tenant_domains' && c.filters[0]?.[0] === 'host').map((c) => c.filters[0][1])
  const allHeaderReads = new Set<string>()
  const site = (tenantId: string, host: string, primaryHost: string, assumed: boolean) => ({ tenantId, host, primaryHost, assumed })
  const oldestOn = (host: string) => site(OLD, host, 'wetravelphoto.com', true)
  const karlaOn = (host: string) => site(KARLA, host, KARLA_HOST, false)
  // What a developer's machine looks like: the setting, nothing from Vercel.
  const DEV: Env = { DEV_TENANT_HOST: KARLA_HOST }
  // Run time as hostile as it gets for a compiled build.
  const HOSTILE: Env = { NODE_ENV: 'development', __NEXT_DEV_SERVER: '1', DEV_TENANT_HOST: KARLA_HOST }

  try {
    // ── 1. development maps the requested registered domain ─────────────────
    for (const [which, env] of [['dev', DEV], ['raw', HOSTILE]] as const) {
      for (const [raw, host] of [['localhost:3000', 'localhost'], ['127.0.0.1:3000', '127.0.0.1'], ['[::1]:3000', '::1'], ['LOCALHOST', 'localhost']] as const) {
        const { site: got, s } = await resolveIn(which, raw, env)
        s.headerReads.forEach((h) => allHeaderReads.add(h))
        is(`${which} ${raw}: the site DEV_TENANT_HOST is registered to, not assumed`, got, karlaOn(host))
        is(`${which} ${raw}: looked up in tenant_domains by the request host, then by DEV_TENANT_HOST`, domainLookups(s), [host, KARLA_HOST])
        ok(`${which} ${raw}: the oldest-site guess is never consulted`, !touchedOldest(s))
        is(`${which} ${raw}: errors are tagged with the resolved site`, s.marked, [got])
      }
    }
    {
      const { site: got } = await resolveIn('dev', 'localhost', { DEV_TENANT_HOST: 'gon.lensgrid.co' })
      is('dev: another registered domain maps to its own site', got, site(OTHER, 'localhost', 'gon.lensgrid.co', false))
    }

    // ── 2. unknown, malformed or unreadable: nothing, never the oldest ──────
    for (const [name, value] of [
      ['an unregistered domain', 'unknown.lensgrid.co'],
      ['a registered domain’s parent', 'lensgrid.co'],
    ] as const) {
      const { site: got, s } = await resolveIn('dev', 'localhost', { DEV_TENANT_HOST: value })
      is(`dev, ${name}: nothing`, got, null)
      is(`dev, ${name}: looked up by that exact host`, domainLookups(s), ['localhost', value])
      ok(`dev, ${name}: no oldest-site guess`, !touchedOldest(s))
      is(`dev, ${name}: errors tagged with no site`, s.marked, [null])
    }
    for (const [name, value] of [
      ['upper-case', 'KarlaMata.lensgrid.co'],
      ['surrounded by spaces', ` ${KARLA_HOST} `],
      ['with a port', `${KARLA_HOST}:443`],
      ['with a scheme', `https://${KARLA_HOST}`],
      ['with a path', `${KARLA_HOST}/`],
      ['with a trailing dot', `${KARLA_HOST}.`],
      ['two hosts', `${KARLA_HOST},gon.lensgrid.co`],
      ['localhost itself', 'localhost'],
      ['an IP address', '127.0.0.1'],
      ['a tenant id', KARLA],
      ['a wildcard', '*.lensgrid.co'],
      ['a SQL-ish string', "x' or '1'='1"],
    ] as const) {
      const { site: got, s } = await resolveIn('dev', 'localhost', { DEV_TENANT_HOST: value })
      is(`dev, setting ${name}: nothing (fail closed)`, got, null)
      is(`dev, setting ${name}: never used as a lookup key`, domainLookups(s), ['localhost'])
      ok(`dev, setting ${name}: no oldest-site guess`, !touchedOldest(s))
    }
    {
      const { site: got, s } = await resolveIn('dev', 'localhost', DEV, ['tenant_domains'])
      is('dev, tenant_domains unreadable: nothing', got, null)
      ok('dev, tenant_domains unreadable: no oldest-site guess', !touchedOldest(s))
    }

    // ── 3. only a loopback request; everything else exactly as before ───────
    for (const [host, want] of [
      ['app.localhost', oldestOn('app.localhost')],
      ['localhost.lensgrid.co', null],
      ['stranger.example', null],
      ['wtp-x.vercel.app', oldestOn('wtp-x.vercel.app')],
      ['gon.lensgrid.co', site(OTHER, 'gon.lensgrid.co', 'gon.lensgrid.co', false)],
      [KARLA_HOST, karlaOn(KARLA_HOST)],
      ['127.0.0.2', null],
      ['0.0.0.0', null],
    ] as const) {
      const { site: got, s } = await resolveIn('dev', host, DEV)
      s.headerReads.forEach((h) => allHeaderReads.add(h))
      is(`dev, non-loopback ${host}: as before, the setting ignored`, got, want)
      ok(`dev, non-loopback ${host}: DEV_TENANT_HOST is not looked up`, !domainLookups(s).includes(KARLA_HOST) || host === KARLA_HOST)
    }
    {
      const { site: got } = await resolveIn('dev', null, DEV)
      is('dev, no Host: nothing', got, null)
    }
    for (const [name, env] of [['unset', {}], ['empty', { DEV_TENANT_HOST: '' }]] as const) {
      const { site: got, s } = await resolveIn('dev', 'localhost', env)
      is(`dev, setting ${name}: localhost gets the oldest site as before`, got, oldestOn('localhost'))
      ok(`dev, setting ${name}: by the oldest-site query`, touchedOldest(s))
    }

    // ── 4. a compiled build ignores it, whatever the run time says ──────────
    for (const [label, env] of [
      ['hostile run time', HOSTILE],
      ['hostile run time, VERCEL_ENV production', { ...HOSTILE, VERCEL: '1', VERCEL_ENV: 'production' }],
      ['hostile run time, no VERCEL', { ...HOSTILE }],
    ] as const) {
      // The raw Host header and the host it normalises to: an IPv6 literal
      // arrives bracketed in HTTP ([::1]), as in section 1.
      for (const [raw, host] of [['localhost', 'localhost'], ['127.0.0.1', '127.0.0.1'], ['[::1]', '::1']] as const) {
        const { site: got, s } = await resolveIn('build', raw, env)
        is(`build (${label}) ${raw}: DEV_TENANT_HOST ignored — the oldest site, as before`, got, oldestOn(host))
        ok(`build (${label}) ${raw}: DEV_TENANT_HOST never looked up`, !domainLookups(s).includes(KARLA_HOST))
      }
    }
    {
      // A preview build: previewSite() as before, the setting nowhere.
      const PREVIEW = { ...HOSTILE, VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'wtp-abc-team.vercel.app', GALLERY_PREVIEW_TENANT_ID: OTHER }
      const { site: got, s } = await resolveIn('build', 'localhost', PREVIEW)
      is('build (preview) localhost: nothing, as before', got, null)
      ok('build (preview) localhost: DEV_TENANT_HOST never looked up', !domainLookups(s).includes(KARLA_HOST))
      const { site: own } = await resolveIn('build', 'wtp-abc-team.vercel.app', PREVIEW)
      is('build (preview) its own address: the configured preview site, as before', own, site(OTHER, 'wtp-abc-team.vercel.app', 'gon.lensgrid.co', false))
    }

    // ── 5. each run-time guard on its own (uncompiled source) ───────────────
    for (const [name, env] of [
      ['NODE_ENV production', { ...HOSTILE, NODE_ENV: 'production' }],
      ['NODE_ENV test', { ...HOSTILE, NODE_ENV: 'test' }],
      ['NODE_ENV unset', { ...HOSTILE, NODE_ENV: undefined }],
      ['not the dev server', { ...HOSTILE, __NEXT_DEV_SERVER: undefined }],
      ['dev server flag not exactly 1', { ...HOSTILE, __NEXT_DEV_SERVER: 'true' }],
      ['on Vercel (VERCEL=1)', { ...HOSTILE, VERCEL: '1' }],
      ['VERCEL_ENV development', { ...HOSTILE, VERCEL_ENV: 'development' }],
      ['VERCEL_ENV production', { ...HOSTILE, VERCEL_ENV: 'production' }],
    ] as const) {
      const { site: got, s } = await resolveIn('raw', 'localhost', env)
      is(`raw, ${name}: ignored — the oldest site, as before`, got, oldestOn('localhost'))
      ok(`raw, ${name}: DEV_TENANT_HOST never looked up`, !domainLookups(s).includes(KARLA_HOST))
    }
    {
      const { site: got, s } = await resolveIn('raw', 'localhost', { ...HOSTILE, VERCEL_ENV: 'preview' })
      is('raw, VERCEL_ENV preview: the preview rule, not the stand-in (nothing)', got, null)
      ok('raw, VERCEL_ENV preview: DEV_TENANT_HOST never looked up', !domainLookups(s).includes(KARLA_HOST))
    }

    // ── 6. nothing but Host chooses ─────────────────────────────────────────
    is('only the Host header is ever read', [...allHeaderReads].sort(), ['host'])

    // ── 7. authorization: localhost behaves as the registered address ───────
    const editorIn = async (which: keyof typeof auth, host: string, env: Env, userId: string) => {
      setEnv(env)
      fresh(host, [], { id: userId })
      try {
        const e = await auth[which].requireEditor()
        return { tenantId: e.tenantId, supporting: e.supporting }
      } catch (err) {
        return { refused: (err as Error).message.startsWith('This is not your site') }
      }
    }
    is("dev: Karla's own account edits Karla's site on localhost", await editorIn('dev', 'localhost', DEV, 'u-karla'), { tenantId: KARLA, supporting: null })
    is("dev: another photographer is refused on localhost, as on Karla's address", await editorIn('dev', 'localhost', DEV, 'u-gon'), { refused: true })
    is("…and on Karla's real address", await editorIn('dev', KARLA_HOST, DEV, 'u-gon'), { refused: true })
    is("dev: a platform admin supports Karla's site on localhost", await editorIn('dev', 'localhost', DEV, 'u-admin'),
      { tenantId: KARLA, supporting: { tenantId: KARLA, host: 'localhost' } })
    is('dev, unknown DEV_TENANT_HOST: an editor keeps their own site (no site resolved, nothing redirected)',
      await editorIn('dev', 'localhost', { DEV_TENANT_HOST: 'unknown.lensgrid.co' }, 'u-admin'), { tenantId: OLD, supporting: null })
    is('build, hostile run time: localhost authorization exactly as before (assumed, own site)',
      await editorIn('build', 'localhost', HOSTILE, 'u-gon'), { tenantId: OTHER, supporting: null })
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete penv[k]
      else penv[k] = saved[k]
    }
  }

  return { pass, fail }
}

type Mutant = { id: string; find: string; replace: string; expect: string }
const STAND_IN_CALL = '    const site = standIn ? await registeredSite(standIn, host, supabase) : null\n    markSite(site)\n    return site\n'
const MUTANTS: Mutant[] = [
  { id: 'no-node-env', find: "  if (process.env.NODE_ENV !== 'development') return undefined\n", replace: '', expect: 'raw, NODE_ENV production: ignored — the oldest site, as before' },
  { id: 'no-dev-server', find: "  if (process.env.__NEXT_DEV_SERVER !== '1') return undefined\n", replace: '', expect: 'raw, not the dev server: ignored — the oldest site, as before' },
  { id: 'runtime-only', find: "  if (process.env.NODE_ENV !== 'development') return undefined\n  if (process.env.__NEXT_DEV_SERVER !== '1') return undefined\n", replace: "  const env = process.env\n  if (env.NODE_ENV !== 'development') return undefined\n  if (env.__NEXT_DEV_SERVER !== '1') return undefined\n", expect: 'build (hostile run time, no VERCEL) localhost: DEV_TENANT_HOST ignored — the oldest site, as before' },
  { id: 'no-vercel', find: '  if (process.env.VERCEL || process.env.VERCEL_ENV) return undefined\n', replace: '', expect: 'raw, on Vercel (VERCEL=1): ignored — the oldest site, as before' },
  { id: 'no-loopback', find: '  if (!LOOPBACK.has(host)) return undefined\n', replace: '', expect: 'dev, non-loopback stranger.example: as before, the setting ignored' },
  { id: 'loopback-suffix', find: '  if (!LOOPBACK.has(host)) return undefined\n', replace: "  if (!host.endsWith('localhost') && !LOOPBACK.has(host)) return undefined\n", expect: 'dev, non-loopback app.localhost: as before, the setting ignored' },
  { id: 'invalid-falls-back', find: 'return HOSTNAME.test(wanted) ? wanted : null', replace: 'return HOSTNAME.test(wanted) ? wanted : undefined', expect: 'dev, setting upper-case: nothing (fail closed)' },
  { id: 'no-validation', find: 'return HOSTNAME.test(wanted) ? wanted : null', replace: 'return wanted.trim().toLowerCase()', expect: 'dev, setting upper-case: nothing (fail closed)' },
  { id: 'unmapped-falls-through', find: STAND_IN_CALL, replace: '    const site = standIn ? await registeredSite(standIn, host, supabase) : null\n    if (site) { markSite(site); return site }\n', expect: 'dev, an unregistered domain: nothing' },
  { id: 'lookup-request-host', find: "    .eq('host', lookupHost)\n", replace: "    .eq('host', requestHost)\n", expect: 'dev localhost:3000: the site DEV_TENANT_HOST is registered to, not assumed' },
  { id: 'stand-in-assumed', find: "    primaryHost: (await primaryHostFor(tenantId)) ?? lookupHost,\n    assumed: false,", replace: "    primaryHost: (await primaryHostFor(tenantId)) ?? lookupHost,\n    assumed: true,", expect: "dev: another photographer is refused on localhost, as on Karla's address" },
]

async function main() {
  const base = await suite(ROOT, 'real')
  console.log(`dev-tenant: ${base.pass} passed, ${base.fail.length} failed`)
  for (const f of base.fail) console.log(`  FAIL ${f}`)
  if (base.fail.length) process.exit(1)
  if (!process.argv.includes('--mutations')) return

  const files = ['lib/tenant.ts', 'lib/auth.ts']
  const before = Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]))
  const scratch = join(ROOT, '.ai-handoff/dev-tenant-mutants')
  rmSync(scratch, { recursive: true, force: true })
  let caught = 0
  const missed: string[] = []
  for (const m of MUTANTS) {
    const copy = join(scratch, m.id)
    for (const f of files) {
      mkdirSync(dirname(join(copy, f)), { recursive: true })
      cpSync(join(ROOT, f), join(copy, f))
    }
    const src = before['lib/tenant.ts'].replace(/\r\n/g, '\n')
    const out = src.replace(m.find, m.replace)
    if (out === src) { missed.push(`${m.id}: the mutation did not apply`); continue }
    writeFileSync(join(copy, 'lib/tenant.ts'), out)
    const r = await suite(copy, `mut-${m.id}`)
    if (r.fail.some((f) => f.split('\n')[0] === m.expect)) caught++
    else missed.push(`${m.id}: expected "${m.expect}" to fail; failures were ${JSON.stringify(r.fail.map((f) => f.split('\n')[0]))}`)
  }
  const unchanged = Object.entries(before).every(([f, t]) => readFileSync(join(ROOT, f), 'utf8') === t)
  console.log(`mutations: ${caught} of ${MUTANTS.length} caught by their named check; real tree unchanged: ${unchanged}`)
  for (const m of missed) console.log(`  MISSED ${m}`)
  if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true })
  if (missed.length || !unchanged) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
