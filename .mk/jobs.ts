import { Client } from 'pg'
import { drain } from '@/lib/jobs/run'
import { HANDLERS } from '@/lib/jobs/handlers'
import { JOB_KINDS, PermanentJobError, type JobHandler } from '@/lib/jobs/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE WORKER, AGAINST A REAL DATABASE
 * ═══════════════════════════════════
 *
 * `db/verify-jobs.sql` proves the SQL: claims, leases, backoff, bounded
 * attempts. `scripts/jobs-concurrency.sh` proves two connections cannot take
 * the same job. This proves the part in between — that `lib/jobs/run.ts`
 * actually uses them the way they are meant to be used.
 *
 * It needs a Postgres carrying `db/test-fixture.sql` plus
 * `db/migrations/2026-09-29_jobs.sql`:
 *
 *   PGHOST=/tmp PGPORT=5433 PGDATABASE=wtp PGUSER=postgres npx tsx .mk/jobs.ts
 *
 * With no database reachable it SKIPS rather than passes. A suite that goes
 * green by not running is worse than no suite, so it says so loudly and exits
 * non-zero on anything other than a connection failure.
 *
 * ── What the adapter is, and what it is not ─────────────────────────────────
 *
 * `drain` takes a Supabase client and uses exactly one thing on it: `.rpc()`.
 * The adapter below is that one method, over a real connection — it exists to
 * reproduce PostgREST's ENVELOPE (`{ data, error }`, an array for a `setof`
 * function, a JSON object or null for one returning a composite), not the
 * behaviour being tested. Everything the assertions are actually about
 * happens in the real `claim_jobs` and `finish_job`.
 *
 * It is NOT a stand-in for the database: a fake that supplies what the real
 * one does is how a green suite comes to mean nothing, which is the lesson
 * S1 cost three incidents to learn.
 */

const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const TENANT_B = 'aaaaaaaa-0000-0000-0000-000000000002'

