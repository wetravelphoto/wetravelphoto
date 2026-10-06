/**
 * P4 MUTATION PROOFS — each guarded defect, put back, must make its test FAIL.
 *
 *   node scripts/p4-mutations.mjs
 *
 * SQL mutants: unit 1 is applied to its own scratch database with ONE change
 * (scripts/p4-local-db.mjs: loopback only, drops only itself), over the
 * fixture rebuilt to the HISTORICAL stage `pre_p4` — the fixture itself now
 * carries the deployed unit 1 — and the named check must FAIL. TypeScript mutants: lib/photos/backfill.ts (or, where named,
 * lib/photos/backfill-cli.ts) is rewritten with
 * one change, .mk/backfill.ts runs (--unit-only, or against a scratch DB where
 * the check needs one), and the file is restored — verified byte for byte —
 * whatever happens. A mutant whose search text is missing is itself a failure.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { applyStage, runSqlFile, tsxPath, withScratch } from './p4-local-db.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UNIT1 = resolve(ROOT, 'db/migrations/2026-10-05_photo_backfill.sql')
const LIB = resolve(ROOT, 'lib/photos/backfill.ts')

let pass = 0
let fail = 0
const ok = (n) => { pass++; console.log(`  ok    ${n}`) }
const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? '\n        ' + d : ''}`) }
const check = (good, okName, badName, detail = '') => { if (good) ok(okName); else bad(badName, detail) }

const mutate = (text, find, replace) => {
  if (!text.includes(find)) return null
  return text.split(find).join(replace)
}

const SQL_MUTANTS = [
  ['source membership NOT NULL-safe (the review\'s bypass)',
    ' or exists (select 1 from jsonb_each_text(p_derivatives) d where d.value = p_source_path)) is not true then',
    ' or exists (select 1 from jsonb_each_text(p_derivatives) d where d.value = p_source_path)) = false then',
    'sql', 'refused: a source size the asset does not record, with NO original'],
  ['display path not checked on its own',
    'if public.photo_backfill_key_base(p_display_path) is distinct from p_key_base then',
    'if false then', 'sql', 'refused: a prefixed key with a flat display file'],
  ['P3\'s legacy fallback ignored',
    "if jsonb_array_length(v_src -> 'sections') = 0 then", 'if true then',
    'sql', 'legacy column of a page WITH section rows'],
  ['JSON-null ladder not normalised',
    "coalesce(nullif(v_row.derivatives, 'null'::jsonb), '{}'::jsonb)", 'v_row.derivatives',
    'sql', 'a display-only row whose ladder is JSON null'],
  ['document bound to ANY string of the source (the draft\'s rule)',
    "if v_slot is null or jsonb_typeof(v_slot) <> 'string' or (v_slot #>> '{}') <> p_source_path then",
    "if not exists (select 1 from jsonb_path_query(v_src, 'strict $.**') x(v) where x.v = to_jsonb(p_source_path)) then",
    'sql', "slot blocks/0/image naming block 1's photograph"],
  ['keywords not bound to the row\'s tags (no tags snapshot check)',
    '         or v_row.tags is distinct from p_source_tags then', '         then',
    'sql', 'keywords normalised from tags the row NO LONGER has'],
  ['resolver back to LIMIT 1 (ambiguity guessed)',
    'select case when count(*) = 1 then (array_agg(m.id))[1] end from m', 'select (array_agg(m.id))[1] from m',
    'sql', 'a path two assets claim resolves to NOTHING'],
  ['document binding without the projection lock',
    '      perform public.photo_usage_lock(p_tenant, p_parent, v_pkey);\n', '',
    'ts-db', 'lock: a document binding WAITS'],
]

const TS_MUTANTS = [
  ['legacy mirrors claimed even with section rows',
    'Array.isArray(src.sections) && src.sections.length === 0 && isRecord(src.legacy)', 'isRecord(src.legacy)',
    'legacy column SHADOWED'],
  ['raw tags sent as keywords (the normaliser bypassed)',
    'return { p_source_tags: tags, p_keywords: normalizeKeywords(tags) }', 'return { p_source_tags: tags, p_keywords: tags }',
    'keywords = normalizeKeywords(the row'],
  ['orientation ignored (rotate().metadata() semantics)',
    'const turned = o >= 5 && o <= 8', 'const turned = false', 'upright: an orientation-6'],
  ['orientation not bounded to 5–8 (an out-of-range value turns the axes)',
    'const turned = o >= 5 && o <= 8', 'const turned = o >= 5', 'upright: an out-of-range orientation'],
  ['orientation: 1–4 treated as turned too',
    'const turned = o >= 5 && o <= 8', 'const turned = o >= 1 && o <= 8', 'upright: orientations 5–8 swap the axes'],
  ['header-only check, no full decode',
    "  await sharp(bytes, { failOn: 'error' }).resize(16, 16, { fit: 'inside' }).raw().toBuffer()\n", '',
    'refused: a flat cover that is a truncated JPEG'],
  ['display files only HEADed, never decoded (the review\'s corrupt cover)',
    "  if (d.format !== formatOfName(key)) throw new Refused('format_mismatch'", "  if (false) throw new Refused('format_mismatch'",
    'refused: a flat cover that is a PNG named .jpg'],
  ['obsolete stale attempts kept after a re-plan',
    "      if (s === 'stale' && !current.has(id)) outcomes.delete(id)\n",
    "      if (false) outcomes.delete(id)\n",
    'stale, then linked by another runner'],
  ['claims asked in one unbounded call',
    'for (let i = 0; i < journal.length; i += CLAIMS_BATCH) Object.assign(foreign, await deps.claims(journal.slice(i, i + CLAIMS_BATCH)))',
    'if (journal.length) Object.assign(foreign, await deps.claims(journal))', 'claims: '],
  ['existing links trusted',
    '  const linkOk = (row: PhotoRow | SiteImageRow, at: Locator): boolean => {\n',
    '  const linkOk = (row: PhotoRow | SiteImageRow, at: Locator): boolean => {\n    if (row) return true\n',
    'existing links are CHECKED'],
  ['a thrown RPC error swallowed as an item failure',
    "      const reply = await deps.rpc.rpc('register_legacy_photo_asset', w.args)",
    "      const reply = await Promise.resolve(deps.rpc.rpc('register_legacy_photo_asset', w.args)).catch((e: Error) => ({ data: null, error: { message: e.message } }))",
    'a THROWN error ends the run'],
  ['malformed sources reported clean',
    "    if (d.malformed > 0) {\n      refusals.push", "    if (false) {\n      refusals.push",
    'a malformed image block'],
  // The ORIGINAL behaviour exactly: a `gone` is settled on the spot — no
  // re-read, counted clean — while `stale` keeps its retry.
  ['the original gone-clean behaviour: `gone` settled at once, never re-read (the one-binding blocker)',
    "      if (status === 'stale' || status === 'gone') {\n        settledGone.delete(w.id)\n        provisional++\n      }",
    "      if (status === 'gone') settledGone.add(w.id)\n      if (status === 'stale') {\n        provisional++\n      }",
    ['A: the bound photograph is gone', 'C: all sources gone']],
  ['an unconfirmed `gone` settled as clean when the passes run out',
    "    if (s === 'stale' || (s === 'gone' && !settledGone.has(id))) {",
    "    if (s === 'stale') {",
    'D: the last, never-confirmed gone is an explicit failure'],
  ['--all stops at the first SHORT page (a server cap truncates silently)',
    '    if (rows.length === 0) return ids\n',
    '    if (rows.length === 0) return ids\n    if (rows.length < limit) { for (const row of rows) ids.push(row.id as string); return ids }\n',
    'still yields every site', 'lib/photos/backfill-cli.ts'],
  ['--all reads a single page (the P3 command\'s shape)',
    '      cursor = id\n    }\n  }\n}',
    '      cursor = id\n    }\n    return ids\n  }\n}',
    'still yields every site', 'lib/photos/backfill-cli.ts'],
]

function suite(env, unitOnly) {
  const r = spawnSync(process.execPath, [tsxPath(), '.mk/backfill.ts', ...(unitOnly ? ['--unit-only'] : [])], { cwd: ROOT, encoding: 'utf8', env })
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

async function sqlMutant([name, find, replace, kind, expect]) {
  const text = readFileSync(UNIT1, 'utf8')
  const mutated = mutate(text, find, replace)
  if (!mutated) return bad(`${name}: the mutation text was not found (the guarded code moved?)`)
  await withScratch(async (cfg) => {
    const c = new pg.Client(cfg)
    await c.connect()
    try {
      const fx = await runSqlFile(c, 'db/test-fixture.sql')
      if (!fx.ok) throw new Error(fx.summary)
      // The fixture carries the DEPLOYED unit 1 (and unit 2); rebuild the stage
      // before it, so the mutant creates every function itself rather than
      // replacing a correct copy that is already there.
      await applyStage(c, 'pre_p4')
      await c.query(mutated)
      if (kind === 'sql') {
        const r = await runSqlFile(c, 'db/verify-photo-backfill.sql')
        const line = r.summary.split('\n').find((l) => l.includes('FAIL') && l.includes(expect))
        check(!r.ok && line, `SQL mutant "${name}" → caught: ${line?.trim().slice(0, 110)}`, `SQL mutant "${name}" was NOT caught`, r.summary.slice(0, 300))
      }
    } finally {
      await c.end()
    }
    if (kind === 'ts-db') {
      const r = suite({ ...process.env, PGHOST: cfg.host, PGPORT: String(cfg.port), PGUSER: cfg.user, PGDATABASE: cfg.database, PGCLIENTENCODING: 'UTF8' }, false)
      const line = r.out.split('\n').find((l) => l.includes(expect))
      check(r.status !== 0 && line, `SQL mutant "${name}" → caught by .mk/backfill.ts: ${line?.trim().slice(0, 100)}`, `SQL mutant "${name}" was NOT caught`, r.out.slice(-400))
    }
  })
}

function tsMutant([name, find, replace, expect, file]) {
  const target = file ? resolve(ROOT, file) : LIB
  const original = readFileSync(target)
  const digest = createHash('sha256').update(original).digest('hex')
  const mutated = mutate(original.toString('utf8'), find, replace)
  if (!mutated) return bad(`${name}: the mutation text was not found (the guarded code moved?)`)
  try {
    writeFileSync(target, mutated)
    const r = suite(process.env, true)
    // One expected failing check, or several that must ALL fail.
    const expects = Array.isArray(expect) ? expect : [expect]
    const lines = expects.map((e) => r.out.split('\n').find((l) => l.includes(e)))
    const caught = r.status !== 0 && lines.every(Boolean)
    check(caught, `TS mutant "${name}" → caught: ${lines.map((l) => l?.trim().slice(0, 80)).join(' | ')}`,
      `TS mutant "${name}" was NOT caught (expected failures: ${expects.join(' ; ')})`, r.out.slice(-400))
  } finally {
    writeFileSync(target, original)
    const back = createHash('sha256').update(readFileSync(target)).digest('hex')
    if (back !== digest) bad(`${file ?? 'lib/photos/backfill.ts'} was NOT restored (${back} ≠ ${digest})`)
  }
}

async function main() {
  // The unmutated baseline must be green, or a "caught" mutant proves nothing.
  const base = suite(process.env, true)
  check(base.status === 0, 'baseline: .mk/backfill.ts --unit-only is green', 'baseline is not green', base.out.slice(-400))
  for (const m of SQL_MUTANTS) await sqlMutant(m)
  for (const m of TS_MUTANTS) tsMutant(m)
  console.log(`\n${pass} passed, ${fail} failed`)
  return fail ? 1 : 0
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1) })
