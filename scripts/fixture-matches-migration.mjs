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
  const namedWant = ['jobs', 'page_views', 'gallery_email_send_attempts']
  if (named.map((n) => n.table).join() !== namedWant.join()) {
    throw new Error(`${SH}: expected the ${namedWant.join(', ')} fact sets, found ${named.map((n) => n.table).join(', ') || 'none'}`)
  }
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
  ['the P5-R1 correction no longer replayed',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$RENDER_FIX" >/tmp/fmm-renderfix.log 2>&1; then\n  echo "FAIL  the P5-R1 correction does not apply:"; tail -8 /tmp/fmm-renderfix.log; exit 1\nfi\n',
    '',
    /\$RENDER_FIX .* replayed 0 times/],
  ['the P5 render read replayed twice',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$RENDER_READ" >/tmp/fmm-renderread.log 2>&1; then\n  echo "FAIL  the P5 render-read migration does not apply:"; tail -8 /tmp/fmm-renderread.log; exit 1\nfi\n',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$RENDER_READ" >/tmp/fmm-renderread.log 2>&1; then\n  echo "FAIL  the P5 render-read migration does not apply:"; tail -8 /tmp/fmm-renderread.log; exit 1\nfi\nif ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$RENDER_READ" >/tmp/fmm-renderread.log 2>&1; then\n  echo "FAIL  the P5 render-read migration does not apply:"; tail -8 /tmp/fmm-renderread.log; exit 1\nfi\n',
    /\$RENDER_READ .* replayed 2 times/],
  ['the gallery email recipient binding no longer replayed',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$GEL_BINDING" >/tmp/fmm-gel-binding.log 2>&1; then\n  echo "FAIL  the gallery email recipient-binding migration does not apply:"; tail -8 /tmp/fmm-gel-binding.log; exit 1\nfi\n',
    '',
    /\$GEL_BINDING .* replayed 0 times/],
  ['the gallery email send limit replayed twice',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$GEL_LIMITS" >/tmp/fmm-gel-limits.log 2>&1; then\n  echo "FAIL  the gallery email send-limit migration does not apply:"; tail -8 /tmp/fmm-gel-limits.log; exit 1\nfi\n',
    'if ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$GEL_LIMITS" >/tmp/fmm-gel-limits.log 2>&1; then\n  echo "FAIL  the gallery email send-limit migration does not apply:"; tail -8 /tmp/fmm-gel-limits.log; exit 1\nfi\nif ! psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$GEL_LIMITS" >/tmp/fmm-gel-limits.log 2>&1; then\n  echo "FAIL  the gallery email send-limit migration does not apply:"; tail -8 /tmp/fmm-gel-limits.log; exit 1\nfi\n',
    /\$GEL_LIMITS .* replayed 2 times/],
  ['the gallery email fact set no longer read',
    'GEL_FACTS=$(facts_sql gallery_email_send_attempts "\'reserve_gallery_email_send\'")\n',
    '',
    /expected the jobs, page_views, gallery_email_send_attempts fact sets/],
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
  // ── P5 (deployed 2026-10-08) ──
  // Anchored on the cover v2 comment that now follows the column: since
  // 20261122233150 access_revision is no longer albums' last column, so it
  // carries a comma rather than closing the table.
  ['albums.access_revision nullable',
    '  access_revision uuid not null default gen_random_uuid(),\n  -- 20261122233150 (album_cover_v2)',
    '  access_revision uuid default gen_random_uuid(),\n  -- 20261122233150 (album_cover_v2)',
    'access_revision uuid DEFAULT gen_random_uuid()'],
  ['albums.access_revision without its default',
    '  access_revision uuid not null default gen_random_uuid(),\n  -- 20261122233150 (album_cover_v2)',
    '  access_revision uuid not null,\n  -- 20261122233150 (album_cover_v2)',
    'access_revision uuid'],
  ['a column-level grant on albums.access_revision',
    'revoke trigger on table public.albums from public, anon, authenticated, service_role;\n',
    'revoke trigger on table public.albums from public, anon, authenticated, service_role;\ngrant update (access_revision) on public.albums to authenticated;\n',
    'NOT NULL ACL'],
  ['the revision trigger disabled',
    'create trigger albums_access_revision\n  before insert or update on public.albums\n  for each row execute function public.albums_access_revision();\n',
    'create trigger albums_access_revision\n  before insert or update on public.albums\n  for each row execute function public.albums_access_revision();\nalter table public.albums disable trigger albums_access_revision;\n',
    'enabled=D'],
  ['the revision trigger UPDATE-only',
    'create trigger albums_access_revision\n  before insert or update on public.albums\n',
    'create trigger albums_access_revision\n  before update on public.albums\n',
    'BEFORE UPDATE ON public.albums'],
  ['TRIGGER on albums never revoked',
    'revoke trigger on table public.albums from public, anon, authenticated, service_role;\n',
    '',
    'authenticated TRIGGER'],
  ['the revision function SECURITY DEFINER',
    "  security invoker volatile set search_path = '' as $body$",
    "  security definer volatile set search_path = '' as $body$",
    'SECURITY DEFINER'],
  ['EXECUTE on the revision function to authenticated',
    'revoke all on function public.albums_access_revision() from public, anon, authenticated, service_role;\n',
    'revoke all on function public.albums_access_revision() from public, anon, authenticated, service_role;\ngrant execute on function public.albums_access_revision() to authenticated;\n',
    'acl  albums_access_revision'],
  ['the revision function owned by another role',
    'revoke all on function public.albums_access_revision() from public, anon, authenticated, service_role;\n',
    'revoke all on function public.albums_access_revision() from public, anon, authenticated, service_role;\nalter function public.albums_access_revision() owner to service_role;\n',
    'owner=service_role'],
  ['the reader back to its pre-R1 body (the deployed v_a.id)',
    "'asset_id', v_asset)",
    "'asset_id', v_a.id)",
    "'asset_id', v_a.id)"],
  ['the reader VOLATILE',
    "returns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = ''\nas $$\ndeclare\n  c_max_refs",
    "returns jsonb\nlanguage plpgsql\nvolatile\nsecurity definer\nset search_path = ''\nas $$\ndeclare\n  c_max_refs",
    'STABLE'],
  ['EXECUTE on the reader to authenticated',
    'grant execute on function public.read_photo_render_assets(uuid, jsonb)            to service_role;',
    'grant execute on function public.read_photo_render_assets(uuid, jsonb)            to service_role;\ngrant execute on function public.read_photo_render_assets(uuid, jsonb) to authenticated;',
    'acl  read_photo_render_assets'],
  ["the projector's section-alt blank rule changed (tab no longer blank)",
    "  c_alt_text  constant text := '[^\\t\\n\\v\\f\\r ",
    "  c_alt_text  constant text := '[^\\n\\v\\f\\r ",
    'c_alt_text'],
  ['the fixture without the revision trigger (refused at the strip)',
    'create trigger albums_access_revision\n  before insert or update on public.albums\n  for each row execute function public.albums_access_revision();\n',
    '',
    'albums_access_revision'],
  // ── Client gallery v2, cover columns (deployed 2026-11-22, 20261122233150) ──
  ['the cover columns declared before access_revision (production added them last)',
    '  access_revision uuid not null default gen_random_uuid(),\n  -- 20261122233150 (album_cover_v2): added by ALTER TABLE after F1, so last.\n  cover_background         text,\n  cover_zoom               numeric,\n  cover_secondary_photo_id uuid\n);',
    '  cover_background         text,\n  cover_zoom               numeric,\n  cover_secondary_photo_id uuid,\n  access_revision uuid not null default gen_random_uuid()\n);',
    'cover_background text'],
  ['albums.cover_zoom with a default',
    '  cover_zoom               numeric,\n',
    '  cover_zoom               numeric default 1.0,\n',
    'cover_zoom numeric DEFAULT'],
  ['albums_cover_zoom_range widened past 2.5',
    'check (cover_zoom >= 1.0 and cover_zoom <= 2.5);',
    'check (cover_zoom >= 1.0 and cover_zoom <= 3.0);',
    'albums_cover_zoom_range'],
  ['albums_cover_background_hex lower-case only',
    "check (cover_background ~ '^#[0-9A-Fa-f]{6}$');",
    "check (cover_background ~ '^#[0-9a-f]{6}$');",
    'albums_cover_background_hex'],
  ['the second cover key without its album (a photograph of another gallery)',
    'foreign key (cover_secondary_photo_id, id, tenant_id)\n          references public.photos (id, album_id, tenant_id)\n',
    'foreign key (cover_secondary_photo_id, tenant_id)\n          references public.photos (id, tenant_id)\n',
    'albums_cover_secondary_photo_fk'],
  ['the second cover key made ON DELETE CASCADE (deleting the photograph deletes the album)',
    '          on delete set null (cover_secondary_photo_id);\n',
    '          on delete cascade;\n',
    'albums_cover_secondary_photo_fk'],
  ['albums_cover_secondary_photo without its predicate',
    'create index albums_cover_secondary_photo on public.albums (cover_secondary_photo_id) where cover_secondary_photo_id is not null;',
    'create index albums_cover_secondary_photo on public.albums (cover_secondary_photo_id);',
    'albums_cover_secondary_photo'],
  ['the fixture without the second cover index (refused at the strip)',
    'create index albums_cover_secondary_photo on public.albums (cover_secondary_photo_id) where cover_secondary_photo_id is not null;\n',
    '',
    'albums_cover_secondary_photo'],
  // ── Client gallery v2, layout_style admits 'square' (deployed 2026-11-22, 20261122233837) ──
  ['albums_layout_style_check lagging production (no square)',
    "check (layout_style in ('masonry','grid','single_column','square'));",
    "check (layout_style in ('masonry','grid','single_column'));",
    'albums_layout_style_check'],
  ['albums_layout_style_check running ahead of production (an extra value)',
    "check (layout_style in ('masonry','grid','single_column','square'));",
    "check (layout_style in ('masonry','grid','single_column','square','editorial'));",
    'albums_layout_style_check'],
  // ── Client gallery v2, the gallery email send limit (20261123001300, 20261123002952) ──
  ["the function lagging production (the send limit's body, before the recipient binding)",
    "  return 'reserved:' || pg_catalog.encode(v_hash, 'hex');\nend $$;",
    "  return 'reserved';\nend $$;",
    "return 'reserved';"],
  ['reserve_gallery_email_send made SECURITY INVOKER',
    "volatile\nsecurity definer\nset search_path = ''\nset lock_timeout = '5s'",
    "volatile\nsecurity invoker\nset search_path = ''\nset lock_timeout = '5s'",
    'SECURITY DEFINER'],
  ['reserve_gallery_email_send without its lock_timeout',
    "set search_path = ''\nset lock_timeout = '5s'\n",
    "set search_path = ''\n",
    'lock_timeout'],
  ['EXECUTE on reserve_gallery_email_send to service_role',
    'grant execute on function public.reserve_gallery_email_send(uuid, uuid, uuid)\n  to authenticated;\n',
    'grant execute on function public.reserve_gallery_email_send(uuid, uuid, uuid)\n  to authenticated;\ngrant execute on function public.reserve_gallery_email_send(uuid, uuid, uuid) to service_role;\n',
    'acl  reserve_gallery_email_send'],
  ['reserve_gallery_email_send owned by another role',
    'grant execute on function public.reserve_gallery_email_send(uuid, uuid, uuid)\n  to authenticated;\n',
    'grant execute on function public.reserve_gallery_email_send(uuid, uuid, uuid)\n  to authenticated;\nalter function public.reserve_gallery_email_send(uuid, uuid, uuid) owner to service_role;\n',
    'owner=service_role'],
  ['SELECT on gallery_email_send_attempts to authenticated',
    'revoke all on table public.gallery_email_send_attempts from public, anon, authenticated, service_role;\n',
    'revoke all on table public.gallery_email_send_attempts from public, anon, authenticated, service_role;\ngrant select on table public.gallery_email_send_attempts to authenticated;\n',
    'authenticated SELECT'],
  ['gallery_email_send_attempts without row-level security',
    'alter table public.gallery_email_send_attempts enable row level security;\n',
    '',
    'rls  DISABLED'],
  ['a policy on gallery_email_send_attempts (it must have none)',
    'alter table public.gallery_email_send_attempts enable row level security;\n',
    'alter table public.gallery_email_send_attempts enable row level security;\ncreate policy "Tenant members manage" on public.gallery_email_send_attempts for all using (tenant_id = public.current_tenant_id());\n',
    'pol  '],
  ['the recipient hash CHECK widened',
    'check (octet_length(recipient_hash) = 32)\n);',
    'check (octet_length(recipient_hash) >= 32)\n);',
    'gallery_email_send_attempts_hash_shape'],
  ['the tenant key without its cascade',
    'foreign key (tenant_id) references public.tenants (id) on delete cascade,\n  constraint gallery_email_send_attempts_hash_shape',
    'foreign key (tenant_id) references public.tenants (id),\n  constraint gallery_email_send_attempts_hash_shape',
    'gallery_email_send_attempts_tenant_fk'],
  ['the send-limit index without attempted_at',
    'on public.gallery_email_send_attempts (tenant_id, recipient_hash, attempted_at);',
    'on public.gallery_email_send_attempts (tenant_id, recipient_hash);',
    'gallery_email_send_attempts_tenant_recipient'],
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
