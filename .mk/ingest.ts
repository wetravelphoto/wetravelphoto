import { Client } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import sharp from 'sharp'

import {
  IngestError,
  SIGNED_UPLOAD_TYPES,
  acceptsContentType,
  contentTypeOf,
  fromSupabase,
  ingestPhoto,
  normalizeFilename,
  type IngestDb,
  type IngestInput,
} from '../lib/photos/ingest'
import { EXIF_KEYS, formatShutter, normalizeCapture, normalizeKeywords, readCapture } from '../lib/photos/exif'
import { isOriginalOf, isRouteKeyBase, routePrefix } from '../lib/photos/key-base'
import type { PhotoStorage } from '../lib/photos/storage'
import { ownsKey } from '../lib/storage-keys'

/**
 * P2: EVERY PHOTOGRAPH COMES IN ONE WAY
 * ═════════════════════════════════════
 *
 * `db/verify-photo-ingest.sql` proves the database boundary. This proves the
 * application above it:
 *
 *   1. the source — all four upload routes call `ingestPhoto`, with the site
 *      from `requireEditor()`; nothing else calls the ladder except the one
 *      named exemption; sample seeding never ingests;
 *   2. the facts — the hash is of the source bytes, the byte count is the
 *      server's, the ladder is right for a small photograph, the content type
 *      comes from the pixels;
 *   3. EXIF — normalised, bounded, and GPS only for a gallery upload;
 *   4. failure — a failed registration cleans up exactly the attempt's
 *      objects, and NOTHING when a committed asset owns them;
 *   5. against a real Postgres, as the real role: all four routes end to end,
 *      retries, "the reply was lost after the commit", and CONCURRENT
 *      registrations of one upload (routes A and B) producing one row.
 *
 * Needs a Postgres carrying db/test-fixture.sql, which since the P2 deployment
 * (Supabase 20260930191116) was reconciled into it already contains P2:
 *
 *   PGHOST=/tmp PGPORT=5433 PGDATABASE=wtp PGUSER=postgres npx tsx .mk/ingest.ts
 *
 * With no database the first four parts run and the fifth SKIPS LOUDLY.
 */

const ROOT = resolve(__dirname, '..')

const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const TENANT_B = 'aaaaaaaa-0000-0000-0000-000000000002'
const USER_A = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'
const ALBUM_A = 'bbbbbbbb-0000-0000-0000-000000000001'

let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') =>
  good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`)
const is = (n: string, got: unknown, want: unknown) =>
  ok(
    n,
    JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got) === JSON.stringify(want)
      ? ''
      : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`
  )

