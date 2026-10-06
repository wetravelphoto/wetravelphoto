/**
 * THE FIXTURE-MATCHES-MIGRATION PROOF, RUN FROM NODE — for a machine with no
 * psql (a Windows checkout).
 *
 *   node scripts/fixture-matches-migration.mjs              the proof
 *   node scripts/fixture-matches-migration.mjs --mutations  …and that it can fail
 *   node scripts/fixture-matches-migration.mjs --fixture <file.sql>   the proof over another file
 *
 * There is ONE definition of the proof: scripts/fixture-matches-migration.sh.
 * This file does not restate it. It READS that script — the facts query, the
 * table and function lists, every strip/link block (`<<'SQL'` heredocs) and
 * every migration (`-f "$VAR"`), in the order the script runs them — and runs
 * exactly that through node-postgres. If the script's shape changes so that
 * something cannot be read — an unrecognized line between the before/after
 * reads, or a required migration not replayed exactly once — this refuses to
 * run rather than run less.
 *
 *   node scripts/fixture-matches-migration.mjs --parser     the parser's own refusals (no database)
 *
 * --mutations runs those parser refusals first.
 *
 * Builds its own scratch database on a LOOPBACK server through
 * scripts/p4-local-db.mjs (unique name, loopback only, drops only itself):
 *   P4_PGHOST (default 127.0.0.1)  P4_PGPORT (default 55434)  P4_PGUSER (default postgres)
 *
 * --mutations writes mutated COPIES of db/test-fixture.sql to the OS temp
 * directory (never the repository), runs the proof against each, and requires
 * every one to FAIL — after an unmutated baseline that must pass.
 */
