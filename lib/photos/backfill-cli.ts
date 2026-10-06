import { createAdminClient } from '@/lib/supabase/admin'
import { backfillTenant, isClean, type BackfillDeps, type BackfillRpc, type TenantReport } from '@/lib/photos/backfill'
import { r2ReadOnly, withRetries } from '@/lib/photos/backfill-storage'
import { parseLegacyKey } from '@/lib/photos/legacy-key'

/**
 * THE BACKFILL COMMAND — the testable half of scripts/backfill-photo-assets.ts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * P4. An INTERNAL tool: no browser action, no route, no page, no job.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-photo-assets.ts --tenant <uuid>
 *   npx tsx --env-file=.env.local scripts/backfill-photo-assets.ts --all
 *   …add --apply to write; add --manifest <file> for unprefixed journal keys
 *
 * DRY RUN BY DEFAULT. Without --apply it reads the inventory, reads and
 * decodes every file apply would (HEAD and bounded GET only), hashes the
 * originals, and reports what it would do; it calls no writer. Exactly one of --tenant or
 * --all, never a default. Sites one at a time, writes one at a time.
 *
 * RESUMABLE because every write is its own transaction and idempotent: run it
 * again after an interruption and everything already linked is skipped.
 *
 * Afterwards, separately: `scripts/rebuild-photo-usages.ts --tenant <id>` for
 * every site the apply processed (the run prints the list) projects the usages
 * the new assets make resolvable. This command never writes a usage. `--all`
 * here lists sites page by page by id cursor, so a server row cap cannot
 * silently drop a site.
 *
 * Exit codes: 0 clean; 1 something was refused, failed or stayed stale (the
 * report says what); 2 the command was wrong or could not start (no work done).
 *
 * ── The provenance manifest ──────────────────────────────────────────────────
 *
 * An unprefixed `journal/<upload>` key names no album and no site, so nothing
 * in the database proves whose it is. Such a key is backfilled only for a site
 * an operator has reviewed it for, in a JSON file:
 *
 *   { "version": 1,
 *     "entries": [ { "tenant": "<uuid>", "key": "journal/<uuid>",
 *                    "reviewed_by": "who checked it", "note": "optional" } ] }
 *
 * `key` is the key BASE, exactly. The same key under two sites refuses the
 * whole file. The database still checks no other site claims the key.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const USAGE =
  'usage: backfill-photo-assets --tenant <uuid> [--apply] [--manifest <file>]\n' +
  '       backfill-photo-assets --all          [--apply] [--manifest <file>]\n' +
  '       (a dry run unless --apply is given)'

export type Target = { mode: 'tenant'; tenant: string } | { mode: 'all' }
export type Command = { target: Target; apply: boolean; manifest: string | null }
export type Parsed = { ok: true; command: Command } | { ok: false; error: string }

/** Pure. Exactly one of --tenant <uuid> / --all; --apply and --manifest at most once. */
export function parseArgs(argv: readonly string[]): Parsed {
  let tenant: string | null = null
  let all = false
  let apply = false
  let manifest: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const value = () => {
      const v = argv[i + 1]
      i++
      return v === undefined || v.startsWith('--') ? null : v
    }
    if (arg === '--all') {
      if (all) return { ok: false, error: '--all was given twice.' }
      all = true
    } else if (arg === '--apply') {
      if (apply) return { ok: false, error: '--apply was given twice.' }
      apply = true
    } else if (arg === '--tenant') {
      if (tenant !== null) return { ok: false, error: '--tenant was given twice.' }
      const v = value()
      if (v === null) return { ok: false, error: '--tenant needs a site id.' }
      tenant = v
    } else if (arg === '--manifest') {
      if (manifest !== null) return { ok: false, error: '--manifest was given twice.' }
      const v = value()
      if (v === null) return { ok: false, error: '--manifest needs a file.' }
      manifest = v
    } else {
      return { ok: false, error: `Unknown argument "${arg}".` }
    }
  }
  if (all && tenant !== null) return { ok: false, error: 'Give --tenant <uuid> OR --all, not both.' }
  if (!all && tenant === null) return { ok: false, error: 'Give --tenant <uuid> or --all. There is no default.' }
  if (tenant !== null && !UUID.test(tenant)) return { ok: false, error: `"${tenant}" is not a site id (a uuid).` }
  const target: Target = tenant !== null ? { mode: 'tenant', tenant: tenant.toLowerCase() } : { mode: 'all' }
  return { ok: true, command: { target, apply, manifest } }
}

export type Manifest = Map<string, Set<string>>
export type ParsedManifest = { ok: true; manifest: Manifest } | { ok: false; error: string }

