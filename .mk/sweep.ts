import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  GRACE_DAYS,
  SWEEP_SOURCES,
  assetFiles,
  candidateAssets,
  examine,
  graceElapsed,
  sweep,
  usageCount,
  type SweepAsset,
  type SweepDb,
  type SweepEvidence,
} from '../lib/photos/sweep'
import { SOURCES, HISTORY_SOURCES, type SourceName } from '../lib/photos/deletion'
import type { PhotoStorage } from '../lib/photos/storage'

/**
 * THE SWEEPER
 * ═══════════
 *
 * P6's second half. The only thing on the platform that deletes a stored file,
 * so this suite's job is to prove what it REFUSES rather than what it removes.
 *
 * Run: node node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs .mk/sweep.ts
 *
 * ── WHAT IS REAL HERE AND WHAT IS NOT ───────────────────────────────────────
 *
 * Real: `examine`, `graceElapsed`, `assetFiles`, `candidateAssets`,
 * `usageCount` and `sweep` itself, exactly as production imports them, and
 * `readSource`/`namesFile` underneath them via `lib/photos/deletion.ts`.
 *
 * Faked: the database surface and the bucket. The fake db applies ONLY the
 * filters the code writes and answers as a platform admin is answered — RLS
 * passes everything — so a missing tenant predicate shows up as a cross-site
 * read instead of being hidden by a policy. That is the same bargain
 * `.mk/deletion-boundary.ts` makes and for the same reason.
 *
 * Not covered, deliberately and stated rather than implied: real R2, real
 * PostgREST paging against a real server, concurrency, and the cooperative
 * budget's behaviour under genuine I/O latency. The sweeper's own header lists
 * those limits; this suite does not pretend to close them.
 *
 * ── THE MUTATIONS ───────────────────────────────────────────────────────────
 *
 * A green suite on its first run is not evidence. `MUTATIONS` at the bottom
 * lists each change to `lib/photos/sweep.ts` that must make a NAMED check
 * fail. They are listed rather than applied because this suite was written in
 * an environment with no way to run it; Codex applies each one, runs this
 * file, confirms the named check fails, and reverts. A mutation that leaves
 * the suite green is a hole in the suite, not a harmless edit.
 */

type Row = Record<string, unknown>
type Call = { table: string; op: string; filters: Array<[string, unknown]> }

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const T = (id: string) => `t/${id}`

// ── The fake database ──────────────────────────────────────────────────────

type Fail = { table: string; op: 'select' | 'update'; mode: 'error' | 'throw' }

class FakeDb {
  rows: Row[] = []
  calls: Call[] = []
  fail: Fail | null = null
  from(table: string) {
    return new Q(this, table)
  }
  of(table: string) {
    return this.rows.filter((r) => r.__table === table)
  }
}

class Q {
  private op: 'select' | 'update' = 'select'
  private filters: Array<[string, unknown]> = []
  private ins: Array<[string, unknown[]]> = []
  private orders: Array<{ col: string; nullsFirst: boolean }> = []
  private patch: Row | null = null
  private head = false
  private wantCount = false
  private lo = 0
  private hi = Number.MAX_SAFE_INTEGER
  constructor(private db: FakeDb, private table: string) {}

  select(_cols: string, opts?: { count?: string; head?: boolean }) {
    this.op = 'select'
    this.wantCount = opts?.count === 'exact'
    this.head = opts?.head === true
    return this
  }
  update(patch: Row) {
    this.op = 'update'
    this.patch = patch
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }
  is(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }
  in(col: string, vals: unknown[]) {
    this.ins.push([col, vals])
    return this
  }
  order(col: string, opts?: { nullsFirst?: boolean }) {
    this.orders.push({ col, nullsFirst: opts?.nullsFirst === true })
    return this
  }
  range(lo: number, hi: number) {
    this.lo = lo
    this.hi = hi
    return this
  }
  limit(n: number) {
    this.lo = 0
    this.hi = n - 1
    return this
  }