import { readFileSync, writeFileSync, rmSync, rmdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { runSqlFile, withScratch } from './p4-local-db.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SH = 'scripts/fixture-matches-migration.sh'

// ── Read the proof out of the shell script ──────────────────────────────────
//
// Fail closed: between the BEFORE and AFTER fact reads, every line must be one
// of the shapes below. A psql invocation of any other form — or any other
// command — is refused rather than skipped, because a skipped step is a proof
// that quietly runs less than the script does. And every migration in the
// script's own required-file list (all but $FIXTURE) must be replayed exactly
// once, so a dropped or doubled replay is refused too.
const HEREDOC_STEP = /^if ! psql -X -q -v ON_ERROR_STOP=1 -d "\$DB" >(\/tmp\/[\w.-]+) 2>&1 <<'SQL'$/
const FILE_STEP = /^if ! psql -X -q -v ON_ERROR_STOP=1 -d "\$DB" -f "\$(\w+)" >\/tmp\/[\w.-]+ 2>&1; then$/
const INERT = [/^\s*$/, /^#/, /^then$/, /^fi$/, /^ {2}echo "FAIL [^"]*"; tail -\d+ \/tmp\/[\w.-]+; exit 1$/]

function readProof() {
  return parseProof(readFileSync(resolve(ROOT, SH), 'utf8'))
}

function parseProof(text) {
  const sh = text.replace(/\r\n/g, '\n')
  const need = (re, what) => {
    const m = re.exec(sh)
    if (!m) throw new Error(`${SH}: could not read ${what} — has the script's shape changed?`)
    return m
  }
  const vars = {}
  for (const m of sh.matchAll(/^([A-Z_0-9]+)="\$ROOT\/([^"]+)"$/gm)) vars[m[1]] = m[2]
  const facts = need(/^facts_sql\(\) \{\n[\s\S]*?cat <<SQL\n([\s\S]*?)\nSQL\n\}$/m, 'the facts query')[1]
  const p1Tables = need(/^P1_TABLES="([^"]+)"$/m, 'P1_TABLES')[1].split(/\s+/)
  const p2Fns = need(/^P2_FNS="([^"]+)"$/m, 'P2_FNS')[1]
  const fnTable = need(/\[ "\$t" = (\w+) \]; then P1_FACTS\[\$t\]=\$\(facts_sql "\$t" "\$P2_FNS"\)/, 'which table carries P2_FNS')[1]
  const named = [...sh.matchAll(/^\w+_FACTS=\$\(facts_sql (\w+) "([^"]*)"\)$/gm)].map((m) => ({ table: m[1], fns: m[2] }))
  if (named.length !== 2) throw new Error(`${SH}: expected the jobs and page_views fact sets, found ${named.length}`)
  const targets = [...named, ...p1Tables.map((t) => ({ table: t, fns: t === fnTable ? p2Fns : "''" }))]

  // The steps between recording the BEFORE facts and the AFTER facts, in order.
  const lines = sh.split('\n')
  const from = lines.findIndex((l) => l.includes('P1_BEFORE[$t]=$(psql'))
  const to = lines.findIndex((l) => l.startsWith('JOBS_AFTER=$(psql'))
  if (from < 0 || to < from) throw new Error(`${SH}: could not find the before/after markers`)
  const steps = []
  for (let i = from + 1; i < to; i++) {
    const l = lines[i]
    let m
    if ((m = HEREDOC_STEP.exec(l))) {
      const end = lines.indexOf('SQL', i + 1)
      if (end < 0 || end > to) throw new Error(`${SH}: unterminated heredoc at line ${i + 1}`)
      steps.push({ kind: 'sql', label: `${m[1].replace('/tmp/', '')} (heredoc, line ${i + 1})`, sql: lines.slice(i + 1, end).join('\n') })
      i = end
    } else if ((m = FILE_STEP.exec(l))) {
      const v = m[1]
      if (!vars[v]) throw new Error(`${SH}: $${v} is not a known file`)
      steps.push({ kind: 'file', label: vars[v], file: vars[v], var: v })
    } else if (!INERT.some((re) => re.test(l))) {
      throw new Error(`${SH}: unrecognized line ${i + 1} between the before/after reads — refusing rather than skipping it: ${l.trim().slice(0, 120)}`)
    }
  }

  // Every required migration replayed exactly once; nothing replayed that is
  // not required.
  const required = need(/^for f in ((?:"\$\w+" ?)+); do$/m, 'the required-file list')[1]
    .match(/\w+/g).filter((v) => v !== 'FIXTURE')
  for (const v of required) {
    if (!vars[v]) throw new Error(`${SH}: required $${v} is not a known file`)
    const n = steps.filter((s) => s.var === v).length
    if (n !== 1) throw new Error(`${SH}: required migration $${v} (${vars[v]}) is replayed ${n} times, not once`)
  }
  for (const s of steps) {
    if (s.kind === 'file' && !required.includes(s.var)) throw new Error(`${SH}: $${s.var} is replayed but not in the required-file list`)
  }
  if (!steps.some((s) => s.kind === 'sql')) throw new Error(`${SH}: found no strip/link block`)
  return { factsFor: (t, fns) => facts.split('$table').join(t).split('$fns').join(fns), targets, steps }
}

// ── The parser must be able to refuse ───────────────────────────────────────
// In-memory edits of the script's text; the repository is never touched. Each
// must make parseProof throw, and say why.
const PARSER_MUTATIONS = [
  ['an unrecognized psql command in the replay block',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HOTFIX"',
    'psql -X -q -d "$DB" -c "select 1"\nif ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HOTFIX"',
    /unrecognized line/],
  ['a replay step with an extra psql flag',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$INGEST"',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -1 -d "$DB" -f "$INGEST"',
    /unrecognized line/],
  ['a required migration (P2) no longer replayed',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$INGEST" >/tmp/fmm-ingest.log 2>&1; then\n  echo "FAIL  the P2 migration does not rebuild its functions:"; tail -8 /tmp/fmm-ingest.log; exit 1\nfi\n',
    '',
    /\$INGEST .* replayed 0 times/],
  ['a required migration (unit 2) replayed twice',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ASSET_FK" >/tmp/fmm-assetfk.log 2>&1; then\n  echo "FAIL  P4 unit 2 does not apply:"; tail -8 /tmp/fmm-assetfk.log; exit 1\nfi\n',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ASSET_FK" >/tmp/fmm-assetfk.log 2>&1; then\n  echo "FAIL  P4 unit 2 does not apply:"; tail -8 /tmp/fmm-assetfk.log; exit 1\nfi\nif ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ASSET_FK" >/tmp/fmm-assetfk.log 2>&1; then\n  echo "FAIL  P4 unit 2 does not apply:"; tail -8 /tmp/fmm-assetfk.log; exit 1\nfi\n',
    /\$ASSET_FK .* replayed 2 times/],
  ['some other command between the reads',
    '# SCRATCH ONLY',
    'dropdb --if-exists somebody_else\n# SCRATCH ONLY',
    /unrecognized line/],
]

function parserProofs(say = console.log) {
  let pass = 0, fail = 0
  const original = readFileSync(resolve(ROOT, SH), 'utf8').replace(/\r\n/g, '\n')
  try {
    const p = parseProof(original)
    const files = p.steps.filter((s) => s.kind === 'file').map((s) => s.var)
    pass++; say(`  ok    parser baseline: the real script parses (${files.length} migrations replayed once each: ${files.join(', ')})`)
  } catch (e) {
    fail++; say(`  FAIL  parser baseline: the real script does not parse\n        ${e.message}`)
  }
  for (const [name, find, replace, expect] of PARSER_MUTATIONS) {
    if (original.split(find).length !== 2) { fail++; say(`  FAIL  parser: ${name}: the edit text is not in the script exactly once`); continue }
    try {
      parseProof(original.split(find).join(replace))
      fail++; say(`  FAIL  parser: ${name} was ACCEPTED`)
    } catch (e) {
      if (expect.test(e.message)) { pass++; say(`  ok    parser refuses ${name} → ${e.message.replace(`${SH}: `, '').slice(0, 110)}`) }
      else { fail++; say(`  FAIL  parser: ${name} refused for the wrong reason\n        ${e.message}`) }
    }
  }
  return { pass, fail }
}

// ── Run it ──────────────────────────────────────────────────────────────────
async function prove(fixture, { quiet = false } = {}) {
  const proof = readProof()
  const out = []
  const say = (s) => { out.push(s); if (!quiet) console.log(s) }
  let ok = true
  await withScratch(async (cfg) => {
    const c = new pg.Client(cfg)
    await c.connect()
    try {
      const fx = await runSqlFile(c, fixture)
      if (!fx.ok) { say(`FAIL  the fixture does not build: ${fx.summary.slice(0, 300)}`); ok = false; return }
      const read = async () => {
        const m = new Map()
        for (const t of proof.targets) {
          const r = await c.query(proof.factsFor(t.table, t.fns))
          m.set(t.table, Object.values(r.rows[0])[0] ?? '')
        }
        return m
      }
      const before = await read()
      for (const s of proof.steps) {
        try {
          await c.query(s.kind === 'sql' ? s.sql : readFileSync(resolve(ROOT, s.file), 'utf8'))
        } catch (e) {
          await c.query('rollback').catch(() => {})
          say(`FAIL  step ${s.label}: ${e.message}`)
          ok = false
          return
        }
      }
      const after = await read()
      for (const t of proof.targets) {
        const b = before.get(t.table), a = after.get(t.table)
        if (!b) { say(`FAIL  the fixture built no ${t.table} at all.`); ok = false; continue }
        if (a === b) {
          say(`ok    the fixture's ${t.table} reproduces the migrations exactly (${b.split('\n').length} facts compared)`)
        } else {
          ok = false
          // A multiset difference, not a set one: a function body repeats lines
          // (" SECURITY DEFINER" is in a dozen), and losing one must still show.
          const count = (s) => s.split('\n').reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map())
          const bs = count(b), as = count(a)
          say(`FAIL  the fixture's ${t.table} has drifted from the migrations (< fixture, > migration):`)
          for (const [l, n] of bs) for (let k = as.get(l) ?? 0; k < n; k++) say(`  < ${l.slice(0, 400)}`)
          for (const [l, n] of as) for (let k = bs.get(l) ?? 0; k < n; k++) say(`  > ${l.slice(0, 400)}`)
        }
      }
    } finally {
      await c.end()
    }
  })
  return { ok, report: out.join('\n'), steps: proof.steps.map((s) => s.label) }
}

