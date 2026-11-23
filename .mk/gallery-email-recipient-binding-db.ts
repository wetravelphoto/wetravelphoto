import pg from 'pg'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { withScratch, loadFixture, runSqlFile } from '../scripts/p4-local-db.mjs'

/**
 * THE RESERVED RECIPIENT IS THE NAMED RECIPIENT, AGAINST REAL CONNECTIONS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * db/migrations/2026-11-22_gallery_email_recipient_binding.sql, a forward
 * correction of the deployed 2026-11-22_gallery_email_send_limits.sql, on
 * loopback scratch databases only (scripts/p4-local-db.mjs refuses any other
 * host). Every site, account and address is synthetic (`.invalid`).
 *
 *   node scripts/p4-local-db.mjs ts -- .mk/gallery-email-recipient-binding-db.ts [--no-mutations]
 *
 * (The harness makes its own scratch databases; the outer one is unused.)
 *
 *   · stage: fixture → deployed limiter → correction → correction (twice);
 *     db/verify-gallery-email-recipient-binding.sql passes on it;
 *   · the returned hash equals an INDEPENDENT implementation (Node's crypto)
 *     of sha256(utf8(tenant + ':' + lower(trim-spaces(address)))), case and
 *     surrounding spaces included;
 *   · A → B → A on real connections, each step committed: both application
 *     reads see A, the answer names B — caught;
 *   · the address changes WHILE the call waits on the site's lock: the answer
 *     names what was charged (the row), not what the address became;
 *   · concurrency is unchanged: 10 at once to one recipient reserve exactly 3,
 *     all naming the same hash; REPEATABLE READ is still refused (55000);
 *   · the correction REFUSES, changing nothing, over: no deployed function, a
 *     drifted body, a drifted owner, a drifted config, a widened ACL, a second
 *     overload, a drifted table, an extra index, a changed index;
 *   · the documented rollback (re-running the deployed file) restores a bare
 *     'reserved', and the correction then applies again;
 *   · mutants — each must be CAUGHT: four function mutants against the SQL
 *     suite (no tenant prefix, bare 'reserved', a hash on 'recipient_limited',
 *     returned ≠ charged), a re-read-after-lock mutant against the lock-wait
 *     scenario, and three migration mutants (no body drift check, a wrong
 *     derivation, no ACL precondition).
 */

const ROOT = resolve(__dirname, '..')
const BASE_FILE = 'db/migrations/2026-11-22_gallery_email_send_limits.sql'
const FIX_FILE = 'db/migrations/2026-11-22_gallery_email_recipient_binding.sql'
const SUITE = 'db/verify-gallery-email-recipient-binding.sql'
const BASE = readFileSync(resolve(ROOT, BASE_FILE), 'utf8')
const FIX = readFileSync(resolve(ROOT, FIX_FILE), 'utf8')
const MUTATIONS = !process.argv.includes('--no-mutations')

/** The correction's CREATE OR REPLACE alone — for function mutants applied over the corrected stage. */
const FIX_FN = (() => {
  const start = FIX.indexOf('create or replace function public.reserve_gallery_email_send(')
  const end = FIX.indexOf('end $$;', start)
  if (start < 0 || end < 0) throw new Error(`${FIX_FILE}: the function block was not found`)
  return FIX.slice(start, end + 'end $$;'.length)
})()

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

/**
 * What the application must compute: Node's own sha256, over the tenant's
 * canonical uuid text, ':', and the address with SPACES trimmed (PostgreSQL's
 * one-argument btrim) and lower-cased. ASCII addresses only here — see the
 * report on non-ASCII and non-space whitespace.
 */
const nodeHash = (tenant: string, address: string) =>
  createHash('sha256').update(`${tenant.toLowerCase()}:${address.replace(/^ +| +$/g, '').toLowerCase()}`, 'utf8').digest('hex')
