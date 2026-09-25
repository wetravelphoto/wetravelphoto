#!/usr/bin/env node
/**
 * EVERY READ OF SOMEBODY'S WORK SAYS WHOSE
 * ════════════════════════════════════════
 *
 * The tables holding photographs, galleries, stories and prints all carry a
 * "anyone may read the published ones" policy, and row-level security cannot
 * narrow that by site: a signed-out visitor has no tenant for the database to
 * compare against. So the filter lives in the application — which means it can
 * be forgotten, silently, by the next query anybody writes.
 *
 * This is the thing that notices. It walks every `.from('<table>')` in the
 * source and fails if the statement around it never mentions `tenant_id`.
 *
 * ── The exemption that cost us, 2026-09-23 ────────────────────────────────
 *
 * This file once excused all of `app/actions/` ("behind requireEditor(), which
 * returns the tenant to write with") and all of `app/admin/` ("behind a session
 * whose tenant must match the address"). Both sentences are true. Neither is
 * an answer to the question this checker asks.
 *
 * Being signed in decides WHO MAY ACT. It does not decide WHAT A QUERY
 * RETURNS. `albums` still carries `Public can view public albums ... using
 * (privacy_type = 'public')`, and Postgres ORs policies together, so that one
 * alone is enough for any signed-in reader: the admin showed every site's
 * galleries to a photographer who owned none of them. Found by the first
 * beta tester on his first sign-in.
 *
 * So: an exemption may only say how a query is NARROWED. "The caller is
 * trusted" is never that. If a reason does not name a filter, it is not a
 * reason.
 *
 * It is deliberately dumb: a regular expression over the text, not a type
 * checker. A clever version would understand the query builder and would break
 * the first time the builder changed. This one only has to be right about
 * whether nine characters appear near a call, and when it is wrong the fix is
 * an entry in ALLOWED below, with a reason somebody can argue with.
 *
 *   node scripts/check-tenant-scoping.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** Tables that belong to one site and must never be read across sites. */
const SCOPED = [
  'albums',
  'blog_posts',
  'photos',
  'page_sections',
  'shop_categories',
  'print_options',
  'catalog_items',
  'products',
  'room_scenes',
  'instagram_media',
  'contact_messages',
  'newsletter_signups',
  'clients',
  'site_settings',
  'site_images',
  // Added 2026-09-24, after applying a look on a second site failed. These
  // were never on the list, and their tenant_id DEFAULTS to
  // default_tenant_id() — the oldest tenant — so every write that omitted it
  // addressed the first site on the platform.
  'site_template',
  'site_template_history',
  // Added 2026-09-25, after the editor went down for every photographer.
  // `site_draft` was never watched, so the draft save could name tenant_id as
  // its conflict target, never set it, and pass this check for months. These
  // nine are every remaining table in db/ that carries a tenant_id; the list
  // was built by reading the schema rather than by remembering.
  'site_draft',
  'site_draft_steps',
  'site_versions',
  'draft_shares',
  'site_secrets',
  'profiles',
  'tenant_domains',
  'orders',
  'order_items',
]

/**
 * Reads that are scoped by something other than a tenant_id of their own, each
 * with the reason. Anything not listed here has to carry the filter.
 */