// ── The proof must be able to fail ──────────────────────────────────────────
const MUTATIONS = [
  ["unit 2's photos_asset_fk made ON DELETE CASCADE",
    'foreign key (asset_id, tenant_id) references public.photo_assets (id, tenant_id);\nalter table public.site_images',
    'foreign key (asset_id, tenant_id) references public.photo_assets (id, tenant_id) on delete cascade;\nalter table public.site_images',
    'photos_asset_fk'],
  ['site_images_asset_tenant without its predicate',
    'create index site_images_asset_tenant on public.site_images (asset_id, tenant_id) where asset_id is not null;',
    'create index site_images_asset_tenant on public.site_images (asset_id, tenant_id);',
    'site_images_asset_tenant'],
  ['an authenticated EXECUTE grant on read_photo_backfill_inventory',
    'grant execute on function public.read_photo_backfill_inventory(uuid)      to service_role;',
    'grant execute on function public.read_photo_backfill_inventory(uuid)      to service_role;\ngrant execute on function public.read_photo_backfill_inventory(uuid) to authenticated;',
    'read_photo_backfill_inventory'],
  ['register_legacy_photo_asset made SECURITY INVOKER',
    "returns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = ''\nas $$\ndeclare\n  c_sizes",
    "returns jsonb\nlanguage plpgsql\nsecurity invoker\nset search_path = ''\nas $$\ndeclare\n  c_sizes",
    'SECURITY DEFINER'],
  ["the resolver back to P3's guess (LIMIT 1 semantics)",
    'select case when count(*) = 1 then (array_agg(m.id))[1] end from m',
    'select (array_agg(m.id))[1] from m',
    'select (array_agg(m.id))[1] from m'],
  ['photo_backfill_foreign_claim without the frozen-history clause',
    '         or exists (select 1 from public.site_versions v where v.tenant_id <> p_tenant\n                     and strpos(v.snapshot::text, p_key_base) > 0)\n',
    '',
    'public.site_versions v where v.tenant_id <> p_tenant'],
  ["the fixture without unit 2's keys at all (refused at the strip)",
    'alter table public.photos add constraint photos_asset_fk\n  foreign key (asset_id, tenant_id) references public.photo_assets (id, tenant_id);\nalter table public.site_images add constraint site_images_asset_fk\n  foreign key (asset_id, tenant_id) references public.photo_assets (id, tenant_id);\n',
    '',
    'photos_asset_fk'],
]

