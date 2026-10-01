import { Client } from 'pg'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { CUSTOM_KEY, PAGES, isPageKey } from '../lib/sections/pages'
import { DRAFT_KINDS, USAGE_KINDS, USAGE_PARENT, USAGE_SCOPES } from '../lib/photos/usage-kinds'

/**
 * P1: THE TWO PLACES THE PHOTO VOCABULARY IS WRITTEN DOWN AGREE
 * ═════════════════════════════════════════════════════════════
 *
 * `db/verify-photo-assets.sql` proves the tables: shape, constraints, keys,
 * grants, isolation. This proves what the SQL cannot see — that the database
 * and the TypeScript describe the same thing:
 *
 *   1. `lib/photos/usage-kinds.ts` and the table's kind, scope and one-parent
 *      CHECKs admit exactly the same shapes.
 *   2. `isPageKey()` in `lib/sections/pages.ts` and the
 *      `photo_usages_page_key_shape` CHECK give the same answer for every key
 *      worth asking about. This is a PERMANENT INVARIANT: add a built-in page
 *      to PAGES without adding it to the CHECK and this suite fails.
 *
 * Needs a Postgres carrying `db/test-fixture.sql`, which since the P1
 * deployment (Supabase 20260930123113) was reconciled into it already contains
 * both tables in their deployed shape:
 *
 *   PGHOST=/tmp PGPORT=5433 PGDATABASE=wtp PGUSER=postgres npx tsx .mk/photo-assets.ts
 *
 * With no database reachable the file-level half still runs and the database
 * half SKIPS LOUDLY. A suite that goes green by not running is worse than none.
 *
 * Runs as the connecting role — the table owner — on purpose: this is a
 * contract test between two descriptions, not a permission test, and the owner
 * is the one role whose refusals can only come from a constraint. Everything
 * it writes is inside one transaction that is rolled back.
 */

// Resolved from this file rather than a fixed sandbox path, so it runs from
// any checkout.
const ROOT = resolve(__dirname, '..')
const MIGRATIONS = `${ROOT}/db/migrations`

const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const PHOTO_A = 'cccccccc-0000-0000-0000-000000000001'
const ALBUM_A = 'bbbbbbbb-0000-0000-0000-000000000001'
const POST_A = 'dddddddd-0000-0000-0000-000000000001'

let pass = 0
const fail: string[] = []
const ok = (n: string, good: boolean, d = '') =>
  good ? pass++ : fail.push(`${n}${d ? '\n    ' + d : ''}`)
const is = (n: string, got: unknown, want: unknown) =>
  ok(
    n,
    JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got) === JSON.stringify(want)
      ? ''
      : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`
  )

const sorted = (xs: readonly string[]) => [...xs].sort()

// ════════════════════════════════════════════════════════════════════════════
// 1. THE MIGRATION FILE SAYS WHAT THE TYPESCRIPT SAYS
// ════════════════════════════════════════════════════════════════════════════
//
// Read from the file so that it holds with no database at all. The database
// half below asks the live constraint the same questions.

/**
 * The text of the LATEST migration that declares `constraint <name>`. P1
 * declared every one of these; P3 (2026-09-30_photo_usages_sync.sql) restates
 * the kind, scope and parent CHECKs with the eighth kind, page_share. Reading
 * only P1's file would hold the TypeScript to a contract the database no longer
 * has. Files are applied in name order, so the last to declare it is the truth.
 */
function declaring(name: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  let text = ''
  for (const file of files) {
    const src = readFileSync(`${MIGRATIONS}/${file}`, 'utf8')
    if (src.includes(`constraint ${name} `) || src.includes(`constraint ${name}
