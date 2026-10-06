/**
 * P4's LOCAL rehearsal harness — portable (Node + pg; no psql, no createdb).
 *
 *   node scripts/p4-local-db.mjs sql <file.sql>...           fresh fixture DB, run each file in order
 *   node scripts/p4-local-db.mjs ts  <migrations.sql>... -- <suite.ts> [args]
 *                                                             fresh fixture DB + migrations, then the suite
 *   … sql|ts --stage pre_unit2|pre_p4 …                       the fixture rebuilt to a HISTORICAL stage first
 *                                                             (see stageSql below); without it, the fixture is
 *                                                             production as deployed, P4 included
 *
 * Every run makes its OWN scratch database, `p4_scratch_<time>_<random>`, on a
 * LOOPBACK server only, loads db/test-fixture.sql into it, and drops exactly
 * that database afterwards. It never touches a database it did not create, and
 * it refuses any host that is not 127.0.0.1 / localhost / ::1 — so an
 * inherited PGHOST can never point it at anything real.
 *
 *   P4_PGHOST (default 127.0.0.1)  P4_PGPORT (default 55434)  P4_PGUSER (default postgres)
 *   P4_TSX    path to tsx's cli.mjs (default node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs,
 *             then node_modules/tsx/dist/cli.mjs)
 *
 * A SQL suite that ends by raising "All N checks passed." counts as passed;
 * any other error fails the run. Exit code: 0 all passed, 1 otherwise.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

export function localConfig() {
  const host = process.env.P4_PGHOST ?? '127.0.0.1'
  if (!LOOPBACK.has(host)) throw new Error(`refusing non-loopback host "${host}": this harness is local-only`)
  return { host, port: Number(process.env.P4_PGPORT ?? 55434), user: process.env.P4_PGUSER ?? 'postgres' }
}

export async function withScratch(fn) {
  const cfg = localConfig()
  const name = `p4_scratch_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
  const admin = new pg.Client({ ...cfg, database: 'postgres', connectionTimeoutMillis: 5000 })
  await admin.connect()
  await admin.query(`create database ${name}`)
  try {
    return await fn({ ...cfg, database: name })
  } finally {
    // Only the database this run created, by the name it generated.
    await admin.query(`drop database if exists ${name} with (force)`).catch((e) => console.error(`could not drop ${name}: ${e.message}`))
    await admin.end()
  }
}

/** Runs one SQL file. Returns { ok, summary }. A suite's closing "All N checks passed." raise is a pass. */
export async function runSqlFile(client, file) {
  const sql = readFileSync(resolve(ROOT, file), 'utf8')
  try {
    await client.query(sql)
    return { ok: true, summary: 'completed' }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    const m = /All (\d+ )?checks passed\./.exec(e.message)
    if (m && !/\bFAIL\b/.test(e.message)) return { ok: true, summary: m[0] }
    return { ok: false, summary: e.message }
  }
}

/*
 * HISTORICAL STAGES. db/test-fixture.sql is production as it is NOW — P4 unit 1
 * and unit 2 deployed (Supabase 20261005192303, 20261006012958). A test of a
 * migration's preconditions needs the database as it was BEFORE that migration,
 * so it asks for it by name and gets it rebuilt in its own scratch database:
 *
 *   pre_unit2   unit 1 deployed, unit 2 not: the two asset keys and their two
 *               indexes removed — unit 2's own footer rollback, read from the
 *               migration file, not retyped.
 *   pre_p4      neither: pre_unit2, then unit 1's five functions dropped (its
 *               footer's drop list) and P3's resolver restored, read from
 *               db/migrations/2026-09-30_photo_usages_sync.sql.
 *
 * Each stage then CHECKS that it got there; a stage that silently did nothing
 * would make a historical test prove the present.
 */
const UNIT1_FILE = 'db/migrations/2026-10-05_photo_backfill.sql'
const UNIT2_FILE = 'db/migrations/2026-10-05_photo_assets_fk.sql'
const P3B_FILE = 'db/migrations/2026-09-30_photo_usages_sync.sql'
export const P4_STAGES = ['pre_unit2', 'pre_p4']
const UNIT1_FNS = ['photo_backfill_key_base', 'photo_backfill_foreign_claim', 'read_photo_backfill_inventory',
                   'read_photo_backfill_claims', 'register_legacy_photo_asset']

const footer = (file) => {
  const text = readFileSync(resolve(ROOT, file), 'utf8').replace(/\r\n/g, '\n')
  return text.slice(text.indexOf('-- ── Rollback')).split('\n').filter((l) => l.startsWith('--   ')).map((l) => l.slice(5))
}