async function mutations() {
  console.log('the parser (in-memory script edits; no database):')
  const parsed = parserProofs()
  console.log('the proof (mutated fixture copies):')
  let pass = 0, fail = 0
  const ok = (n) => { pass++; console.log(`  ok    ${n}`) }
  const bad = (n, d = '') => { fail++; console.log(`  FAIL  ${n}${d ? '\n        ' + d : ''}`) }
  const base = await prove('db/test-fixture.sql', { quiet: true })
  if (base.ok) ok('baseline: the unmutated fixture passes')
  else bad('baseline: the unmutated fixture does not pass', base.report.slice(0, 600))
  const original = readFileSync(resolve(ROOT, 'db/test-fixture.sql'), 'utf8').replace(/\r\n/g, '\n')
  const dir = mkdtempSync(join(tmpdir(), 'fmm-mutants-'))
  const file = join(dir, 'fixture.sql')
  try {
    for (const [name, find, replace, expect] of MUTATIONS) {
      if (original.split(find).length !== 2) { bad(`${name}: the mutation text is not in the fixture exactly once`); continue }
      writeFileSync(file, original.split(find).join(replace))
      const r = await prove(file, { quiet: true })
      const line = r.report.split('\n').find((l) => l.includes(expect) && /^(FAIL|  [<>])/.test(l))
      if (!r.ok && line) ok(`${name} → caught: ${line.trim().slice(0, 120)}`)
      else bad(`${name} was NOT caught`, r.report.slice(0, 600))
    }
  } finally {
    // Not recursive: the one file this wrote, then the directory, which
    // rmdirSync removes only if it is now empty.
    rmSync(file, { force: true })
    rmdirSync(dir)
  }
  console.log(`\nparser: ${parsed.pass} passed, ${parsed.fail} failed · proof: ${pass} passed, ${fail} failed`)
  return fail || parsed.fail ? 1 : 0
}

async function main(argv) {
  if (argv[0] === '--mutations') return mutations()
  if (argv[0] === '--parser') {
    const r = parserProofs()
    console.log(`\n${r.pass} passed, ${r.fail} failed`)
    return r.fail ? 1 : 0
  }
  const fixture = argv[0] === '--fixture' && argv[1] ? argv[1] : 'db/test-fixture.sql'
  const r = await prove(fixture)
  console.log(`\n(steps read from ${SH}: ${r.steps.join(' → ')})`)
  return r.ok ? 0 : 1
}

main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1) })
