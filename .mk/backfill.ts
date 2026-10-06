import { Client } from 'pg'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import sharp from 'sharp'

import { isSamplePhoto } from '../lib/images'
import { normalizeKeywords } from '../lib/photos/exif'
import { keyBaseFor, parseLegacyKey } from '../lib/photos/legacy-key'
import {
  CLAIMS_BATCH,
  MAX_PASSES,
  backfillTenant,
  decodeImage,
  documentClaims,
  isClean,
  planTenant,
  uprightSize,
  validateInventory,
  type BackfillRpc,
  type Inventory,
  type PlanDeps,
  type TenantReport,
} from '../lib/photos/backfill'
import { STORAGE_ATTEMPTS, TooLargeError, withRetries, type BackfillStorage } from '../lib/photos/backfill-storage'
import { listAllTenants, main, parseArgs, parseManifest, runBackfill, type TenantPage } from '../lib/photos/backfill-cli'
import { rebuildUsages, type UsageRpc } from '../lib/photos/usages'
import { HANDLERS } from '../lib/jobs/handlers'
import { isPermanent, type JobContext } from '../lib/jobs/types'

/**
 * P4: EVERY PHOTOGRAPH FROM BEFORE P2 GETS ITS ASSET
 * ══════════════════════════════════════════════════
 *
 * `db/verify-photo-backfill.sql` proves the database half in one transaction,
 * and `scripts/photo-assets-fk.mjs` the foreign keys. This proves what neither
 * can:
 *
 *   1. the grammar, the manifest and the arguments, with no database;
 *   2. the source: storage is HEAD/GET only, nothing reaches the CLI from a
 *      route, nothing but P3 writes a usage, the retired job writes nothing;
 *   3. the planner over a FAKE bucket holding REAL image bytes — decoding,
 *      upright sizes, corrupt/truncated/unsupported/misnamed files, retries,
 *      ambiguity, samples, provenance, P3's legacy fallback, link checks,
 *      claim batching, stale reconciliation;
 *   4. against a real LOCAL Postgres, as service_role: dry run writes nothing;
 *      apply links every era; a rerun writes nothing; P2's rows untouched; P3's
 *      rebuild resolves them and is its own invariant; interruption before and
 *      after a commit; a stale source; TS/SQL grammar parity; two connections.
 *
 * Run through the local harness, which makes a scratch database:
 *
 *   node scripts/p4-local-db.mjs ts db/migrations/2026-10-05_photo_backfill.sql -- .mk/backfill.ts
 *
 * LOCAL ONLY: it refuses a PGHOST that is not loopback and a PGDATABASE that is
 * not a P4 scratch/local database. The database half is REQUIRED — with no
 * database the suite FAILS. `--unit-only` runs parts 1–3 alone and says so.
 */

const ROOT = resolve(__dirname, '..')
const UNIT_ONLY = process.argv.includes('--unit-only')

const TA = 'aaaaaaaa-0000-0000-0000-000000000001'
const TB = 'aaaaaaaa-0000-0000-0000-000000000002'
const AA = 'bbbbbbbb-0000-0000-0000-000000000001'
const AA2 = 'bbbbbbbb-0000-0000-0000-000000000002'
const AB = 'bbbbbbbb-0000-0000-0000-000000000003'
const POST_A = 'dddddddd-0000-0000-0000-000000000001'
const POST_RACE = 'dddddddd-0000-0000-0000-0000000000a1'
const USER_A = '11111111-1111-1111-1111-111111111111'
const u = (n: number) => `0b000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const pid = (n: number) => `cccccccc-0000-0000-0000-${n.toString(16).padStart(12, '0')}`

let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') => (good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`))
const is = (n: string, got: unknown, want: unknown) =>
  ok(n, JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got) === JSON.stringify(want) ? '' : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// ════════════════════════════════════════════════════════════════════════════
// Real image bytes, and a fake bucket
// ════════════════════════════════════════════════════════════════════════════

let JPEG: Buffer, PNG: Buffer, WEBP: Buffer, GIF: Buffer, ORIENTED: Buffer, TRUNCATED: Buffer
const GARBAGE = Buffer.from('this is not a photograph, though it has bytes')
/**
 * Tags as an old row may hold them: mixed case, padding, an empty one, control
 * characters, one far over 200 characters, and more than 25 in all. The asset
 * must get normalizeKeywords() of exactly these — the ONE normaliser.
 */
