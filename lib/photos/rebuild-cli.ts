import { createAdminClient } from '@/lib/supabase/admin'
import { rebuildUsages, type RebuildReport, type UsageRpc } from '@/lib/photos/usages'

/**
 * THE REBUILD COMMAND — the testable half of scripts/rebuild-photo-usages.ts
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The deterministic repair path for photo_usages (P3), and the command P4 runs
 * after its backfill. An INTERNAL tool: no browser action, no route, no page.
 *
 *   npx tsx --env-file=.env.local scripts/rebuild-photo-usages.ts --tenant <uuid>
 *   npx tsx --env-file=.env.local scripts/rebuild-photo-usages.ts --all
 *
 * It contains no projection logic. It only chooses which sites, and calls
 * `rebuildUsages()` (lib/photos/usages.ts) for each — the same projector every
 * save uses — through the service-role client. It writes nothing but the
 * derived photo_usages rows that projector maintains.
 *
 * Exit codes: 0 every parent rebuilt; 1 a site had failed parents (or could not
 * be listed); 2 the command was wrong or could not start (no work was done).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const USAGE =
  'usage: rebuild-photo-usages --tenant <uuid>   (one site)\n' +
  '       rebuild-photo-usages --all             (every site, one after another)'

export type RebuildTarget = { mode: 'tenant'; tenant: string } | { mode: 'all' }

export type Parsed = { ok: true; target: RebuildTarget } | { ok: false; error: string }

/** Pure. Exactly one of --tenant <uuid> or --all; never a default. */
export function parseArgs(argv: readonly string[]): Parsed {
  let tenant: string | null = null
  let all = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--all') {
      if (all) return { ok: false, error: '--all was given twice.' }
      all = true
    } else if (arg === '--tenant') {
      if (tenant !== null) return { ok: false, error: '--tenant was given twice.' }
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return { ok: false, error: '--tenant needs a site id.' }
      tenant = value
      i++
    } else {
      return { ok: false, error: `Unknown argument "${arg}".` }
    }
  }
  if (all && tenant !== null) return { ok: false, error: 'Give --tenant <uuid> OR --all, not both.' }
  if (!all && tenant === null) return { ok: false, error: 'Give --tenant <uuid> or --all. There is no default.' }
  if (tenant !== null) {
    if (!UUID.test(tenant)) return { ok: false, error: `"${tenant}" is not a site id (a uuid).` }
    return { ok: true, target: { mode: 'tenant', tenant: tenant.toLowerCase() } }
  }
  return { ok: true, target: { mode: 'all' } }
}

/** What the command needs from the world. `serviceDeps()` is the real one. */
export type RebuildDeps = {
  rebuild: (tenantId: string) => Promise<RebuildReport>
  listTenants: () => Promise<string[]>
  out: (line: string) => void
}

const line = (tenant: string, r: RebuildReport) =>
  `tenant ${tenant}  parents ${r.parents}  failed ${r.failed}  written ${r.written}  unresolved ${r.unresolved}`

/** Runs a parsed command. Sites one at a time, never in parallel. Returns the exit code. */
export async function runRebuild(target: RebuildTarget, deps: RebuildDeps): Promise<number> {
  if (target.mode === 'tenant') {
    const r = await deps.rebuild(target.tenant)
    deps.out(line(target.tenant, r))
    return r.failed > 0 ? 1 : 0
  }

  let tenants: string[]
  try {
    tenants = await deps.listTenants()
  } catch (e) {
    deps.out(`could not list the sites: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
  const total: RebuildReport = { parents: 0, failed: 0, written: 0, unresolved: 0 }
  let failedSites = 0
  for (const tenant of tenants) {
    const r = await deps.rebuild(tenant)
    deps.out(line(tenant, r))
    total.parents += r.parents
    total.failed += r.failed
    total.written += r.written
    total.unresolved += r.unresolved
    if (r.failed > 0) failedSites++
  }
  deps.out(
    `total  sites ${tenants.length}  failed sites ${failedSites}  parents ${total.parents}  ` +
      `failed ${total.failed}  written ${total.written}  unresolved ${total.unresolved}`
  )
  return failedSites > 0 ? 1 : 0
}

/**
 * The real dependencies: the service-role client (which throws without
 * SUPABASE_SERVICE_ROLE_KEY) and the existing rebuildUsages.
 */
export function serviceDeps(out: (line: string) => void = console.log): RebuildDeps {
  const admin = createAdminClient()
  return {
    rebuild: (tenantId) => rebuildUsages(tenantId, { rpc: admin as unknown as UsageRpc }),
    listTenants: async () => {
      // Every site, by id. The tenants table IS the list of sites; nothing
      // here reads anything belonging to one.
      const { data, error } = await admin.from('tenants').select('id').order('id')
      if (error) throw new Error(error.message)
      return (data ?? []).map((row) => row.id as string)
    },
    out,
  }
}

/**
 * The whole command: parse, and only then build the dependencies and run.
 * Nothing touches a database until the arguments are valid.
 */
export async function main(
  argv: readonly string[],
  makeDeps: () => RebuildDeps = () => serviceDeps(),
  err: (line: string) => void = console.error
): Promise<number> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    err(`${parsed.error}\n${USAGE}`)
    return 2
  }
  let deps: RebuildDeps
  try {
    deps = makeDeps()
  } catch (e) {
    err(e instanceof Error ? e.message : String(e))
    return 2
  }
  return runRebuild(parsed.target, deps)
}