const ALLOWED = [
  {
    file: 'lib/album-covers.ts',
    why: 'photographs of an album the caller already resolved by tenant',
  },
  {
    file: 'lib/album-access.ts',
    table: 'photos',
    why: 'photographs of an album resolved by tenant a few lines above',
  },
  {
    file: 'lib/gallery-access.ts',
    why: 'scoped by an unforgeable share token; the tenant is checked when the token is read',
  },
  {
    file: 'lib/instagram.ts',
    why: 'the nightly sync takes its tenant explicitly — it runs on a cron with no address to read',
  },
  {
    file: 'app/actions/sites.ts',
    why: 'making a site is cross-site by definition; it is behind platformAdmin and writes the tenant it just created',
  },
  {
    file: 'app/admin/sites/page.tsx',
    why: 'the one screen whose whole job is to see across sites, behind platformAdmin',
  },
  {
    file: 'app/api/instagram/refresh/route.ts',
    why: 'the cron loops every site explicitly',
  },
  {
    file: 'lib/supabase/',
    why: 'the clients themselves',
  },
  {
    file: 'app/actions/templates.ts',
    table: 'templates',
    why: 'the catalogue of looks is the platform\'s, shared by every site, and belongs to no tenant',
  },
  {
    file: 'lib/templates/store.ts',
    table: 'templates',
    why: 'the same shared catalogue, read-only',
  },
  {
    file: 'app/actions/sites.ts',
    table: 'templates',
    why: 'reading the default look from the shared catalogue when a site is made',
  },
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

/** The statement a `.from(` sits in: up to the next blank line or semicolon. */
function statementAt(text, index) {
  const start = text.lastIndexOf('\n\n', index)
  let end = index
  let depth = 0
  for (; end < text.length; end++) {
    const c = text[end]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if ((c === '\n' && depth <= 0 && /[;,)]\s*$/.test(text.slice(end - 2, end + 1))) || (c === '\n' && text[end + 1] === '\n')) break
  }
  // A chained call keeps going. Breaking at the `})` that closes an
  // `.update({...})` cut the window just before the `.eq('tenant_id', …)` that
  // followed it, which reported two correctly-scoped newsletter writes as
  // unscoped. A checker's false alarms are not harmless: they are what
  // persuades somebody to add an exemption, and an exemption is how the last
  // hole got in.
  while (end < text.length) {
    // Skip whitespace AND comments. A comment between `.from(...)` and the
    // `.eq('tenant_id', ...)` below it used to end the window early, which
    // reported a correctly scoped read as unscoped — and the fix somebody
    // reaches for when that happens is an exemption.
    let rest = 0
    for (;;) {
      const ws = text.slice(end + rest).match(/^\s*/)[0].length
      rest += ws
      const two = text.slice(end + rest, end + rest + 2)
      if (two === '//') rest += text.slice(end + rest).indexOf('\n') + 1
      else if (two === '/*') rest += text.slice(end + rest).indexOf('*/') + 2
      else break
    }
    if (text[end + rest] !== '.') break
    end += rest + 1
    let depth = 0
    for (; end < text.length; end++) {
      const c = text[end]
      if (c === '(') depth++
      else if (c === ')') { depth--; if (depth === 0) { end++; break } }
    }
  }

  return text.slice(Math.max(start, index - 400), Math.min(end + 200, text.length))
}

const problems = []

for (const file of walk(join(ROOT, 'lib')).concat(walk(join(ROOT, 'app')))) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  const text = readFileSync(file, 'utf8')

  for (const table of SCOPED) {
    const needle = `.from('${table}')`
    let at = text.indexOf(needle)
    while (at !== -1) {
      const excused = ALLOWED.find(
        (a) => rel.startsWith(a.file) && (!a.table || a.table === table)
      )
      if (!excused) {
        const statement = statementAt(text, at)
        const line = text.slice(0, at).split('\n').length

        if (!statement.includes('tenant_id')) {
          problems.push(`${rel}:${line}  reads ${table} without saying whose`)
        } else if (
          /\.(insert|upsert)\s*\(/.test(statement) &&
          /onConflict\s*:\s*['"][^'"]*tenant_id/.test(statement) &&
          // The payload is usually a variable built a dozen lines earlier, so
          // this one looks further back than the statement window does.
          // Deliberately generous: the cost of missing a real one is an
          // outage, the cost of looking too far is nothing.
          !/tenant_id\s*:/.test(text.slice(Math.max(0, at - 2000), at + 400))
        ) {
          /**
           * NAMING A COLUMN IS NOT SETTING IT.
           *
           * This rule exists because of one outage. The draft save read:
           *
           *   supabase.from('site_draft').upsert(row, { onConflict: 'tenant_id' })
           *
           * and `row` never contained a tenant. The nine characters were right
           * there in the statement, so the check above was satisfied and the
           * line looked, to a reader and to this script, like it had been
           * thought about. It had not: the value came from a column default
           * that guessed. When the default was removed so that a forgotten
           * tenant would fail loudly, this failed loudly — on every save in
           * the editor, for every photographer, as a redacted React #441.
           *
           * So an insert or upsert whose ONLY mention of tenant_id is its
           * conflict target is refused. Narrow on purpose: payloads built a
           * few lines above are common and legitimate, and a checker that
           * cries wolf gets exemptions added to it, which is how the first
           * hole got in.
           */
          problems.push(
            `${rel}:${line}  ${table}: onConflict names tenant_id but the row never sets it`
          )
        }
      }
      at = text.indexOf(needle, at + 1)
    }
  }
}

if (problems.length) {
  console.error('\nSome reads do not say which site they are for:\n')
  for (const p of problems) console.error('  ' + p)
  console.error(
    '\nAdd `.eq(\'tenant_id\', tenantId)` with the tenant from lib/tenant.ts,\n' +
      'and return nothing when there is no tenant. If the read is genuinely\n' +
      'scoped some other way, add it to ALLOWED in this file with the reason.\n'
  )
  process.exit(1)
}

console.log('Every read of a site-owned table says which site it is for.')