async function rejects(p: Promise<unknown>): Promise<IngestError | Error | null> {
  try {
    await p
    return null
  } catch (e) {
    return e as Error
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. THE SOURCE
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
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

{
  // Every call to the ladder, wherever it is.
  const calls = new Map<string, string[]>()
  for (const file of SOURCES) {
    const text = readFileSync(file, 'utf8')
    for (const fn of ['processExistingOriginal', 'processPhoto']) {
      const n = (text.match(new RegExp(`(?<!function )\\b${fn}\\(`, 'g')) ?? []).length
      if (n > 0 && rel(file) !== 'lib/derivatives.ts') {
        calls.set(fn, [...(calls.get(fn) ?? []), rel(file)])
      }
    }
  }
  is('processExistingOriginal( is called from lib/photos/ingest.ts and NOWHERE else',
    calls.get('processExistingOriginal') ?? [], ['lib/photos/ingest.ts'])
  // The named, temporary exemption is GONE (P4): the pre-ladder derivative job
  // (lib/jobs/derive.ts) was retired rather than brought under assets, so no
  // code path makes sizes without an asset any more — not even that one.
  is('processPhoto( is called from NOWHERE — P4 retired the one exemption',
    calls.get('processPhoto') ?? [], [])

  // The four routes, each calling ingestPhoto with ITS route and a site taken
  // from requireEditor() — never from anything the browser sent.
  const ROUTES: [string, string, string][] = [
    ['app/actions/photos.ts', 'registerPhoto', 'gallery'],
    ['app/actions/images.ts', 'registerSiteImage', 'site'],
    ['app/actions/blog.ts', 'registerJournalImage', 'journal'],
    ['app/actions/albums.ts', 'uploadCustomCover', 'cover'],
  ]
  for (const [file, fn, route] of ROUTES) {
    const text = read(file)
    const start = text.indexOf(`export async function ${fn}(`)
    const end = text.indexOf('\nexport ', start + 1)
    const body = start < 0 ? '' : text.slice(start, end < 0 ? undefined : end)
    ok(`${fn} exists`, body.length > 0)
    ok(`${fn} takes the site from requireEditor()`, /const \{ tenantId \} = await requireEditor\(\)/.test(body))
    ok(`${fn} calls ingestPhoto with route '${route}' and that tenantId`,
      new RegExp(`ingestPhoto\\(\\s*\\{\\s*route: '${route}',\\s*tenantId,`).test(body))
    ok(`${fn} passes the photographer's own client, not the service role`,
      /\{ db: fromSupabase\(supabase\) \}/.test(body) && /const supabase = await createClient\(\)/.test(body)
        && !/createAdminClient/.test(body))
    ok(`${fn} never reads a tenant from its arguments or the form`,
      !/formData\.get\('tenant|tenantId:\s*(?!tenantId)[a-zA-Z_.]+\s*[,}]/.test(body))
  }

  // Return contracts — the successful shapes are the ones the clients expect.
  ok('registerPhoto still returns nothing',
    /export async function registerPhoto\([\s\S]*?originalBytes: number\n\) \{/.test(read('app/actions/photos.ts')))
  ok('registerSiteImage still returns { ok, path, id } | { ok: false, message }',
    read('app/actions/images.ts').includes(
      '): Promise<{ ok: true; path: string; id: string | null } | { ok: false; message: string }> {'))
  ok('registerJournalImage still returns a path or null',
    read('app/actions/blog.ts').includes(
      'export async function registerJournalImage(key: string, base: string): Promise<string | null> {'))
  ok('uploadCustomCover still returns nothing',
    read('app/actions/albums.ts').includes(
      'export async function uploadCustomCover(albumId: string, formData: FormData) {'))

  // The mounted cover editor always leaves "Uploading…" when the upload
  // fails — the loading state is restored in a `finally`, not after the await.
  {
    const editor = read('components/admin/AlbumSettingsEditor.tsx')
    const start = editor.indexOf('async function handleCustomUpload(')
    const body = editor.slice(start, editor.indexOf('\n  }\n', start))
    ok('AlbumSettingsEditor restores the upload state in a finally',
      /try \{[\s\S]*await uploadCustomCover\(albumId, fd\)[\s\S]*\} finally \{\s*setUploading\(null\)\s*\}/.test(body))
    ok('…and does not swallow the failure', !/catch/.test(body))
  }

  // Sample seeding never touches ingestion.
  const sites = read('app/actions/sites.ts')
  ok('sample seeding does not call ingestPhoto or a register_* function',
    !/ingestPhoto|register_(gallery_photo|site_image|journal_image|album_cover)/.test(sites))
}

// ════════════════════════════════════════════════════════════════════════════
// 2. KEYS AND SAMPLES
// ════════════════════════════════════════════════════════════════════════════

{
  const u = randomUUID()
  ok('a gallery key base is recognised', isRouteKeyBase('gallery', TENANT_A, `t/${TENANT_A}/photos/${ALBUM_A}/${u}`, ALBUM_A))
  ok('…but not for another album', !isRouteKeyBase('gallery', TENANT_A, `t/${TENANT_A}/photos/${ALBUM_A}/${u}`, randomUUID()))
  ok('…nor for another site', !isRouteKeyBase('gallery', TENANT_B, `t/${TENANT_A}/photos/${ALBUM_A}/${u}`, ALBUM_A))
  ok('…nor with a traversal', !isRouteKeyBase('site', TENANT_A, `t/${TENANT_A}/site-images/../${u}`))
  ok('…nor with an upper-case id', !isRouteKeyBase('journal', TENANT_A, `t/${TENANT_A}/journal/${u.toUpperCase()}`))
  ok('an original is recognised', isOriginalOf(`k/${u}`, `k/${u}/original.jpg`))
  ok('…but not another extension', !isOriginalOf(`k/${u}`, `k/${u}/original.exe`))
  is('the site-image prefix is the one /api/upload-url mints', routePrefix('site', TENANT_A), `t/${TENANT_A}/site-images/`)

  // A built-in sample is not this site's to register — refused by ownsKey and
  // by ingestPhoto's own key check, before a single byte is read.
  ok('ownsKey refuses a sample path', !ownsKey(TENANT_A, '/samples/church/2400.webp'))
  ok('isRouteKeyBase refuses a sample path', !isRouteKeyBase('journal', TENANT_A, '/samples/church'))
}

// ════════════════════════════════════════════════════════════════════════════
// 3. EXIF — pure normalisation
// ════════════════════════════════════════════════════════════════════════════

{
  is('1/250 s', formatShutter(0.004), '1/250')
  is('2 s', formatShutter(2), '2s')
  is('2.5 s', formatShutter(2.5), '2.5s')
  is('no shutter for 0', formatShutter(0), null)
  is('keywords: today\'s rule (trim, lower-case, drop empties, first 25)',
    normalizeKeywords([' Heron ', 'WADER', '', 7, ...Array.from({ length: 30 }, (_, i) => `k${i}`)]).slice(0, 4),
    ['heron', 'wader', 'k0', 'k1'])
  is('keywords: at most 25', normalizeKeywords(Array.from({ length: 30 }, (_, i) => `k${i}`)).length, 25)
  is('keywords: each at most 200 characters, no control characters',
    normalizeKeywords(['a'.repeat(250), 'b\u0000c']), ['a'.repeat(200), 'bc'])
  is('keywords: a single string becomes a list', normalizeKeywords('Heron'), ['heron'])

  const c = normalizeCapture(
    {
      Make: ' Sony ', Model: 'ILCE-1', LensModel: 'FE 600mm F4 GM OSS', ISO: 400, FNumber: 5.6,
      ExposureTime: 0.004, FocalLength: 600, Keywords: ['Heron'],
      DateTimeOriginal: new Date('2026-05-01T06:30:00Z'), Orientation: 6, OffsetTimeOriginal: '+02:00',
      ExposureProgram: 3, ExposureMode: 0, ExposureCompensation: -0.666, MeteringMode: 5, Flash: 16,
      WhiteBalance: 0, FocalLengthIn35mmFormat: 600, LensMake: 'Sony', ColorSpace: 1,
      Software: 'Lightroom', latitude: 51.5, longitude: -0.125,
      BodySerialNumber: '12345', Artist: 'Someone', Copyright: '(c)', GPSLatitude: [51, 30, 0],
      MakerNote: 'binary', UserComment: 'free text',
    },
    { gps: true }
  )
  is('capture columns normalised', [c.taken_at, c.camera_make, c.camera_model, c.lens, c.iso, c.aperture, c.shutter, c.focal_length, c.keywords],
    ['2026-05-01T06:30:00.000Z', 'Sony', 'ILCE-1', 'FE 600mm F4 GM OSS', 400, 5.6, '1/250', 600, ['heron']])
  is('the exif subset, allowlisted and nothing else', c.exif, {
    v: 1, orientation: 6, offset_time: '+02:00', exposure_program: 'aperture_priority', exposure_mode: 'auto',
    exposure_bias_ev: -0.67, metering_mode: 'pattern', flash_fired: false, white_balance: 'auto',
    focal_length_35mm: 600, lens_make: 'Sony', color_space: 'srgb', software: 'Lightroom',
  })
  ok('every exif key is on the allowlist', Object.keys(c.exif).every((k) => (EXIF_KEYS as readonly string[]).includes(k)))
  ok('no serial, owner, artist, copyright, GPS tag, maker note or free text in exif',
    !/Serial|Artist|Copyright|GPS|MakerNote|UserComment/i.test(JSON.stringify(c.exif)))
  is('GPS kept for a gallery upload', [c.latitude, c.longitude], [51.5, -0.125])
  const noGps = normalizeCapture({ latitude: 51.5, longitude: -0.125, Make: 'Sony' }, { gps: false })
  is('GPS dropped for every other route, even when the file carries it', [noGps.latitude, noGps.longitude], [null, null])
  const bad = normalizeCapture(
    { ISO: 0, FNumber: 200, FocalLength: -5, ExposureTime: -1, Orientation: 9, Make: 7, Model: 'x'.repeat(80) },
    { gps: true }
  )
  is('out-of-range optional values become NULL (long strings are cut)',
    [bad.iso, bad.aperture, bad.focal_length, bad.shutter, bad.camera_make, bad.camera_model?.length, bad.exif],
    [null, null, null, null, null, 64, {}])
  is('nothing at all gives the empty capture', normalizeCapture(null, { gps: true }).exif, {})
  ok('the fullest exif stays well under 1024 bytes', JSON.stringify(c.exif).length < 1024)

  is('content type from the pixels', [contentTypeOf('jpeg'), contentTypeOf('heif', 'av1'), contentTypeOf('heif', 'hevc'), contentTypeOf('gif')],
    ['image/jpeg', 'image/avif', 'image/heif', null])
  is('file names: the last segment, plain, ≤ 120', [normalizeFilename('C:\\x\\heron.jpg'), normalizeFilename('a\u0007b'), normalizeFilename('x'.repeat(130))?.length, normalizeFilename('   ')],
    ['heron.jpg', 'ab', 120, null])
}

// ════════════════════════════════════════════════════════════════════════════
// 4. THE PIPELINE, THROUGH THE STORAGE SEAM
// ════════════════════════════════════════════════════════════════════════════

/** A bucket in memory that records every read, write and delete. */
function memoryStorage(seed: Record<string, Buffer> = {}, opts: { failRemove?: boolean } = {}) {
  const objects = new Map(Object.entries(seed))
  const log = { reads: [] as string[], writes: [] as string[], removes: [] as string[] }
  const storage: PhotoStorage = {
    async read(key) {
      log.reads.push(key)
      return objects.get(key) ?? null
    },
    async write(key, body) {
      log.writes.push(key)
      objects.set(key, body)
    },
    async remove(keys) {
      log.removes.push(...keys)
      if (opts.failRemove) return keys
      for (const k of keys) objects.delete(k)
      return []
    },
  }
  return { storage, objects, log }
}

type Call = { fn: string; args: Record<string, unknown> }

/** A database that answers as told, and records what it was asked. */
function fakeDb(answer: (c: Call) => { data: unknown; error: { message: string } | null }, exists: boolean | null = false) {
  const calls: Call[] = []
  const db: IngestDb = {
    rpc: async (fn, args) => {
      calls.push({ fn, args })
      return answer({ fn, args })
    },
    assetExists: async () => exists,
  }
  return { db, calls }
}

const okAnswer = ({ fn }: Call) =>
  fn === 'register_gallery_photo'
    ? { data: [{ photo_id: 'p-1', asset_id: 'a-1' }], error: null }
    : fn === 'register_site_image'
      ? { data: [{ site_image_id: 's-1', asset_id: 'a-1' }], error: null }
      : { data: 'a-1', error: null }

async function jpeg(width: number, height: number, withGps = false): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#6a8' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Sony', Model: 'ILCE-1' },
      IFD2: { ExposureTime: '1/250', FNumber: '56/10', ISOSpeedRatings: '400' },
      ...(withGps ? { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 30/1' } } : {}),
    })
    .toBuffer()
}

function inputFor(route: IngestInput['route'], bytes: Buffer, tenant = TENANT_A, album = ALBUM_A): IngestInput {
  const keyBase = `${routePrefix(route, tenant, album)}${randomUUID()}`
  const sourceKey = `${keyBase}/original.jpg`
  switch (route) {
    case 'gallery':
      return { route, tenantId: tenant, albumId: album, keyBase, sourceKey }
    case 'site':
      return { route, tenantId: tenant, keyBase, sourceKey, filename: 'heron.jpg' }
    case 'journal':
      return { route, tenantId: tenant, keyBase, sourceKey }
    case 'cover':
      return { route, tenantId: tenant, albumId: album, keyBase, bytes, filename: 'cover.jpg' }
  }
}

function seedFor(input: IngestInput, bytes: Buffer): Record<string, Buffer> {
  return 'sourceKey' in input ? { [input.sourceKey]: bytes } : {}
}

async function pipeline() {
  const small = await jpeg(1200, 800, true)
  const hash = createHash('sha256').update(small).digest('hex')

  // ── Route A, happy path ──────────────────────────────────────────────────
  {
    const input = inputFor('gallery', small)
    const { storage, log } = memoryStorage(seedFor(input, small))
    const { db, calls } = fakeDb(okAnswer)
    const r = await ingestPhoto(input, { db, storage })
    const args = calls[0]!.args
    is('A: reads exactly the original, once', log.reads, [(input as { sourceKey: string }).sourceKey])
    is('A: writes the SHORT ladder for a 1200-px photograph — 400 and 800, nothing more',
      log.writes, [`${input.keyBase}/400.webp`, `${input.keyBase}/800.webp`])
    is('A: the display path is the largest written', args.p_display_path, `${input.keyBase}/800.webp`)
    is('A: the hash is of the source bytes', args.p_content_sha256, hash)
    is('A: the byte count is the server\'s', args.p_original_bytes, small.byteLength)
    is('A: dimensions from the processed pixels', [args.p_width, args.p_height], [1200, 800])
    is('A: the content type from the pixels', args.p_content_type, 'image/jpeg')
    is('A: the capture came through', [args.p_camera_make, args.p_iso, args.p_aperture, args.p_shutter], ['Sony', 400, 5.6, '1/250'])
    is('A: GPS kept — the one route that stored it before P2', [args.p_latitude, args.p_longitude], [51.5, -0.125])
    is('A: calls register_gallery_photo with the album', [calls[0]!.fn, args.p_album], ['register_gallery_photo', ALBUM_A])
    is('A: returns the asset, the display path and the membership', r, { assetId: 'a-1', displayPath: `${input.keyBase}/800.webp`, photoId: 'p-1' })
    is('A: nothing deleted on success', log.removes, [])
  }

  // ── B, C, D: no GPS parameter at all, even from a file that carries it ────
  for (const route of ['site', 'journal', 'cover'] as const) {
    const input = inputFor(route, small)
    const { storage, log } = memoryStorage(seedFor(input, small))
    const { db, calls } = fakeDb(okAnswer)
    const r = await ingestPhoto(input, { db, storage })
    const args = calls[0]!.args
    ok(`${route}: no latitude/longitude parameter is sent`, !('p_latitude' in args) && !('p_longitude' in args),
      JSON.stringify(Object.keys(args)))
    is(`${route}: the hash and byte count are the server's`, [args.p_content_sha256, args.p_original_bytes], [hash, small.byteLength])
    if (route === 'cover') {
      is('cover: reads nothing from storage — its bytes came in the form', log.reads, [])
      ok('cover: sends no original path', !('p_original_path' in args))
      ok('cover: writes only WebP sizes — never an original', log.writes.every((k) => /\/(400|800|1600|2400)\.webp$/.test(k)) && log.writes.length === 2)
      is('cover: returns the asset and display path', r, { assetId: 'a-1', displayPath: `${input.keyBase}/800.webp` })
    }
    if (route === 'site') {
      is('site: returns the Uploads row id', r.siteImageId, 's-1')
      is('site: sends the normalised file name', args.p_filename, 'heron.jpg')
    }
    if (route === 'journal') ok('journal: sends no file name', !('p_filename' in args))
  }

  // ── The key is checked before a byte is read ────────────────────────────
  {
    const { storage, log } = memoryStorage()
    const { db, calls } = fakeDb(okAnswer)
    const e = await rejects(ingestPhoto(
      { route: 'journal', tenantId: TENANT_A, keyBase: '/samples/church', sourceKey: '/samples/church/original.jpg' },
      { db, storage }))
    is('a sample path is refused as ownership', e instanceof IngestError ? e.reason : String(e), 'ownership')
    is('…before any read, write or database call', [log.reads.length, log.writes.length, calls.length], [0, 0, 0])
    const e2 = await rejects(ingestPhoto(
      { ...(inputFor('site', small) as Extract<IngestInput, { route: 'site' }>), tenantId: TENANT_B },
      { db, storage }))
    is('another site\'s key is refused as ownership', e2 instanceof IngestError ? e2.reason : String(e2), 'ownership')
  }

  // ── Failure: the database refuses, no asset committed → clean up ─────────
  for (const route of ['gallery', 'site', 'journal', 'cover'] as const) {
    const input = inputFor(route, small)
    const { storage, log, objects } = memoryStorage(seedFor(input, small))
    const { db } = fakeDb(() => ({ data: null, error: { message: 'That is not your site.' } }), false)
    const e = await rejects(ingestPhoto(input, { db, storage }))
    is(`${route}: a refused registration fails the upload`, e instanceof IngestError ? [e.reason, e.message] : String(e),
      ['registration', 'That is not your site.'])
    const expected = [
      `${input.keyBase}/400.webp`, `${input.keyBase}/800.webp`,
      ...('sourceKey' in input ? [input.sourceKey] : []),
    ]
    is(`${route}: cleanup deletes exactly this attempt's objects`, [...log.removes].sort(), [...expected].sort())
    is(`${route}: …and nothing of it is left`, objects.size, 0)
  }

  // ── Failure, but a committed asset owns the key → delete NOTHING ─────────
  {
    const input = inputFor('gallery', small)
    const { storage, log, objects } = memoryStorage(seedFor(input, small))
    const { db } = fakeDb(() => ({ data: null, error: { message: 'connection reset' } }), true)
    const e = await rejects(ingestPhoto(input, { db, storage }))
    ok('reply lost after a commit: the action still reports failure', e instanceof IngestError)
    is('…but deletes nothing', log.removes, [])
    is('…and the original and sizes are all still there', objects.size, 3)
  }

  // ── Failure, and the database cannot say → delete nothing, and say so ───
  {
    const input = inputFor('journal', small)
    const { storage, log } = memoryStorage(seedFor(input, small))
    const { db } = fakeDb(() => ({ data: null, error: { message: 'x' } }), null)
    const logged: Record<string, unknown>[] = []
    await rejects(ingestPhoto(input, { db, storage, log: (_m, d) => logged.push(d) }))
    is('unknown commit state: deletes nothing', log.removes, [])
    ok('…and logs the keys it left', logged.length === 1 && Array.isArray(logged[0]!.left) && (logged[0]!.left as string[]).length === 3)
  }

  // ── Cleanup that itself fails is logged with site, route and keys ───────
  {
    const input = inputFor('site', small)
    const { storage } = memoryStorage(seedFor(input, small), { failRemove: true })
    const { db } = fakeDb(() => ({ data: null, error: { message: 'x' } }), false)
    const logged: Record<string, unknown>[] = []
    await rejects(ingestPhoto(input, { db, storage, log: (_m, d) => logged.push(d) }))
    is('a failed cleanup is logged with the site, the route and every key left',
      logged.map((d) => [d.tenantId, d.route, (d.left as string[]).length]), [[TENANT_A, 'site', 3]])
  }

  // ── The RPC throwing (network) is the same as it refusing ───────────────
  {
    const input = inputFor('journal', small)
    const { storage, log } = memoryStorage(seedFor(input, small))
    const db: IngestDb = { rpc: () => Promise.reject(new Error('socket hang up')), assetExists: async () => false }
    const e = await rejects(ingestPhoto(input, { db, storage }))
    is('a thrown RPC is a registration failure', e instanceof IngestError ? e.reason : String(e), 'registration')
    is('…and is cleaned up the same way', log.removes.length, 3)
  }

  // ── Not an image: fails before writing anything ─────────────────────────
  {
    const junk = Buffer.from('this is not a photograph')
    const input = inputFor('site', junk)
    const { storage, log } = memoryStorage(seedFor(input, junk))
    const { db, calls } = fakeDb(okAnswer)
    const e = await rejects(ingestPhoto(input, { db, storage }))
    is('bytes that are not an image are a processing failure', e instanceof IngestError ? e.reason : String(e), 'processing')
    is('…no size is written and the database is never asked', [log.writes.length, calls.length], [0, 0])
  }

  // ── A format sharp decodes but that is not an upload type (a GIF) ───────
  //
  // The three signed-upload routes refuse it before writing anything; a
  // custom cover — which may be any format sharp reads, as before P2 — keeps
  // it, recorded with an unknown (NULL) content type.
  {
    const gif = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#6a8' } }).gif().toBuffer()
    for (const route of ['gallery', 'site', 'journal'] as const) {
      const input = inputFor(route, gif)
      const { storage, log } = memoryStorage(seedFor(input, gif))
      const { db, calls } = fakeDb(okAnswer)
      const e = await rejects(ingestPhoto(input, { db, storage }))
      is(`${route}: a GIF is refused as not a supported type`, e instanceof IngestError ? [e.reason, e.message] : String(e),
        ['processing', 'That file is not a supported image type.'])
      is(`${route}: …before any size is written or the database is asked`, [log.writes.length, calls.length], [0, 0])
    }
    const input = inputFor('cover', gif)
    const { storage } = memoryStorage()
    const { db, calls } = fakeDb(okAnswer)
    const r = await rejects(ingestPhoto(input, { db, storage }))
    is('cover: a GIF still uploads, as before P2', r, null)
    is('cover: …with an unknown (NULL) content type', calls[0]?.args.p_content_type, null)
  }

  // ── The MIME rule by route ───────────────────────────────────────────────
  //
  // The five /api/upload-url types, exactly, for the three signed routes;
  // anything for a cover. HEIF is tested here as a type rather than as a file:
  // the prebuilt sharp can neither encode nor decode HEVC-HEIF (its heif input
  // covers .avif only), so a real HEIC cannot even reach this point locally.
  for (const route of ['gallery', 'site', 'journal'] as const) {
    is(`${route}: accepts exactly the five upload types`,
      ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif', 'image/heif', null].map((t) => acceptsContentType(route, t)),
      [true, true, true, true, true, false, false])
  }
  is('cover: accepts the five, HEIF, and an unrecognised format (NULL)',
    ['image/jpeg', 'image/avif', 'image/heif', null].map((t) => acceptsContentType('cover', t)), [true, true, true, true])
  is('the five signed-upload types are the ones /api/upload-url allows',
    [...SIGNED_UPLOAD_TYPES].sort(),
    [...(read('app/api/upload-url/route.ts').match(/'image\/[a-z]+'(?=:)/g) ?? [])].map((s) => s.slice(1, -1)).sort())

  // ── An unreadable source goes through the checked cleanup ───────────────
  //
  // Every route keeps its caller-facing answer for this (registerJournalImage
  // still returns null — it keys off the 'unreadable' reason); what changed is
  // that the attempt's original is cleaned up exactly as any other failure's.
  {
    const input = inputFor('journal', small) as Extract<IngestInput, { route: 'journal' }>
    const src = input.sourceKey

    // read returns null (no such object), no committed asset
    {
      const { storage, log } = memoryStorage({})
      const { db } = fakeDb(okAnswer, false)
      const e = await rejects(ingestPhoto(input, { db, storage }))
      is('unreadable (null): reason is still "unreadable"', e instanceof IngestError ? e.reason : String(e), 'unreadable')
      is('unreadable (null), no committed asset: the attempt\'s original is cleaned up', log.removes, [src])
    }
    // read throws, no committed asset
    {
      const { storage, log } = memoryStorage({})
      storage.read = async () => { throw new Error('network') }
      const { db } = fakeDb(okAnswer, false)
      const e = await rejects(ingestPhoto(input, { db, storage }))
      is('unreadable (throws): reason is still "unreadable"', e instanceof IngestError ? e.reason : String(e), 'unreadable')
      is('unreadable (throws), no committed asset: the attempt\'s original is cleaned up', log.removes, [src])
    }
    // read fails but a committed asset owns the key
    {
      const { storage, log } = memoryStorage({})
      const { db } = fakeDb(okAnswer, true)
      await rejects(ingestPhoto(input, { db, storage }))
      is('unreadable, committed asset exists: NOTHING is deleted', log.removes, [])
    }
    // read fails, commit state unknown
    {
      const { storage, log } = memoryStorage({})
      const { db } = fakeDb(okAnswer, null)
      const logged: Record<string, unknown>[] = []
      await rejects(ingestPhoto(input, { db, storage, log: (_m, d) => logged.push(d) }))
      is('unreadable, commit state unknown: nothing deleted, and logged', [log.removes.length, logged.length], [0, 1])
    }
    // read fails, cleanup itself fails
    {
      const { storage } = memoryStorage({}, { failRemove: true })
      const { db } = fakeDb(okAnswer, false)
      const logged: Record<string, unknown>[] = []
      await rejects(ingestPhoto(input, { db, storage, log: (_m, d) => logged.push(d) }))
      is('unreadable, cleanup fails: logged with site, route and the key left',
        logged.map((d) => [d.tenantId, d.route, d.left]), [[TENANT_A, 'journal', [src]]])
    }
  }

  // ── A retry is the same attempt ─────────────────────────────────────────
  {
    const input = inputFor('gallery', small)
    const first = memoryStorage(seedFor(input, small))
    const second = memoryStorage(seedFor(input, small))
    const a = fakeDb(okAnswer)
    const b = fakeDb(okAnswer)
    await ingestPhoto(input, { db: a.db, storage: first.storage })
    await ingestPhoto(input, { db: b.db, storage: second.storage })
    is('a repeated registration sends identical arguments', b.calls[0]!.args, a.calls[0]!.args)
    is('…and writes the same keys', second.log.writes, first.log.writes)
  }

  // ── fromSupabase asks for THIS site's asset at THIS key ─────────────────
  {
    const asked: [string, unknown][] = []
    const chain = {
      select: (c: string) => { asked.push(['select', c]); return chain },
      eq: (c: string, v: unknown) => { asked.push([c, v]); return chain },
      maybeSingle: async () => ({ data: { id: 'x' }, error: null }),
    }
    const client = { rpc: async () => ({ data: null, error: null }), from: (t: string) => { asked.push(['from', t]); return chain } }
    const exists = await fromSupabase(client as never).assetExists(TENANT_A, 'k')
    is('fromSupabase checks photo_assets by tenant_id AND key_base', asked,
      [['from', 'photo_assets'], ['select', 'id'], ['tenant_id', TENANT_A], ['key_base', 'k']])
    ok('…and reports the committed asset', exists === true)
  }

  // readCapture on a real file with GPS, as each route would.
  {
    const withGps = await readCapture(small, { gps: true })
    const without = await readCapture(small, { gps: false })
    is('readCapture: GPS read for a gallery upload', [withGps.latitude, withGps.longitude], [51.5, -0.125])
    is('readCapture: GPS NOT kept for the other routes — exifr returns it anyway, the normaliser drops it',
      [without.latitude, without.longitude], [null, null])
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 5. AGAINST A REAL POSTGRES, AS THE REAL ROLE
// ════════════════════════════════════════════════════════════════════════════

const PG = {
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  database: process.env.PGDATABASE ?? 'wtp',
  user: process.env.PGUSER ?? 'postgres',
}

/**
 * One call of a register_* function as `authenticated`, signed in as `user`,
 * in its own transaction — what PostgREST does for the real action. `hold`
 * leaves the transaction open (for the concurrency proof) and returns its
 * commit.
 */
async function callAs(
  client: Client,
  user: string,
  fn: string,
  args: Record<string, unknown>,
  hold = false
): Promise<{ data: unknown; error: { message: string; code?: string } | null; commit?: () => Promise<void> }> {
  const names = Object.keys(args)
  const sql = `select * from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`
  const values = names.map((n) => {
    const v = args[n]
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v
  })
  await client.query('begin')
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user })])
    await client.query('set local role authenticated')
    const res = await client.query(sql, values)
    const scalar = res.fields.length === 1 && res.fields[0]!.name === fn
    const data = scalar ? res.rows[0]?.[fn] : res.rows
    if (hold) return { data, error: null, commit: async () => void (await client.query('commit')) }
    await client.query('commit')
    return { data, error: null }
  } catch (e) {
    await client.query('rollback')
    const err = e as { message: string; code?: string }
    return { data: null, error: { message: err.message, code: err.code } }
  }
}

function pgDb(client: Client, user: string, after?: (r: { data: unknown }) => { data: unknown; error: { message: string } | null }): IngestDb {
  return {
    rpc: async (fn, args) => {
      const r = await callAs(client, user, fn, args)
      return after && !r.error ? after(r) : r
    },
    async assetExists(tenantId, keyBase) {
      await client.query('begin')
      try {
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user })])
        await client.query('set local role authenticated')
        const r = await client.query('select id from public.photo_assets where tenant_id = $1 and key_base = $2', [tenantId, keyBase])
        await client.query('commit')
        return r.rowCount! > 0
      } catch {
        await client.query('rollback')
        return null
      }
    },
  }
}