  private matching() {
    let rows = this.db.of(this.table)
    for (const [col, val] of this.filters) rows = rows.filter((r) => (r[col] ?? null) === val)
    for (const [col, vals] of this.ins) rows = rows.filter((r) => vals.includes(r[col]))
    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[o.col] ?? null
        const y = b[o.col] ?? null
        if (x === null && y === null) return 0
        if (x === null) return o.nullsFirst ? -1 : 1
        if (y === null) return o.nullsFirst ? 1 : -1
        return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0
      })
    }
    return rows
  }

  then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
    this.db.calls.push({ table: this.table, op: this.op, filters: [...this.filters] })
    const f = this.db.fail
    if (f && f.table === this.table && f.op === this.op) {
      if (f.mode === 'throw') return reject(new Error('connection reset'))
      return resolve({ data: null, error: { message: 'permission denied' }, count: null })
    }
    try {
      const all = this.matching()
      if (this.op === 'update') {
        for (const row of all) Object.assign(row, this.patch)
        return resolve({ data: null, error: null })
      }
      const page = all.slice(this.lo, this.hi + 1)
      return resolve({
        data: this.head ? null : page.map((r) => ({ ...r })),
        error: null,
        count: this.wantCount ? all.length : null,
      })
    } catch (e) {
      return reject(e)
    }
  }
}

// ── The fake bucket ────────────────────────────────────────────────────────

function fakeStorage(refuse: string[] = []) {
  const removed: string[] = []
  const storage: PhotoStorage = {
    async read() {
      throw new Error('the sweeper never reads')
    },
    async write() {
      throw new Error('the sweeper never writes')
    },
    async remove(keys) {
      removed.push(...keys)
      return keys.filter((k) => refuse.includes(k))
    },
  }
  return { storage, removed }
}

// ── Evidence rows that satisfy every declared shape ────────────────────────
//
// A row missing one declared column is `malformed`, which makes the source
// incomplete, which makes the sweeper refuse everything — a silent pass. So
// these are built from the same column lists `deletion.ts` checks against.

function seedEvidence(db: FakeDb, tenantId: string) {
  const add = (table: string, row: Row) => db.rows.push({ __table: table, tenant_id: tenantId, ...row })
  add('photos', {
    id: randomUUID(),
    album_id: randomUUID(),
    storage_path: `${T(tenantId)}/photos/keep.webp`,
    original_path: null,
    derivatives: {},
  })
  add('albums', { id: randomUUID(), cover_custom_path: null, cover_video_path: null })
  add('site_images', {
    id: randomUUID(),
    storage_path: `${T(tenantId)}/site-images/keep.webp`,
    original_path: null,
    derivatives: {},
  })
  add('blog_posts', { id: randomUUID(), featured_custom_path: null, blocks: [], content: {} })
  add('page_sections', { id: randomUUID(), settings: {} })
  add('site_draft', { pages: {}, page_seo: null, chrome: null, global_styles: null })
  add('site_settings', {
    id: 1,
    hero_image_path: null,
    intro_image_path: null,
    contact_image_path: null,
    about_image_path: null,
    logo_header_path: null,
    logo_footer_path: null,
    logo_bird_path: null,
    favicon_path: null,
    shop_wall_texture: null,
    shop_frames: {},
    page_seo: {},
    global_styles: {},
  })
  add('site_versions', { id: randomUUID(), snapshot: {} })
  add('site_draft_steps', { id: 1, snapshot: {} })
  add('site_template_history', { id: randomUUID(), sections_before: [], styles_before: {} })
}

/** One asset row, plus the SweepAsset the sweeper would build from it. */
function seedAsset(
  db: FakeDb,
  tenantId: string,
  opts: { paths?: string[]; unreferencedSince?: string | null; checkedAt?: string | null; sweptAt?: string | null } = {}
) {
  const id = randomUUID()
  const paths = opts.paths ?? [`${T(tenantId)}/photos/${id}/display.webp`]
  db.rows.push({
    __table: 'photo_assets',
    id,
    tenant_id: tenantId,
    key_base: `${T(tenantId)}/photos/${id}`,
    display_path: paths[0] ?? null,
    original_path: paths[1] ?? null,
    derivatives: paths.length > 2 ? { large: paths[2] } : {},
    unreferenced_since: opts.unreferencedSince ?? null,
    sweep_checked_at: opts.checkedAt ?? null,
    swept_at: opts.sweptAt ?? null,
  })
  return { id, paths }
}