let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') =>
  good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`)

function adapter(client: Client): SupabaseClient {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      const keys = Object.keys(args)
      const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
      const values = keys.map((k) => args[k])

      try {
        if (name === 'claim_jobs') {
          const r = await client.query(
            `select to_jsonb(t) as row from public.claim_jobs(${params}) t`,
            values
          )
          return { data: r.rows.map((x) => x.row), error: null }
        }
        // A composite-returning function: one row, or SQL NULL when it
        // returned null — which is how "you no longer hold the lease" arrives.
        const r = await client.query(
          `select to_jsonb(public.${name}(${params})) as row`,
          values
        )
        return { data: r.rows[0]?.row ?? null, error: null }
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
      }
    },
  } as unknown as SupabaseClient
}

/** Handlers that do exactly what a test needs, and count how often. */
function testHandlers() {
  const ran: Record<string, number> = {}
  const count = (k: string) => (ran[k] = (ran[k] ?? 0) + 1)

  const map: Record<string, JobHandler> = {
    'test.ok': async ({ payload }) => {
      count('test.ok:' + String(payload.n ?? ''))
      count('test.ok')
    },
    'test.throws': async () => {
      count('test.throws')
      throw new Error('the service said no')
    },
    'test.permanent': async () => {
      count('test.permanent')
      throw new PermanentJobError('that photograph is gone')
    },
    'test.slow': async () => {
      count('test.slow')
      await new Promise((r) => setTimeout(r, 400))
    },
  }

  return { ran, resolve: (kind: string) => map[kind] ?? null }
}

async function main() {
  const client = new Client({
    host: process.env.PGHOST ?? '/tmp',
    port: Number(process.env.PGPORT ?? 5433),
    database: process.env.PGDATABASE ?? 'wtp',
    user: process.env.PGUSER ?? 'postgres',
  })

  try {
    await client.connect()
  } catch (e) {
    console.log('SKIPPED — no local Postgres to test against.')
    console.log(String(e instanceof Error ? e.message : e))
    console.log('\nBuild one: db/test-fixture.sql then db/migrations/2026-09-29_jobs.sql,')
    console.log('then PGHOST=/tmp PGPORT=5433 PGDATABASE=wtp PGUSER=postgres npx tsx .mk/jobs.ts')
    process.exit(0)
  }

  const db = adapter(client)
  const wipe = () => client.query("delete from jobs where kind like 'test.%'")
  const one = async (sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows[0]

  const add = (kind: string, tenant = TENANT_A, extra = '') =>
    client
      .query(
        `insert into jobs (tenant_id, kind, payload ${extra ? ', ' + extra.split('=')[0] : ''})
         values ($1, $2, '{}'::jsonb ${extra ? ', ' + extra.split('=')[1] : ''}) returning id`,
        [tenant, kind]
      )
      .then((r) => r.rows[0].id as string)

  // ── 1. A job that works ───────────────────────────────────────────────────
  {
    await wipe()
    const id = await add('test.ok')
    const h = testHandlers()
    const report = await drain(db, { tenantId: TENANT_A, resolve: h.resolve })
    const row = await one('select * from jobs where id = $1', [id])

    ok('a job that works is claimed once', h.ran['test.ok'] === 1, `ran ${h.ran['test.ok']} times`)
    ok('and marked done', row.status === 'done', `status is ${row.status}`)
    ok('with one attempt', row.attempts === 1, `attempts ${row.attempts}`)
    ok('its lease is released', row.locked_by === null)
    ok('the report counts it', report.done === 1 && report.claimed === 1,
       `claimed ${report.claimed}, done ${report.done}`)
    ok('and reports no errors', report.errors.length === 0, JSON.stringify(report.errors))
  }

  // ── 2. A job that fails comes back later, not now ─────────────────────────
  {
    await wipe()
    const id = await add('test.throws')
    const h = testHandlers()
    const report = await drain(db, { tenantId: TENANT_A, resolve: h.resolve })
    const row = await one('select *, run_after > now() as later from jobs where id = $1', [id])

    ok('a failing job is re-queued', row.status === 'queued', `status is ${row.status}`)
    ok('with its error kept', row.last_error === 'the service said no', String(row.last_error))
    ok('and a wait before the next try', row.later === true)
    ok('the drain stops rather than spinning on it', h.ran['test.throws'] === 1,
       `ran ${h.ran['test.throws']} times in one drain`)
    ok('it is not counted as finished', report.done === 0 && report.failed === 0,
       `done ${report.done}, failed ${report.failed}`)
    ok('but the error is in the report', report.errors.length === 1,
       JSON.stringify(report.errors))
  }

  // ── 3. Five tries and no more ─────────────────────────────────────────────
  {
    await wipe()
    const id = await add('test.throws')
    const h = testHandlers()

    // Each drain is a separate invocation; the wait between them is skipped
    // rather than slept through, which is the only thing being faked here.
    for (let i = 0; i < 8; i++) {
      await client.query("update jobs set run_after = now() where id = $1 and status = 'queued'", [id])
      await drain(db, { tenantId: TENANT_A, resolve: h.resolve })
    }

    const row = await one('select * from jobs where id = $1', [id])
    ok('a job that always fails ends up failed', row.status === 'failed', `status is ${row.status}`)
    ok('after exactly max_attempts tries', row.attempts === 5, `attempts ${row.attempts}`)
    ok('and the handler ran that many times', h.ran['test.throws'] === 5,
       `ran ${h.ran['test.throws']}`)
    ok('a terminal failure is findable by query',
       Number((await one("select count(*)::int as n from jobs where status = 'failed' and kind = 'test.throws'")).n) === 1)
  }

  // ── 4. A failure nothing can fix does not get five goes ───────────────────
  {
    await wipe()
    const id = await add('test.permanent')
    const h = testHandlers()
    const report = await drain(db, { tenantId: TENANT_A, resolve: h.resolve })
    const row = await one('select * from jobs where id = $1', [id])

    ok('a permanent failure fails at once', row.status === 'failed', `status is ${row.status}`)
    ok('on the first attempt', row.attempts === 1, `attempts ${row.attempts}`)
    ok('the handler ran once', h.ran['test.permanent'] === 1)
    ok('and it is counted as failed', report.failed === 1, `failed ${report.failed}`)
  }

  // ── 5. A kind nothing handles ─────────────────────────────────────────────
  {
    await wipe()
    const id = await add('test.nosuchthing')
    const h = testHandlers()
    const report = await drain(db, { tenantId: TENANT_A, resolve: h.resolve })
    const row = await one('select * from jobs where id = $1', [id])

    ok('an unknown kind fails permanently', row.status === 'failed', `status is ${row.status}`)
    ok('rather than being retried five times', row.attempts === 1, `attempts ${row.attempts}`)
    ok('and says so', String(row.last_error).includes('No handler'), String(row.last_error))
    ok('counted as failed', report.failed === 1)
  }

  // ── 6. TWO WORKERS OVER THE SAME QUEUE ────────────────────────────────────
  //
  // The one that matters on Vercel, and the only place the real worker code,
  // the real SQL and real concurrency meet. Two drains started at the same
  // instant over six jobs: every job done, none done twice.
  {
    await wipe()
    for (let i = 0; i < 6; i++) {
      await client.query(
        "insert into jobs (tenant_id, kind, payload) values ($1, 'test.ok', jsonb_build_object('n', $2::int))",
        [TENANT_A, i]
      )
    }

    const second = new Client({
      host: process.env.PGHOST ?? '/tmp',
      port: Number(process.env.PGPORT ?? 5433),
      database: process.env.PGDATABASE ?? 'wtp',
      user: process.env.PGUSER ?? 'postgres',
    })
    await second.connect()

    const h1 = testHandlers()
    const h2 = testHandlers()

    const [r1, r2] = await Promise.all([
      drain(db, { tenantId: TENANT_A, resolve: h1.resolve }),
      drain(adapter(second), { tenantId: TENANT_A, resolve: h2.resolve }),
    ])
    await second.end()

    const done = Number((await one("select count(*)::int as n from jobs where kind='test.ok' and status='done'")).n)
    const most = Number((await one("select coalesce(max(attempts),0)::int as n from jobs where kind='test.ok'")).n)
    const eachRanOnce = [0, 1, 2, 3, 4, 5].every(
      (n) => (h1.ran['test.ok:' + n] ?? 0) + (h2.ran['test.ok:' + n] ?? 0) === 1
    )

    ok('two workers finish all six jobs', done === 6, `${done} done`)
    ok('and no job was run twice', most === 1, `one job reached attempt ${most}`)
    ok('every job ran exactly once, across both workers', eachRanOnce,
       JSON.stringify({ one: h1.ran, two: h2.ran }))
    ok('the two workers are different', r1.worker !== r2.worker)
    ok('and between them they claimed six', r1.claimed + r2.claimed === 6,
       `${r1.claimed} + ${r2.claimed}`)
    ok('with both doing some of it', r1.claimed > 0 && r2.claimed > 0,
       `${r1.claimed} + ${r2.claimed} — one worker did all of it, so this proved nothing`)
  }

  // ── 7. One site's drain never spends its time on another's work ───────────
  {
    await wipe()
    await add('test.ok', TENANT_A)
    await add('test.ok', TENANT_B)
    const h = testHandlers()

    await drain(db, { tenantId: TENANT_A, resolve: h.resolve })

    const a = await one("select status from jobs where tenant_id = $1 and kind = 'test.ok'", [TENANT_A])
    const b = await one("select status from jobs where tenant_id = $1 and kind = 'test.ok'", [TENANT_B])

    ok('a drain for one site does its own work', a.status === 'done', `status is ${a.status}`)
    ok('and leaves the other site alone', b.status === 'queued', `status is ${b.status}`)

    const h2 = testHandlers()
    await drain(db, { resolve: h2.resolve })
    const b2 = await one("select status from jobs where tenant_id = $1 and kind = 'test.ok'", [TENANT_B])
    ok('a drain with no site does everybody', b2.status === 'done', `status is ${b2.status}`)
  }

  // ── 8. It stops when it runs out of time, mid-queue ───────────────────────
  {
    await wipe()
    for (let i = 0; i < 5; i++) await add('test.slow')
    const h = testHandlers()

    const started = Date.now()
    const report = await drain(db, { tenantId: TENANT_A, resolve: h.resolve, budgetMs: 700 })
    const elapsed = Date.now() - started

    const left = Number((await one("select count(*)::int as n from jobs where kind='test.slow' and status='queued'")).n)
    const stuck = Number((await one("select count(*)::int as n from jobs where kind='test.slow' and status='running'")).n)

    ok('it stops when the budget is spent', report.outOfTime === true)
    ok('without overrunning it badly', elapsed < 2000, `${elapsed}ms against a 700ms budget`)
    ok('the rest are still queued for the next run', left > 0, `${left} left`)
    ok('AND NONE IS LEFT SITTING IN running', stuck === 0,
       `${stuck} claimed but never run — they would wait out a ten-minute lease for nothing`)
    ok('it did some of the work', report.done > 0, `done ${report.done}`)
  }

  // ── 9. The ceiling holds whatever the clock says ──────────────────────────
  {
    await wipe()
    for (let i = 0; i < 6; i++) await add('test.ok')
    const h = testHandlers()
    const report = await drain(db, { tenantId: TENANT_A, resolve: h.resolve, maxJobs: 2 })

    ok('maxJobs is a hard ceiling', report.claimed === 2, `claimed ${report.claimed}`)
    ok('and the rest wait', h.ran['test.ok'] === 2, `ran ${h.ran['test.ok']}`)
  }

  // ── 10. Every declared kind has a handler ─────────────────────────────────
  //
  // Typescript already requires this (HANDLERS is Record<JobKind, …>), so this
  // is here for the case it cannot see: a kind added to the list and given an
  // entry that is undefined at runtime.
  {
    for (const kind of JOB_KINDS) {
      ok(`every kind has a handler: ${kind}`, typeof HANDLERS[kind] === 'function')
    }
  }

  await wipe()
  await client.end()
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
