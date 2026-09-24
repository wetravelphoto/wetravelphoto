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
    file: 'lib/drafts/',
    why: 'the draft layer carries its own tenant handling',
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
    file: 'lib/start-here.ts',
    table: 'templates',
    why: 'counting how many looks the platform offers, which is the same number for everybody',
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
        if (!statement.includes('tenant_id')) {
          const line = text.slice(0, at).split('\n').length
          problems.push(`${rel}:${line}  reads ${table} without saying whose`)
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