/** Put a path somewhere a source names it. */
function reference(db: FakeDb, tenantId: string, table: string, path: string) {
  if (table === 'page_sections') {
    db.rows.push({ __table: table, id: randomUUID(), tenant_id: tenantId, settings: { image_path: path } })
    return
  }
  if (table === 'site_versions') {
    db.rows.push({
      __table: table,
      id: randomUUID(),
      tenant_id: tenantId,
      snapshot: { pages: { home: [{ settings: { image_path: path } }] } },
    })
    return
  }
  if (table === 'site_draft_steps') {
    db.rows.push({ __table: table, id: 2, tenant_id: tenantId, snapshot: { pages: { home: [{ bg_image: path }] } } })
    return
  }
  if (table === 'site_template_history') {
    db.rows.push({
      __table: table,
      id: randomUUID(),
      tenant_id: tenantId,
      sections_before: [{ settings: { image_path: path } }],
      styles_before: {},
    })
    return
  }
  throw new Error(`no reference shape for ${table}`)
}

async function evidenceFor(db: FakeDb, tenantId: string): Promise<SweepEvidence> {
  const { readSweepEvidence } = await import('../lib/photos/sweep')
  return readSweepEvidence(db as unknown as SweepDb, tenantId)
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

// ── The suite ──────────────────────────────────────────────────────────────

let pass = 0
const fail: string[] = []
const ok = (name: string, good: boolean, detail?: unknown) => {
  if (good) pass++
  else fail.push(detail === undefined ? name : `${name} — ${JSON.stringify(detail)}`)
}

async function main() {
  // ── 1. The source never writes a column somebody else reads ─────────────
  //
  // `deleted_at` is a VISIBILITY verdict in the deployed reader, and
  // `archived_at` / `original_purged_at` belong to a design that was
  // withdrawn. Asserted against the source text, the way `.mk/analytics.ts`
  // asserts that no analytics file touches localStorage: this is the kind of
  // regression a behavioural test cannot see until a photograph vanishes.
  const SWEEP_SRC = join(process.cwd(), 'lib/photos/sweep.ts')
  const src = readFileSync(SWEEP_SRC, 'utf8')
  const writesColumn = (col: string) =>
    new RegExp(`(update\\s*\\(\\s*\\{[^}]*\\b${col}\\b)|(\\b${col}\\s*:\\s*(stamp|new Date))`, 's').test(src)
  ok('source: never writes deleted_at', !writesColumn('deleted_at'))
  ok('source: never writes archived_at', !writesColumn('archived_at'))
  ok('source: never writes original_purged_at', !writesColumn('original_purged_at'))
  ok(
    'source: the candidate queue is ordered by sweep_checked_at, not by a clock',
    /\.order\(\s*'sweep_checked_at'/.test(src) && !/\.order\(\s*'deleted_at'/.test(src)
  )

  // ── 2. The ten sources ──────────────────────────────────────────────────
  ok('sources: seven canonical plus three history', SWEEP_SOURCES.length === 10, SWEEP_SOURCES.length)
  ok('sources: canonical seven unchanged', SOURCES.length === 7, SOURCES.length)
  for (const h of HISTORY_SOURCES) {
    ok(`sources: history includes ${h}`, SWEEP_SOURCES.includes(h))
  }

  // ── 3. assetFiles ───────────────────────────────────────────────────────
  ok('files: a malformed derivatives map is refused, not guessed', assetFiles({ display_path: 'a', derivatives: 7 }) === null)
  ok('files: a non-string path is refused', assetFiles({ display_path: 5, derivatives: {} }) === null)
  ok('files: nulls and empties are skipped', JSON.stringify(assetFiles({ display_path: '', original_path: null, derivatives: {} })) === '[]')
  ok(
    'files: duplicates collapse',
    JSON.stringify(assetFiles({ display_path: 'x', original_path: 'x', derivatives: { a: 'x' } })) === '["x"]'
  )

  // ── 4. graceElapsed ─────────────────────────────────────────────────────
  const now = new Date()
  ok('grace: a null clock has not elapsed', graceElapsed(null, now) === false)
  ok('grace: unparseable is treated as not elapsed', graceElapsed('not a date', now) === false)
  ok('grace: one day short has not elapsed', graceElapsed(daysAgo(GRACE_DAYS - 1), now) === false)
  ok('grace: one day over has elapsed', graceElapsed(daysAgo(GRACE_DAYS + 1), now) === true)

  // ── 5. examine ──────────────────────────────────────────────────────────
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const a = seedAsset(db, TENANT)
    const ev = await evidenceFor(db, TENANT)
    const asset: SweepAsset = { id: a.id, tenantId: TENANT, keyBase: '', paths: a.paths, unreferencedSince: null }

    ok('examine: nothing names it → unreferenced', examine(ev, asset).state === 'unreferenced', examine(ev, asset))

    // Evidence about another site must never decide this asset.
    const foreign: SweepEvidence = { ...ev, tenantId: OTHER }
    ok('examine: foreign evidence is refused', examine(foreign, asset).state === 'incomplete')

    // A path outside this site's prefix is never purged.
    const legacy: SweepAsset = { ...asset, paths: ['photos/old/legacy.webp'] }
    ok('examine: a legacy path is unprovable', examine(ev, legacy).state === 'unprovable')

    // One missing source and nothing is concluded.
    const holed: SweepEvidence = {
      tenantId: TENANT,
      sources: ev.sources.filter((s) => s.source !== 'site_settings'),
    }
    ok('examine: a missing source is incomplete', examine(holed, asset).state === 'incomplete')

    const twice: SweepEvidence = { tenantId: TENANT, sources: [...ev.sources, ev.sources[0]!] }
    ok('examine: a duplicated source is incomplete', examine(twice, asset).state === 'incomplete')
  }

  // ── 6. Referenced by each kind of source, history included ──────────────
  //
  // The history cases are the point of the whole design correction: a file
  // named only by a version snapshot is one a restore would ask for.
  for (const table of ['page_sections', 'site_versions', 'site_draft_steps', 'site_template_history']) {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const a = seedAsset(db, TENANT)
    reference(db, TENANT, table, a.paths[0]!)
    const ev = await evidenceFor(db, TENANT)
    const asset: SweepAsset = { id: a.id, tenantId: TENANT, keyBase: '', paths: a.paths, unreferencedSince: null }
    const found = examine(ev, asset)
    ok(`examine: ${table} naming a file makes it referenced`, found.state === 'referenced', found)
  }

  // ── 7. candidateAssets ──────────────────────────────────────────────────
  {
    const db = new FakeDb()
    seedAsset(db, TENANT, { sweptAt: daysAgo(1) })
    const live = seedAsset(db, TENANT)
    const got = await candidateAssets(db as unknown as SweepDb, {})
    ok('candidates: a swept asset is never a candidate again', got.ok && got.assets.length === 1, got)
    ok('candidates: the live one is returned', got.ok && got.assets[0]?.id === live.id)

    const broken = new FakeDb()
    broken.rows.push({ __table: 'photo_assets', id: randomUUID(), tenant_id: 'not-a-uuid', display_path: 'x', derivatives: {} })
    const bad = await candidateAssets(broken as unknown as SweepDb, {})
    ok('candidates: a row with no usable site is refused', bad.ok === false)

    const erroring = new FakeDb()
    erroring.fail = { table: 'photo_assets', op: 'select', mode: 'error' }
    const errored = await candidateAssets(erroring as unknown as SweepDb, {})
    ok('candidates: a database error is reported, not thrown', errored.ok === false)
  }

  // ── 8. usageCount is a veto that fails closed ───────────────────────────
  {
    const db = new FakeDb()
    const a = seedAsset(db, TENANT)
    db.rows.push({ __table: 'photo_usages', id: randomUUID(), tenant_id: TENANT, asset_id: a.id })
    ok('usages: a usage row is counted', (await usageCount(db as unknown as SweepDb, TENANT, a.id)) === 1)
    ok('usages: another site\'s asset counts zero here', (await usageCount(db as unknown as SweepDb, OTHER, a.id)) === 0)

    db.fail = { table: 'photo_usages', op: 'select', mode: 'error' }
    ok('usages: an unanswerable count is null, not zero', (await usageCount(db as unknown as SweepDb, TENANT, a.id)) === null)
  }

  // ── 9. The two-observation rule, end to end ─────────────────────────────
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const a = seedAsset(db, TENANT)
    const { storage, removed } = fakeStorage()

    const first = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    const row = () => db.of('photo_assets').find((r) => r.id === a.id)!
    ok('run 1: the clock starts', typeof row().unreferenced_since === 'string', row())
    ok('run 1: nothing is deleted on first sight', removed.length === 0 && first.purged === 0)
    ok('run 1: the asset was examined', first.examined === 1)
    ok('run 1: sweep_checked_at is written', typeof row().sweep_checked_at === 'string')

    // Still inside the window.
    row().unreferenced_since = daysAgo(GRACE_DAYS - 2)
    const second = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    ok('run 2: inside the grace period nothing is deleted', removed.length === 0 && second.purged === 0)
    ok('run 2: reported as waiting', (second.outcomes.waiting_out_grace ?? 0) === 1, second.outcomes)

    // Past it.
    row().unreferenced_since = daysAgo(GRACE_DAYS + 1)
    const third = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    ok('run 3: the files are deleted', removed.length === a.paths.length, removed)
    ok('run 3: swept_at is written', typeof row().swept_at === 'string')
    ok('run 3: reported as purged', third.purged === 1)

    const fourth = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    ok('run 4: a swept asset is not examined again', fourth.examined === 0)
  }

  // ── 10. A reference appearing mid-countdown clears the clock ────────────
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const a = seedAsset(db, TENANT, { unreferencedSince: daysAgo(GRACE_DAYS + 5) })
    reference(db, TENANT, 'page_sections', a.paths[0]!)
    const { storage, removed } = fakeStorage()

    const report = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    const row = db.of('photo_assets').find((r) => r.id === a.id)!
    ok('back in use: nothing is deleted even though the clock had run out', removed.length === 0)
    ok('back in use: the clock is cleared', row.unreferenced_since === null, row)
    ok('back in use: reported as cleared', report.clocksCleared === 1)
  }

  // ── 11. The vetoes each stop a due purge ────────────────────────────────
  for (const scenario of ['usages_present', 'usage_unanswerable', 'storage_refuses'] as const) {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const a = seedAsset(db, TENANT, { unreferencedSince: daysAgo(GRACE_DAYS + 1) })
    if (scenario === 'usages_present') {
      db.rows.push({ __table: 'photo_usages', id: randomUUID(), tenant_id: TENANT, asset_id: a.id })
    }
    if (scenario === 'usage_unanswerable') db.fail = { table: 'photo_usages', op: 'select', mode: 'error' }
    const { storage, removed } = fakeStorage(scenario === 'storage_refuses' ? [a.paths[0]!] : [])

    const report = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    const row = db.of('photo_assets').find((r) => r.id === a.id)!
    ok(`veto ${scenario}: not purged`, report.purged === 0, report.outcomes)
    ok(`veto ${scenario}: swept_at is not written`, row.swept_at === null)
    if (scenario !== 'storage_refuses') ok(`veto ${scenario}: nothing was sent to the bucket`, removed.length === 0)
  }

  // ── 12. Incomplete evidence deletes nothing and concludes nothing ───────
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const started = daysAgo(GRACE_DAYS + 1)
    const a = seedAsset(db, TENANT, { unreferencedSince: started })
    /*
     * An EMPTY table is a complete read of nothing, not an incomplete one —
     * deleting the rows would have made this test pass for the wrong reason.
     * The source has to actually fail to be read.
     */
    db.fail = { table: 'site_versions', op: 'select', mode: 'error' }
    const { storage, removed } = fakeStorage()
    const report = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    const row = db.of('photo_assets').find((r) => r.id === a.id)!
    ok('incomplete: nothing deleted', removed.length === 0 && report.purged === 0)
    ok('incomplete: the clock is left exactly as it was', row.unreferenced_since === started, row.unreferenced_since)
    ok('incomplete: still examined and stamped', report.examined === 1 && typeof row.sweep_checked_at === 'string')
  }

  // ── 13. Forward progress — Codex's starvation finding ───────────────────
  //
  // Three assets, a batch of one, and the first two permanently referenced.
  // Oldest-clock-first would examine the same asset for ever; oldest-CHECKED
  // first must reach the third within three passes.
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const stuck1 = seedAsset(db, TENANT)
    const stuck2 = seedAsset(db, TENANT)
    const reachable = seedAsset(db, TENANT)
    reference(db, TENANT, 'page_sections', stuck1.paths[0]!)
    reference(db, TENANT, 'page_sections', stuck2.paths[0]!)
    const { storage } = fakeStorage()

    const seen = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const before = db.of('photo_assets').map((r) => ({ id: r.id, at: r.sweep_checked_at }))
      await sweep(db as unknown as SweepDb, storage, { now: new Date(Date.now() + i * 1000), maxAssets: 1 })
      for (const b of before) {
        const after = db.of('photo_assets').find((r) => r.id === b.id)!
        if (after.sweep_checked_at !== b.at) seen.add(String(b.id))
      }
    }
    ok('forward progress: three passes of one reach all three assets', seen.size === 3, [...seen].length)
    ok('forward progress: the third asset was reached', seen.has(reachable.id))
  }

  // ── 14. Sample photographs are never handed to the bucket ───────────────
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const a = seedAsset(db, TENANT, { unreferencedSince: daysAgo(GRACE_DAYS + 1) })
    // Replace its files with the bucket's own sample.
    const row = db.of('photo_assets').find((r) => r.id === a.id)!
    row.display_path = 'samples/sample-1.webp'
    row.original_path = null
    row.derivatives = {}
    const { storage, removed } = fakeStorage()
    await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    ok('samples: no sample key is ever sent to remove', removed.length === 0, removed)
  }

  // ── 15. dryRun writes nothing and deletes nothing ───────────────────────
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const a = seedAsset(db, TENANT, { unreferencedSince: daysAgo(GRACE_DAYS + 1) })
    const { storage, removed } = fakeStorage()
    const report = await sweep(db as unknown as SweepDb, storage, { now: new Date(), dryRun: true })
    const row = db.of('photo_assets').find((r) => r.id === a.id)!
    ok('dry run: reports a purge', report.purged === 1)
    ok('dry run: deletes nothing', removed.length === 0)
    ok('dry run: writes nothing', row.swept_at === null && row.sweep_checked_at === null, row)
  }

  // ── 16. Rejection paths — nothing throws out of sweep() ─────────────────
  for (const where of ['photo_assets', 'photo_usages', 'page_sections'] as const) {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    seedAsset(db, TENANT, { unreferencedSince: daysAgo(GRACE_DAYS + 1) })
    db.fail = { table: where, op: 'select', mode: 'throw' }
    const { storage, removed } = fakeStorage()
    let threw: unknown = null
    let report: Awaited<ReturnType<typeof sweep>> | null = null
    try {
      report = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    } catch (e) {
      threw = e
    }
    ok(`rejection ${where}: sweep does not throw`, threw === null, threw instanceof Error ? threw.message : threw)
    ok(`rejection ${where}: nothing is deleted`, removed.length === 0)
    ok(`rejection ${where}: a report comes back`, report !== null && report.purged === 0)
  }

  // A failing write must not be reported as a purge.
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const a = seedAsset(db, TENANT, { unreferencedSince: daysAgo(GRACE_DAYS + 1) })
    db.fail = { table: 'photo_assets', op: 'update', mode: 'error' }
    const { storage, removed } = fakeStorage()
    const report = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    ok('write failure: the files were deleted but no purge is claimed', removed.length > 0 && report.purged === 0, report.outcomes)
    ok('write failure: the asset is left for another run', db.of('photo_assets').find((r) => r.id === a.id)!.swept_at === null)
  }

  // ── 17. The report adds up ──────────────────────────────────────────────
  //
  // One outcome per examined asset. An earlier version recorded both
  // `clock_cleared` and `kept_referenced` for the same asset, which made the
  // counts stop summing and the report impossible to add up.
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    const due = seedAsset(db, TENANT, { unreferencedSince: daysAgo(GRACE_DAYS + 1) })
    const fresh = seedAsset(db, TENANT)
    const back = seedAsset(db, TENANT, { unreferencedSince: daysAgo(GRACE_DAYS + 1) })
    reference(db, TENANT, 'page_sections', back.paths[0]!)
    void due
    void fresh
    const { storage } = fakeStorage()
    const report = await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    const total = Object.values(report.outcomes).reduce((a, b) => a + (b ?? 0), 0)
    ok('report: outcomes sum to examined', total === report.examined, { total, examined: report.examined, outcomes: report.outcomes })
  }

  // ── 18. Cross-site: one site's run never touches another's asset ────────
  {
    const db = new FakeDb()
    seedEvidence(db, TENANT)
    seedEvidence(db, OTHER)
    const mine = seedAsset(db, TENANT, { unreferencedSince: daysAgo(GRACE_DAYS + 1) })
    const theirs = seedAsset(db, OTHER, { unreferencedSince: daysAgo(GRACE_DAYS + 1) })
    // Their asset is referenced on their site; mine is not referenced anywhere.
    reference(db, OTHER, 'page_sections', theirs.paths[0]!)
    const { storage, removed } = fakeStorage()
    await sweep(db as unknown as SweepDb, storage, { now: new Date() })
    ok('two sites: mine is purged', removed.includes(mine.paths[0]!))
    ok('two sites: theirs is not', !removed.includes(theirs.paths[0]!), removed)
  }

  console.log(`sweep: ${pass} passed, ${fail.length} failed`)
  for (const f of fail) console.log('  FAIL ' + f)

  console.log('\nMUTATIONS — apply each to lib/photos/sweep.ts, run this file, confirm the')
  console.log('named check FAILS, then revert. A mutation that leaves this green is a hole')
  console.log('in the suite, not a harmless edit.')
  for (const m of MUTATIONS) console.log(`  • ${m.change}\n      must fail: ${m.expect}`)

  process.exit(fail.length === 0 ? 0 : 1)
}

