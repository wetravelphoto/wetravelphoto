import pg from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { withScratch, loadFixture, runSqlFile } from '../scripts/p4-local-db.mjs'

/**
 * THE DURABLE GALLERY-EMAIL SEND LIMIT, AGAINST REAL CONNECTIONS
 * ═══════════════════════════════════════════════════════════════
 *
 * db/migrations/2026-11-22_gallery_email_send_limits.sql, on loopback scratch
 * databases only (scripts/p4-local-db.mjs refuses any other host). Every
 * site, account and address is synthetic (`.invalid`).
 *
 *   node scripts/p4-local-db.mjs ts -- .mk/gallery-email-limits-db.ts [--no-mutations]
 *
 * What db/verify-gallery-email-limits.sql cannot show from inside one
 * transaction, and this does:
 *   · the migration applies twice (loadFixture applies it twice), and the SQL
 *     suite passes on that database;
 *   · SERIALISATION, deterministically: two reservations are committed, a
 *     third is made and HELD uncommitted, three more callers are started and
 *     seen waiting on the advisory lock in pg_locks, then the holder commits —
 *     every waiter must answer recipient_limited. Without the lock each would
 *     count two and reserve (the mutant below proves the check can fail);
 *   · a burst of 45 concurrent calls on one site reserves exactly 30, and 10
 *     concurrent calls to one recipient reserve exactly 3;
 *   · REPEATABLE READ and SERIALIZABLE callers are refused (55000), nothing
 *     written;
 *   · a waiter gives up after lock_timeout (55P03) rather than hanging;
 *   · another site never waits on this site's lock;
 *   · a re-run REFUSES a same-named table with an extra column or a policy
 *     (42710), and RE-NARROWS a widened grant;
 *   · mutants (copies of the migration text, each on its own scratch
 *     database): no advisory lock → over-reservation; no isolation guard →
 *     REPEATABLE READ reserves; no tenant match in the editor rule → the SQL
 *     suite's cross-site refusals FAIL in its report; an anon grant → the migration's own read-back refuses.
 *     Each must be CAUGHT; a mutant that survives is a failure here.
 */

const ROOT = resolve(__dirname, '..')
const MIG_FILE = 'db/migrations/2026-11-22_gallery_email_send_limits.sql'
const SUITE = 'db/verify-gallery-email-limits.sql'
const MIG = readFileSync(resolve(ROOT, MIG_FILE), 'utf8')
const MUTATIONS = !process.argv.includes('--no-mutations')

/*
 * The SQL suite cut down to its authorisation half: setup, §1 (catalogue) and
 * §2 (who may call it), then the suite's own report-and-abort block — the
 * file's text, sliced, never edited. The any-site-editor mutant needs this:
 * under it §2's cross-site calls RESERVE (the failures it must show), which
 * leaves site B two rows, and §5's scalar `(select recipient_hash … where
 * tenant_id = TB)` then raises 21000 "more than one row returned by a
 * subquery" — aborting the transaction before the report, so the full suite
 * can only crash on that mutant, never name the refusal it lost.
 */
const AUTH_SUITE = (() => {
  const text = readFileSync(resolve(ROOT, SUITE), 'utf8')
  const cut = text.indexOf('-- ── 3. Nobody reaches the table directly')
  const report = text.indexOf('-- ── Report, then abort')
  if (cut < 0 || report < 0 || report < cut) throw new Error(`${SUITE}: the section markers the authorisation slice needs were not found`)
  return text.slice(0, cut) + text.slice(report)
})()

/** runSqlFile's contract, for SQL text rather than a file. */
async function runSqlText(c: pg.Client, sql: string) {
  try {
    await c.query(sql)
    return { ok: true, summary: 'completed' }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    const msg = (e as Error).message
    const m = /All (\d+ )?checks passed\./.exec(msg)
    if (m && !/\bFAIL\b/.test(msg)) return { ok: true, summary: m[0] }
    return { ok: false, summary: msg }
  }
}
/** True when the suite's report lists `step` as a FAIL line (its own `  FAIL  <step padded>` format). */
const failed = (summary: string, step: string) => {
  const escaped = step.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')
  return new RegExp('^\\s*FAIL\\s+' + escaped + '\\s', 'm').test(summary)
}

let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') => (good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`))
const is = (n: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  ok(n, g === w, g === w ? '' : `got ${g}\n    wanted ${w}`)
}