export function stageSql(stage) {
  if (!P4_STAGES.includes(stage)) throw new Error(`unknown stage "${stage}" (known: ${P4_STAGES.join(', ')})`)
  const unit2 = footer(UNIT2_FILE).join('\n')
  if (stage === 'pre_unit2') return unit2
  const drops = footer(UNIT1_FILE).filter((l) => l.startsWith('drop function'))
  const p3 = readFileSync(resolve(ROOT, P3B_FILE), 'utf8').replace(/\r\n/g, '\n')
  const m = /create or replace function public\.photo_usage_resolve_path\(p_tenant uuid, p_path text\)[\s\S]*?\n\$\$;\n/.exec(p3)
  if (drops.length !== UNIT1_FNS.length || !m) throw new Error('pre_p4: unit 1 footer or the P3 resolver not found')
  return [unit2, 'begin;', ...drops, m[0],
          'revoke all on function public.photo_usage_resolve_path(uuid, text) from public, anon, authenticated, service_role;',
          'commit;'].join('\n')
}

export async function applyStage(client, stage) {
  await client.query(stageSql(stage))
  const one = async (sql, args) => Object.values((await client.query(sql, args)).rows[0])[0]
  const keys = await one(`select count(*)::int from pg_constraint where conname in ('photos_asset_fk', 'site_images_asset_fk')`)
  const idx = await one(`select count(*)::int from pg_indexes where schemaname = 'public' and indexname in ('photos_asset_tenant', 'site_images_asset_tenant')`)
  const fns = await one(`select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [UNIT1_FNS])
  const p3Resolver = await one(`select pg_get_functiondef('public.photo_usage_resolve_path(uuid, text)'::regprocedure) like '%limit 1%'`)
  const want = stage === 'pre_unit2' ? [0, 0, 5, false] : [0, 0, 0, true]
  const got = [keys, idx, fns, p3Resolver]
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`stage ${stage} not reached: [keys, indexes, unit 1 functions, P3 resolver] = ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

/** The fixture, then (optionally) a historical stage, then each migration in order. */
export async function loadFixture(cfg, migrations = [], { stage } = {}) {
  const c = new pg.Client(cfg)
  await c.connect()
  try {
    const r = await runSqlFile(c, 'db/test-fixture.sql')
    if (!r.ok) throw new Error(`db/test-fixture.sql: ${r.summary}`)
    if (stage) await applyStage(c, stage)
    for (const f of migrations) {
      const m = await runSqlFile(c, f)
      if (!m.ok) throw new Error(`${f}: ${m.summary}`)
    }
  } finally {
    await c.end()
  }
}

export function tsxPath() {
  for (const p of [process.env.P4_TSX, join(ROOT, 'node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs'), join(ROOT, 'node_modules/tsx/dist/cli.mjs')]) {
    if (p && existsSync(p)) return p
  }
  throw new Error('tsx not found; set P4_TSX')
}

async function main(argv) {
  const [mode, ...more] = argv
  let stage
  if (more[0] === '--stage') {
    stage = more[1]
    stageSql(stage)
  }
  const rest = stage ? more.slice(2) : more
  if (mode === 'sql') {
    return withScratch(async (cfg) => {
      await loadFixture(cfg, [], { stage })
      const c = new pg.Client(cfg)
      await c.connect()
      let failed = 0
      try {
        // A suite that knows the historical contract (db/verify-photo-assets.sql)
        // asserts it only when told which stage it is looking at.
        if (stage) await c.query(`select set_config('wtp.p4_stage', $1, false)`, [stage])
        for (const f of rest) {
          const r = await runSqlFile(c, f)
          console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${f}: ${r.ok ? r.summary : '\n' + r.summary}`)
          if (!r.ok) failed++
        }
      } finally {
        await c.end()
      }
      return failed ? 1 : 0
    })
  }
  if (mode === 'ts') {
    const sep = rest.indexOf('--')
    if (sep < 0) throw new Error('usage: ts <migrations>... -- <suite.ts> [args]')
    const migrations = rest.slice(0, sep)
    const [suite, ...args] = rest.slice(sep + 1)
    return withScratch(async (cfg) => {
      await loadFixture(cfg, migrations, { stage })
      const r = spawnSync(process.execPath, [tsxPath(), suite, ...args], {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          PGHOST: cfg.host, PGPORT: String(cfg.port), PGUSER: cfg.user, PGDATABASE: cfg.database,
          PGCLIENTENCODING: 'UTF8', P4_LOCAL_DB: cfg.database,
        },
      })
      return r.status ?? 1
    })
  }
  throw new Error('usage: p4-local-db.mjs sql [--stage S] <files>... | ts [--stage S] <migrations>... -- <suite.ts> [args]')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message)
      process.exit(1)
    }
  )
}
