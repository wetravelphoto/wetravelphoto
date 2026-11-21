import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/*
 * The REAL `GET` of app/api/jobs/drain/route.ts, bundled with its four
 * boundaries replaced by fakes: the admin client, the queue drain, R2 and the
 * sweeper. Synthetic only — no database, no storage, no network, no secret.
 *
 *   node node_modules/.p4-runtime/node_modules/tsx/dist/cli.mjs .mk/drain-route.ts
 *
 * What it holds the route to:
 *   - a missing or wrong bearer, and an unset CRON_SECRET, are 401 with NOTHING
 *     called (not even the admin client);
 *   - no service key is a 500, before the queue;
 *   - a sweep's runErrors (candidate read, bookkeeping write) reach BOTH the
 *     error log and the response, total always, detail bounded in count and
 *     length — never a quiet "examined 0";
 *   - a normal run reports the queue and the sweep, with no error log;
 *   - a queue that used the window skips the sweep (never called) and says so.
 */

const ROOT = resolve(__dirname, '..')
const CACHE = join(ROOT, 'node_modules/.cache/drain-route')
const req = createRequire(join(ROOT, 'package.json'))

let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') => (good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`))
const is = (n: string, got: unknown, want: unknown) =>
  ok(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`)

type Sweep = {
  examined: number; purged: number; filesDeleted: number; clocksStarted: number; clocksCleared: number
  outOfTime: boolean; outcomes: Record<string, number>; runErrors: string[]; notes: { assetId: string; outcome: string }[]
}
type State = {
  adminThrows: boolean
  drainSkewMs: number
  drainErrors: string[]
  sweepResult: Sweep
  calls: string[]
  sweepBudget: number | null
}
const st: State = (globalThis as unknown as { __dr: State }).__dr = {
  adminThrows: false, drainSkewMs: 0, drainErrors: [], sweepResult: sweepOf(), calls: [], sweepBudget: null,
}

function sweepOf(over: Partial<Sweep> = {}): Sweep {
  return {
    examined: 3, purged: 1, filesDeleted: 4, clocksStarted: 1, clocksCleared: 0, outOfTime: false,
    outcomes: { purged: 1, referenced: 2 }, runErrors: [], notes: [], ...over,
  }
}

// The clock the route reads; the fake drain moves it to spend the window.
const realNow = Date.now
let skew = 0
Date.now = () => realNow() + skew

const FAKES: Record<string, string> = {
  '@/lib/supabase/admin': `exports.createAdminClient = () => { const s = globalThis.__dr; s.calls.push('admin');
    if (s.adminThrows) throw new Error('no key'); return { fake: 'db' } };`,
  '@/lib/jobs/run': `exports.drain = async (db, opts) => { const s = globalThis.__dr; s.calls.push('drain:' + opts.budgetMs);
    globalThis.__drSkew(s.drainSkewMs);
    return { claimed: 2, done: 2 - s.drainErrors.length, failed: s.drainErrors.length, outOfTime: false, errors: s.drainErrors } };`,
  '@/lib/photos/storage': `exports.r2Storage = { fake: 'r2' };`,
  '@/lib/photos/sweep': `exports.SWEEP_BUDGET_MS = 30000;
    exports.sweep = async (db, storage, opts) => { const s = globalThis.__dr; s.calls.push('sweep');
      if (db.fake !== 'db' || storage.fake !== 'r2') throw new Error('wrong boundary handed to sweep');
      s.sweepBudget = opts.budgetMs; return s.sweepResult };`,
}
;(globalThis as unknown as { __drSkew: (ms: number) => void }).__drSkew = (ms) => { skew += ms }

async function build(): Promise<{ GET: (r: unknown) => Promise<Response> }> {
  const esbuild = req(join(ROOT, 'node_modules/.p4-runtime/node_modules/esbuild')) as typeof import('esbuild')
  const outfile = join(CACHE, 'route.cjs')
  mkdirSync(CACHE, { recursive: true })
  await esbuild.build({
    stdin: { contents: "export { GET } from './app/api/jobs/drain/route'", resolveDir: ROOT, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile,
    tsconfig: join(ROOT, 'tsconfig.json'), packages: 'external', logLevel: 'silent',
    plugins: [{
      name: 'boundaries',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (a.path in FAKES ? { path: a.path, namespace: 'fake' } : undefined))
        b.onLoad({ filter: /.*/, namespace: 'fake' }, (a) => ({ contents: FAKES[a.path], loader: 'js' }))
      },
    }],
  })
  delete req.cache[req.resolve(outfile)]
  return req(outfile)
}

const SECRET = 'synthetic-cron-secret'
const request = (auth: string | null) => ({ headers: new Headers(auth === null ? {} : { authorization: auth }) })

type Run = { status: number; body: Record<string, unknown>; errors: unknown[][]; logs: unknown[][]; calls: string[] }
async function run(GET: (r: unknown) => Promise<Response>, auth: string | null, setup: Partial<State> = {}): Promise<Run> {
  Object.assign(st, { adminThrows: false, drainSkewMs: 0, drainErrors: [], sweepResult: sweepOf(), sweepBudget: null }, setup)
  st.calls = []
  skew = 0
  const errors: unknown[][] = []
  const logs: unknown[][] = []
  const [e0, l0] = [console.error, console.log]
  console.error = (...a: unknown[]) => { errors.push(a) }
  console.log = (...a: unknown[]) => { logs.push(a) }
  try {
    const res = await GET(request(auth))
    return { status: res.status, body: await res.json(), errors, logs, calls: st.calls }
  } finally {
    console.error = e0
    console.log = l0
  }
}

async function main() {
  const { GET } = await build()
  const bearer = `Bearer ${SECRET}`

  // ── Unauthorized: nothing is touched ─────────────────────────────────────
  delete process.env.CRON_SECRET
  let r = await run(GET, bearer)
  is('unset CRON_SECRET: 401, nothing called', [r.status, r.body.error, r.calls], [401, 'Unauthorized', []])
  process.env.CRON_SECRET = SECRET
  r = await run(GET, null)
  is('no authorization header: 401, nothing called', [r.status, r.calls], [401, []])
  r = await run(GET, `Bearer ${SECRET}x`)
  is('wrong bearer: 401, nothing called', [r.status, r.calls], [401, []])
  r = await run(GET, SECRET)
  is('secret without "Bearer ": 401, nothing called', [r.status, r.calls], [401, []])
  process.env.CRON_SECRET = ''
  r = await run(GET, 'Bearer ')
  is('empty CRON_SECRET with an empty bearer: 401', [r.status, r.calls], [401, []])
  process.env.CRON_SECRET = SECRET

  // ── No service key: 500 before the queue ─────────────────────────────────
  r = await run(GET, bearer, { adminThrows: true })
  is('no service key: 500, queue and sweep never called', [r.status, r.calls], [500, ['admin']])

  // ── Normal: queue, then sweep, no error log ──────────────────────────────
  r = await run(GET, bearer)
  is('normal: 200, admin → drain(200000) → sweep', [r.status, r.calls], [200, ['admin', 'drain:200000', 'sweep']])
  is('normal: sweep budget is SWEEP_BUDGET_MS', st.sweepBudget, 30000)
  is('normal: queue report', [r.body.claimed, r.body.done, r.body.failed, r.body.outOfTime], [2, 2, 0, false])
  is('normal: sweep report, runErrors total 0', r.body.sweep, {
    examined: 3, purged: 1, filesDeleted: 4, clocksStarted: 1, clocksCleared: 0, outOfTime: false,
    outcomes: { purged: 1, referenced: 2 }, runErrors: { total: 0, detail: [] },
  })
  is('normal: no error logged', r.errors.length, 0)
  const sweepLog = r.logs.find((l) => l[0] === '[p6] sweep')?.[1] as Record<string, unknown> | undefined
  is('normal: the sweep log line carries examined and runErrors', [sweepLog?.examined, sweepLog?.runErrors], [3, 0])

  // ── Sweep run failures: visible in the log AND the response ──────────────
  const candidate = 'the candidate read failed: connection reset'
  const bookkeeping = 'the bookkeeping write failed for 7 assets: permission denied'
  r = await run(GET, bearer, { sweepResult: sweepOf({ examined: 0, purged: 0, filesDeleted: 0, clocksStarted: 0, outcomes: {}, runErrors: [candidate, bookkeeping] }) })
  is('runErrors: still 200 with the sweep run', [r.status, r.calls.includes('sweep')], [200, true])
  is('runErrors: response carries total and detail', (r.body.sweep as Record<string, unknown>).runErrors, { total: 2, detail: [candidate, bookkeeping] })
  const runLog = r.errors.find((e) => e[0] === '[p6] sweep run failed')
  is('runErrors: error log carries total and detail', runLog?.[1], { total: 2, detail: [candidate, bookkeeping] })
  is('runErrors: the info log line counts them too', (r.logs.find((l) => l[0] === '[p6] sweep')?.[1] as Record<string, unknown>)?.runErrors, 2)

  // Bounded: ten shown, each cut at 300 characters, the total never cut.
  const many = Array.from({ length: 13 }, (_, i) => `e${i}:` + 'x'.repeat(400))
  r = await run(GET, bearer, { sweepResult: sweepOf({ runErrors: many }) })
  const bounded = (r.body.sweep as { runErrors: { total: number; detail: string[] } }).runErrors
  is('bounded: total is every error', bounded.total, 13)
  is('bounded: ten shown, first ten in order', bounded.detail.map((d) => d.split(':')[0]), many.slice(0, 10).map((d) => d.split(':')[0]))
  ok('bounded: each cut to 300 chars plus an ellipsis', bounded.detail.every((d) => d.length === 301 && d.endsWith('…')))
  is('bounded: the log gets the same bounded summary', r.errors.find((e) => e[0] === '[p6] sweep run failed')?.[1], bounded)

  // Notes and queue errors are logged, separately from runErrors.
  r = await run(GET, bearer, { drainErrors: ['job j1: boom'], sweepResult: sweepOf({ notes: [{ assetId: 'a1', outcome: 'storage_failed' }] }) })
  is('queue errors logged', r.errors.find((e) => e[0] === '[jobs] drain finished with errors')?.[1], ['job j1: boom'])
  is('sweep notes logged', r.errors.find((e) => e[0] === '[p6] sweep did not purge')?.[1], [{ assetId: 'a1', outcome: 'storage_failed' }])
  ok('notes alone are not reported as a run failure', !r.errors.some((e) => e[0] === '[p6] sweep run failed'))

  // ── Skip: the queue used the window ──────────────────────────────────────
  r = await run(GET, bearer, { drainSkewMs: 281_000 })
  is('skip (<5s left): 200, sweep never called', [r.status, r.calls], [200, ['admin', 'drain:200000']])
  is('skip: response says why', r.body.sweep, { skipped: 'no budget left after the queue' })
  ok('skip: no sweep log line', !r.logs.some((l) => l[0] === '[p6] sweep'))
  r = await run(GET, bearer, { drainSkewMs: 270_000 })
  ok('shortened window: sweep gets only what is left (≤15s, ≥5s)', r.calls.includes('sweep') && st.sweepBudget !== null && st.sweepBudget <= 15_000 && st.sweepBudget >= 5_000, `budget ${st.sweepBudget}`)

  Date.now = realNow
  console.log(`drain-route: ${pass} passed, ${fail.length} failed`)
  if (fail.length) {
    for (const f of fail) console.log('  FAIL ' + f)
    process.exit(1)
  }
}

main().catch((e) => {
  Date.now = realNow
  console.error(e)
  process.exit(1)
})
