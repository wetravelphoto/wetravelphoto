/**
 * P4 UNIT 2, END TO END: the asset foreign keys and their completeness proof.
 *
 *   node scripts/photo-assets-fk.mjs
 *
 * Portable (Node + pg). Builds its OWN scratch database on a loopback server
 * (scripts/p4-local-db.mjs: unique name, loopback only, drops only itself).
 *
 * Unit 2 is DEPLOYED (Supabase 20261006012958) and db/test-fixture.sql now
 * carries it, so the migration's PRECONDITIONS can only be tested against the
 * database as it was before it. That state is rebuilt explicitly: fixture →
 * stage `pre_p4` (unit 2's keys and indexes and unit 1's functions removed, P3's
 * resolver restored — scripts/p4-local-db.mjs) → unit 1, twice (from nothing,
 * then again) → P1's suite told `wtp.p4_stage = pre_unit2`, which asserts the
 * ORIGINAL contract: no asset key yet. Then it proves
 * db/migrations/2026-10-05_photo_assets_fk.sql:
 *
 *   0. MUTATION: in that state the DEFAULT P1 suite (the deployed contract)
 *      fails — and on the deployed fixture (compatibility()) the historical
 *      one does;
 *   1. the PREFLIGHT refuses — changing nothing — for each of its five rules;
 *   2. an existing constraint OR supporting index of another shape refuses;
 *   3. the RACE: a writer's uncommitted unlinked photograph is waited for and
 *      then refused; and the same race against the migration WITHOUT its lock
 *      is LOST (the keys go on over incomplete data) — so the test can fail;
 *   4. with complete data it applies, twice, to exactly the definitions meant;
 *   5. db/verify-photo-assets-fk.sql passes; and, on a SECOND scratch
 *      database holding the UNTOUCHED fixture — the deployed state, keys
 *      included (see compatibility()) — P1's, P2's, P3's and P4's suites pass
 *      with the real, validated keys in place (SQL and TypeScript);
 *   6. the footer ROLLBACK removes exactly what it added;
 *   7. MUTATION: without the keys the verify suite FAILS.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadFixture, runSqlFile, tsxPath, withScratch } from './p4-local-db.mjs'

// P1's suite under a named stage (unset = the deployed contract).
async function p1Suite(db, stage = '') {
  await db.query(`select set_config('wtp.p4_stage', $1, false)`, [stage])
  try {
    return await runSqlFile(db, 'db/verify-photo-assets.sql')
  } finally {
    await db.query(`select set_config('wtp.p4_stage', '', false)`)
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIG = 'db/migrations/2026-10-05_photo_assets_fk.sql'
const UNIT1 = 'db/migrations/2026-10-05_photo_backfill.sql'
const DEF = 'FOREIGN KEY (asset_id, tenant_id) REFERENCES photo_assets(id, tenant_id)'

let pass = 0
let fail = 0
const ok = (n) => { pass++; console.log(`  ok    ${n}`) }
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? '\n        ' + d : ''}`) }
const check = (good, okName, badName, detail = '') => { if (good) ok(okName); else bad(badName, detail) }
const is = (n, got, want) => check(JSON.stringify(got) === JSON.stringify(want), n, n, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const migText = readFileSync(resolve(ROOT, MIG), 'utf8')

async function main() {
  return withScratch(async (cfg) => {
    // The HISTORICAL state, rebuilt on purpose: before P4, then unit 1 from
    // nothing and once more (safe to run twice) — production between the units.
    await loadFixture(cfg, [UNIT1, UNIT1], { stage: 'pre_p4' })
    const db = new pg.Client(cfg)
    await db.connect()
    const q = async (sql, args = []) => (await db.query(sql, args)).rows
    const one = async (sql, args = []) => Object.values((await q(sql, args))[0] ?? {})[0]
    const keys = () => one(`select count(*)::int from pg_constraint where conname in ('photos_asset_fk', 'site_images_asset_fk')`)
    const indexes = () => one(`select count(*)::int from pg_indexes where indexname in ('photos_asset_tenant', 'site_images_asset_tenant')`)
    const apply = async (text = migText) => {
      try {
        await db.query(text)
        return null
      } catch (e) {
        await db.query('rollback').catch(() => {})
        return e.message
      }
    }
    const refuses = async (label, fragment) => {
      const err = await apply()
      if (err && err.includes(fragment)) ok(`${label}: refused — "${fragment}"`)
      else bad(`${label}: refused`, String(err))
      is(`${label}: …and nothing changed`, [await keys(), await indexes()], [0, 0])
    }

    try {
      // P1's ORIGINAL contract holds BEFORE unit 2: asset_id has no key yet.
      const p1 = await p1Suite(db, 'pre_unit2')
      check(p1.ok, `P1 suite, historical stage pre_unit2: ${p1.summary}`, 'P1 suite, historical stage pre_unit2', failures(p1.summary))
      // …and the DEFAULT (deployed) contract must FAIL here: it is not a skip.
      const p1now = await p1Suite(db)
      check(!p1now.ok && p1now.summary.includes("FAIL   photos.asset_id / site_images.asset_id carry P4 unit 2's keys, exactly"),
        `MUTATION (no keys yet): the deployed-state P1 suite fails — ${(/\d+ of \d+ check\(s\) failed/.exec(p1now.summary) ?? ['?'])[0]}`,
        'MUTATION (no keys yet): the deployed-state P1 suite did not fail where it must', p1now.summary.slice(0, 400))

      // ── 1. The preflight, rule by rule ─────────────────────────────────────
      await refuses('the fixture as it is (3 unlinked photographs)', '3 unlinked photograph(s), 0 unlinked Uploads row(s), 0 link(s)')
      // Link the fixture's photographs as the backfill would leave them (the
      // owner writes directly: this tests the migration, not the writer).
      await q(`insert into photo_assets (tenant_id, key_base, display_path, derivatives, state)
               select tenant_id, regexp_replace(storage_path, '/[^/]+$', ''), storage_path, '{}', 'derived' from photos`)
      await q(`update photos p set asset_id = a.id from photo_assets a where a.tenant_id = p.tenant_id and a.display_path = p.storage_path`)

      await q(`insert into site_images (id, tenant_id, storage_path) values ('eeeeeeee-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', 't/one/site-images/x/400.webp')`)
      await refuses('an unlinked Uploads row', '1 unlinked Uploads row(s)')
      await q(`insert into photo_assets (id, tenant_id, key_base, display_path, derivatives, state)
               values ('0e000000-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', 't/one/site-images/x', 't/one/site-images/x/400.webp', '{}', 'derived');
               update site_images set asset_id = '0e000000-0000-4000-8000-0000000000d1' where id = 'eeeeeeee-0000-0000-0000-0000000000d1'`)

      await q(`insert into photo_assets (id, tenant_id, key_base, display_path, derivatives, state)
               values ('0e000000-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-0000-0000-000000000002', 't/two/x', 't/one/photos/a/1/2400.webp', '{}', 'derived');
               update photos set asset_id = '0e000000-0000-4000-8000-0000000000d2' where id = 'cccccccc-0000-0000-0000-000000000001'`)
      await refuses("a link to ANOTHER site's asset", "1 link(s) to no asset of the row's own site")
      await q(`update photos p set asset_id = a.id from photo_assets a
                where p.id = 'cccccccc-0000-0000-0000-000000000001' and a.tenant_id = p.tenant_id and a.display_path = p.storage_path;
               delete from photo_assets where id = '0e000000-0000-4000-8000-0000000000d2'`)

      await q(`insert into photos (id, tenant_id, album_id, storage_path, sort_order, asset_id)
               select 'cccccccc-0000-0000-0000-0000000000d4', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
                      '/samples/wildlife/lion.webp', 9, asset_id from photos where id = 'cccccccc-0000-0000-0000-000000000001'`)
      await refuses('a sample with an asset', '1 sample(s) with an asset')
      await q(`update photos set asset_id = null where id = 'cccccccc-0000-0000-0000-0000000000d4'`)

      await q(`update photos set storage_path = 't/one/photos/a/1/800.webp' where id = 'cccccccc-0000-0000-0000-000000000001'`)
      await refuses('a row disagreeing with its asset', '1 row(s) disagreeing')
      await q(`update photos set storage_path = 't/one/photos/a/1/2400.webp' where id = 'cccccccc-0000-0000-0000-000000000001'`)

      // ── 2. Same-named objects of another shape ─────────────────────────────
      await q(`alter table photos add constraint photos_asset_fk foreign key (asset_id) references photo_assets (id)`)
      let err = await apply()
      check(err?.includes('photos_asset_fk exists with another definition'), 'a photos_asset_fk of another shape: refused', 'a photos_asset_fk of another shape', String(err))
      is('…and site_images_asset_fk was not added', await one(`select count(*)::int from pg_constraint where conname = 'site_images_asset_fk'`), 0)
      await q(`alter table photos drop constraint photos_asset_fk`)

      await q(`create index photos_asset_tenant on photos (asset_id)`)
      err = await apply()
      check(err?.includes('photos_asset_tenant exists with another definition'), 'a photos_asset_tenant index of another shape: refused', 'a wrong existing index', String(err))
      is('…and no key was left behind', await keys(), 0)
      await q(`drop index photos_asset_tenant`)
      await q(`create index photos_asset_tenant on photos (asset_id, tenant_id) where asset_id is not null and tenant_id is not null`)
      err = await apply()
      check(err?.includes('photos_asset_tenant exists with another definition'), '…and one differing only in its predicate: refused', 'a wrong predicate', String(err))
      await q(`drop index photos_asset_tenant`)

      // ── 3. The race: preflight vs. an uncommitted writer ───────────────────
      const race = async (text) => {
        const w = new pg.Client(cfg)
        const m = new pg.Client(cfg)
        await w.connect()
        await m.connect()
        try {
          await w.query('begin')
          await w.query(`insert into photos (id, tenant_id, album_id, storage_path, sort_order)
                         values ('cccccccc-0000-0000-0000-0000000000e1', 'aaaaaaaa-0000-0000-0000-000000000001',
                                 'bbbbbbbb-0000-0000-0000-000000000001', 't/one/photos/a/race/400.webp', 99)`)
          const migP = m.query(text).then(() => null, async (e) => { await m.query('rollback').catch(() => {}); return e.message })
          let waited = false
          for (let i = 0; i < 100 && !waited; i++) {
            await new Promise((r) => setTimeout(r, 30))
            waited = (await one(`select count(*)::int from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'`, [m.processID])) === 1
          }
          await w.query('commit')
          return { waited, err: await migP }
        } finally {
          await w.end()
          await m.end()
        }
      }
      const real = await race(migText)
      check(real.waited, 'race: the migration WAITS for the writer (observed)', 'race: the wait was not observed')
      check(real.err?.includes('1 unlinked photograph(s)'), "race: …then sees the writer's row and REFUSES", 'race: refused after the wait', String(real.err))
      is('race: …no keys', await keys(), 0)
      await q(`delete from photos where id = 'cccccccc-0000-0000-0000-0000000000e1'`)

      const unlocked = migText.replace(/^lock table public\.photo_assets, public\.photos, public\.site_images in share row exclusive mode;$/m, '')
      check(unlocked !== migText, 'MUTATION: the lock statement removed', 'MUTATION: could not remove the lock statement')
      const lost = await race(unlocked)
      is('MUTATION (no lock): the race is LOST — the keys go on over an unlinked photograph',
        [lost.err, await keys(), await one(`select count(*)::int from photos where id = 'cccccccc-0000-0000-0000-0000000000e1' and asset_id is null`)], [null, 2, 1])
      await apply(`begin; alter table photos drop constraint photos_asset_fk; alter table site_images drop constraint site_images_asset_fk;
                   drop index public.photos_asset_tenant; drop index public.site_images_asset_tenant;
                   delete from photos where id = 'cccccccc-0000-0000-0000-0000000000e1'; commit;`)
      is('(mutation undone)', [await keys(), await indexes()], [0, 0])

      // ── 4. Complete: it applies, twice ─────────────────────────────────────
      is('with complete data the migration applies', await apply(), null)
      is('…and applies a second time', await apply(), null)
      is('photos_asset_fk is exactly the definition meant', await one(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'photos_asset_fk'`), DEF)
      is('site_images_asset_fk is exactly the definition meant', await one(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'site_images_asset_fk'`), DEF)
      is('exactly one of each, and both indexes once', [await keys(), await indexes()], [2, 2])

      // ── 5. Its own suite ───────────────────────────────────────────────────
      const own = await runSqlFile(db, 'db/verify-photo-assets-fk.sql')
      check(own.ok, `db/verify-photo-assets-fk.sql: ${own.summary}`, 'db/verify-photo-assets-fk.sql', failures(own.summary))

      // ── 6. The rollback, as written in the footer ──────────────────────────
      const rollback = migText.slice(migText.indexOf('-- ── Rollback')).split('\n').filter((l) => l.startsWith('--   ')).map((l) => l.slice(5)).join('\n')
      is('the rollback runs', await apply(rollback), null)
      is('it removes both keys and both indexes', [await keys(), await indexes()], [0, 0])
      is('…and no row changed (every non-sample photograph still linked)',
        await one(`select count(*)::int from photos where asset_id is null and storage_path !~ '^/samples/'`), 0)

      // ── 7. Mutation: without the keys the suite must FAIL ──────────────────
      const m = await runSqlFile(db, 'db/verify-photo-assets-fk.sql')
      check(!m.ok && m.summary.includes("FAIL   a photograph pointing at ANOTHER site's asset is refused"),
        `MUTATION (no keys): the suite fails — ${(/\d+ of \d+ check\(s\) failed/.exec(m.summary) ?? ['?'])[0]}`,
        'MUTATION (no keys): the suite did not fail where it must', m.summary.slice(0, 400))
    } finally {
      await db.end()
    }
  })
}

const failures = (s) => s.split('\n').filter((l) => /FAIL|failed/.test(l)).join('\n        ') || s.slice(0, 600)

/**
 * P1, P2, P3 and P4 with the keys in place, on the UNTOUCHED fixture — which
 * since the reconciliation IS the deployed state: unit 1's functions and unit
 * 2's keys and indexes, created by db/test-fixture.sql itself (no stage, no
 * hand-added DDL). Unit 1 is applied over it once more: running it against the
 * deployed state changes nothing. The keys are the real, VALIDATED ones: the
 * fixture's three seeded unlinked photographs have a NULL asset_id, and under
 * MATCH SIMPLE a NULL passes a foreign key — which is exactly why a key that
 * applies proves nothing about completeness, and why the migration's own
 * preflight (proved above) is what refuses them. Production holds no such row.
 */