/** Pure. A manifest is all valid or not used at all. */
export function parseManifest(text: string): ParsedManifest {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The manifest is not JSON.' }
  }
  const d = doc as { version?: unknown; entries?: unknown }
  if (!d || typeof d !== 'object' || d.version !== 1 || !Array.isArray(d.entries)) {
    return { ok: false, error: 'The manifest must be { "version": 1, "entries": [...] }.' }
  }
  const owner = new Map<string, string>()
  const out: Manifest = new Map()
  for (const [i, e] of (d.entries as unknown[]).entries()) {
    const entry = e as { tenant?: unknown; key?: unknown; reviewed_by?: unknown; note?: unknown }
    if (!entry || typeof entry !== 'object') return { ok: false, error: `Entry ${i} is not an object.` }
    const allowed = new Set(['tenant', 'key', 'reviewed_by', 'note'])
    const extra = Object.keys(entry).find((k) => !allowed.has(k))
    if (extra) return { ok: false, error: `Entry ${i} has an unknown field "${extra}".` }
    if (typeof entry.tenant !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.tenant)) {
      return { ok: false, error: `Entry ${i}: "tenant" must be a lower-case site id.` }
    }
    if (typeof entry.reviewed_by !== 'string' || entry.reviewed_by.trim() === '') {
      return { ok: false, error: `Entry ${i}: "reviewed_by" must say who reviewed it.` }
    }
    if (entry.note !== undefined && typeof entry.note !== 'string') return { ok: false, error: `Entry ${i}: "note" must be text.` }
    const k = parseLegacyKey(entry.key)
    if (!k.ok || k.shape !== 'base' || k.route !== 'journal' || k.prefixTenant !== null || k.keyBase !== entry.key) {
      return { ok: false, error: `Entry ${i}: "key" must be exactly an unprefixed journal key base, journal/<uuid>.` }
    }
    const before = owner.get(k.keyBase)
    if (before !== undefined && before !== entry.tenant) {
      return { ok: false, error: `The key ${k.keyBase} is listed for two sites. The manifest is refused.` }
    }
    owner.set(k.keyBase, entry.tenant)
    out.set(entry.tenant, (out.get(entry.tenant) ?? new Set<string>()).add(k.keyBase))
  }
  return { ok: true, manifest: out }
}

/** What the command needs from the world. `serviceDeps()` is the real one. */
export type CliDeps = {
  backfill: (tenantId: string, apply: boolean) => Promise<TenantReport>
  listTenants: () => Promise<string[]>
  out: (line: string) => void
}

export function formatReport(r: TenantReport): string[] {
  const c = r.counts
  const lines = [
    `tenant ${r.tenant}  ${r.apply ? 'APPLY' : 'dry run'}  passes ${r.passes}`,
    `  photos ${c.photos} (samples ${c.photoSamples}, already linked ${c.photosLinked})  ` +
      `site_images ${c.siteImages} (already linked ${c.siteImagesLinked})`,
    `  references ${c.references} (samples ${c.referenceSamples}, malformed ${c.malformed})  ` +
      `existing assets ${c.assetsExisting}`,
    `  plan: assets to create ${c.assetsPlanned}, rows to link ${c.rowsToLink}` +
      `  (writes: ${r.planned.create} create, ${r.planned.reuse} reuse)`,
    `  verified: display files read and decoded ${c.filesDecoded}, originals read, decoded and hashed ${c.originalsRead}`,
  ]
  if (r.apply) {
    const w = r.writes
    lines.push(`  wrote: created ${w.created}, reused ${w.reused}, already linked ${w.already_linked}, ` +
      `gone ${w.gone}, stale ${w.stale}, failed ${w.failed}  (rows linked ${r.linked})`)
  }
  lines.push(`  refused ${r.refusals.length}`)
  for (const f of r.refusals.slice(0, 200)) {
    lines.push(`    ${f.reason}  ${f.keyBase ?? f.path ?? ''}  [${f.where}]${f.detail ? '  ' + f.detail : ''}`)
  }
  if (r.refusals.length > 200) lines.push(`    … and ${r.refusals.length - 200} more`)
  for (const f of r.failures) lines.push(`    FAILED ${f.id}: ${f.message}`)
  return lines
}