async function database() {
  const owner = new Client(PG)
  try {
    await owner.connect()
  } catch (e) {
    console.log(
      `\nSKIPPED the database half: no Postgres at ${PG.host}:${PG.port}. ` +
        'Build db/test-fixture.sql and run again.\n' +
        (e instanceof Error ? e.message : String(e))
    )
    return
  }
  const has = await owner.query(`select to_regprocedure('public.register_gallery_photo(uuid, uuid, text, text, text, jsonb, integer, integer, bigint, text, text, timestamptz, text, text, text, integer, numeric, text, numeric, text[], jsonb, double precision, double precision)') is not null as there`)
  if (!has.rows[0].there) {
    fail.push('register_gallery_photo does not exist — this database predates the P2 reconciliation; rebuild it from db/test-fixture.sql')
    await owner.end()
    return
  }

  const conn = new Client(PG)
  await conn.connect()
  const small = await jpeg(1200, 800, true)
  const made: string[] = [] // key bases this run created, removed at the end

  const count = async (sql: string, args: unknown[]) => Number((await owner.query(sql, args)).rows[0].n)
  const covers = await owner.query('select cover_custom_path, cover_photo_id from albums where id = $1', [ALBUM_A])

  try {
    // ── The four routes, end to end, as the signed-in photographer ─────────
    for (const route of ['gallery', 'site', 'journal', 'cover'] as const) {
      const input = inputFor(route, small)
      made.push(input.keyBase)
      const { storage } = memoryStorage(seedFor(input, small))
      let r: Awaited<ReturnType<typeof ingestPhoto>>
      try {
        r = await ingestPhoto(input, { db: pgDb(conn, USER_A), storage })
      } catch (e) {
        // Recorded, not thrown: a crash here would lose every later result.
        fail.push(`DB ${route}: the registration itself failed\n    ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      const asset = (await owner.query('select * from photo_assets where key_base = $1', [input.keyBase])).rows[0]
      ok(`DB ${route}: the asset exists, derived, created by the uploader`,
        asset && asset.state === 'derived' && asset.created_by === USER_A && asset.tenant_id === TENANT_A && asset.id === r.assetId)
      is(`DB ${route}: the stored hash and bytes are the server's`, [asset?.content_sha256, Number(asset?.original_bytes)],
        [createHash('sha256').update(small).digest('hex'), small.byteLength])
      is(`DB ${route}: latitude/longitude`, [asset?.latitude, asset?.longitude],
        route === 'gallery' ? [51.5, -0.125] : [null, null])
      if (route === 'gallery') {
        const photo = (await owner.query('select * from photos where id = $1', [r.photoId])).rows[0]
        ok('DB gallery: the photos row points at the asset and agrees with it',
          photo?.asset_id === r.assetId && photo.width === asset.width && photo.height === asset.height
            && Number(photo.original_bytes) === Number(asset.original_bytes) && photo.storage_path === asset.display_path)
        is('DB gallery: one gallery usage', await count(`select count(*) n from photo_usages where asset_id = $1 and kind = 'gallery'`, [r.assetId]), 1)
      }
      if (route === 'site') {
        is('DB site: the site_images row points at the asset', (await owner.query('select asset_id from site_images where id = $1', [r.siteImageId])).rows[0]?.asset_id, r.assetId)
      }
      if (route === 'cover') {
        is('DB cover: the album cover is this upload; the asset keeps no original',
          [(await owner.query('select cover_custom_path from albums where id = $1', [ALBUM_A])).rows[0].cover_custom_path, asset?.original_path],
          [r.displayPath, null])
      }
      if (route !== 'gallery') {
        is(`DB ${route}: no usage`, await count('select count(*) n from photo_usages where asset_id = $1', [r.assetId]), 0)
      }
    }

    // ── A retry, end to end ────────────────────────────────────────────────
    {
      const input = inputFor('gallery', small)
      made.push(input.keyBase)
      const r1 = await ingestPhoto(input, { db: pgDb(conn, USER_A), storage: memoryStorage(seedFor(input, small)).storage })
      const r2 = await ingestPhoto(input, { db: pgDb(conn, USER_A), storage: memoryStorage(seedFor(input, small)).storage })
      is('DB retry: the same photo and asset', [r2.photoId, r2.assetId], [r1.photoId, r1.assetId])
      is('DB retry: one photos row, one usage',
        [await count('select count(*) n from photos where asset_id = $1', [r1.assetId]), await count('select count(*) n from photo_usages where asset_id = $1', [r1.assetId])], [1, 1])
    }

    // ── The reply is lost AFTER the commit ─────────────────────────────────
    {
      const input = inputFor('site', small)
      made.push(input.keyBase)
      const { storage, log, objects } = memoryStorage(seedFor(input, small))
      const lost = pgDb(conn, USER_A, () => ({ data: null, error: { message: 'the reply never arrived' } }))
      const e = await rejects(ingestPhoto(input, { db: lost, storage }))
      ok('DB lost reply: the action reports failure', e instanceof IngestError)
      is('DB lost reply: the committed asset is found and NOTHING is deleted', [log.removes.length, objects.size], [0, 3])
      is('DB lost reply: the asset really is committed', await count('select count(*) n from photo_assets where key_base = $1', [input.keyBase]), 1)
    }

    // ── A real refusal by the database → the attempt is cleaned up ─────────
    {
      const input = inputFor('journal', small)
      const { storage, log, objects } = memoryStorage(seedFor(input, small))
      // Photographer B, not an admin, registering on site A: the app's key
      // check passes (the key is site A's shape) — the DATABASE refuses.
      const e = await rejects(ingestPhoto(input, { db: pgDb(conn, USER_B), storage }))
      is('DB refusal: photographer B on site A is refused by the database', e instanceof IngestError ? [e.reason, e.message] : String(e),
        ['registration', 'That is not your site.'])
      is('DB refusal: the attempt\'s objects are deleted', [log.removes.length, objects.size], [3, 0])
      is('DB refusal: no asset', await count('select count(*) n from photo_assets where key_base = $1', [input.keyBase]), 0)
    }

    // ── CONCURRENCY: one upload, two registrations at once (A and B) ───────
    for (const route of ['gallery', 'site'] as const) {
      const input = inputFor(route, small)
      made.push(input.keyBase)
      const { storage } = memoryStorage(seedFor(input, small))
      // Capture the exact arguments ingestion would send.
      let args: Record<string, unknown> = {}
      await ingestPhoto({ ...input, keyBase: input.keyBase } as IngestInput, {
        db: { rpc: async (_f, a) => { args = a; return { data: null, error: { message: 'captured' } } }, assetExists: async () => true },
        storage,
      }).catch(() => undefined)
      const fn = route === 'gallery' ? 'register_gallery_photo' : 'register_site_image'

      /*
       * THE RACE THE ASSET LOCK EXISTS FOR.
       *
       * A brand-new upload is serialised by the unique index anyway — the
       * second insert waits for the first's. The dangerous case is an asset
       * that ALREADY exists while its relationship row does not (here: the
       * membership was deleted after a first registration). Two registrations
       * then both look, both find no row, and both insert — unless the asset
       * row is locked before the look. So that is the state this starts from.
       */
      const seeded = await callAs(conn, USER_A, fn, args)
      ok(`CONCURRENT ${route}: seeded`, !seeded.error, seeded.error?.message)
      if (route === 'gallery') {
        await owner.query('delete from photos where asset_id = (select id from photo_assets where key_base = $1)', [input.keyBase])
      } else {
        await owner.query('delete from site_images where asset_id = (select id from photo_assets where key_base = $1)', [input.keyBase])
      }

      // Deterministic: the first holds its transaction open; the second must
      // WAIT on the asset, then reuse what the first committed.
      const c1 = new Client(PG)
      const c2 = new Client(PG)
      await c1.connect()
      await c2.connect()
      try {
        const first = await callAs(c1, USER_A, fn, args, true)
        if (first.error || !first.commit) {
          fail.push(`CONCURRENT ${route}: the first registration failed\n    ${first.error?.message}`)
          continue
        }
        const secondP = callAs(c2, USER_A, fn, args)
        let waiting = false
        for (let i = 0; i < 50 && !waiting; i++) {
          await new Promise((r) => setTimeout(r, 40))
          const w = await owner.query(`select count(*) n from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'`, [(c2 as unknown as { processID: number }).processID])
          waiting = Number(w.rows[0].n) === 1
        }
        ok(`CONCURRENT ${route}: the second registration waits on the first`, waiting)
        await first.commit!()
        const second = await secondP
        const id = (d: unknown) => JSON.stringify(Array.isArray(d) ? d[0] : d)
        is(`CONCURRENT ${route}: the second reuses the first's rows`, id(second.data), id(first.data))
      } finally {
        await c1.end()
        await c2.end()
      }

      // And a burst: six at once, from six connections.
      const burst = await Promise.all(Array.from({ length: 6 }, async () => {
        const c = new Client(PG)
        await c.connect()
        try {
          return await callAs(c, USER_A, fn, args)
        } finally {
          await c.end()
        }
      }))
      is(`CONCURRENT ${route}: a burst of six all succeed`, burst.map((b) => b.error?.message ?? 'ok'), Array(6).fill('ok'))
      const assetId = (await owner.query('select id from photo_assets where key_base = $1', [input.keyBase])).rows[0]?.id
      is(`CONCURRENT ${route}: one asset`, await count('select count(*) n from photo_assets where key_base = $1', [input.keyBase]), 1)
      if (route === 'gallery') {
        is('CONCURRENT gallery: one photos row and one usage',
          [await count('select count(*) n from photos where asset_id = $1', [assetId]), await count('select count(*) n from photo_usages where asset_id = $1', [assetId])], [1, 1])
      } else {
        is('CONCURRENT site: one site_images row', await count('select count(*) n from site_images where asset_id = $1', [assetId]), 1)
      }
    }

    // Deleting a gallery photograph (P2 leaves deletePhoto alone): the row
    // goes, its usage cascades away, the asset stays — unused, as recorded.
    {
      const input = inputFor('gallery', small)
      made.push(input.keyBase)
      const r = await ingestPhoto(input, { db: pgDb(conn, USER_A), storage: memoryStorage(seedFor(input, small)).storage })
      await owner.query('delete from photos where id = $1', [r.photoId])
      is('after a photos row is deleted: usage gone, asset kept (the accepted P2→P6 state)',
        [await count('select count(*) n from photo_usages where asset_id = $1', [r.assetId]), await count('select count(*) n from photo_assets where id = $1', [r.assetId])], [0, 1])
    }
  } finally {
    // Leave the database as it was.
    for (const kb of made) {
      const ids = (await owner.query('select id from photo_assets where key_base = $1', [kb])).rows.map((r) => r.id)
      if (ids.length === 0) continue
      await owner.query('delete from photo_usages where asset_id = any($1)', [ids])
      await owner.query('delete from photos where asset_id = any($1)', [ids])
      await owner.query('delete from site_images where asset_id = any($1)', [ids])
      await owner.query('delete from photo_assets where id = any($1)', [ids])
    }
    await owner.query('update albums set cover_custom_path = $2, cover_photo_id = $3 where id = $1',
      [ALBUM_A, covers.rows[0].cover_custom_path, covers.rows[0].cover_photo_id])
    is('the suite leaves no asset behind', await count('select count(*) n from photo_assets', []), 0)
    await conn.end()
    await owner.end()
  }
}

async function main() {
  await pipeline()
  await database()
}

main().then(
  () => {
    console.log(`${pass + fail.length} assertions`)
    for (const f of fail) console.log('FAIL ' + f)
    console.log(`\n${pass} passed, ${fail.length} failed`)
    process.exit(fail.length ? 1 : 0)
  },
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