async function compatibility() {
  return withScratch(async (cfg) => {
    await loadFixture(cfg, [UNIT1])
    const db = new pg.Client(cfg)
    await db.connect()
    try {
      const keys = (await db.query(`select pg_get_constraintdef(oid) d, convalidated v from pg_constraint
                                     where conname in ('photos_asset_fk', 'site_images_asset_fk') order by conname`)).rows
      is('compatibility: the fixture carries the keys exactly as defined, and VALIDATED', keys, [{ d: DEF, v: true }, { d: DEF, v: true }])
      is('compatibility: …and both supporting indexes', (await db.query(`select count(*)::int n from pg_indexes
        where schemaname = 'public' and indexname in ('photos_asset_tenant', 'site_images_asset_tenant')`)).rows[0].n, 2)
      is('compatibility: …over the fixture as it is — its unlinked photographs pass a key (NULL), which is why the preflight exists',
        (await db.query(`select count(*)::int n from photos where asset_id is null and storage_path !~ '^/samples/'`)).rows[0].n, 3)
      const p1 = await p1Suite(db)
      check(p1.ok, `compatibility: P1 suite, deployed contract: ${p1.summary}`, 'compatibility: P1 suite, deployed contract', failures(p1.summary))
      const p1old = await p1Suite(db, 'pre_unit2')
      check(!p1old.ok && p1old.summary.includes('FAIL   HISTORICAL (before unit 2): photos.asset_id / site_images.asset_id have no foreign key yet'),
        'MUTATION (keys on): the historical-stage P1 suite fails — it reports the keys it found',
        'MUTATION (keys on): the historical-stage P1 suite did not fail where it must', p1old.summary.slice(0, 400))
      for (const f of ['db/verify-photo-assets-fk.sql', 'db/verify-photo-ingest.sql', 'db/verify-photo-usages.sql', 'db/verify-photo-backfill.sql',
                       'db/verify-album-cover-fk.sql', 'db/verify-tenant-isolation.sql', 'db/verify-jobs.sql', 'db/verify-analytics.sql']) {
        const r = await runSqlFile(db, f)
        check(r.ok, `${f} with the keys: ${r.summary}`, `${f} with the keys`, failures(r.summary))
      }
    } finally {
      await db.end()
    }
    for (const suite of ['.mk/photo-assets.ts', '.mk/ingest.ts', '.mk/usages.ts', '.mk/backfill.ts', '.mk/jobs.ts']) {
      const r = spawnSync(process.execPath, [tsxPath(), suite], {
        cwd: ROOT, encoding: 'utf8',
        env: { ...process.env, PGHOST: cfg.host, PGPORT: String(cfg.port), PGUSER: cfg.user, PGDATABASE: cfg.database, PGCLIENTENCODING: 'UTF8' },
      })
      const tail = (r.stdout ?? '').trim().split('\n').slice(-1)[0]
      check(r.status === 0, `${suite} with the keys: ${tail}`, `${suite} with the keys`, failures(r.stdout ?? '') + (r.stderr ?? ''))
    }
  })
}

async function all() {
  await main()
  await compatibility()
  console.log(`\n${pass} passed, ${fail} failed`)
  return fail ? 1 : 0
}

all().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1) })