/** Runs a parsed command. Sites one after another. Returns the exit code. */
export async function runBackfill(command: Command, deps: CliDeps): Promise<number> {
  let tenants: string[]
  if (command.target.mode === 'tenant') {
    tenants = [command.target.tenant]
  } else {
    try {
      tenants = await deps.listTenants()
    } catch (e) {
      deps.out(`could not list the sites: ${e instanceof Error ? e.message : String(e)}`)
      return 1
    }
  }
  let unclean = 0
  // Every site this run reached — including one whose run ended early, which
  // may already have committed some writes.
  const processed: string[] = []
  const interrupted = new Set<string>()
  for (const tenant of tenants) {
    let report: TenantReport
    processed.push(tenant)
    try {
      report = await deps.backfill(tenant, command.apply)
    } catch (e) {
      deps.out(`tenant ${tenant}  FAILED: ${e instanceof Error ? e.message : String(e)}`)
      interrupted.add(tenant)
      unclean++
      continue
    }
    for (const l of formatReport(report)) deps.out(l)
    if (!isClean(report)) unclean++
  }
  deps.out(`total  sites ${tenants.length}  unclean ${unclean}  ${command.apply ? 'APPLIED' : 'dry run — the same reads and decoding as apply; nothing was written'}`)
  if (command.apply) {
    // Per site, by id: the rebuild's own --all reads the site list in a single
    // query (open-items §12), so name each processed site explicitly.
    deps.out('next, separately approved: project the usages these assets resolve, for EACH processed site:')
    for (const tenant of processed) {
      deps.out(`  scripts/rebuild-photo-usages.ts --tenant ${tenant}` +
        (interrupted.has(tenant) ? '   (its backfill ended early: rerun the backfill for it first)' : ''))
    }
  }
  return unclean > 0 ? 1 : 0
}

/** One page of site ids after `after` (exclusive), ascending, asking for at most `limit`. */
export type TenantPage = (after: string | null, limit: number) => Promise<{ data: { id: unknown }[] | null; error: { message: string } | null }>

/** Ids requested per page. The server may return FEWER (its row cap); that is not the end. */
export const TENANT_PAGE = 500

/**
 * Every site id, by an id cursor, until a page comes back EMPTY. A short page
 * is never taken as the last one: PostgREST's row cap can return fewer rows
 * than asked for, and stopping there would drop sites without a word. Each
 * page must continue strictly after the cursor, or this throws rather than
 * loop or skip.
 */
export async function listAllTenants(page: TenantPage, limit = TENANT_PAGE): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | null = null
  for (;;) {
    const { data, error } = await page(cursor, limit)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    if (rows.length === 0) return ids
    for (const row of rows) {
      const id = row.id
      if (typeof id !== 'string' || (cursor !== null && !(id > cursor))) {
        throw new Error(`the site listing did not continue after ${cursor ?? 'the start'} (got ${String(id)})`)
      }
      ids.push(id)
      cursor = id
    }
  }
}

/** The real dependencies: the service-role client and the read-only bucket. */
export function serviceDeps(manifest: Manifest, out: (line: string) => void = console.log): CliDeps {
  const admin = createAdminClient()
  const rpc = admin as unknown as BackfillRpc
  const deps: BackfillDeps = {
    rpc,
    storage: withRetries(r2ReadOnly),
    provenance: (tenantId) => manifest.get(tenantId) ?? new Set(),
    progress: out,
  }
  return {
    backfill: (tenantId, apply) => backfillTenant(tenantId, apply, deps),
    // Every site, by id, page by page. The tenants table IS the list of sites.
    listTenants: () =>
      listAllTenants(async (after, limit) => {
        const q = admin.from('tenants').select('id').order('id').limit(limit)
        return after === null ? q : q.gt('id', after)
      }),
    out,
  }
}

/**
 * The whole command: parse the arguments and the manifest, and only then build
 * the dependencies and run. Nothing touches a database until both are valid.
 */
export async function main(
  argv: readonly string[],
  readFile: (path: string) => string,
  makeDeps: (manifest: Manifest) => CliDeps = (m) => serviceDeps(m),
  err: (line: string) => void = console.error
): Promise<number> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    err(`${parsed.error}\n${USAGE}`)
    return 2
  }
  let manifest: Manifest = new Map()
  if (parsed.command.manifest !== null) {
    let text: string
    try {
      text = readFile(parsed.command.manifest)
    } catch (e) {
      err(`could not read the manifest: ${e instanceof Error ? e.message : String(e)}`)
      return 2
    }
    const m = parseManifest(text)
    if (!m.ok) {
      err(m.error)
      return 2
    }
    manifest = m.manifest
  }
  let deps: CliDeps
  try {
    deps = makeDeps(manifest)
  } catch (e) {
    err(e instanceof Error ? e.message : String(e))
    return 2
  }
  return runBackfill(parsed.command, deps)
}