const hexOf = (a: string) => (/^reserved:[0-9a-f]{64}$/.test(a) ? a.slice(9) : null)

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
const sql = (cfg: Cfg, q: string, p: unknown[] = []) => owner(cfg, (c) => c.query(q, p))

const SEED = `
insert into public.tenants (id, name, domain) values
  ('${TA}', 'GERB site A', 'gerb-a.invalid'), ('${TB}', 'GERB site B', 'gerb-b.invalid');
insert into auth.users (id) values ('${UA}'), ('${UB}');
insert into public.profiles (id, tenant_id, email, role) values
  ('${UA}', '${TA}', 'editor-a@example.invalid', 'editor'),
  ('${UB}', '${TB}', 'editor-b@example.invalid', 'editor');
insert into public.albums (id, tenant_id, title, slug) values
  ('${AA}', '${TA}', 'GERB A', 'gerb-a'), ('${AB}', '${TB}', 'GERB B', 'gerb-b');
insert into public.clients (id, tenant_id, name, email)
  select ('e3a00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${TA}', 'A' || n, 'recipient' || n || '@example.invalid'
    from generate_series(1, 20) n;
insert into public.clients (id, tenant_id, name, email)
  select ('e3b00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${TB}', 'B' || n, 'recipient' || n || '@example.invalid'
    from generate_series(1, 20) n;
update public.clients set email = '  RECIPIENT5@Example.INVALID ' where id = '${ca(5)}';
insert into public.album_clients (album_id, client_id)
  select '${AA}', ('e3a00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 20) n;
insert into public.album_clients (album_id, client_id)
  select '${AB}', ('e3b00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 20) n;
`

async function begin(c: pg.Client, sub: string, iso?: string) {
  await c.query(iso ? `begin isolation level ${iso}` : 'begin')
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })])
  await c.query('set local role authenticated')
}
const reserve = (c: pg.Client, tenant: string, album: string, client: string) =>
  c.query('select public.reserve_gallery_email_send($1, $2, $3) as v', [tenant, album, client]).then((r) => r.rows[0].v as string)

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
    n = Number((await sql(cfg, `select count(*) from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())`)).rows[0].count)
    if (n >= want) return n
    await new Promise((r) => setTimeout(r, 50))
  }
  return n
}
const v = (a: Answer) => (a.ok ? a.v : `ERR:${a.code}`)
const emailOf = async (cfg: Cfg, client: string) => (await sql(cfg, 'select email from public.clients where id = $1', [client])).rows[0].email as string
const setEmail = (cfg: Cfg, client: string, email: string) => sql(cfg, 'update public.clients set email = $2 where id = $1', [client, email])
const clear = (cfg: Cfg) => sql(cfg, 'delete from public.gallery_email_send_attempts')
const bodyMd5 = async (cfg: Cfg) =>
  (await sql(cfg, `select md5(prosrc) as m from pg_proc where oid = to_regprocedure('public.reserve_gallery_email_send(uuid, uuid, uuid)')`)).rows[0]?.m ?? null
const applyText = (cfg: Cfg, text: string) =>
  owner(cfg, async (c) => {
    try {
      await c.query(text)
      return 'applied'
    } catch (e) {
      await c.query('rollback').catch(() => {})
      return (e as { code?: string }).code ?? 'error'
    }
  })

/** A → B → A, every step committed on its own connection. */
async function aba(cfg: Cfg, client: string) {
  const A = await emailOf(cfg, client)
  const B = `swapped-${client.slice(-4)}@example.invalid`
  const read1 = await emailOf(cfg, client)
  await setEmail(cfg, client, B)
  const ans = v(await call(cfg, UA, TA, AA, client))
  await setEmail(cfg, client, A)
  const read2 = await emailOf(cfg, client)
  return { A, B, read1, read2, ans }
}