const MUTATIONS: Array<{ change: string; expect: string }> = [
  {
    change: 'In SWEEP_SOURCES, drop ...HISTORY_SOURCES so only the canonical seven are read.',
    expect: 'examine: site_versions naming a file makes it referenced (and the two other history cases)',
  },
  {
    change: "In candidateAssets, order by 'unreferenced_since' instead of 'sweep_checked_at'.",
    expect: 'forward progress: three passes of one reach all three assets',
  },
  {
    change: 'In examine, return { state: "unreferenced" } when incomplete.length > 0.',
    expect: 'examine: a missing source is incomplete / incomplete: nothing deleted',
  },
  {
    change: 'In examine, delete the ownsKey loop.',
    expect: 'examine: a legacy path is unprovable',
  },
  {
    change: 'In examine, delete the evidence.tenantId !== asset.tenantId refusal.',
    expect: 'examine: foreign evidence is refused',
  },
  {
    change: 'In sweep, treat usageCount() === null as zero and carry on.',
    expect: 'veto usage_unanswerable: not purged',
  },
  {
    change: 'In sweep, write swept_at even when storage.remove returned failed keys.',
    expect: 'veto storage_refuses: swept_at is not written',
  },
  {
    change: 'In sweep, purge on the first unreferenced sighting instead of starting a clock.',
    expect: 'run 1: nothing is deleted on first sight',
  },
  {
    change: 'In sweep, skip clearing unreferenced_since when a reference reappears.',
    expect: 'back in use: the clock is cleared',
  },
  {
    change: 'In assetFiles, remove the isSamplePhoto guard.',
    expect: 'samples: no sample key is ever sent to remove',
  },
  {
    change: 'In sweep, honour dryRun for storage but still write sweep_checked_at.',
    expect: 'dry run: writes nothing',
  },
]

main().catch((e) => {
  console.log(`FAIL the suite stopped: ${e instanceof Error ? e.stack : String(e)}`)
  process.exit(1)
})