`)) text = src
  }
  return text
}

/** The quoted strings inside the first `<column> in ( … )` after `name`. */
function listIn(src: string, name: string, column: string): string[] | null {
  const at = src.indexOf(`constraint ${name}`)
  if (at < 0) return null
  const m = new RegExp(`${column}\\s+in\\s*\\(([^)]*)\\)`).exec(src.slice(at))
  return m ? [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!) : null
}

{
  const kinds = listIn(declaring('photo_usages_kind_known'), 'photo_usages_kind_known', 'kind')
  ok('the migration still declares its kinds', kinds !== null)
  if (kinds) is('its kinds are USAGE_KINDS', sorted(kinds), sorted(USAGE_KINDS))

  const scopes = listIn(declaring('photo_usages_scope_known'), 'photo_usages_scope_known', 'scope')
  ok('the migration still declares its scopes', scopes !== null)
  if (scopes) is('its scopes are USAGE_SCOPES', sorted(scopes), sorted(USAGE_SCOPES))

  const draft = listIn(declaring('photo_usages_scope_by_kind'), 'photo_usages_scope_by_kind', 'kind')
  ok('the migration still declares its draft-capable kinds', draft !== null)
  if (draft) is('they are DRAFT_KINDS', sorted(draft), sorted(DRAFT_KINDS))

  // THE PAGE LIST. Written out in SQL because a CHECK cannot import TypeScript.
  // This is the assertion that fails first when a built-in page is added to
  // PAGES and not to the CHECK.
  const migration = declaring('photo_usages_page_key_shape')
  const builtins = listIn(migration, 'photo_usages_page_key_shape', 'page_key')
  ok('the migration still lists its built-in pages', builtins !== null)
  if (builtins) is('its built-in pages are exactly the keys of PAGES', sorted(builtins), sorted(Object.keys(PAGES)))
  ok('and they include notfound, which isPageKey accepts', builtins?.includes('notfound') ?? false)

  const re = /page_key ~ '([^']*)'/.exec(migration.slice(migration.indexOf('constraint photo_usages_page_key_shape')))
  ok('the migration still has a custom-key pattern', re !== null)
  if (re) is('its pattern is CUSTOM_KEY, character for character', re[1], CUSTOM_KEY.source)
  is('and CUSTOM_KEY carries no flags that SQL would not', CUSTOM_KEY.flags, '')
}

// ════════════════════════════════════════════════════════════════════════════
// 2. THE KEYS WORTH ASKING ABOUT
// ════════════════════════════════════════════════════════════════════════════
//
// Every built-in, well-formed custom keys, and the near-misses where two regex
// engines are most likely to disagree. Non-ASCII ones are MEASURED against the
// real engine and collation below, not assumed.

const NEAR_MISSES: Record<string, string[]> = {
  'valid custom keys': ['p_a1b2c3d4', 'p_00000000', 'p_zzzzzzzz', 'p_abcdefgh', 'p_99999999'],
  'invalid custom keys': [
    'p_a1b2c3d', 'p_a1b2c3d4e', 'p_', 'p_a1b2c3d!', 'p_a1b2-3d4', 'p_a1b2_3d4', 'q_a1b2c3d4',
    'pa1b2c3d4e', 'p__1b2c3d4', 'p_a1b2c3d4p_a1b2c3d4',
  ],
  'upper case': ['P_a1b2c3d4', 'p_A1B2C3D4', 'p_a1b2c3dZ', 'HOME', 'Home', 'NotFound', 'Galleries'],
  'wrong lengths and near built-ins': ['', 'h', 'hom', 'homes', 'homee', 'trips', '404', 'not_found', 'about-us'],
  'whitespace and punctuation': [
    ' home', 'home ', 'home\n', '\nhome', 'home\t', ' p_a1b2c3d4', 'p_a1b2c3d4 ', 'p_a1b2c3d4\n', '\np_a1b2c3d4',
    'home.', 'home;', '../home', 'home/', 'p_a1b2c3d.', "p_a1b2c3d'", 'p_a1b2c3d%', 'p_a1b2c3d_', 'p_a1b2c3d*',
  ],
  'non-ASCII near-misses': [
    'p_a1b2c3dé',             // Latin small e with acute
    'p_a1b2c3dı',             // dotless i — lower-cases oddly in some locales
    'p_a1b2c3dK',        // KELVIN SIGN, which case-folds to "k"
    'p_a1b2c3dＡ',            // fullwidth A
    'p_a1b2c3dａ',            // fullwidth a
    'p_a1b2c3d４',            // fullwidth digit four
    'p_a1b2c3d٤',             // Arabic-Indic digit four
    'p_a1b2c3dß',             // sharp s
    'p_a1b2c3dª',        // feminine ordinal — a "letter" in some classifications
    'p_a1b2c3d⁰',        // superscript zero
    'p_a1b2c3d\u{1D41A}',     // mathematical bold a (astral, two UTF-16 units)
    'p_a1b2c3\u{1D41A}',      // …and where two UTF-16 units would make eight
    'p_a1b2c3dé',       // e + combining acute: eight letters then a mark
    'hоme',                   // Cyrillic o
    'ｈｏｍｅ',                // fullwidth home
    'notfounԁ',               // Cyrillic d
  ],
  'object-prototype names': ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'],
}

const BUILTINS = Object.keys(PAGES)
const CANDIDATES = [...BUILTINS, ...Object.values(NEAR_MISSES).flat()]

// The TypeScript side must reject everything that is not a built-in or a
// well-formed custom key; asserted here so a loosened isPageKey fails even if
// the database happened to loosen the same way.
for (const [group, keys] of Object.entries(NEAR_MISSES)) {
  const want = group === 'valid custom keys'
  const wrong = keys.filter((k) => isPageKey(k) !== want)
  is(`isPageKey: ${group} are all ${want ? 'accepted' : 'refused'}`, wrong, [])
}
is('isPageKey accepts every built-in, notfound included', BUILTINS.filter((k) => !isPageKey(k)), [])

// ════════════════════════════════════════════════════════════════════════════
// 3. …AND THE LIVE CONSTRAINT AGREES
// ════════════════════════════════════════════════════════════════════════════

type Verdict = boolean

/**
 * Does the real `photo_usages_page_key_shape` accept this key? Asked by
 * inserting a page_section usage in a savepoint. A refusal by ANY other
 * constraint, or any other error, is thrown rather than read as "refused" —
 * the S4 lesson: "it was refused" is satisfied by the wrong layer.
 */
async function dbAccepts(db: Client, assetId: string, key: string): Promise<Verdict> {
  await db.query('savepoint k')
  try {
    await db.query(
      `insert into photo_usages (tenant_id, asset_id, kind, page_key, field)
       values ($1, $2, 'page_section', $3, 'image_path')`,
      [TENANT_A, assetId, key]
    )
    await db.query('rollback to savepoint k')
    return true
  } catch (e) {
    await db.query('rollback to savepoint k')
    const err = e as { code?: string; constraint?: string; message?: string }
    if (err.code === '23514' && err.constraint === 'photo_usages_page_key_shape') return false
    throw new Error(`key ${JSON.stringify(key)} was refused by something else: ${err.code} ${err.constraint ?? ''} ${err.message}`)
  }
}

/** Every candidate on which the database and a TypeScript predicate disagree. */
async function disagreements(
  db: Client,
  assetId: string,
  keys: string[],
  ts: (k: string) => boolean
): Promise<string[]> {
  const out: string[] = []
  for (const k of keys) if ((await dbAccepts(db, assetId, k)) !== ts(k)) out.push(k)
  return out
}

async function main() {
  const db = new Client({
    host: process.env.PGHOST ?? '/tmp',
    port: Number(process.env.PGPORT ?? 5433),
    database: process.env.PGDATABASE ?? 'wtp',
    user: process.env.PGUSER ?? 'postgres',
  })

  try {
    await db.connect()
  } catch (e) {
    report()
    console.log(
      '\nSKIPPED the database half: no Postgres at ' +
        `${process.env.PGHOST ?? '/tmp'}:${process.env.PGPORT ?? 5433}. ` +
        'Build db/test-fixture.sql and run again.\n' +
        (e instanceof Error ? e.message : String(e))
    )
    process.exit(fail.length ? 1 : 0)
  }

  const has = await db.query(`select to_regclass('public.photo_usages') is not null as there`)
  if (!has.rows[0].there) {
    fail.push('photo_usages does not exist here — this database predates the P1 reconciliation; rebuild it from db/test-fixture.sql')
    await db.end()
    return
  }

  await db.query('begin')
  try {
    const asset = await db.query(
      `insert into photo_assets (tenant_id, key_base, display_path)
       values ($1, 't/mk/photo-assets/1', 't/mk/photo-assets/1/2400.webp') returning id`,
      [TENANT_A]
    )
    const assetId: string = asset.rows[0].id

    // ── 3a. The constraint text, from the catalogue ───────────────────────
    const def = await db.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'photo_usages'::regclass
          and conname in ('photo_usages_kind_known', 'photo_usages_page_key_shape')`
    )
    const byName = Object.fromEntries(def.rows.map((r) => [r.conname, r.def as string]))
    const quoted = (s: string | undefined) => [...(s ?? '').matchAll(/'([^']*)'::text/g)].map((m) => m[1]!)
    is('the LIVE kind CHECK names exactly USAGE_KINDS', sorted(quoted(byName.photo_usages_kind_known)), sorted(USAGE_KINDS))
    const liveBuiltins = quoted(byName.photo_usages_page_key_shape).filter((k) => !k.startsWith('^'))
    is('the LIVE page CHECK names exactly the keys of PAGES', sorted(liveBuiltins), sorted(BUILTINS))

    // ── 3b. Kinds, parents and scopes, by behaviour ───────────────────────
    const parentValue: Record<string, string> = {
      photo_id: PHOTO_A,
      album_id: ALBUM_A,
      post_id: POST_A,
      product_id: '', // filled below: the fixture has no catalog item
      page_key: 'home',
    }
    const item = await db.query(
      `insert into catalog_items (tenant_id, photo_id) values ($1, $2) returning id`,
      [TENANT_A, PHOTO_A]
    )
    parentValue.product_id = item.rows[0].id

    const PARENTS = ['photo_id', 'album_id', 'post_id', 'product_id', 'page_key'] as const
    const attempt = async (kind: string, scope: string, parent: string): Promise<string> => {
      await db.query('savepoint s')
      try {
        await db.query(
          `insert into photo_usages (tenant_id, asset_id, scope, kind, ${parent}, field) values ($1, $2, $3, $4, $5, $6)`,
          // A page_share has exactly one legal field (photo_usages_share_slot, P3);
          // every other kind takes any.
          [TENANT_A, assetId, scope, kind, parentValue[parent], kind === 'page_share' ? 'page_seo.image' : 'f']
        )
        await db.query('rollback to savepoint s')
        return 'accepted'
      } catch (e) {
        await db.query('rollback to savepoint s')
        const err = e as { code?: string; constraint?: string }
        return `${err.code} ${err.constraint ?? ''}`.trim()
      }
    }

    for (const kind of USAGE_KINDS) {
      const own = USAGE_PARENT[kind]
      is(`${kind}: accepted with its declared parent, ${own}`, await attempt(kind, 'live', own), 'accepted')
      const others: string[] = []
      for (const p of PARENTS) if (p !== own) others.push(`${p}=${await attempt(kind, 'live', p)}`)
      is(
        `${kind}: refused with any other parent`,
        others,
        PARENTS.filter((p) => p !== own).map((p) => `${p}=23514 photo_usages_one_parent`)
      )
      const draftOk = (DRAFT_KINDS as readonly string[]).includes(kind)
      is(
        `${kind}: draft scope is ${draftOk ? 'allowed' : 'refused'}`,
        await attempt(kind, 'draft', own),
        draftOk ? 'accepted' : '23514 photo_usages_scope_by_kind'
      )
    }
    is('a kind USAGE_KINDS does not know is refused', await attempt('portfolio', 'live', 'page_key'), '23514 photo_usages_kind_known')

    // ── 3c. THE PAGE-KEY PARITY — the permanent invariant ─────────────────
    const differ = await disagreements(db, assetId, CANDIDATES, isPageKey)
    is(`isPageKey and the SQL CHECK agree on all ${CANDIDATES.length} keys`, differ, [])

    for (const [group, keys] of Object.entries(NEAR_MISSES)) {
      const d = await disagreements(db, assetId, keys, isPageKey)
      is(`  …including the ${group}`, d, [])
    }

    // ── 3d. AND IT WOULD FAIL. Proved, not claimed. ───────────────────────
    //
    // Simulate the day somebody adds a built-in page — `portfolio` — to PAGES
    // and forgets the CHECK: isPageKey starts accepting it, the database does
    // not. The same comparison must report exactly that key. If it did not,
    // the assertion above would be green for the wrong reason.
    const tomorrow = (k: string) => isPageKey(k) || k === 'portfolio'
    is(
      'a built-in added to PAGES but not to SQL is reported as a disagreement',
      await disagreements(db, assetId, [...CANDIDATES, 'portfolio'], tomorrow),
      ['portfolio']
    )
    // …and the file-level check above fails the same way: the SQL list would
    // no longer equal Object.keys(PAGES) once PAGES had a key it lacks.
    const withTomorrow = sorted([...BUILTINS, 'portfolio'])
    ok(
      'the file-level page list would also fail on that addition',
      JSON.stringify(sorted(liveBuiltins)) !== JSON.stringify(withTomorrow)
    )
    // And the other direction: a key SQL accepts that TypeScript refuses.
    const stricter = (k: string) => isPageKey(k) && k !== 'notfound'
    is(
      'a page SQL accepts but TypeScript refuses is reported too',
      await disagreements(db, assetId, CANDIDATES, stricter),
      ['notfound']
    )
  } finally {
    await db.query('rollback')
    await db.end()
  }
}

function report() {
  console.log(`${pass + fail.length} assertions`)
  for (const f of fail) console.log('FAIL ' + f)
  console.log(`\n${pass} passed, ${fail.length} failed`)
}

main().then(
  () => {
    report()
    process.exit(fail.length ? 1 : 0)
  },
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