/** The address changes while the call WAITS on the site's lock (it read the address before waiting). */
async function lockWait(cfg: Cfg, client: string) {
  await clear(cfg)
  const A = await emailOf(cfg, client)
  const B = `moved-${client.slice(-4)}@example.invalid`
  const x = await hold(cfg, UA, TA, AA, ca(19))
  const pending = call(cfg, UA, TA, AA, client)
  const seen = await waiters(cfg, 1)
  await setEmail(cfg, client, B)
  await x.c.query('commit')
  await x.c.end()
  const ans = v(await pending)
  const charged = (await sql(cfg, `select encode(recipient_hash, 'hex') as h from public.gallery_email_send_attempts
                                    where tenant_id = $1 and recipient_hash <> decode($2, 'hex')`, [TA, nodeHash(TA, 'recipient19@example.invalid')])).rows.map((r) => r.h)
  await setEmail(cfg, client, A)
  return { A, B, seen, ans, charged }
}

async function main() {
  // ── The corrected stage ───────────────────────────────────────────────────
  await withScratch(async (cfg: Cfg) => {
    await loadFixture(cfg, [BASE_FILE])
    const deployedMd5 = await bodyMd5(cfg)
    is('first apply of the correction', await applyText(cfg, FIX), 'applied')
    const correctedMd5 = await bodyMd5(cfg)
    ok('the body changed', correctedMd5 !== deployedMd5, `${deployedMd5} -> ${correctedMd5}`)
    is('second apply of the correction (safe to run twice)', await applyText(cfg, FIX), 'applied')
    is('second apply: body unchanged', await bodyMd5(cfg), correctedMd5)

    const suite = await owner(cfg, (c) => runSqlFile(c, SUITE))
    ok(`SQL suite on the twice-corrected database (${suite.summary.split('\n')[0]})`, suite.ok, suite.ok ? '' : suite.summary)

    await sql(cfg, SEED)

    // Independent hash.
    const r1 = v(await call(cfg, UA, TA, AA, ca(1)))
    is('answer = reserved:<Node sha256(tenant:address)>', hexOf(r1), nodeHash(TA, 'recipient1@example.invalid'))
    const r5 = v(await call(cfg, UA, TA, AA, ca(5)))
    is('stored "  RECIPIENT5@Example.INVALID ": Node hash of the normalised address', hexOf(r5), nodeHash(TA, 'recipient5@example.invalid'))
    const rb = v(await call(cfg, UB, TB, AB, cb(1)))
    is('same address on site B: Node hash keyed by B', hexOf(rb), nodeHash(TB, 'recipient1@example.invalid'))
    ok('site B\'s hash is not site A\'s', hexOf(rb) !== hexOf(r1))

    // A → B → A.
    const s = await aba(cfg, ca(2))
    is('A→B→A: both application reads agree', s.read1 === s.read2 && s.read1 === s.A, true)
    is('A→B→A: the answer names B', hexOf(s.ans), nodeHash(TA, s.B))
    ok('A→B→A: comparison with the address about to be sent fails closed', hexOf(s.ans) !== nodeHash(TA, s.read2), s.ans)

    // The address moves while the call waits on the lock.
    const w = await lockWait(cfg, ca(3))
    ok('lock-wait: the call was seen waiting', w.seen >= 1, `saw ${w.seen}`)
    is('lock-wait: exactly one row charged besides the holder', w.charged.length, 1)
    is('lock-wait: the answer names the charged row', hexOf(w.ans), w.charged[0])
    is('lock-wait: which is the address read before waiting', hexOf(w.ans), nodeHash(TA, w.A))
    ok('lock-wait: and not the address it became — fails closed against it', hexOf(w.ans) !== nodeHash(TA, w.B))

    // Concurrency and isolation, unchanged.
    await clear(cfg)
    const ten = (await Promise.all(Array.from({ length: 10 }, () => call(cfg, UA, TA, AA, ca(4))))).map(v)
    const reserved = ten.filter((x) => hexOf(x) !== null)
    is('10 concurrent to one recipient: reserved', reserved.length, 3)
    is('… all naming that recipient', [...new Set(reserved.map(hexOf))], [nodeHash(TA, 'recipient4@example.invalid')])
    is('… recipient_limited, verbatim', ten.filter((x) => x === 'recipient_limited').length, 7)
    const iso = await call(cfg, UA, TA, AA, ca(6), 'repeatable read')
    ok('repeatable read: still refused 55000', !iso.ok && iso.code === '55000', JSON.stringify(iso))
  })

  // ── The documented rollback, then forward again ──────────────────────────
  await withScratch(async (cfg: Cfg) => {
    await loadFixture(cfg, [BASE_FILE])
    const deployedMd5 = await bodyMd5(cfg)
    await applyText(cfg, FIX)
    const correctedMd5 = await bodyMd5(cfg)
    is('rollback: re-running the deployed file applies', await applyText(cfg, BASE), 'applied')
    is('rollback: the deployed body is back', await bodyMd5(cfg), deployedMd5)
    await sql(cfg, SEED)
    is('rollback: a bare reserved again', v(await call(cfg, UA, TA, AA, ca(1))), 'reserved')
    is('forward again: the correction applies', await applyText(cfg, FIX), 'applied')
    is('forward again: the corrected body', await bodyMd5(cfg), correctedMd5)
  })

  // ── The correction refuses drift, and changes nothing ────────────────────
  const drift: [string, string, string][] = [
    ['a drifted body', BASE.slice(BASE.indexOf('create or replace function public.reserve_gallery_email_send('), BASE.indexOf('end $$;', BASE.indexOf('create or replace function')) + 7).replace('c_site_max      constant integer  := 30;', 'c_site_max      constant integer  := 300;'), '42P17'],
    ['a drifted owner', 'alter function public.reserve_gallery_email_send(uuid, uuid, uuid) owner to service_role', '42P17'],
    ['a drifted config', `alter function public.reserve_gallery_email_send(uuid, uuid, uuid) set lock_timeout = '10s'`, '42P17'],
    ['a widened ACL', 'grant execute on function public.reserve_gallery_email_send(uuid, uuid, uuid) to anon', '42P17'],
    ['a second overload', 'create function public.reserve_gallery_email_send(p uuid) returns text language sql as $$ select null::text $$', '42710'],
    ['a drifted table', 'alter table public.gallery_email_send_attempts add column note text', '42710'],
    // The index comparison expects public.-qualified definitions; an extra index must still refuse.
    ['an extra index', 'create index gerb_extra on public.gallery_email_send_attempts (attempted_at)', '42710'],
    ['a changed index', 'drop index public.gallery_email_send_attempts_tenant_recipient; create index gallery_email_send_attempts_tenant_recipient on public.gallery_email_send_attempts (tenant_id, recipient_hash)', '42710'],
  ]
  for (const [label, tamper, want] of drift) {
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [BASE_FILE])
      await sql(cfg, tamper)
      const before = await bodyMd5(cfg)
      is(`over ${label}: refused`, await applyText(cfg, FIX), want)
      is(`over ${label}: body unchanged`, await bodyMd5(cfg), before)
      if (label === 'a widened ACL') {
        const still = (await sql(cfg, `select has_function_privilege('anon', 'public.reserve_gallery_email_send(uuid, uuid, uuid)', 'EXECUTE') as f`)).rows[0].f
        is('over a widened ACL: left for investigation, not silently re-narrowed', still, true)
      }
    })
  }
  await withScratch(async (cfg: Cfg) => {
    await loadFixture(cfg, [])
    is('with no deployed limiter: refused', await applyText(cfg, FIX), '42P17')
    is('with no deployed limiter: nothing created', await bodyMd5(cfg), null)
  })

  // ── Mutants ──────────────────────────────────────────────────────────────
  if (MUTATIONS) {
    const mutate = (name: string, text: string, from: string, to: string) => {
      const out = text.replace(from, to)
      if (out === text) throw new Error(`mutant "${name}": its target was not found`)
      return out
    }
    const RET = `return 'reserved:' || pg_catalog.encode(v_hash, 'hex');`

    // Function mutants against the SQL suite: corrected stage, then the mutant body.
    const fnMutants: [string, string, string, string][] = [
      ['no tenant prefix', RET, `return 'reserved:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8')), 'hex');`, 'hash = sha256(site:normalised address)'],
      ['bare reserved', RET, `return 'reserved';`, 'reserved answer shape'],
      ['hash on recipient_limited', `return 'recipient_limited';`, `return 'recipient_limited:' || pg_catalog.encode(v_hash, 'hex');`, 'fourth: recipient_limited, verbatim'],
      ['returned ≠ charged', 'values (p_tenant, v_hash, v_now);', `values (p_tenant, pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8')), v_now);`, 'hash = the row this call charged'],
    ]
    for (const [name, from, to, step] of fnMutants) {
      await withScratch(async (cfg: Cfg) => {
        await loadFixture(cfg, [BASE_FILE])
        await applyText(cfg, FIX)
        is(`mutant ${name}: installs`, await applyText(cfg, mutate(name, FIX_FN, from, to)), 'applied')
        const r = await owner(cfg, (c) => runSqlFile(c, SUITE))
        ok(`mutant ${name}: CAUGHT by the SQL suite ("${step}" FAILs)`, !r.ok && failed(r.summary, step), r.summary.slice(0, 1600))
      })
    }

    // Re-reading the address after the lock for the answer: the lock-wait scenario must catch it.
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [BASE_FILE])
      await applyText(cfg, FIX)
      is('mutant re-read-after-lock: installs', await applyText(cfg, mutate('re-read', FIX_FN, RET,
        `return 'reserved:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_tenant::text || ':' || (select pg_catalog.lower(pg_catalog.btrim(c.email)) from public.clients c where c.id = p_client), 'UTF8')), 'hex');`)), 'applied')
      await sql(cfg, SEED)
      const w = await lockWait(cfg, ca(3))
      ok('mutant re-read-after-lock: CAUGHT (answer ≠ charged row)', w.seen >= 1 && w.charged.length === 1 && hexOf(w.ans) !== w.charged[0], JSON.stringify(w))
    })

    // Migration mutants.
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [BASE_FILE])
      await sql(cfg, drift[0][1])
      const m = mutate('no drift check', FIX,
        `  if v_body is distinct from current_setting('gel_fix.deployed_md5')\n     and v_body is distinct from current_setting('gel_fix.corrected_md5') then`,
        `  if false then`)
      ok('mutant no-body-drift-check: CAUGHT (a drifted body is overwritten)', (await applyText(cfg, m)) === 'applied')
    })
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [BASE_FILE])
      const m = mutate('wrong derivation', FIX, `pg_catalog.encode(v_hash, ''hex'');\\nend '),`, `pg_catalog.encode(v_hash, ''base64'');\\nend '),`)
      is('mutant wrong-derivation: CAUGHT by the read-back (42P17)', await applyText(cfg, m), '42P17')
    })
    await withScratch(async (cfg: Cfg) => {
      await loadFixture(cfg, [BASE_FILE])
      await sql(cfg, drift[3][1])
      const m = mutate('no ACL precondition', FIX, `    raise exception 'reserve_gallery_email_send has another ACL than deployed' using errcode = '42P17';`, `    null;`)
      ok('mutant no-ACL-precondition: CAUGHT (a widened ACL is silently re-narrowed)', (await applyText(cfg, m)) === 'applied')
    })
  }

  console.log(`gallery-email-recipient-binding-db: ${pass} passed, ${fail.length} failed${MUTATIONS ? '' : ' (mutations skipped)'}`)
  for (const f of fail) console.log(`  FAIL ${f}`)
  process.exit(fail.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