const TA = 'e0a00000-0000-4000-8000-000000000001'
const TB = 'e0b00000-0000-4000-8000-000000000001'
const UA = 'e1a00000-0000-4000-8000-000000000001'
const UB = 'e1b00000-0000-4000-8000-000000000001'
const AA = 'e2a00000-0000-4000-8000-000000000001'
const AB = 'e2b00000-0000-4000-8000-000000000001'
const ca = (n: number) => `e3a00000-0000-4000-8000-${String(n).padStart(12, '0')}`
const cb = (n: number) => `e3b00000-0000-4000-8000-${String(n).padStart(12, '0')}`

type Cfg = { host: string; port: number; user: string; database: string }
type Answer = { ok: true; v: string } | { ok: false; code?: string; message: string }

async function connect(cfg: Cfg) {
  const c = new pg.Client(cfg)
  await c.connect()
  return c
}

async function owner<T>(cfg: Cfg, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = await connect(cfg)
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

const SEED = `
insert into public.tenants (id, name, domain) values
  ('${TA}', 'GEL site A', 'gel-a.invalid'), ('${TB}', 'GEL site B', 'gel-b.invalid');
insert into auth.users (id) values ('${UA}'), ('${UB}');
insert into public.profiles (id, tenant_id, email, role) values
  ('${UA}', '${TA}', 'editor-a@example.invalid', 'editor'),
  ('${UB}', '${TB}', 'editor-b@example.invalid', 'editor');
insert into public.albums (id, tenant_id, title, slug) values
  ('${AA}', '${TA}', 'GEL A', 'gel-a'), ('${AB}', '${TB}', 'GEL B', 'gel-b');
insert into public.clients (id, tenant_id, name, email)
  select ('e3a00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${TA}', 'A' || n, 'recipient' || n || '@example.invalid'
    from generate_series(1, 60) n;
insert into public.clients (id, tenant_id, name, email)
  select ('e3b00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${TB}', 'B' || n, 'recipient' || n || '@example.invalid'
    from generate_series(1, 60) n;
insert into public.album_clients (album_id, client_id)
  select '${AA}', ('e3a00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 60) n;
insert into public.album_clients (album_id, client_id)
  select '${AB}', ('e3b00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 60) n;
`

const clear = (cfg: Cfg) => owner(cfg, (c) => c.query('delete from public.gallery_email_send_attempts'))
const rowsOf = (cfg: Cfg, tenant: string) =>
  owner(cfg, async (c) => Number((await c.query('select count(*) from public.gallery_email_send_attempts where tenant_id = $1', [tenant])).rows[0].count))

async function begin(c: pg.Client, sub: string, iso?: string) {
  await c.query(iso ? `begin isolation level ${iso}` : 'begin')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })])
  await c.query('set local role authenticated')
}

const reserve = (c: pg.Client, tenant: string, album: string, client: string) =>
  c.query('select public.reserve_gallery_email_send($1, $2, $3) as v', [tenant, album, client]).then((r) => r.rows[0].v as string)

/** One committed call on its own connection, as the photographer. */
async function call(cfg: Cfg, sub: string, tenant: string, album: string, client: string, iso?: string): Promise<Answer> {
  const c = await connect(cfg)
  try {
    await begin(c, sub, iso)
    const v = await reserve(c, tenant, album, client)
    await c.query('commit')
    return { ok: true, v }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    return { ok: false, code: (e as { code?: string }).code, message: (e as Error).message }
  } finally {
    await c.end()
  }
}

/** A reservation made and HELD: the transaction stays open, holding the site's lock. */
async function hold(cfg: Cfg, sub: string, tenant: string, album: string, client: string) {
  const c = await connect(cfg)
  await begin(c, sub)
  const v = await reserve(c, tenant, album, client)
  return { c, v }
}

async function waiters(cfg: Cfg, want: number, ms = 4000): Promise<number> {
  const until = Date.now() + ms
  let n = -1
  while (Date.now() < until) {
    n = await owner(cfg, async (c) =>
      Number((await c.query(`select count(*) from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())`)).rows[0].count))
    if (n >= want) return n
    await new Promise((r) => setTimeout(r, 50))
  }
  return n
}

const v = (a: Answer) => (a.ok ? a.v : `ERR:${a.code}`)

/** The deterministic serialisation scenario. Returns the three waiters' answers and the recipient's final row count. */
async function serialisation(cfg: Cfg) {
  await clear(cfg)
  const R = ca(1)
  const pre = [await call(cfg, UA, TA, AA, R), await call(cfg, UA, TA, AA, R)].map(v)
  const x = await hold(cfg, UA, TA, AA, R)
  const pending = [1, 2, 3].map(() => call(cfg, UA, TA, AA, R))
  const seen = await waiters(cfg, 3)
  await x.c.query('commit')
  await x.c.end()
  const answers = (await Promise.all(pending)).map(v)
  return { pre, held: x.v, seen, answers, rows: await rowsOf(cfg, TA) }
}