const MESSY_TAGS = ['  Kenya ', 'LION', '', '\u0001wild\u0007', 'x'.repeat(250), ...Array.from({ length: 24 }, (_, i) => `Tag${i}`)]
const MESSY_KEYWORDS = normalizeKeywords(MESSY_TAGS)
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function images() {
  const base = sharp({ create: { width: 30, height: 20, channels: 3, background: '#7a6a5a' } })
  JPEG = await base.clone().jpeg().toBuffer()
  PNG = await base.clone().png().toBuffer()
  WEBP = await base.clone().webp().toBuffer()
  GIF = await base.clone().gif().toBuffer()
  // Stored 4×2, EXIF orientation 6: upright it is 2 wide and 4 tall.
  ORIENTED = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#336699' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer()
  // A real, noisy JPEG cut short: the header is fine, the pixels are not.
  const noise = Buffer.alloc(240 * 160 * 3)
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251
  const full = await sharp(noise, { raw: { width: 240, height: 160, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
  TRUNCATED = full.subarray(0, Math.floor(full.length * 0.6))
}

type Call = { verb: string; key: string }

/** A bucket in memory: only head and get exist, and a Proxy records every property asked for. */
function fakeBucket(objects: Record<string, Buffer>, opts: { flaky?: Record<string, number> } = {}) {
  const calls: Call[] = []
  const touched = new Set<string>()
  const flaky = { ...(opts.flaky ?? {}) }
  const store: BackfillStorage = {
    async head(key) {
      calls.push({ verb: 'head', key })
      if (flaky[key] && flaky[key]! > 0) {
        flaky[key]!--
        throw new Error('ECONNRESET (simulated)')
      }
      const b = objects[key]
      return b === undefined ? { exists: false } : { exists: true, bytes: b.byteLength }
    },
    async get(key, max) {
      calls.push({ verb: 'get', key })
      if (flaky[key] && flaky[key]! > 0) {
        flaky[key]!--
        throw new Error('ECONNRESET (simulated)')
      }
      const b = objects[key]
      if (b === undefined) return null
      if (b.byteLength > max) throw new TooLargeError(key, b.byteLength)
      return b
    },
  }
  const proxy = new Proxy(store, {
    get(target, prop, receiver) {
      touched.add(String(prop))
      return Reflect.get(target, prop, receiver)
    },
  })
  return { storage: proxy as BackfillStorage, calls, touched }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. THE GRAMMAR, THE MANIFEST, THE ARGUMENTS
// ════════════════════════════════════════════════════════════════════════════

function corpus(): [string, string | null][] {
  const x = u(1)
  return [
    [`photos/${AA}/${x}`, `photos/${AA}/${x}`],
    [`photos/${AA}/${x}.jpg`, `photos/${AA}/${x}`],
    [`photos/${AA}/${x}/original.jpg`, `photos/${AA}/${x}`],
    [`photos/${AA}/${x}/original.avif`, `photos/${AA}/${x}`],
    [`photos/${AA}/${x}/400.webp`, `photos/${AA}/${x}`],
    [`photos/${AA}/${x}/2400.webp`, `photos/${AA}/${x}`],
    [`covers/${AA}/${x}.jpg`, `covers/${AA}/${x}`],
    [`covers/${AA}/${x}/1600.webp`, `covers/${AA}/${x}`],
    [`journal/${x}.jpg`, `journal/${x}`],
    [`journal/${x}/800.webp`, `journal/${x}`],
    [`journal/${x}`, `journal/${x}`],
    [`t/${TA}/photos/${AA}/${x}/1600.webp`, `t/${TA}/photos/${AA}/${x}`],
    [`t/${TA}/covers/${AA}/${x}/400.webp`, `t/${TA}/covers/${AA}/${x}`],
    [`t/${TA}/journal/${x}/original.png`, `t/${TA}/journal/${x}`],
    [`t/${TA}/site-images/${x}/800.webp`, `t/${TA}/site-images/${x}`],
    [`t/${TA}/site-images/${x}`, `t/${TA}/site-images/${x}`],
    [`t/${TA}/photos/${AA}/${x}.jpg`, null],
    [`t/${TA}/journal/${x}.jpg`, null],
    [`site-images/${x}/800.webp`, null],
    [`journal/${x}.jpeg`, null],
    [`journal/${x}.JPG`, null],
    [`journal/${x}.png`, null],
    [`journal/${x}/original.gif`, null],
    [`journal/${x}/1200.webp`, null],
    [`journal/${x}/400.jpg`, null],
    [`journal/${x.toUpperCase()}/400.webp`, null],
    [`photos/${AA.toUpperCase()}/${x}/400.webp`, null],
    [`photos/${AA}/not-a-uuid/400.webp`, null],
    [`photos/${x}.jpg`, null],
    [`photos/${AA}/${x}/400.webp/extra`, null],
    [`t/not-a-uuid/photos/${AA}/${x}/400.webp`, null],
    [`t/${TA}`, null],
    ['/samples/wildlife/lion.webp', null],
    [`https://cdn.example/photos/${AA}/${x}.jpg`, null],
    [`//cdn.example/photos/${AA}/${x}.jpg`, null],
    [`/photos/${AA}/${x}.jpg`, null],
    [`photos/${AA}/../${x}/400.webp`, null],
    [`photos/${AA}/./${x}/400.webp`, null],
    [`photos/${AA}//${x}/400.webp`, null],
    [`photos/${AA}/${x}/`, null],
    [`photos/${AA}/${x}%2F400.webp`, null],
    [`photos/${AA}/${x}/400.webp?v=2`, null],
    [`photos/${AA}/${x}/400.webp#x`, null],
    [`photos\\${AA}\\${x}.jpg`, null],
    [`photos/${AA}/${x}/400.webp\n`, null],
    [`photos/${AA}/${x}/400.webp `, null],
    [`photos/${AA}/${x}/４00.webp`, null],
    [`branding/logo-${x}.png`, null],
    [`covers/${AA}/${x}.mp4`, null],
    ['t/one/photos/a/1/2400.webp', null],
    ['', null],
  ]
}

function grammar() {
  for (const [path, want] of corpus()) {
    const p = parseLegacyKey(path)
    is(`grammar: ${JSON.stringify(path)}`, p.ok ? p.keyBase : null, want)
    if (p.ok) {
      const again = parseLegacyKey(p.keyBase)
      is(`grammar: idempotent on the base of ${JSON.stringify(path)}`, again.ok ? again.keyBase : null, p.keyBase)
    }
  }
  is('grammar: a non-string is refused', parseLegacyKey(42).ok, false)
  const reasons: [string, string][] = [
    ['/samples/wildlife/lion.webp', 'sample'],
    ['https://cdn.example/x.jpg', 'url'],
    ['//cdn.example/x.jpg', 'url'],
    [`photos/${AA}/${u(1)}%2F400.webp`, 'encoded'],
    [`photos/${AA}/../${u(1)}/400.webp`, 'traversal'],
    [`journal/${u(1).toUpperCase()}/400.webp`, 'bad_uuid'],
    ['branding/logo.png', 'unknown_shape'],
  ]
  for (const [path, reason] of reasons) {
    const p = parseLegacyKey(path)
    is(`grammar: ${path} → ${reason}`, p.ok ? 'accepted' : p.reason, reason)
  }
  const ctx = { albums: new Set([AA]), provenance: new Set([`journal/${u(2)}`]) }
  const own = (path: string, tenant = TA, c = ctx) => {
    const k = keyBaseFor(path, tenant, c)
    return k.ok ? 'ok' : k.reason
  }
  is("ownership: this site's prefix", own(`t/${TA}/site-images/${u(1)}/400.webp`), 'ok')
  is("ownership: ANOTHER site's prefix", own(`t/${TB}/site-images/${u(1)}/400.webp`), 'foreign_prefix')
  is("ownership: unprefixed, this site's album", own(`photos/${AA}/${u(1)}.jpg`), 'ok')
  is("ownership: unprefixed, ANOTHER site's album", own(`photos/${AB}/${u(1)}.jpg`), 'album_not_owned')
  is('ownership: unprefixed cover, another album', own(`covers/${AB}/${u(1)}.jpg`), 'album_not_owned')
  is('ownership: unprefixed journal WITH reviewed provenance', own(`journal/${u(2)}/400.webp`), 'ok')
  is('ownership: unprefixed journal WITHOUT', own(`journal/${u(3)}.jpg`), 'needs_provenance')
  is('ownership: provenance is per SITE', own(`journal/${u(2)}/400.webp`, TB, { albums: new Set(), provenance: new Set() }), 'needs_provenance')

  const sampleSql = /^\/samples\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.webp$/
  for (const p of ['/samples/wildlife/lion.webp', '/samples/a_b/c-d.webp', '/samples/x/y.jpg', '/samples/x/y/z.webp',
                   'samples/x/y.webp', '/samples/é/y.webp', '/samples/x/y.webp\n', '/samples//y.webp']) {
    is(`sample rule agrees with the FK preflight: ${JSON.stringify(p)}`, sampleSql.test(p), isSamplePhoto(p))
  }
  const fkFile = readFileSync(join(ROOT, 'db/migrations/2026-10-05_photo_assets_fk.sql'), 'utf8')
  ok('the FK preflight states exactly that sample pattern', fkFile.includes(`'^/samples/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\\.webp$'`))
}

function manifestAndArgs() {
  const good = JSON.stringify({ version: 1, entries: [
    { tenant: TA, key: `journal/${u(1)}`, reviewed_by: 'Gonzalo' },
    { tenant: TA, key: `journal/${u(2)}`, reviewed_by: 'Gonzalo', note: 'Kenya story' },
    { tenant: TB, key: `journal/${u(3)}`, reviewed_by: 'Gonzalo' },
  ] })
  const m = parseManifest(good)
  ok('manifest: a valid file parses', m.ok)
  if (m.ok) {
    is('manifest: by site', [...(m.manifest.get(TA) ?? [])].sort(), [`journal/${u(1)}`, `journal/${u(2)}`])
    is('manifest: …site B separately', [...(m.manifest.get(TB) ?? [])], [`journal/${u(3)}`])
  }
  const refused: [string, unknown][] = [
    ['not JSON', '{'],
    ['wrong version', { version: 2, entries: [] }],
    ['one key under two sites', { version: 1, entries: [
      { tenant: TA, key: `journal/${u(1)}`, reviewed_by: 'x' }, { tenant: TB, key: `journal/${u(1)}`, reviewed_by: 'x' }] }],
    ['a path, not a key base', { version: 1, entries: [{ tenant: TA, key: `journal/${u(1)}/400.webp`, reviewed_by: 'x' }] }],
    ['a prefixed journal key', { version: 1, entries: [{ tenant: TA, key: `t/${TA}/journal/${u(1)}`, reviewed_by: 'x' }] }],
    ['a gallery key', { version: 1, entries: [{ tenant: TA, key: `photos/${AA}/${u(1)}`, reviewed_by: 'x' }] }],
    ['no reviewer', { version: 1, entries: [{ tenant: TA, key: `journal/${u(1)}` }] }],
    ['a blank reviewer', { version: 1, entries: [{ tenant: TA, key: `journal/${u(1)}`, reviewed_by: '  ' }] }],
    ['an upper-case site', { version: 1, entries: [{ tenant: TA.toUpperCase(), key: `journal/${u(1)}`, reviewed_by: 'x' }] }],
    ['an unknown field', { version: 1, entries: [{ tenant: TA, key: `journal/${u(1)}`, reviewed_by: 'x', site: 'y' }] }],
  ]
  for (const [what, doc] of refused) {
    is(`manifest refused: ${what}`, parseManifest(typeof doc === 'string' ? doc : JSON.stringify(doc)).ok, false)
  }
  const p = (a: string[]) => {
    const r = parseArgs(a)
    return r.ok ? r.command : r.error
  }
  is('args: a DRY RUN unless --apply', p(['--tenant', TA]), { target: { mode: 'tenant', tenant: TA }, apply: false, manifest: null })
  is('args: --apply', p(['--all', '--apply']), { target: { mode: 'all' }, apply: true, manifest: null })
  is('args: --manifest', p(['--all', '--manifest', 'm.json']), { target: { mode: 'all' }, apply: false, manifest: 'm.json' })
  for (const bad of [[], ['--apply'], ['--all', '--tenant', TA], ['--tenant', 'nope'], ['--tenant'], ['--tenant', '--all'],
                     ['--all', '--apply', '--apply'], ['--all', '--manifest'], ['--all', '--everything']]) {
    ok(`args refused: ${JSON.stringify(bad)}`, typeof p(bad) === 'string')
  }
}

const emptyCounts = () => ({ photos: 0, photoSamples: 0, photosLinked: 0, siteImages: 0, siteImagesLinked: 0, references: 0,
  referenceSamples: 0, malformed: 0, assetsExisting: 0, assetsPlanned: 0, rowsToLink: 0, filesDecoded: 0, originalsRead: 0 })

async function cliRuns() {
  let built = 0
  const code = await main(['--all', '--apply', '--manifest', 'm.json'], () => '{"version":1,"entries":[{"tenant":"x"}]}',
    () => { built++; throw new Error('should not be built') }, () => {})
  is('CLI: a bad manifest → exit 2, nothing built', [code, built], [2, 0])
  const code2 = await main(['--tenant', 'nope'], () => '', () => { built++; throw new Error('no') }, () => {})
  is('CLI: bad arguments → exit 2, nothing built', [code2, built], [2, 0])

  const report = (clean: boolean): TenantReport => ({
    tenant: TA, apply: true, passes: 1, counts: emptyCounts(),
    refusals: clean ? [] : [{ reason: 'missing_object', where: 'x' }],
    writes: { created: 0, reused: 0, already_linked: 0, stale: 0, gone: 0, failed: 0 },
    linked: 0, failures: [], planned: { create: 0, reuse: 0 },
  })
  const seen: string[] = []
  const lines: string[] = []
  const deps = (cleanFor: string[], throwFor: string[] = []) => ({
    backfill: async (t: string) => {
      seen.push(t)
      if (throwFor.includes(t)) throw new Error('malformed inventory for ' + t)
      return { ...report(cleanFor.includes(t)), tenant: t }
    },
    listTenants: async () => [TA, TB],
    out: (l: string) => void lines.push(l),
  })
  is('CLI --all: every site clean → exit 0', await runBackfill({ target: { mode: 'all' }, apply: true, manifest: null }, deps([TA, TB])), 0)
  is('CLI --all: sites in order', seen, [TA, TB])
  is('CLI --all: one site refused something → exit 1', await runBackfill({ target: { mode: 'all' }, apply: true, manifest: null }, deps([TA])), 1)
  is('CLI --all: a site whose run THREW (e.g. a malformed inventory) → exit 1, the next site still runs',
    [await runBackfill({ target: { mode: 'all' }, apply: false, manifest: null }, deps([TA, TB], [TA])), seen.slice(-2)], [1, [TA, TB]])
  is('isClean: a malformed source alone is NOT clean', isClean({ ...report(true), counts: { ...emptyCounts(), malformed: 1 } }), false)
  lines.length = 0
  await runBackfill({ target: { mode: 'tenant', tenant: TA }, apply: false, manifest: null }, deps([TA]))
  ok('CLI: a dry run says what it read and that nothing was written', lines.some((l) => l.includes('the same reads and decoding as apply; nothing was written')))
  ok('CLI: a dry run names no rebuild', !lines.some((l) => l.includes('rebuild-photo-usages')))
  lines.length = 0
  await runBackfill({ target: { mode: 'all' }, apply: true, manifest: null }, deps([TA, TB], [TB]))
  is('CLI apply: a --tenant rebuild named for EVERY processed site, the interrupted one flagged',
    lines.filter((l) => l.includes('rebuild-photo-usages.ts --tenant')).map((l) => [l.includes(TA) ? 'A' : 'B', l.includes('ended early')]),
    [['A', false], ['B', true]])

  // ── --all lists sites by id cursor, never trusting a short page ──
  const ids = Array.from({ length: 1234 }, (_, i) => `aaaaaaaa-0000-0000-0000-${i.toString(16).padStart(12, '0')}`)
  const server = (cap: number, opts: { misorder?: boolean; failAt?: number } = {}) => {
    const asked: { after: string | null; limit: number }[] = []
    const page: TenantPage = async (after, limit) => {
      asked.push({ after, limit })
      if (opts.failAt !== undefined && asked.length === opts.failAt) return { data: null, error: { message: 'connection reset' } }
      const rest = ids.filter((id) => after === null || id > after)
      const rows = rest.slice(0, Math.min(limit, cap)).map((id) => ({ id }))
      if (opts.misorder && after !== null) rows.unshift({ id: after })
      return { data: rows, error: null }
    }
    return { page, asked }
  }
  const capped = server(100)
  const all = await listAllTenants(capped.page, 500)
  is(`--all: a server cap (100) below the page asked for (500) still yields every site (${ids.length}), in order`,
    [all.length, all[0], all[all.length - 1], new Set(all).size], [ids.length, ids[0], ids[ids.length - 1], ids.length])
  is('--all: …by asking past each short page until an EMPTY one (13 pages of ≤100, then the empty tail)',
    [capped.asked.length, capped.asked.every((a) => a.limit === 500), capped.asked[1]!.after], [14, true, ids[99]])
  is('--all: a page that does not continue after the cursor throws (never loops, never skips)',
    await listAllTenants(server(100, { misorder: true }).page, 500).then(() => 'listed', (e: Error) => e.message.slice(0, 40)),
    'the site listing did not continue after ')
  is('--all: an error on a later page throws — a partial list is never returned',
    await listAllTenants(server(100, { failAt: 3 }).page, 500).then((l) => `listed ${l.length}`, (e: Error) => e.message), 'connection reset')
  is('--all: no sites at all → an empty list, one request', await (async () => {
    const s: TenantPage = async () => ({ data: [], error: null })
    return listAllTenants(s)
  })(), [])
  const src = read('lib/photos/backfill-cli.ts')
  ok('--all: the real listing goes through listAllTenants with an id cursor (gt) and a limit',
    /listAllTenants\(async \(after, limit\) =>/.test(src) && /\.order\('id'\)\.limit\(limit\)/.test(src) && /q\.gt\('id', after\)/.test(src))
}

// ════════════════════════════════════════════════════════════════════════════
// 2. THE SOURCE
// ════════════════════════════════════════════════════════════════════════════

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
const SOURCES = ['app', 'lib', 'components'].flatMap((d) => walk(join(ROOT, d)))
const rel = (p: string) => relative(ROOT, p).split('\\').join('/')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
/** Code only: block-comment and line-comment lines removed. */
const code = (t: string) => t.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

async function source() {
  const BACKFILL = ['lib/photos/backfill.ts', 'lib/photos/backfill-cli.ts', 'lib/photos/backfill-storage.ts', 'lib/photos/legacy-key.ts']
  const storageFile = code(read('lib/photos/backfill-storage.ts'))
  is('storage: the only S3 commands imported are HEAD and GET',
    /import \{([^}]*)\} from '@aws-sdk\/client-s3'/.exec(storageFile)?.[1]!.split(',').map((s) => s.trim()).filter(Boolean).sort(),
    ['GetObjectCommand', 'HeadObjectCommand'])
  for (const f of BACKFILL) {
    const t = code(read(f))
    is(`${f}: no write, copy, delete, move or list of storage`,
      /PutObject|DeleteObject|CopyObject|ListObjects|UploadPart|\.write\(|\.remove\(|r2Storage|lib\/photos\/storage'|processPhoto|processExistingOriginal/.test(t), false)
    is(`${f}: writes no usage — P3 stays the only writer`,
      /photo_usages|sync_photo_usages|read_photo_usage_source|list_photo_usage_parents/.test(t), false)
  }
  const callers = SOURCES.filter((p) => /['"](register_legacy_photo_asset|read_photo_backfill_inventory|read_photo_backfill_claims)['"]/.test(code(readFileSync(p, 'utf8')))).map(rel)
  is('only lib/photos/backfill.ts calls the backfill functions', callers, ['lib/photos/backfill.ts'])
  is('no route, action, page or component reaches the backfill',
    SOURCES.filter((p) => /photos\/backfill|photos\/legacy-key/.test(code(readFileSync(p, 'utf8'))) && !rel(p).startsWith('lib/photos/')).map(rel), [])
  const script = read('scripts/backfill-photo-assets.ts')
  ok('the script only runs lib/photos/backfill-cli.ts main()',
    script.includes("import { main } from '../lib/photos/backfill-cli'") && script.includes('main(process.argv.slice(2)'))
  is('lib/photos/backfill-cli.ts uses the service role in exactly one place',
    code(read('lib/photos/backfill-cli.ts')).match(/createAdminClient\(\)/g)?.length ?? 0, 1)

  const derive = code(read('lib/jobs/derive.ts'))
  is('lib/jobs/derive.ts imports only the job types and calls no storage or table', [
    [...derive.matchAll(/from '([^']+)'/g)].map((m) => m[1]),
    /GetObject|PutObject|processPhoto|\.from\(|\.update\(|r2Client/.test(derive),
  ], [['@/lib/jobs/types'], false])
  let thrown: unknown = null
  try {
    await HANDLERS['photo.derivatives']({} as JobContext)
  } catch (e) {
    thrown = e
  }
  is('the old queued kind fails PERMANENTLY (one tidy row, no retries)', isPermanent(thrown), true)
  is('the admin backfill action and its panel are gone',
    [existsSync(join(ROOT, 'app/actions/backfill.ts')), existsSync(join(ROOT, 'components/admin/BackfillPanel.tsx'))], [false, false])
  is('…and no code names them', SOURCES.filter((p) => /actions\/backfill|BackfillPanel|backfillDerivatives/.test(code(readFileSync(p, 'utf8')))).map(rel), [])
  is('nothing in the application enqueues photo.derivatives any more',
    SOURCES.filter((p) => /kind:\s*'photo\.derivatives'/.test(code(readFileSync(p, 'utf8')))).map(rel), [])
  ok('.mk/ingest.ts no longer exempts lib/jobs/derive.ts', !/\['lib\/jobs\/derive\.ts'\]/.test(read('.mk/ingest.ts')))
}

// ════════════════════════════════════════════════════════════════════════════
// 3. THE PLANNER, OVER A FAKE BUCKET OF REAL IMAGES
// ════════════════════════════════════════════════════════════════════════════

const ladder = (base: string, ...sizes: string[]) => Object.fromEntries(sizes.map((s) => [s, `${base}/${s}.webp`]))
const filesOf = (base: string, sizes: string[], extra: Record<string, Buffer> = {}) =>
  ({ ...Object.fromEntries(sizes.map((s) => [`${base}/${s}.webp`, WEBP])), ...extra })

function inv(over: Partial<Inventory>): Inventory {
  return { tenant: TA, photos: [], site_images: [], albums: [{ id: AA, cover_custom_path: null }], assets: [], sources: [], ...over }
}
const row = (id: string, storage_path: string, extra: Partial<Inventory['photos'][number]> = {}) => ({
  id, album_id: AA, storage_path, original_path: null, derivatives: {}, width: 1200, height: 800, tags: [], asset_id: null, ...extra,
})
const deps = (storage: BackfillStorage, over: Partial<PlanDeps> = {}): PlanDeps => ({
  storage, provenance: new Set(), claims: async (k) => Object.fromEntries(k.map((x) => [x, false])), ...over,
})
const reasons = (p: { refusals: { reason: string }[] }) => p.refusals.map((r) => r.reason).sort()

async function planner() {
  // ── decodeImage itself: upright, and truly decoded ──
  {
    const d = await decodeImage(ORIENTED)
    is('upright: an orientation-6 4×2 JPEG measures 2×4', [d.width, d.height], [2, 4])
    is('upright: orientations 5–8 swap the axes, 1–4 keep them',
      [1, 2, 3, 4, 5, 6, 7, 8].map((o) => uprightSize(4, 2, o).width), [4, 4, 4, 4, 2, 2, 2, 2])
    is('upright: an out-of-range orientation (0, 9, 255, none) changes nothing',
      [0, 9, 255, undefined].map((o) => uprightSize(4, 2, o).width), [4, 4, 4, 4])
    const naive = await sharp(ORIENTED).rotate().metadata()
    is('…which sharp().rotate().metadata() does NOT give (why decodeImage exists)', [naive.width, naive.height], [4, 2])
    const meta = await sharp(TRUNCATED).metadata().then((m) => m.format, () => 'refused')
    is('a truncated JPEG still has a readable HEADER (so a header check is not enough)', meta, 'jpeg')
    is('…but does not DECODE', await decodeImage(TRUNCATED).then(() => 'decoded', () => 'refused'), 'refused')
    is('garbage does not decode', await decodeImage(GARBAGE).then(() => 'decoded', () => 'refused'), 'refused')
  }
  // ── a flat photograph with an old-job ladder ──
  {
    const b = `photos/${AA}/${u(10)}`
    const bucket = fakeBucket({ [`${b}.jpg`]: JPEG, ...filesOf(b, ['400', '1600']), [`${b}/original.jpg`]: JPEG })
    const plan = await planTenant(inv({ photos: [row(pid(1), `${b}.jpg`, { derivatives: ladder(b, '400', '1600'), width: 2400, height: 1600, tags: MESSY_TAGS })] }), deps(bucket.storage))
    is('flat: one write, binding the photograph', plan.writes.map((w) => [w.mode, w.at.source]), [['create', 'photo']])
    const a = plan.writes[0]!.args
    is('flat: display is the flat JPEG, exactly; its ladder from the row', [a.p_display_path, a.p_derivatives], [`${b}.jpg`, ladder(b, '400', '1600')])
    is("flat: NO original — the old job's original.jpg beside it is never asked about", [a.p_original_path, a.p_content_sha256, bucket.calls.some((c) => c.key.includes('/original.'))], [null, null, false])
    is("flat: the row's dimensions; its date left to the database", [a.p_width, a.p_height, a.p_taken_at], [2400, 1600, null])
    is('flat: keywords = normalizeKeywords(the row\'s raw tags), sent WITH those raw tags for the database to bind',
      [a.p_keywords, a.p_source_tags], [MESSY_KEYWORDS, MESSY_TAGS])
    is('(the fixture really is messy: 25 kept of 28, lower-cased, trimmed, cleaned, one cut to 200)',
      [MESSY_KEYWORDS.length, MESSY_KEYWORDS.slice(0, 3), MESSY_KEYWORDS[3]!.length], [25, ['kenya', 'lion', 'wild'], 200])
    is('flat: every display file READ and decoded — the flat file and both sizes, nothing else',
      bucket.calls.map((c) => `${c.verb} ${c.key.slice(b.length)}`).sort(), ['get .jpg', 'get /1600.webp', 'get /400.webp'])
    is('flat: the bucket was only ever asked to head/get', [...bucket.touched].filter((p) => p !== 'head' && p !== 'get' && p !== 'then'), [])
  }
  // ── corrupt files establishing an asset are refused ──
  {
    const cover = `covers/${AA}/${u(40)}`
    const cases: [string, Buffer, string][] = [
      ['a flat cover whose bytes are garbage', GARBAGE, 'undecodable'],
      ['a flat cover that is a truncated JPEG', TRUNCATED, 'undecodable'],
      ['a flat cover that is a PNG named .jpg', PNG, 'format_mismatch'],
    ]
    for (const [what, bytes, reason] of cases) {
      const plan = await planTenant(inv({ albums: [{ id: AA, cover_custom_path: `${cover}.jpg` }] }), deps(fakeBucket({ [`${cover}.jpg`]: bytes }).storage))
      is(`refused: ${what}`, [plan.counts.assetsPlanned, plan.writes.length, reasons(plan)], [0, 0, [reason]])
    }
    const b = `photos/${AA}/${u(41)}`
    const p = await planTenant(inv({ photos: [row(pid(41), `${b}/800.webp`, { derivatives: ladder(b, '400', '800') })] }),
      deps(fakeBucket({ [`${b}/800.webp`]: WEBP, [`${b}/400.webp`]: JPEG }).storage))
    is('refused: a size that is a JPEG named .webp', reasons(p), ['format_mismatch'])
  }
  // ── a folder photograph whose original the row names ──
  {
    const b = `photos/${AA}/${u(11)}`
    const objects = { ...filesOf(b, ['400', '2400']), [`${b}/original.jpg`]: JPEG }
    const bucket = fakeBucket(objects)
    const r = row(pid(2), `${b}/2400.webp`, { original_path: `${b}/original.jpg`, derivatives: ladder(b, '400', '2400'), width: 6000, height: 4000 })
    const plan = await planTenant(inv({ photos: [r] }), deps(bucket.storage))
    const a = plan.writes[0]!.args
    is('folder: the original, hashed from its bytes', [a.p_original_path, a.p_content_sha256, a.p_original_bytes, a.p_content_type],
      [`${b}/original.jpg`, sha(JPEG), JPEG.byteLength, 'image/jpeg'])
    is("folder: the ROW keeps its dimensions", [a.p_width, a.p_height], [6000, 4000])
    const dry = fakeBucket(objects)
    const p2 = await planTenant(inv({ photos: [r] }), deps(dry.storage))
    is('the planner is the same for dry run and apply: same reads, same args', [dry.calls, p2.writes[0]!.args], [bucket.calls, a])
  }
  // ── an original that is not a supported photograph ──
  {
    const b = `photos/${AA}/${u(42)}`
    const p = await planTenant(inv({ photos: [row(pid(42), `${b}/400.webp`, { original_path: `${b}/original.png`, derivatives: ladder(b, '400') })] }),
      deps(fakeBucket({ ...filesOf(b, ['400']), [`${b}/original.png`]: GIF }).storage))
    is('refused: an "original" that decodes as GIF (no supported type to record)', reasons(p), ['unsupported_format'])
    const t = await planTenant(inv({ photos: [row(pid(42), `${b}/400.webp`, { original_path: `${b}/original.jpg`, derivatives: ladder(b, '400') })] }),
      deps(fakeBucket({ ...filesOf(b, ['400']), [`${b}/original.jpg`]: TRUNCATED }).storage))
    is('refused: a truncated original', reasons(t), ['undecodable'])
  }
  // ── discovery: bounded, unambiguous ──
  {
    const b = `t/${TA}/photos/${AA}/${u(12)}`
    const bucket = fakeBucket({ ...filesOf(b, ['400', '800']), [`${b}/original.png`]: PNG })
    const plan = await planTenant(inv({ photos: [row(pid(3), `${b}/800.webp`, { derivatives: ladder(b, '400', '800') })] }), deps(bucket.storage))
    is('discovery: the one original found, png', [plan.writes[0]?.args.p_original_path, plan.writes[0]?.args.p_content_type], [`${b}/original.png`, 'image/png'])
    is('discovery: bounded — exactly five HEADs for the five names', bucket.calls.filter((c) => c.verb === 'head' && c.key.includes('/original.')).length, 5)
    const two = await planTenant(inv({ photos: [row(pid(3), `${b}/800.webp`, { derivatives: ladder(b, '400', '800') })] }),
      deps(fakeBucket({ ...filesOf(b, ['400', '800']), [`${b}/original.png`]: PNG, [`${b}/original.jpg`]: JPEG }).storage))
    is('discovery: two originals → refused as ambiguous, nothing planned', [two.writes.length, reasons(two)], [0, ['ambiguous_original']])
  }
  // ── missing, empty, too large ──
  {
    const b = `photos/${AA}/${u(13)}`
    const cases: [string, Record<string, Buffer>, string][] = [
      ['a claimed size missing', { [`${b}/800.webp`]: WEBP }, 'missing_object'],
      ['a claimed size EMPTY', { [`${b}/800.webp`]: WEBP, [`${b}/400.webp`]: Buffer.alloc(0) }, 'empty_object'],
    ]
    for (const [what, objects, reason] of cases) {
      const plan = await planTenant(inv({ photos: [row(pid(4), `${b}/800.webp`, { derivatives: ladder(b, '400', '800') })] }), deps(fakeBucket(objects).storage))
      is(`refused: ${what}`, [plan.writes.length, reasons(plan)], [0, [reason]])
    }
    const big = await planTenant(inv({ photos: [row(pid(4), `${b}/800.webp`, { original_path: `${b}/original.jpg`, derivatives: ladder(b, '400', '800') })] }),
      deps(fakeBucket({ ...filesOf(b, ['400', '800']), [`${b}/original.jpg`]: JPEG }).storage, { maxOriginalBytes: 10 }))
    is('refused: an original over the read limit', reasons(big), ['too_large'])
  }
  // ── transient storage failures: retried, BOUNDED ──
  {
    const b = `photos/${AA}/${u(14)}`
    const objects = { [`${b}.jpg`]: JPEG }
    const recover = fakeBucket(objects, { flaky: { [`${b}.jpg`]: STORAGE_ATTEMPTS - 1 } })
    is(`storage: ${STORAGE_ATTEMPTS - 1} transient failures, then success → planned`,
      (await planTenant(inv({ photos: [row(pid(5), `${b}.jpg`)] }), deps(withRetries(recover.storage)))).writes.length, 1)
    const broken = fakeBucket(objects, { flaky: { [`${b}.jpg`]: 99 } })
    const p = await planTenant(inv({ photos: [row(pid(5), `${b}.jpg`)] }), deps(withRetries(broken.storage)))
    is('storage: a failure that persists → refused as storage_error', reasons(p), ['storage_error'])
    is(`storage: …after exactly ${STORAGE_ATTEMPTS} attempts, not forever`, broken.calls.length, STORAGE_ATTEMPTS)
  }
  // ── samples, duplicates, conflicts, existing assets and existing LINKS ──
  {
    const b = `photos/${AA}/${u(15)}`
    const bucket = fakeBucket({ [`${b}.jpg`]: JPEG })
    const plan = await planTenant(inv({ photos: [
      row(pid(6), '/samples/wildlife/lion.webp'),
      row(pid(7), `${b}.jpg`, { width: 800, height: 600 }),
      { ...row(pid(8), `${b}.jpg`, { width: 800, height: 600 }), album_id: AA2 },
    ] }), deps(bucket.storage))
    is('a sample: counted, never planned', [plan.counts.photoSamples, plan.writes.some((w) => w.args.p_source_id === pid(6))], [1, false])
    is('two rows of one upload: create, then reuse', plan.writes.map((w) => `${w.mode}:${w.args.p_source_id}`), [`create:${pid(7)}`, `reuse:${pid(8)}`])
    const conflict = await planTenant(inv({ photos: [row(pid(7), `${b}.jpg`, { width: 800, height: 600 }), row(pid(8), `${b}.jpg`, { width: 801, height: 600 })] }), deps(fakeBucket({ [`${b}.jpg`]: JPEG }).storage))
    is('two rows of one upload that DISAGREE: refused', [conflict.writes.length, reasons(conflict)], [0, ['conflicting_rows']])
    const nullLadder = await planTenant(inv({ photos: [row(pid(9), `${b}.jpg`, { derivatives: null, width: null, height: null })] }), deps(fakeBucket({ [`${b}.jpg`]: JPEG }).storage))
    is('a display-only row whose ladder is JSON null: planned with {} (the database agrees)', nullLadder.writes[0]?.args.p_derivatives, {})

    const existing = { id: 'e1', key_base: b, original_path: null, display_path: `${b}.jpg`, derivatives: {}, width: 800, height: 600,
                       original_bytes: null, content_sha256: null, content_type: null, archived: false, deleted: false }
    const quiet = fakeBucket({})
    const reuse = await planTenant(inv({ photos: [row(pid(7), `${b}.jpg`, { width: 800, height: 600 })], assets: [existing] }), deps(quiet.storage))
    is("an asset at the key, the row agreeing: reuse with THE ASSET's facts, no storage call", [reuse.writes.map((w) => w.mode), quiet.calls.length], [['reuse'], 0])
    is('an asset at the key the row DISAGREES with: refused',
      reasons(await planTenant(inv({ photos: [row(pid(7), `${b}.jpg`, { width: 640, height: 480 })], assets: [existing] }), deps(fakeBucket({}).storage))), ['conflicts_with_asset'])
    is('an asset at the key that is deleted: refused',
      reasons(await planTenant(inv({ photos: [row(pid(7), `${b}.jpg`, { width: 800, height: 600 })], assets: [{ ...existing, deleted: true }] }), deps(fakeBucket({}).storage))), ['asset_retired'])

    const links = await planTenant(inv({ photos: [
      row(pid(20), `${b}.jpg`, { asset_id: 'e1' }),
      row(pid(21), `photos/${AA}/${u(16)}.jpg`, { asset_id: 'not-an-asset-of-this-site' }),
      row(pid(22), `photos/${AA}/${u(17)}.jpg`, { asset_id: 'e1' }),
      row(pid(23), '/samples/wildlife/lion.webp', { asset_id: 'e1' }),
    ], assets: [existing] }), deps(fakeBucket({}).storage))
    is('existing links are CHECKED: one valid; a missing/foreign asset, a disagreeing one and a sample are reported',
      [links.counts.photosLinked, reasons(links), links.writes.length], [1, ['invalid_link', 'link_disagrees', 'sample_has_asset'], 0])
  }
  // ── standalone uploads named only by covers and documents ──
  {
    const cover = `covers/${AA}/${u(16)}`
    const jf = `journal/${u(17)}`
    const jd = `journal/${u(18)}`
    const objects = { [`${cover}.jpg`]: JPEG, [`${jf}.jpg`]: JPEG, ...filesOf(jd, ['400', '800', '1600']), [`${jd}/original.jpg`]: ORIENTED }
    const bucket = fakeBucket(objects)
    const post = { parent: 'post' as const, key: POST_A, source: { parent: 'post', post: POST_A, exists: true, featured: `${jf}.jpg`,
      blocks: [{ id: 'b', type: 'image', image: { path: `${jd}/1600.webp`, alt: '' }, caption: `${cover}.jpg` }] } }
    const plan = await planTenant(inv({ albums: [{ id: AA, cover_custom_path: `${cover}.jpg` }], sources: [post] }), deps(bucket.storage, { provenance: new Set([jf, jd]) }))
    const by = (k: string) => plan.writes.find((w) => w.keyBase === k)?.args
    is('flat cover: display the flat file, no ladder, no original, size unknown',
      [by(cover)?.p_display_path, by(cover)?.p_derivatives, by(cover)?.p_original_path, by(cover)?.p_width, by(cover)?.p_source], [`${cover}.jpg`, {}, null, null, 'album_cover'])
    is('flat journal: bound to its story\'s featured slot', [by(jf)?.p_source, by(jf)?.p_parent, by(jf)?.p_parent_key, by(jf)?.p_slot, by(jf)?.p_provenance_reviewed],
      ['document', 'post', POST_A, 'featured', true])
    is('folder journal: bound to the block\'s image slot, ladder found, largest is the display file',
      [by(jd)?.p_slot, by(jd)?.p_derivatives, by(jd)?.p_display_path], ['blocks/0/image', ladder(jd, '400', '800', '1600'), `${jd}/1600.webp`])
    is("folder journal: the ORIGINAL's UPRIGHT size (orientation 6: 2 wide, 4 tall)", [by(jd)?.p_width, by(jd)?.p_height], [2, 4])
    is('a caption that holds a path is never claimed', plan.writes.filter((w) => w.keyBase === cover).map((w) => w.at.source), ['album_cover'])
    is('a flat cover is never searched for an original', bucket.calls.some((c) => c.key.startsWith(`${cover}/original.`)), false)

    is('unprefixed journal WITHOUT the manifest: refused',
      reasons(await planTenant(inv({ sources: [post] }), deps(fakeBucket({}).storage))), ['needs_provenance', 'needs_provenance'])
    const claimed = await planTenant(inv({ sources: [post] }), deps(fakeBucket(objects).storage, {
      provenance: new Set([jf, jd]), claims: async (k) => Object.fromEntries(k.map((x) => [x, x === jd])) }))
    is('…WITH the manifest but another site claims one: that one refused, the other planned',
      [claimed.refusals.map((r) => `${r.reason}:${r.keyBase}`), claimed.writes.map((w) => w.keyBase)], [[`foreign_claim:${jd}`], [jf]])
    is('…and a claim check that did not answer refuses rather than assumes',
      reasons(await planTenant(inv({ sources: [post] }), deps(fakeBucket({}).storage, { provenance: new Set([jf]), claims: async () => ({}) }))), ['foreign_claim', 'needs_provenance'])
  }
  // ── claims are asked in batches of CLAIMS_BATCH, tail included ──
  {
    const keys = Array.from({ length: 2 * CLAIMS_BATCH + 500 }, (_, i) => `journal/${u(10000 + i)}`)
    const asked: number[] = []
    const seen = new Set<string>()
    const page = { parent: 'live_page' as const, key: 'home', source: { parent: 'live_page', page: 'home', share: null, legacy: {},
      sections: keys.map((k) => ({ type: 'intro', settings: { image_path: `${k}.jpg` } })) } }
    const plan = await planTenant(inv({ sources: [page] }), deps(fakeBucket({}).storage, { provenance: new Set(keys), claims: async (k) => {
      asked.push(k.length)
      k.forEach((x) => seen.add(x))
      return Object.fromEntries(k.map((x) => [x, true]))
    } }))
    is(`claims: ${keys.length} keys asked in batches of at most ${CLAIMS_BATCH}`, asked, [CLAIMS_BATCH, CLAIMS_BATCH, 500])
    is('claims: every key asked, the tail included', [seen.size, seen.has(keys[keys.length - 1]!)], [keys.length, true])
    is('claims: every claimed key refused', plan.refusals.filter((r) => r.reason === 'foreign_claim').length, keys.length)
  }
  // ── documents: P3's extractor, P3's legacy fallback, exact slots ──
  {
    const b = `t/${TA}/site-images/${u(19)}`
    const page = { parent: 'live_page' as const, key: 'home', source: {
      parent: 'live_page', page: 'home', share: null, legacy: { hero_image_path: '/samples/wildlife/lion.webp' },
      sections: [
        { type: 'hero', settings: { image_path: `${b}/800.webp`, image_path_mobile: `${b}/400.webp`, video_path: `photos/${AA}/${u(20)}/original.jpg`, video_poster: `${b}/800.webp`, hidden: true } },
        { type: 'intro', settings: { image_path: `t/${TB}/photos/${AB}/${u(21)}/400.webp`, bg_image: `photos/${AA}/${u(22)}/800.webp` } },
      ] } }
    const d = documentClaims(page)
    is('extractor: hidden hero image, its phone twin and the poster are claimed, with exact slots; the hero VIDEO is not',
      d.claims.filter((c) => c.path.startsWith(b)).map((c) => c.at.source === 'document' && c.at.slot).sort(),
      ['sections/0/image_path', 'sections/0/image_path_mobile', 'sections/0/video_poster'])
    is('extractor: the video path is never a claim', d.claims.some((c) => c.path.includes(u(20))), false)
    const plan = await planTenant(inv({ sources: [page] }), deps(fakeBucket(filesOf(b, ['400', '800'])).storage))
    is('a page-only Uploads file: one asset, bound to the page slot', plan.writes.map((w) => [w.keyBase, w.args.p_parent, w.args.p_parent_key, w.args.p_slot]),
      [[b, 'live_page', 'home', 'sections/0/image_path']])
    is("another site's prefix and a background with no files: refused", reasons(plan), ['foreign_prefix', 'missing_object'])

    // P3's fallback: legacy columns are placements only with NO section rows.
    const cover = `covers/${AA}/${u(23)}`
    const legacy = (sections: unknown[]) => ({ parent: 'live_page' as const, key: 'home',
      source: { parent: 'live_page', page: 'home', share: null, sections, legacy: { hero_image_path: `${cover}.jpg` } } })
    is('legacy column SHADOWED by a section row (even an empty hero): not claimed',
      documentClaims(legacy([{ type: 'hero', settings: {} }])).claims.length, 0)
    const shadowed = await planTenant(inv({ sources: [legacy([{ type: 'hero', settings: {} }])] }), deps(fakeBucket({ [`${cover}.jpg`]: JPEG }).storage))
    is('…so no asset is planned for it', [shadowed.writes.length, shadowed.refusals.length], [0, 0])
    is('legacy column of a page with NO section rows: claimed at legacy/<column>',
      documentClaims(legacy([])).claims.map((c) => c.at.source === 'document' && c.at.slot), ['legacy/hero_image_path'])

    const draft = { parent: 'draft' as const, key: null, source: { parent: 'draft', exists: true,
      pages: { about: [{ type: 'intro', settings: { image_path: `${b}/400.webp` } }] }, page_seo: { about: { image: `${b}/800.webp` } } } }
    is('draft slots: pages/<page>/<n>/<setting> and page_seo/<page>',
      documentClaims(draft).claims.map((c) => c.at.source === 'document' && c.at.slot).sort(), ['page_seo/about', 'pages/about/0/image_path'])
    const pair = { parent: 'post' as const, key: POST_A, source: { parent: 'post', exists: true, featured: null, blocks: [
      { type: 'image_pair', left: { path: `${b}/400.webp` }, right: { path: `${b}/800.webp` } },
      { type: 'masonry', images: [{ path: `${b}/400.webp` }, { path: `${b}/800.webp` }] },
      { type: 'image', image: { alt: 'no path' } }] } }
    const pd = documentClaims(pair)
    is('story slots: left/right, images/<j>', pd.claims.map((c) => c.at.source === 'document' && c.at.slot),
      ['blocks/0/left', 'blocks/0/right', 'blocks/1/images/0', 'blocks/1/images/1'])
    const malformed = await planTenant(inv({ sources: [pair] }), deps(fakeBucket(filesOf(b, ['400', '800'])).storage))
    is('a malformed image block: reported, never a clean run', [malformed.counts.malformed, reasons(malformed)], [1, ['malformed_source']])
  }
  // ── the inventory is validated, not cast ──
  {
    const good = { tenant: TA, photos: [], site_images: [], albums: [], assets: [], sources: [] }
    ok('inventory: a well-formed one passes', !!validateInventory(TA, good))
    for (const [what, bad] of [
      ['another site', { ...good, tenant: TB }],
      ['photos missing', { ...good, photos: undefined }],
      ['a row with a numeric path', { ...good, photos: [{ ...row(pid(1), 'x'), storage_path: 7 }] }],
      ['a source of an unknown parent', { ...good, sources: [{ parent: 'album', key: null, source: {} }] }],
    ] as [string, unknown][]) {
      is(`inventory refused: ${what}`, (() => { try { validateInventory(TA, bad); return 'accepted' } catch { return 'refused' } })(), 'refused')
    }
  }
}

async function applier() {
  const b1 = `photos/${AA}/${u(30)}`
  const b2 = `photos/${AA}/${u(31)}`
  const b3 = `photos/${AA}/${u(32)}`
  const bucket = fakeBucket({ [`${b1}.jpg`]: JPEG, [`${b2}.jpg`]: JPEG, [`${b3}.jpg`]: JPEG })
  const scripted = (inventory: (pass: number) => Inventory, answer: (args: Record<string, unknown>, n: number) => unknown) => {
    const calls: string[] = []
    let n = 0
    let reads = 0
    const rpc: BackfillRpc = {
      async rpc(fn, args) {
        calls.push(fn)
        if (fn === 'read_photo_backfill_inventory') return { data: inventory(++reads), error: null }
        if (fn === 'read_photo_backfill_claims') return { data: {}, error: null }
        const a = answer(args, n++)
        if (a instanceof Error) throw a
        return typeof a === 'string' ? { data: null, error: { message: a } } : { data: a, error: null }
      },
    }
    return { rpc, calls }
  }
  const two = () => inv({ photos: [row(pid(30), `${b1}.jpg`), row(pid(31), `${b2}.jpg`)] })
  const base = { storage: bucket.storage, provenance: () => new Set<string>() }

  const dry = scripted(two, () => ({ status: 'created' }))
  const r0 = await backfillTenant(TA, false, { ...base, rpc: dry.rpc })
  is('dry run: the writer is never called', dry.calls.filter((c) => c === 'register_legacy_photo_asset').length, 0)
  is('dry run: but says what it would do', r0.planned, { create: 2, reuse: 0 })

  const stale = scripted(two, () => ({ status: 'stale' }))
  const r1 = await backfillTenant(TA, true, { ...base, rpc: stale.rpc })
  is(`a source that STAYS stale: re-read ${MAX_PASSES} times, then REPORTED, not forced`,
    [r1.passes, stale.calls.filter((c) => c === 'read_photo_backfill_inventory').length, r1.writes.stale, isClean(r1)], [MAX_PASSES, MAX_PASSES, 2, false])
  const once = scripted(two, (_a, n) => ({ status: n === 0 ? 'stale' : 'created' }))
  const r2 = await backfillTenant(TA, true, { ...base, rpc: once.rpc })
  is('stale once, then fresh: two passes, both created, clean', [r2.passes, r2.writes.created, r2.writes.stale, isClean(r2)], [2, 2, 0, true])

  // Stale, then on re-read ANOTHER RUNNER had linked it: settled, not reported.
  const linkedLater = scripted(
    (pass) => pass === 1 ? two() : inv({
      photos: [row(pid(30), `${b1}.jpg`, { asset_id: 'x1' }), row(pid(31), `${b2}.jpg`)],
      assets: [{ id: 'x1', key_base: b1, original_path: null, display_path: `${b1}.jpg`, derivatives: {}, width: 1200, height: 800,
                 original_bytes: null, content_sha256: null, content_type: null, archived: false, deleted: false }] }),
    (a) => ({ status: a.p_source_id === pid(30) ? 'stale' : 'created' }))
  const r3 = await backfillTenant(TA, true, { ...base, rpc: linkedLater.rpc })
  is('stale, then linked by another runner: settled — no stale left, clean', [r3.writes.stale, r3.writes.created, r3.counts.photosLinked, isClean(r3)], [0, 1, 1, true])
  // Stale because the path CHANGED: the new path is planned and written; the old attempt is settled.
  const moved = scripted(
    (pass) => pass === 1 ? two() : inv({ photos: [row(pid(30), `${b3}.jpg`), row(pid(31), `${b2}.jpg`, { asset_id: 'x2' })],
      assets: [{ id: 'x2', key_base: b2, original_path: null, display_path: `${b2}.jpg`, derivatives: {}, width: 1200, height: 800,
                 original_bytes: null, content_sha256: null, content_type: null, archived: false, deleted: false }] }),
    (a) => ({ status: a.p_key_base === b1 ? 'stale' : 'created' }))
  const r4 = await backfillTenant(TA, true, { ...base, rpc: moved.rpc })
  is('stale because the path moved: the NEW path written, the old attempt settled, clean',
    [r4.writes.stale, r4.writes.created, isClean(r4)], [0, 2, true])

  // A RETURNED error is one item's failure; the run carries on.
  const refuse = scripted(two, (a) => (a.p_source_id === pid(30) ? 'photo backfill: the asset already at this key records different files.' : { status: 'created' }))
  const r5 = await backfillTenant(TA, true, { ...base, rpc: refuse.rpc })
  is('a returned refusal: recorded, and the next write still happens', [r5.writes.failed, r5.writes.created, r5.failures.length, isClean(r5)], [1, 1, 1, false])
  is('…and is NOT retried (the database\'s final word)', refuse.calls.filter((c) => c === 'register_legacy_photo_asset').length, 2)
  // A THROWN error (the connection or the process went away) ends the run.
  const died = scripted(two, () => new Error('socket hang up'))
  is('a THROWN error ends the run (a rerun resumes)', await backfillTenant(TA, true, { ...base, rpc: died.rpc }).then(() => 'finished', (e: Error) => e.message), 'socket hang up')
  is('…after exactly one write attempt', died.calls.filter((c) => c === 'register_legacy_photo_asset').length, 1)
  // A malformed inventory is an error, never an empty, clean site.
  const broken: BackfillRpc = { async rpc() { return { data: { tenant: TA, photos: 'nope' }, error: null } } }
  is('a malformed inventory throws', await backfillTenant(TA, false, { ...base, rpc: broken }).then(() => 'clean', () => 'refused'), 'refused')

  await goneSurvivors()
}

/**
 * THE ONE-BINDING BLOCKER. The planner binds an upload's asset to ONE source.
 * If that source vanishes (`gone`) while another source of the same upload
 * survives — a story naming a deleted gallery photograph — the survivor must
 * still get its asset, and a `gone` may only settle once a FRESH inventory
 * confirms it. The database here is scripted per pass; the real-DB race is in
 * part 4.
 */
async function goneSurvivors() {
  const b = `photos/${AA}/${u(33)}`
  const cv = `covers/${AA}/${u(34)}`
  const bucket = fakeBucket({ [`${b}.jpg`]: JPEG, [`${cv}.jpg`]: JPEG })
  const story = (path: string) => ({ parent: 'post' as const, key: POST_A,
    source: { parent: 'post', post: POST_A, exists: true, featured: path, blocks: [] } })
  const page = (path: string | null) => ({ parent: 'live_page' as const, key: 'home', source: { parent: 'live_page', page: 'home', share: null, legacy: {},
    sections: path ? [{ type: 'intro', settings: { image_path: path } }] : [] } })
  const asset = (key: string, display: string) => ({ id: `asset-${key}`, key_base: key, original_path: null, display_path: display, derivatives: {},
    width: null, height: null, original_bytes: null, content_sha256: null, content_type: null, archived: false, deleted: false })
  /** A database that answers per pass and per call, recording every writer call's arguments. */
  const world = (inventory: (pass: number) => Inventory, answer: (args: Record<string, unknown>) => string) => {
    const writes: Record<string, unknown>[] = []
    let reads = 0
    const rpc: BackfillRpc = {
      async rpc(fn, args) {
        if (fn === 'read_photo_backfill_inventory') return { data: inventory(++reads), error: null }
        if (fn === 'read_photo_backfill_claims') return { data: {}, error: null }
        writes.push(args)
        return { data: { status: answer(args) }, error: null }
      },
    }
    return { rpc, writes, reads: () => reads }
  }
  const run = (w: ReturnType<typeof world>, apply = true) =>
    backfillTenant(TA, apply, { storage: bucket.storage, provenance: () => new Set<string>(), rpc: w.rpc })
  const photo = row(pid(33), `${b}.jpg`)
  const bySource = (a: Record<string, unknown>) => `${a.p_source}${a.p_slot ? ':' + a.p_slot : ''}`

  // ── A. the photograph is deleted under the run; the story naming its file survives ──
  {
    const w = world((p) => p === 1 ? inv({ photos: [photo], sources: [story(`${b}.jpg`)] }) : inv({ sources: [story(`${b}.jpg`)] }),
      (a) => (a.p_source === 'photo' ? 'gone' : 'created'))
    const r = await run(w)
    is('A: the bound photograph is gone → a fresh read → the surviving STORY binds and creates the asset',
      [w.writes.map(bySource), r.passes, r.writes.created, r.writes.gone], [['photo', 'document:featured'], 2, 1, 1])
    is('A: …and the story binding is the asset of the same upload', [w.writes[1]?.p_key_base, w.writes[1]?.p_source_path], [b, `${b}.jpg`])
    is('A: the gone is confirmed by the fresh read, so the site is clean', [isClean(r), r.failures], [true, []])
    // Reuse: the fresh read shows another runner already made the asset — nothing to write.
    const w2 = world((p) => p === 1 ? inv({ photos: [photo], sources: [story(`${b}.jpg`)] })
      : inv({ sources: [story(`${b}.jpg`)], assets: [asset(b, `${b}.jpg`)] }), (a) => (a.p_source === 'photo' ? 'gone' : 'created'))
    const r2 = await run(w2)
    is('A: …or, if the asset now exists, the story REUSES it: no second write, clean',
      [w2.writes.map(bySource), r2.writes.gone, isClean(r2)], [['photo'], 1, true])
  }

  // ── B. a cover / a page slot was the binding and vanished; another source survives ──
  {
    // Album AA2 uses a cover file whose key belongs to album AA. AA2 is DELETED
    // under the run — the writer answers `gone` for a missing album (a cover
    // merely cleared would be `stale`) — while AA, which owns the key, and the
    // story naming the file both survive.
    const w = world((p) => p === 1
      ? inv({ albums: [{ id: AA, cover_custom_path: null }, { id: AA2, cover_custom_path: `${cv}.jpg` }], sources: [story(`${cv}.jpg`)] })
      : inv({ albums: [{ id: AA, cover_custom_path: null }], sources: [story(`${cv}.jpg`)] }),
      (a) => (a.p_source === 'album_cover' ? 'gone' : 'created'))
    const r = await run(w)
    is('B: the bound cover\'s album is deleted (gone) → the surviving story binds and creates',
      [w.writes.map(bySource), r.writes.created, r.writes.gone, isClean(r)], [['album_cover', 'document:featured'], 1, 1, true])
    const w2 = world((p) => p === 1 ? inv({ sources: [page(`${b}.jpg`), story(`${b}.jpg`)] }) : inv({ sources: [page(null), story(`${b}.jpg`)] }),
      (a) => (a.p_slot === 'sections/0/image_path' ? 'stale' : 'created'))
    const r2 = await run(w2)
    is('B: the bound PAGE slot no longer holds it (stale) → the surviving story binds and creates',
      [w2.writes.map(bySource), r2.writes.created, r2.writes.stale, isClean(r2)], [['document:sections/0/image_path', 'document:featured'], 1, 0, true])
  }

  // ── C. every source disappears: only the fresh inventory lets it settle ──
  {
    const w = world((p) => p === 1 ? inv({ photos: [photo], sources: [story(`${b}.jpg`)] }) : inv({}), () => 'gone')
    const r = await run(w)
    is('C: all sources gone → re-read; the FRESH inventory names none → settled gone, clean',
      [w.writes.length, w.reads(), r.writes.gone, isClean(r)], [1, 2, 1, true])
  }

  // ── D. churn: bounded, then an explicit, non-clean failure ──
  {
    // A new row id for the same upload every pass, each gone when written.
    const w = world((p) => inv({ photos: [row(pid(100 + p), `${b}.jpg`)], sources: [story(`${b}.jpg`)] }), () => 'gone')
    const r = await run(w)
    is(`D: churning sources stop after ${MAX_PASSES} passes: exactly ${MAX_PASSES} reads and ${MAX_PASSES} writes`,
      [r.passes, w.reads(), w.writes.length], [MAX_PASSES, MAX_PASSES, MAX_PASSES])
    is('D: the last, never-confirmed gone is an explicit failure; the site is NOT clean',
      [isClean(r), r.failures.length, r.failures[0]?.message.startsWith(`unsettled after ${MAX_PASSES} pass(es)`)], [false, 1, true])
    // The SAME id keeps reappearing and keeps answering gone.
    const same = world(() => inv({ photos: [photo] }), () => 'gone')
    const rs = await run(same)
    is('D: the same row reappearing in every fresh read is asked again each pass, then fails explicitly',
      [same.writes.length, isClean(rs), rs.failures.length], [MAX_PASSES, false, 1])
    // …and if it then succeeds, the earlier gone is not kept.
    let n = 0
    const back = world(() => inv({ photos: [photo] }), () => (++n === 1 ? 'gone' : 'created'))
    const rb = await run(back)
    is('D: the same id gone once, then back and written: created, nothing provisional kept, clean',
      [back.writes.length, rb.writes.created, rb.writes.gone, isClean(rb)], [2, 1, 0, true])
    // A changed locator: the story moved into a block — the old slot settles, the new one is written.
    const moved = world((p) => p === 1 ? inv({ sources: [story(`${b}.jpg`)] })
      : inv({ sources: [{ ...story(''), source: { ...story('').source, featured: null, blocks: [{ type: 'image', image: { path: `${b}.jpg` } }] } }] }),
      (a) => (a.p_slot === 'featured' ? 'stale' : 'created'))
    const rm = await run(moved)
    is('D: a changed locator (featured → a block) settles the old attempt and writes the new one',
      [moved.writes.map(bySource), rm.writes.stale, isClean(rm)], [['document:featured', 'document:blocks/0/image'], 0, true])
  }

  // ── F. the dry run, in the same scenario: never a writer call ──
  {
    const w = world(() => inv({ photos: [photo], sources: [story(`${b}.jpg`)] }), () => 'gone')
    const r = await run(w, false)
    is('F: dry run — no writer call, one read, no provisional state', [w.writes.length, w.reads(), r.failures], [0, 1, []])
  }

  // ── G. rerun after A's outcome: nothing to write ──
  {
    const w = world(() => inv({ sources: [story(`${b}.jpg`)], assets: [asset(b, `${b}.jpg`)] }), () => 'created')
    const r = await run(w)
    is('G: rerun once the asset exists: zero writes, clean', [w.writes.length, isClean(r)], [0, true])
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. AGAINST A REAL, LOCAL POSTGRES
// ════════════════════════════════════════════════════════════════════════════

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])
const PG = {
  host: process.env.PGHOST ?? '',
  port: Number(process.env.PGPORT ?? 0),
  database: process.env.PGDATABASE ?? '',
  user: process.env.PGUSER ?? 'postgres',
}

/**
 * Parameters typed as Postgres text[] go as JS arrays (pg sends an array);
 * every other object or array is jsonb and goes as JSON text — p_refs is a
 * JSON array — exactly as PostgREST would send each.
 */
const TEXT_ARRAYS = new Set(['p_keywords', 'p_key_bases', 'p_source_tags'])
const param = (name: string, v: unknown) =>
  v !== null && typeof v === 'object' && !(Array.isArray(v) && TEXT_ARRAYS.has(name)) ? JSON.stringify(v) : v

type Hook = (fn: string, args: Record<string, unknown>) => Promise<void> | void

/** The backfill service as PostgREST runs it: one transaction per call, as service_role. */
function serviceRpc(client: Client, hooks: { before?: Hook; after?: Hook } = {}): BackfillRpc & UsageRpc {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (hooks.before) await hooks.before(fn, args)
      const names = Object.keys(args)
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`
      await client.query('begin')
      let out: { data: unknown; error: { message: string } | null }
      try {
        await client.query('set local role service_role')
        const r = await client.query(sql, names.map((n) => param(n, args[n])))
        await client.query('commit')
        out = { data: r.rows[0].v, error: null }
      } catch (e) {
        await client.query('rollback')
        out = { data: null, error: { message: (e as Error).message } }
      }
      if (hooks.after) await hooks.after(fn, args)
      return out
    },
  }
}

/** An interruption: thrown by a hook, outside any RPC's own error handling. */
class Interrupted extends Error {}

async function database() {
  if (UNIT_ONLY) {
    console.log('\nUNIT-ONLY: the database half was NOT run. This is not the full suite.')
    return
  }
  if (!LOOPBACK.has(PG.host) || !/^(p4_scratch_|lensgrid_p4_)/.test(PG.database) || !PG.port) {
    fail.push(`refusing to run the database half against ${PG.host}:${PG.port}/${PG.database} — local P4 scratch databases only (run through scripts/p4-local-db.mjs, or pass --unit-only)`)
    return
  }
  const owner = new Client(PG)
  try {
    await owner.connect()
  } catch (e) {
    fail.push(`the database half is required and could not connect: ${(e as Error).message}`)
    return
  }
  const has = await owner.query(`select to_regprocedure('public.read_photo_backfill_inventory(uuid)') is not null as there`)
  if (!has.rows[0].there) {
    fail.push('read_photo_backfill_inventory does not exist — apply db/migrations/2026-10-05_photo_backfill.sql first')
    await owner.end()
    return
  }
  const svc = new Client(PG)
  await svc.connect()
  const q = async (sql: string, args: unknown[] = []) => (await owner.query(sql, args)).rows
  const quiet = { warn: () => {}, error: () => {} }

  // ── The data: every era, on site A; a foreign claim from site B ──────────
  const F1 = `photos/${AA}/${u(101)}`             // flat + old-job ladder (+ a fake original.jpg beside it)
  const F2 = `photos/${AA}/${u(102)}`             // unprefixed folder + original
  const F3 = `t/${TA}/photos/${AA}/${u(103)}`     // prefixed folder, original discovered (png)
  const D1 = `photos/${AA}/${u(108)}`             // one upload, two rows
  const S1 = `t/${TA}/site-images/${u(104)}`      // an Uploads row
  const CV = `covers/${AA}/${u(105)}`             // a flat custom cover
  const JF = `journal/${u(106)}`                  // a flat journal file (featured image)
  const JD = `journal/${u(110)}`                  // a folder journal file (story block), original orientation 6
  const SX = `t/${TA}/site-images/${u(112)}`      // a page background with no row
  const JX = `journal/${u(115)}`                  // a journal file site B also names
  const LG = `covers/${AA}/${u(116)}`             // a legacy hero column SHADOWED by home's sections
  const P2 = `t/${TA}/photos/${AA}/${u(109)}`     // a real P2 upload
  const bucket: Record<string, Buffer> = {
    [`${F1}.jpg`]: JPEG, [`${F1}/400.webp`]: WEBP, [`${F1}/1600.webp`]: WEBP, [`${F1}/original.jpg`]: JPEG,
    ...filesOf(F2, ['400', '800', '1600', '2400']), [`${F2}/original.jpg`]: JPEG,
    ...filesOf(F3, ['400', '1600']), [`${F3}/original.png`]: PNG,
    [`${D1}.jpg`]: JPEG,
    ...filesOf(S1, ['400', '800']), [`${S1}/original.webp`]: WEBP,
    [`${CV}.jpg`]: JPEG,
    [`${JF}.jpg`]: JPEG,
    ...filesOf(JD, ['400', '800', '1600']), [`${JD}/original.jpg`]: ORIENTED,
    ...filesOf(SX, ['400', '800']), [`${SX}/original.webp`]: WEBP,
    [`${JX}/1600.webp`]: WEBP,
    [`${LG}.jpg`]: JPEG,
  }
  const MANIFEST = new Map([[TA, new Set([JF, JD, JX])]])
  const provenance = (t: string) => MANIFEST.get(t) ?? new Set<string>()
  const FIXTURE_PHOTOS = [pid(1), pid(2), pid(3)]

  const reset = async () => {
    await q(`delete from photo_usages where tenant_id in ($1, $2)`, [TA, TB])
    await q(`delete from photos where tenant_id in ($1, $2) and not (id = any ($3::uuid[]))`, [TA, TB, FIXTURE_PHOTOS])
    await q(`update photos set asset_id = null where id = any ($1::uuid[])`, [FIXTURE_PHOTOS])
    await q(`delete from site_images where tenant_id in ($1, $2)`, [TA, TB])
    await q(`delete from photo_assets where tenant_id in ($1, $2)`, [TA, TB])
    await q(`update albums set cover_photo_id = $2, cover_custom_path = null where id = $1`, [AA, pid(1)])
    await q(`update blog_posts set featured_custom_path = null, blocks = '[]' where id = $1`, [POST_A])
    await q(`delete from blog_posts where id = $1`, [POST_RACE])
    await q(`delete from page_sections where tenant_id in ($1, $2)`, [TA, TB])
    await q(`insert into page_sections (tenant_id, page, type, position, settings) values ($1, 'home', 'hero', 0, '{}')`, [TA])
    await q(`update site_settings set page_seo = '{}', hero_image_path = null where tenant_id in ($1, $2)`, [TA, TB])
    await q(`update site_draft set pages = '{}', page_seo = null where tenant_id = $1`, [TA])
  }

  const ins = `insert into photos (id, tenant_id, album_id, storage_path, original_path, derivatives, width, height, sort_order, taken_at, latitude, longitude, tags)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`
  const flatRow = (id: string, album: string, path: string) => q(ins, [id, TA, album, path, null, {}, 100, 75, 40, null, null, null, []])

  const seed = async () => {
    await q(ins, [pid(101), TA, AA, `${F1}.jpg`, null, ladder(F1, '400', '1600'), 2400, 1600, 10, '2019-07-01T06:00:00Z', -1.5, 35.1, MESSY_TAGS])
    await q(ins, [pid(102), TA, AA, `${F2}/2400.webp`, `${F2}/original.jpg`, ladder(F2, '400', '800', '1600', '2400'), 6000, 4000, 11, null, null, null, []])
    await q(ins, [pid(103), TA, AA, `${F3}/1600.webp`, null, ladder(F3, '400', '1600'), 1800, 1200, 12, null, null, null, []])
    await q(ins, [pid(104), TA, AA, '/samples/wildlife/lion.webp', null, {}, 1600, 1067, 13, null, null, null, []])
    await q(ins, [pid(108), TA, AA, `${D1}.jpg`, null, {}, 800, 600, 14, null, null, null, []])
    await q(ins, [pid(118), TA, AA2, `${D1}.jpg`, null, {}, 800, 600, 15, null, null, null, []])
    await q(`insert into site_images (id, tenant_id, storage_path, original_path, derivatives, width, height, bytes, filename)
             values ('eeeeeeee-0000-0000-0000-000000000104', $1, $2, $3, $4, 900, 600, 99, 'harbour.webp')`,
      [TA, `${S1}/800.webp`, `${S1}/original.webp`, ladder(S1, '400', '800')])
    await q(`update albums set cover_custom_path = $2 where id = $1`, [AA, `${CV}.jpg`])
    await q(`update blog_posts set featured_custom_path = $2, blocks = $3 where id = $1`,
      [POST_A, `${JF}.jpg`, JSON.stringify([{ id: 'b1', type: 'image', image: { path: `${JD}/1600.webp`, alt: '' }, caption: `${LG}.jpg` }])])
    await q(`delete from page_sections where tenant_id = $1`, [TA])
    await q(`insert into page_sections (tenant_id, page, type, position, settings) values ($1, 'home', 'hero', 0, $2), ($1, 'home', 'intro', 1, $3)`,
      [TA, { image_path: `${F1}/1600.webp`, video_path: `photos/${AA}/${u(111)}/original.jpg` }, { image_path: `${F2}/2400.webp`, bg_image: `${SX}/800.webp` }])
    // home HAS section rows, so this legacy column is a mirror: never an asset.
    await q(`update site_settings set hero_image_path = $2 where tenant_id = $1`, [TA, `${LG}.jpg`])
    await q(`update site_draft set pages = $2, page_seo = $3 where tenant_id = $1`,
      [TA, { home: [{ type: 'intro', settings: { image_path: `${JX}/1600.webp` } }] }, { home: { image: `${CV}.jpg` } }])
    await q(`insert into page_sections (tenant_id, page, type, position, settings) values ($1, 'home', 'intro', 0, $2)`, [TB, { image_path: `${JX}/1600.webp` }])
    await owner.query('begin')
    await owner.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER_A })])
    await owner.query('set local role authenticated')
    await owner.query(`select * from public.register_gallery_photo($1, $2, $3, $3 || '/original.jpg', $3 || '/800.webp',
                         jsonb_build_object('400', $3 || '/400.webp', '800', $3 || '/800.webp'), 800, 533, 4096, $4, 'image/jpeg',
                         null, null, null, null, null, null, null, null, null, '{}'::jsonb, null, null)`, [TA, AA, P2, 'ab'.repeat(32)])
    await owner.query('commit')
  }

  const fingerprint = async () =>
    (await q(`select md5(concat_ws('|',
       (select string_agg(to_jsonb(a)::text, '' order by a.key_base) from photo_assets a),
       (select string_agg(to_jsonb(p)::text, '' order by p.id) from photos p),
       (select string_agg(to_jsonb(s)::text, '' order by s.id) from site_images s),
       (select string_agg(to_jsonb(x)::text, '' order by x.id) from photo_usages x),
       (select string_agg(to_jsonb(al)::text, '' order by al.id) from albums al),
       (select string_agg(to_jsonb(b)::text, '' order by b.id) from blog_posts b),
       (select string_agg(to_jsonb(ps)::text, '' order by ps.id) from page_sections ps),
       (select string_agg(to_jsonb(d)::text, '' order by d.tenant_id) from site_draft d),
       (select string_agg(to_jsonb(st)::text, '' order by st.tenant_id) from site_settings st))) as f`))[0].f as string
  const p2State = async () =>
    (await q(`select to_jsonb(p)::text || to_jsonb(a)::text || coalesce((select string_agg(to_jsonb(x)::text, '' order by x.id)
                 from photo_usages x where x.photo_id = p.id), '') as s
                from photos p join photo_assets a on a.id = p.asset_id where a.key_base = $1`, [P2]))[0]?.s as string
  const logical = async (tenant: string) =>
    (await q(`select format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', scope, kind, asset_id, photo_id, album_id, post_id, product_id,
                            page_key, field, position, decorative) as r from photo_usages where tenant_id = $1 order by 1`, [tenant])).map((r) => r.r as string)
  const asset = async (keyBase: string) => (await q(`select * from photo_assets where tenant_id = $1 and key_base = $2`, [TA, keyBase]))[0]
  const run = (apply: boolean, hooks: { before?: Hook; after?: Hook } = {}, objects = bucket) =>
    backfillTenant(TA, apply, { rpc: serviceRpc(svc, hooks), storage: fakeBucket(objects).storage, provenance })

  try {
    await reset()
    await seed()

    // ── 4a. TS/SQL grammar parity ──
    for (const [path] of corpus()) {
      const sql = (await q(`select public.photo_backfill_key_base($1) as k`, [path]))[0].k as string | null
      const p = parseLegacyKey(path)
      is(`parity: ${JSON.stringify(path)}`, sql, p.ok ? p.keyBase : null)
    }

    // ── 4b. A DRY RUN writes nothing ──
    const before = await fingerprint()
    const p2Before = await p2State()
    ok('the real P2 upload is in place', typeof p2Before === 'string' && p2Before.length > 0)
    const names: string[] = []
    const dryBucket = fakeBucket(bucket)
    const dry = await backfillTenant(TA, false, { rpc: serviceRpc(svc, { before: (fn) => void names.push(fn) }), storage: dryBucket.storage, provenance })
    is('dry run: nothing in the database changed', await fingerprint(), before)
    is('dry run: the writer was never called', names.filter((n) => n === 'register_legacy_photo_asset').length, 0)
    // From the data above. Create: F1, F2, F3, the first D1 row, S1, CV, JF,
    // JD, SX — 9 (LG is a shadowed mirror; JX is claimed by site B). Reuse: the
    // second D1 row — 1.
    is('dry run: the plan, from the facts', dry.planned, { create: 9, reuse: 1 })

    // ── 4c. APPLY ──
    const usagesBefore = await logical(TA)
    const applyBucket = fakeBucket(bucket)
    const r = await backfillTenant(TA, true, { rpc: serviceRpc(svc), storage: applyBucket.storage, provenance })
    is('apply: created 9, reused 1, nothing failed or stale', [r.writes.created, r.writes.reused, r.writes.failed, r.writes.stale], [9, 1, 0, 0])
    is('apply: six rows linked', r.linked, 6)
    is("apply: the refusals — site B's claim and the fixture's three unshaped rows",
      r.refusals.map((x) => x.reason).sort(), ['foreign_claim', 'unknown_shape', 'unknown_shape', 'unknown_shape'])
    is('apply: the shadowed legacy column got no asset', await asset(LG), undefined)
    is("apply: unlinked are only the sample and the fixture's unshaped rows",
      (await q(`select id from photos where tenant_id = $1 and asset_id is null order by id`, [TA])).map((x) => x.id), [pid(1), pid(2), pid(3), pid(104)].sort())
    is('apply: rows and their assets agree on display path and size', (await q(
      `select count(*)::int as n from photos p join photo_assets a on a.id = p.asset_id
        where p.tenant_id = $1 and (a.display_path <> p.storage_path or a.width is distinct from p.width or a.height is distinct from p.height)`, [TA]))[0].n, 0)
    is('apply: P3 is still the only usage writer — the backfill wrote none', await logical(TA), usagesBefore)
    is('apply: the P2 upload, its asset and its usage are byte-for-byte unchanged', await p2State(), p2Before)
    is('apply: storage was only ever HEADed and GOT', [...new Set(applyBucket.calls.map((c) => c.verb))].sort(), ['get', 'head'])
    ok('apply: the bucket object was only asked for head/get', [...applyBucket.touched].every((p) => ['head', 'get', 'then'].includes(p)), [...applyBucket.touched].join(','))
    const a1 = await asset(F1)
    is('flat asset: the flat JPEG is the display file, its old-job ladder kept, no original',
      [a1.display_path, a1.derivatives, a1.original_path, a1.content_sha256], [`${F1}.jpg`, ladder(F1, '400', '1600'), null, null])
    is("flat asset: the row's date and place; keywords = normalizeKeywords(its messy tags)",
      [new Date(a1.taken_at).toISOString(), a1.latitude, a1.longitude, a1.keywords], ['2019-07-01T06:00:00.000Z', -1.5, 35.1, MESSY_KEYWORDS])
    is('flat asset: …and the row\'s own tags are byte-for-byte what they were', (await q(`select tags from photos where id = $1`, [pid(101)]))[0].tags, MESSY_TAGS)
    const a2 = await asset(F2)
    is("folder asset: the original's hash and bytes; the row's size", [a2.content_sha256, Number(a2.original_bytes), a2.content_type, a2.width, a2.height],
      [sha(JPEG), JPEG.byteLength, 'image/jpeg', 6000, 4000])
    is('discovered original: png', [(await asset(F3)).original_path, (await asset(F3)).content_type], [`${F3}/original.png`, 'image/png'])
    const jd = await asset(JD)
    is("folder journal (no row): its ladder, its largest size, the original's UPRIGHT size",
      [jd.derivatives, jd.display_path, jd.width, jd.height], [ladder(JD, '400', '800', '1600'), `${JD}/1600.webp`, 2, 4])
    const cv = await asset(CV)
    is('flat cover: sparse — no ladder, no original, size unknown', [cv.display_path, cv.derivatives, cv.original_path, cv.width], [`${CV}.jpg`, {}, null, null])
    is('every backfilled asset: derived, derived_at unknown, created_by nobody',
      await q(`select distinct state, derived_at, created_by from photo_assets where tenant_id = $1 and key_base <> $2`, [TA, P2]),
      [{ state: 'derived', derived_at: null, created_by: null }])
    is('the two rows of one upload share one asset', (await q(`select count(distinct asset_id)::int n from photos where id in ($1, $2)`, [pid(108), pid(118)]))[0].n, 1)
    is('the foreign-claimed journal file got NO asset', await asset(JX), undefined)

    // ── 4d. A RERUN writes nothing ──
    const settled = await fingerprint()
    const again: string[] = []
    const r2 = await run(true, { before: (fn) => void again.push(fn) })
    is('rerun: not one writer call', again.filter((n) => n === 'register_legacy_photo_asset').length, 0)
    is('rerun: the database is byte-for-byte what the first run left', await fingerprint(), settled)
    is('rerun: the same refusals, honestly repeated', r2.refusals.length, r.refusals.length)

    // ── 4e. THEN P3: the rebuild resolves them, and is its own invariant ──
    const rebuilt = await rebuildUsages(TA, { rpc: serviceRpc(svc), log: quiet })
    is('rebuild: every parent projected', rebuilt.failed, 0)
    // Album aa: F1, F2, F3, the first D1 row, P2 = 5; album aa2: the second D1 row = 1.
    is('rebuild: gallery rows for every linked photograph', (await q(`select count(*)::int n from photo_usages where tenant_id = $1 and kind = 'gallery'`, [TA]))[0].n, 6)
    is('rebuild: the flat cover, the flat featured image, the folder story block and the page background resolve',
      (await q(`select string_agg(kind || ':' || field, ',' order by kind, field) s from photo_usages
                 where tenant_id = $1 and scope = 'live' and (kind in ('gallery_cover', 'story_cover', 'story_block')
                    or (kind = 'page_section' and field = 'bg_image'))`, [TA]))[0].s,
      'gallery_cover:cover_custom_path,page_section:bg_image,story_block:block:0,story_cover:featured_custom_path')
    is('rebuild: the draft share image (the flat cover) resolves', (await q(`select count(*)::int n from photo_usages where tenant_id = $1 and scope = 'draft' and kind = 'page_share'`, [TA]))[0].n, 1)
    const projection = await logical(TA)
    ok('rebuild: the projection is not empty', projection.length >= 11, String(projection.length))
    await q(`delete from photo_usages where tenant_id = $1`, [TA])
    await rebuildUsages(TA, { rpc: serviceRpc(svc), log: quiet })
    is('THE INVARIANT: delete every usage, rebuild, and it comes back identical', await logical(TA), projection)
    await rebuildUsages(TA, { rpc: serviceRpc(svc), log: quiet })
    is('…and a second rebuild projects the same set', await logical(TA), projection)

    // ── 4f. Interruption, before and after a commit ──
    const I1 = `photos/${AA}/${u(130)}`
    const I2 = `photos/${AA}/${u(131)}`
    const more = { ...bucket, [`${I1}.jpg`]: JPEG, [`${I2}.jpg`]: JPEG }
    await flatRow(pid(130), AA, `${I1}.jpg`)
    await flatRow(pid(131), AA, `${I2}.jpg`)
    const at130 = (fn: string, a: Record<string, unknown>) => fn === 'register_legacy_photo_asset' && a.p_source_id === pid(130)
    const cut = await run(true, { before: (fn, a) => { if (at130(fn, a)) throw new Interrupted('the process died before the call') } }, more)
      .then(() => 'finished', (e) => (e instanceof Interrupted ? 'interrupted' : String(e)))
    is('interrupted BEFORE a call: the run stops', cut, 'interrupted')
    is('…and neither photograph is linked (the second was never reached)',
      (await q(`select asset_id from photos where id in ($1, $2)`, [pid(130), pid(131)])).map((x) => x.asset_id), [null, null])
    const lost = await run(true, { after: (fn, a) => { if (at130(fn, a)) throw new Interrupted('the process died after the commit') } }, more)
      .then(() => 'finished', (e) => (e instanceof Interrupted ? 'interrupted' : String(e)))
    is('interrupted AFTER a commit: the run stops', lost, 'interrupted')
    is('…but that commit stands; the next was never reached',
      (await q(`select id, asset_id is not null as l from photos where id in ($1, $2) order by id`, [pid(130), pid(131)])).map((x) => x.l), [true, false])
    const resumed: string[] = []
    const r3 = await run(true, { before: (fn, a) => void (fn === 'register_legacy_photo_asset' && resumed.push(String(a.p_source_id))) }, more)
    is('resumed: only the photograph not yet done is written', [resumed, r3.writes.created], [[pid(131)], 1])
    is('resumed: one asset per upload, no duplicates', (await q(`select count(*)::int n from photo_assets where key_base in ($1, $2)`, [I1, I2]))[0].n, 2)

    // ── 4g. A source that changes under the backfill ──
    const ST = `photos/${AA}/${u(140)}`
    await flatRow(pid(140), AA, `${ST}.jpg`)
    let edited = false
    const r4 = await run(true, { before: async (fn, a) => {
      if (fn === 'register_legacy_photo_asset' && a.p_source_id === pid(140) && !edited) {
        edited = true
        await q(`update photos set width = 120, height = 90, tags = '{edited}' where id = $1`, [pid(140)])
      }
    } }, { ...more, [`${ST}.jpg`]: JPEG })
    is('a row edited mid-run: stale once, then written from the NEW row, clean', [r4.passes, r4.writes.created, r4.writes.stale, isClean(r4) || r4.refusals.every((x) => x.reason === 'foreign_claim' || x.reason === 'unknown_shape')], [2, 1, 0, true])
    is('…the asset carries the edited size and the edited tags', [(await asset(ST)).width, (await asset(ST)).height, (await asset(ST)).keywords], [120, 90, ['edited']])
    // ONLY the tags change mid-run: nothing but the tags snapshot can notice.
    const TG = `photos/${AA}/${u(143)}`
    await flatRow(pid(143), AA, `${TG}.jpg`)
    let retagged = false
    const r4b = await run(true, { before: async (fn, a) => {
      if (fn === 'register_legacy_photo_asset' && a.p_source_id === pid(143) && !retagged) {
        retagged = true
        await q(`update photos set tags = $2 where id = $1`, [pid(143), ['  Zebra', 'MARA ']])
      }
    } }, { ...more, [`${TG}.jpg`]: JPEG })
    is('only the tags edited mid-run: stale once, then written', [r4b.passes, r4b.writes.created, r4b.writes.stale], [2, 1, 0])
    is('…with the NEW tags, normalised by the one normaliser', (await asset(TG)).keywords, normalizeKeywords(['  Zebra', 'MARA ']))
    // The path moves mid-run: the old attempt is settled by the re-plan.
    const MV = `photos/${AA}/${u(141)}`
    const MV2 = `photos/${AA}/${u(142)}`
    await flatRow(pid(141), AA, `${MV}.jpg`)
    let movedIt = false
    const r5 = await run(true, { before: async (fn, a) => {
      if (fn === 'register_legacy_photo_asset' && a.p_source_id === pid(141) && !movedIt) {
        movedIt = true
        await q(`update photos set storage_path = $2 where id = $1`, [pid(141), `${MV2}.jpg`])
      }
    } }, { ...more, [`${MV}.jpg`]: JPEG, [`${MV2}.jpg`]: JPEG })
    is('a path moved mid-run: the new path written, no stale attempt left over', [r5.writes.stale, r5.writes.created, (await asset(MV2))?.display_path], [0, 1, `${MV2}.jpg`])

    // THE ONE-BINDING RACE, for real: a gallery photograph and a story name the
    // same flat file; the photograph is deleted just before its write, so the
    // DATABASE answers `gone`. The story must still get the asset.
    const GR = `photos/${AA}/${u(144)}`
    await flatRow(pid(144), AA, `${GR}.jpg`)
    await q(`insert into blog_posts (id, tenant_id, title, slug, status, featured_custom_path) values ($1, $2, 'Race', 'race', 'draft', $3)`,
      [POST_RACE, TA, `${GR}.jpg`])
    const raceCalls: string[] = []
    let deletedIt = false
    const r6 = await run(true, { before: async (fn, a) => {
      if (fn !== 'register_legacy_photo_asset' || a.p_key_base !== GR) return
      raceCalls.push(String(a.p_source))
      if (a.p_source === 'photo' && !deletedIt) {
        deletedIt = true
        await q(`delete from photos where id = $1`, [pid(144)])
      }
    } }, { ...more, [`${GR}.jpg`]: JPEG })
    is('race (real DB): the photograph deleted under its write → gone → fresh read → the story binds and creates',
      [raceCalls, r6.writes.gone, r6.writes.created, r6.passes], [['photo', 'document'], 1, 1, 2])
    is('race (real DB): the asset exists, bound to the story\'s file, and no failure is left over',
      [(await asset(GR))?.display_path, r6.failures], [`${GR}.jpg`, []])
    const again6: string[] = []
    await run(true, { before: (fn, a) => void (fn === 'register_legacy_photo_asset' && a.p_key_base === GR && again6.push('x')) }, { ...more, [`${GR}.jpg`]: JPEG })
    is('race (real DB): a rerun writes nothing more for it', again6.length, 0)

    // ── 4h. TWO CONNECTIONS ──
    const c1 = new Client(PG)
    const c2 = new Client(PG)
    await c1.connect()
    await c2.connect()
    const waits = async (c: Client) => {
      for (let i = 0; i < 100; i++) {
        await new Promise((res) => setTimeout(res, 30))
        const w = await q(`select count(*)::int as n from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'`, [(c as unknown as { processID: number }).processID])
        if (w[0].n === 1) return true
      }
      return false
    }
    const regSql = `select public.register_legacy_photo_asset(p_tenant => $1, p_source => 'photo', p_source_id => $2, p_parent => null,
                      p_parent_key => null, p_slot => null, p_source_path => $3, p_key_base => $4, p_original_path => null, p_display_path => $3,
                      p_derivatives => '{}', p_width => 100, p_height => 75, p_original_bytes => null, p_content_sha256 => null,
                      p_content_type => null, p_taken_at => null, p_camera_make => null, p_camera_model => null, p_lens => null,
                      p_iso => null, p_aperture => null, p_shutter => null, p_focal_length => null,
                      p_keywords => '{}'::text[], p_source_tags => '{}'::text[],
                      p_exif => '{}', p_provenance_reviewed => false) as v`
    const inTx = async (c: Client, sql: string, args: unknown[]) => {
      await c.query('begin')
      await c.query('set local role service_role')
      return (await c.query(sql, args)).rows[0].v
    }
    try {
      const CC = `photos/${AA}/${u(150)}`
      await flatRow(pid(150), AA, `${CC}.jpg`)
      await flatRow(pid(151), AA2, `${CC}.jpg`)
      is('race: the first registration holds its transaction open', (await inTx(c1, regSql, [TA, pid(150), `${CC}.jpg`, CC])).status, 'created')
      const twoP = inTx(c2, regSql, [TA, pid(151), `${CC}.jpg`, CC]).then(async (v) => { await c2.query('commit'); return v })
      ok('race: the second WAITS (the key lock)', await waits(c2))
      await c1.query('commit')
      is("race: then REUSES the first's asset", (await twoP).status, 'reused')
      is('race: one asset, both rows on it', (await q(`select count(distinct asset_id)::int n, count(*)::int m from photos where id in ($1, $2)`, [pid(150), pid(151)]))[0], { n: 1, m: 2 })

      const AL = `photos/${AA}/${u(160)}`
      await flatRow(pid(160), AA, `${AL}.jpg`)
      const snap = await inTx(c1, `select public.read_photo_usage_source($1, 'album', $2) as v`, [TA, AA])
      is('lock: an album sync holds its transaction open', (await c1.query(`select public.sync_photo_usages($1, 'album', $2, $3, '[]') as v`, [TA, AA, snap])).rows[0].v.stale, false)
      const regP = inTx(c2, regSql, [TA, pid(160), `${AL}.jpg`, AL]).then(async (v) => { await c2.query('commit'); return v })
      ok('lock: the backfill writer WAITS for the album projection', await waits(c2))
      await c1.query('commit')
      is('lock: then writes', (await regP).status, 'created')

      // A document binding vs. a projection of the same story.
      const DJ = `t/${TA}/journal/${u(170)}`
      await q(`update blog_posts set blocks = $2 where id = $1`, [POST_A, JSON.stringify([{ id: 'z', type: 'image', image: { path: `${DJ}/400.webp` } }])])
      const psnap = await inTx(c1, `select public.read_photo_usage_source($1, 'post', $2) as v`, [TA, POST_A])
      await c1.query(`select public.sync_photo_usages($1, 'post', $2, $3, '[]') as v`, [TA, POST_A, psnap])
      const docSql = regSql.replace(`p_source => 'photo', p_source_id => $2, p_parent => null,\n                      p_parent_key => null, p_slot => null`,
        `p_source => 'document', p_source_id => null, p_parent => 'post',\n                      p_parent_key => $2, p_slot => 'blocks/0/image'`)
        .replace(`p_derivatives => '{}', p_width => 100, p_height => 75`, `p_derivatives => jsonb_build_object('400', $4 || '/400.webp'), p_width => null, p_height => null`)
        .replace(`p_keywords => '{}'::text[], p_source_tags => '{}'::text[]`, `p_keywords => null, p_source_tags => null`)
      ok('(the document variant of the call is well formed)', docSql !== regSql && docSql.includes("p_slot => 'blocks/0/image'") && docSql.includes('p_source_tags => null'))
      const docP = inTx(c2, docSql, [TA, POST_A, `${DJ}/400.webp`, DJ]).then(async (v) => { await c2.query('commit'); return v }, async (e) => { await c2.query('rollback'); return { status: (e as Error).message } })
      ok('lock: a document binding WAITS for a projection of the same story', await waits(c2))
      await c1.query('commit')
      is('lock: then binds to the saved slot', (await docP).status, 'created')
      // Residual, stated: the document's OWN writers do not take this lock. An
      // edit committed after the binding leaves an asset nothing places —
      // harmless (unused assets are allowed) and the projection never names it.
      await q(`update blog_posts set blocks = '[]' where id = $1`, [POST_A])
      const after = await rebuildUsages(TA, { rpc: serviceRpc(svc), log: quiet })
      is('residual: the story edited away afterwards — the asset stays, unplaced, and the rebuild projects nothing for it',
        [after.failed, (await q(`select count(*)::int n from photo_usages u join photo_assets a on a.id = u.asset_id where a.key_base = $1`, [DJ]))[0].n, !!(await asset(DJ))], [0, 0, true])
    } finally {
      await c1.end()
      await c2.end()
    }
  } finally {
    await reset()
    await svc.end()
    await owner.end()
  }
}

images()
  .then(() => {
    grammar()
    manifestAndArgs()
  })
  .then(cliRuns)
  .then(source)
  .then(planner)
  .then(applier)
  .then(database)
  .catch((e) => fail.push(`the suite threw: ${e instanceof Error ? e.stack : String(e)}`))
  .finally(() => {
    if (fail.length) console.log('\nFAILED:\n  ' + fail.join('\n  '))
    console.log(`\n${pass + fail.length} assertions${UNIT_ONLY ? ' (UNIT-ONLY — not the full suite)' : ''}\n\n${pass} passed, ${fail.length} failed`)
    process.exit(fail.length ? 1 : 0)
  })