async function main() {
  // ── The migration twice, the SQL suite, and the concurrent behaviour ──────
  await withScratch(async (cfg: Cfg) => {
    await loadFixture(cfg, [MIG_FILE, MIG_FILE])
    ok('migration applied twice onto the fixture', true)

    const suite = await owner(cfg, (c) => runSqlFile(c, SUITE))
    ok(`SQL suite on the twice-migrated database (${suite.summary.split('\n')[0]})`, suite.ok, suite.ok ? '' : suite.summary)

    // Control for the any-site-editor mutant: the authorisation slice passes
    // whole on the real migration, so a FAIL under the mutant is the mutant's.
    const auth = await owner(cfg, (c) => runSqlText(c, AUTH_SUITE))
    ok(`SQL suite, authorisation slice, on the real migration (${auth.summary.split('\n')[0]})`, auth.ok, auth.ok ? '' : auth.summary)

    await owner(cfg, (c) => c.query(SEED))

    // Serialisation.
    const s = await serialisation(cfg)
    is('serialisation: two committed first', s.pre, ['reserved', 'reserved'])
    is('serialisation: the held third reserved', s.held, 'reserved')
    ok('serialisation: three callers seen WAITING on the advisory lock', s.seen >= 3, `saw ${s.seen}`)
    is('serialisation: every waiter, after the commit, is refused', s.answers, ['recipient_limited', 'recipient_limited', 'recipient_limited'])
    is('serialisation: the recipient holds exactly 3', s.rows, 3)

    // A burst on one site: 15 connections × 3 calls, 45 distinct recipients.
    await clear(cfg)
    const burst = (
      await Promise.all(
        Array.from({ length: 15 }, async (_, k) => {
          const out: string[] = []
          for (let j = 0; j < 3; j++) out.push(v(await call(cfg, UA, TA, AA, ca(1 + k * 3 + j))))
          return out
        })
      )
    ).flat()
    is('burst of 45 on one site: reserved', burst.filter((x) => x === 'reserved').length, 30)
    is('burst of 45 on one site: site_limited', burst.filter((x) => x === 'site_limited').length, 15)
    is('burst: site A holds exactly 30', await rowsOf(cfg, TA), 30)

    // Ten at once to one recipient, on the other site.
    const ten = (await Promise.all(Array.from({ length: 10 }, () => call(cfg, UB, TB, AB, cb(1))))).map(v)
    is('10 concurrent to one recipient: reserved', ten.filter((x) => x === 'reserved').length, 3)
    is('10 concurrent to one recipient: recipient_limited', ten.filter((x) => x === 'recipient_limited').length, 7)

    // Isolation guard.
    await clear(cfg)
    for (const iso of ['repeatable read', 'serializable']) {
      const a = await call(cfg, UA, TA, AA, ca(1), iso)
      ok(`${iso}: refused 55000 by the guard`, !a.ok && a.code === '55000' && /READ COMMITTED/.test(a.message), JSON.stringify(a))
    }
    is('isolation refusals wrote nothing', await rowsOf(cfg, TA), 0)

    // Another site never waits; a waiter on this site gives up at lock_timeout.
    const x = await hold(cfg, UA, TA, AA, ca(2))
    let t = Date.now()
    const other = await call(cfg, UB, TB, AB, cb(2))
    const otherMs = Date.now() - t
    ok('another site does not wait on this site\'s lock', other.ok && other.v === 'reserved' && otherMs < 2000, `${JSON.stringify(other)} in ${otherMs} ms`)
    t = Date.now()
    const timed = await call(cfg, UA, TA, AA, ca(3))
    const timedMs = Date.now() - t
    await x.c.query('rollback')
    await x.c.end()
    ok('a waiter gives up at lock_timeout (55P03)', !timed.ok && timed.code === '55P03' && timedMs >= 4500 && timedMs < 15000, `${JSON.stringify(timed)} after ${timedMs} ms`)
  })

  // ── Re-runs: refuse a wrong shape, re-narrow a widened grant ──────────────
  for (const [label, tamper, want] of [
    ['an extra column', 'alter table public.gallery_email_send_attempts add column note text', '42710'],
    ['a policy', 'create policy gel_open on public.gallery_email_send_attempts for select using (true)', '42710'],
    ['a second overload', 'create function public.reserve_gallery_email_send(p uuid) returns text language sql as $$ select null::text $$', '42710'],
  ] as const) {
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [MIG_FILE])
      await owner(cfg, (c) => c.query(tamper))
      const r = await owner(cfg, async (c) => {
        try {
          await c.query(MIG)
          return 'applied'
        } catch (e) {
          await c.query('rollback').catch(() => {})
          return (e as { code?: string }).code
        }
      })
      is(`re-run over ${label}: refused`, r, want)
    })
  }
  await withScratch(async (cfg: Cfg) => {
    await loadFixture(cfg, [MIG_FILE])
    await owner(cfg, (c) => c.query('grant select, insert on public.gallery_email_send_attempts to authenticated; grant execute on function public.reserve_gallery_email_send(uuid, uuid, uuid) to anon'))
    await owner(cfg, (c) => c.query(MIG))
    const after = await owner(cfg, async (c) =>
      (await c.query(`select has_table_privilege('authenticated', 'public.gallery_email_send_attempts', 'SELECT, INSERT') as t,
                             has_function_privilege('anon', 'public.reserve_gallery_email_send(uuid, uuid, uuid)', 'EXECUTE') as f`)).rows[0])
    is('re-run over a widened grant: re-narrowed', after, { t: false, f: false })
  })

  // ── Mutants: each check above must be capable of failing ──────────────────
  if (MUTATIONS) {
    const mutate = (name: string, from: string | RegExp, to: string) => {
      const out = MIG.replace(from, to)
      if (out === MIG) throw new Error(`mutant "${name}": its target was not found in the migration`)
      return out
    }
    const viaFile = async (cfg: Cfg, sql: string) =>
      owner(cfg, async (c) => {
        try {
          await c.query(sql)
          return 'applied'
        } catch (e) {
          await c.query('rollback').catch(() => {})
          return (e as { code?: string }).code ?? 'error'
        }
      })

    // 1. No advisory lock → the waiters over-reserve.
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [])
      is('mutant no-lock: applies', await viaFile(cfg, mutate('no-lock', /\s*perform pg_catalog\.pg_advisory_xact_lock\([\s\S]*?\);/, '')), 'applied')
      await owner(cfg, (c) => c.query(SEED))
      const s = await serialisation(cfg)
      ok('mutant no-lock: CAUGHT (a waiter reserved past 3)', s.answers.includes('reserved') && s.rows > 3, JSON.stringify(s))
    })

    // 2. No isolation guard → REPEATABLE READ reserves.
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [])
      is('mutant no-isolation-guard: applies',
        await viaFile(cfg, mutate('no-iso', /\s*if pg_catalog\.current_setting\('transaction_isolation'\)[\s\S]*?end if;/, '')), 'applied')
      await owner(cfg, (c) => c.query(SEED))
      const a = await call(cfg, UA, TA, AA, ca(1), 'repeatable read')
      ok('mutant no-isolation-guard: CAUGHT (repeatable read was not refused)', a.ok, JSON.stringify(a))
    })

    // 3. The editor rule without its site match → the SQL suite's own
    //    cross-site refusals fail, by name, in its report (the authorisation
    //    slice; see AUTH_SUITE for why the full file cannot report here).
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [])
      is('mutant any-site-editor: applies',
        await viaFile(cfg, mutate('any-site', 'and p.tenant_id = p_tenant\n', '\n')), 'applied')
      const r = await owner(cfg, (c) => runSqlText(c, AUTH_SUITE))
      ok('mutant any-site-editor: CAUGHT by the SQL suite (report reached; both cross-site refusals FAIL)',
        !r.ok && /CHECK\(S\) FAILED\./.test(r.summary)
          && failed(r.summary, 'editor of B on A: refused') && failed(r.summary, 'editor of A on B: refused'),
        r.summary.slice(0, 1600))
      const full = await owner(cfg, (c) => runSqlFile(c, SUITE))
      ok('mutant any-site-editor: the full SQL suite does not pass either', !full.ok, full.summary.slice(0, 400))
    })

    // 4. An anon grant → the migration's own read-back refuses (nothing kept).
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [])
      const r = await viaFile(cfg, mutate('anon-grant', /\n  to authenticated;\n/, '\n  to authenticated, anon;\n'))
      is('mutant anon-grant: CAUGHT by the read-back (42P17)', r, '42P17')
      const left = await owner(cfg, async (c) => (await c.query(`select to_regclass('public.gallery_email_send_attempts') is null as gone`)).rows[0].gone)
      is('mutant anon-grant: rolled back whole', left, true)
    })
  }

  console.log(`gallery-email-limits-db: ${pass} passed, ${fail.length} failed${MUTATIONS ? '' : ' (mutations skipped)'}`)
  for (const f of fail) console.log(`  FAIL ${f}`)
  process.exit(fail.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
