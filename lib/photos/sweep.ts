import type { SupabaseClient } from '@supabase/supabase-js'
import { ownsKey } from '@/lib/storage-keys'
import { isSamplePhoto } from '@/lib/images'
import {
  HISTORY_SOURCES,
  SOURCES,
  columnsOf,
  namesFile,
  readSource,
  stringLeaves,
  type IncompleteReason,
  type Row,
  type SourceName,
  type SourceRead,
} from '@/lib/photos/deletion'

/**
 * THE SWEEPER — OBSERVATION ONLY. IT CANNOT DELETE A FILE.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ── WHY IT NO LONGER DELETES (Work, gate P6-20261121-sweeper-application-01)
 *
 * Work blocked the deleting version on two reproduced defects:
 *
 * B1  A canonical save between the evidence read and the storage delete left
 *     only `photo_usages` — a best-effort projection — between a current
 *     reference and the loss of its file. Re-reading closer to the delete only
 *     narrows that window. Closing it needs every reference writer and restore
 *     (replaceSections, patchSiteSettings, the draft store, versions, blog
 *     saves, looks) excluded while removal runs. They share no lock, and R2
 *     sits outside every database transaction.
 * B2  Storage went before the marker. When the marker write failed, the next
 *     run could take the referenced branch, clear the clock and never record
 *     that the files were gone. Fixing that needs durable purge intent written
 *     BEFORE the delete, which ordinary reads and writers then have to honour.
 *
 * Neither fix fits inside the current schema and writers. Each one is a
 * cross-cutting protocol: a purge-intent state, a reference-write fence, and
 * reconciliation after a partial delete. That protocol is a later cleanup
 * phase with its own design, migration and review. Inventing it here would be
 * claiming a guarantee the architecture does not give.
 *
 * So this module can no longer delete, and that is enforced by what it is
 * able to reach rather than by a flag:
 *
 * - `sweep()` takes no storage. It imports nothing that can reach the bucket:
 *   not `lib/photos/storage`, not `lib/r2`, not the S3 SDK.
 * - It never writes `swept_at` or `deleted_at`. Every update goes through one
 *   helper, and that helper refuses any column outside `BOOKKEEPING_COLUMNS`.
 * - An asset that the old rule would have purged is reported as
 *   `purge_deferred` and left exactly as it is, apart from `sweep_checked_at`.
 *
 * `.mk/sweep.ts` holds all of this to account with source scans, an S3
 * tripwire, a patch allow-list and deterministic interleavings, including both
 * of Work's probes. Each check has a mutation that must turn it red.
 *
 * A CLOCK RECORDED BY THIS BUILD IS AN OBSERVATION, NOT PERMISSION. Any future
 * cleanup phase has to establish its own durable purge intent and its own
 * fence. It must never treat `unreferenced_since` from here as proof that a
 * file is safe to remove.
 *
 * Everything below describes the observation as it was designed. Where it
 * talks about purging, read it as "what a future phase would act on".
 *
 * ── HISTORY ─────────────────────────────────────────────────────────────────
 *
 * P6's second half. Design and the three corrections that produced it:
 * .ai-handoff/p6-sweeper-design-claude.md, then Codex's review of 2026-11-03
 * (.ai-handoff/p6-sweeper-codex-review-20261103.md), which rejected the first
 * version of this file on two blocking grounds. Both are answered below.
 *
 * ── IT DISCOVERS ITS OWN WORK. NOTHING MARKS IT. ────────────────────────────
 *
 * The first design had `deleteAlbum` and `deletePhoto` write
 * `photo_assets.deleted_at` to start a thirty-day clock. Two things were wrong
 * with that, and they are worth keeping written down:
 *
 * 1. `authenticated` holds `select` and nothing else on `photo_assets`
 *    (`2026-09-29_photo_assets.sql` revoked everything and granted that one
 *    privilege), so the write was denied. BYPASSRLS is not a table privilege.
 * 2. `deleted_at` is ALREADY a visibility verdict: the reader deployed in
 *    `2026-10-08_photo_render_record_fix.sql` returns unavailable for any
 *    non-null value. Writing it to mean "the clock is running" would have
 *    hidden the photograph immediately, so a thirty-day storage grace period
 *    would not have been a thirty-day no-impact window.
 *
 * So no removal action writes anything, and the sweeper keeps its own three
 * columns (`2026-11-03_photo_sweeper.sql`), which nothing already deployed
 * reads:
 *
 *     unreferenced_since   when it first saw the asset referenced by nothing
 *     sweep_checked_at     when it last examined it
 *     swept_at             its files are gone (never written by this build)
 *
 * `archived_at` and `original_purged_at` stay unwritten by this phase.
 * `deleted_at` belongs at the moment of a PURGE and nowhere else. Then it is
 * true, and it makes every deployed reader stop offering an asset whose files
 * are gone. Writing it while a clock merely runs is the withdrawn design and
 * must not come back. In this observation-only build it is never written at
 * all, and `.mk/sweep.ts` asserts that.
 *
 * Discovery is also strictly better than marking: it finds an asset orphaned
 * by ANY path — a section edited, a draft discarded, an upload forgotten — and
 * not only by the two removal actions.
 *
 * ── AN ASSET IS OBSERVED UNREFERENCED TWICE, THIRTY DAYS APART ──────────────
 *
 * First observation starts the clock. The purge needs a second one, fresh, in
 * a later run. A reference seen in between CLEARS the clock, so an asset that
 * comes back into use is not on a countdown it cannot get off.
 *
 * ── IT IS NOT A JOB KIND, ON PURPOSE ────────────────────────────────────────
 *
 * `jobs` grants INSERT to nobody, `enqueue_jobs` is the only door and
 * allow-lists one kind, and widening that door would cost a migration and hand
 * a browser the ability to queue sweeps. The drain calls this directly, and
 * `sweep-cli.ts` calls it by hand.
 *
 * ── THE SCOPING IN THIS FILE IS THE SECURITY ────────────────────────────────
 *
 * It runs with the service-role key, which ignores row level security, and it
 * deliberately examines EVERY site — so no policy is narrowing anything here.
 * Every read names a site, and the site it names is the one on the asset's own
 * row. The same rule `lib/gallery-access.ts` states for share links, with more
 * force, because the mistake here deletes a photograph rather than showing it.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * It never deletes on incomplete evidence, never on a path it cannot prove
 * belongs to the site whose row it came from, and never on `photo_usages`
 * alone — which `deletion.ts` refuses as evidence because a failed sync can
 * leave it stale, and stale here means deleting a file that is in use. A usage
 * count is a veto, not a permission.
 *
 * ── LIMITS, STATED RATHER THAN CLAIMED AWAY ─────────────────────────────────
 *
 * Codex named these and they are real:
 *
 * - The budget is COOPERATIVE. It is checked between assets; an awaited read
 *   or storage call already in flight can overrun it. The route's own
 *   `maxDuration` is the only hard fence.
 * - Evidence is read ONCE PER SITE PER RUN and reused across that site's
 *   candidates. It is not re-read before each delete. The usage veto is the
 *   only thing re-read per asset.
 * - There is NO atomic exclusion against a reference created while a run is in
 *   progress. Nothing here locks, and the asset row is not deleted, so no
 *   foreign key stands between a concurrent edit and a storage delete. What
 *   stands there is the two-observation rule thirty days apart, the usage veto,
 *   and the fact that a file referenced by anything at all is never a
 *   candidate. That is mitigation, not prevention, and it is why the grace
 *   period is thirty days and not thirty minutes.
 * - Partial deletion is not atomic. (Superseded: Work's B2 showed that
 *   "a later run retries" was false once a reference appeared. That is one
 *   of the two reasons this module no longer deletes.)
 */

/**
 * The only values this build can be. A literal type rather than a boolean, so
 * no option, environment variable or argument can switch deletion back on.
 * Turning it back on means changing this file and passing review again.
 */
export const PHYSICAL_DELETION = 'disabled' as const

/**
 * EVERY COLUMN THIS MODULE MAY WRITE. All of them belong to the sweeper and no
 * deployed reader reads them. `swept_at` and `deleted_at` are absent on
 * purpose: with nothing deleted, both would be false.
 */
export const BOOKKEEPING_COLUMNS: readonly string[] = ['sweep_checked_at', 'unreferenced_since']

/** Service-role client. There is no signed-in user when this runs. */
export type SweepDb = SupabaseClient

/**
 * EVERY SOURCE A PURGE MUST READ: the seven canonical ones, plus frozen
 * history. History is excluded from the removal-time report on purpose and
 * required here — a file named only by a version snapshot is one a restore
 * would ask for.
 */
export const SWEEP_SOURCES: readonly SourceName[] = [...SOURCES, ...HISTORY_SOURCES]

/** How long an asset must have been continuously unreferenced before purging. */
export const GRACE_DAYS = 30

/** The most assets one invocation will examine, whatever the clock says. */
export const SWEEP_ASSETS = 200

/** How long one invocation may spend. Well under the route's `maxDuration`. */
export const SWEEP_BUDGET_MS = 30_000

export type SweepEvidence = { tenantId: string; sources: SourceRead[] }

/**
 * Fresh evidence for one site, across all ten sources. Each read is bounded,
 * paged and checked against PostgREST's exact count by `readSource`; a source
 * that cannot be read whole comes back incomplete, and incomplete evidence is
 * never read as "nothing names this file".
 */
export async function readSweepEvidence(db: SweepDb, tenantId: string): Promise<SweepEvidence> {
  const read = (source: SourceName, orderBy: string) =>
    readSource(source, tenantId, (lo, hi) =>
      db
        .from(source)
        .select(columnsOf(source), { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order(orderBy)
        .range(lo, hi)
    )

  const sources = await Promise.all([
    read('photos', 'id'),
    read('albums', 'id'),
    read('site_images', 'id'),
    read('blog_posts', 'id'),
    read('page_sections', 'id'),
    read('site_draft', 'tenant_id'),
    read('site_settings', 'id'),
    read('site_versions', 'id'),
    read('site_draft_steps', 'id'),
    read('site_template_history', 'id'),
  ])
  return { tenantId, sources }
}

// ── The candidates ─────────────────────────────────────────────────────────

export type SweepAsset = {
  id: string
  tenantId: string
  keyBase: string
  /** Every file this asset has: display size, original, derivatives. */
  paths: string[]
  /** When this asset was first seen referenced by nothing, or null. */
  unreferencedSince: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isRecord = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * The files one asset row names. Returns null when the row is not the shape
 * this reads — a malformed row is never guessed at, because the guess would be
 * a delete.
 *
 * A sample photograph is the bucket's own, shared by every site, and is never
 * a candidate: no sample key is ever handed to `remove`. That is the same
 * exclusion `deletion.ts` makes.
 */
export function assetFiles(row: Row): string[] | null {
  const out: string[] = []
  const add = (value: unknown): boolean => {
    if (value === null || value === undefined || value === '') return true
    if (typeof value !== 'string') return false
    if (!isSamplePhoto(value)) out.push(value)
    return true
  }
  const derivatives = row.derivatives ?? {}
  if (!isRecord(derivatives)) return null
  if (!add(row.display_path) || !add(row.original_path)) return null
  for (const value of Object.values(derivatives)) if (!add(value)) return null
  return [...new Set(out)]
}

/**
 * Assets to examine: anything not yet swept, LEAST RECENTLY CHECKED FIRST.
 *
 * The ordering is the whole answer to a bug Codex found in the first version,
 * which took the oldest N by clock with no cursor: if those N were
 * permanently referenced, asset N+1 was never examined on any day, for ever.
 * `sweep_checked_at nulls first` guarantees forward progress — every examined
 * asset goes to the back of the queue — without rotating anybody's clock.
 */
export async function candidateAssets(
  db: SweepDb,
  { limit = SWEEP_ASSETS }: { limit?: number } = {}
): Promise<{ ok: true; assets: SweepAsset[] } | { ok: false; reason: string }> {
  /*
   * WRAPPED. supabase-js resolves `{ data, error }` for a query error and
   * REJECTS on a network failure, an aborted fetch or an unparseable
   * response. An exception here would abort the whole run instead of
   * producing the report this function promises — the same defect Codex
   * found in the withdrawn marking module, in a second place.
   */
  let rows: unknown[]
  try {
    const { data, error } = await db
      .from('photo_assets')
      .select('id, tenant_id, key_base, display_path, original_path, derivatives, unreferenced_since')
      .is('swept_at', null)
      .order('sweep_checked_at', { nullsFirst: true })
      .order('unreferenced_since', { nullsFirst: true })
      .limit(limit)

    if (error) return { ok: false, reason: error.message }
    if (!Array.isArray(data)) return { ok: false, reason: 'The candidate read did not return rows.' }
    rows = data
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'The candidate read failed.' }
  }

  const assets: SweepAsset[] = []
  for (const row of rows) {
    if (!isRecord(row)) return { ok: false, reason: 'A candidate row was not an object.' }
    // No policy narrowed this read, so the row's own site is the authority and
    // it has to look like one.
    if (typeof row.tenant_id !== 'string' || !UUID.test(row.tenant_id)) {
      return { ok: false, reason: 'A candidate row carried no usable site.' }
    }
    if (typeof row.id !== 'string' || !UUID.test(row.id)) {
      return { ok: false, reason: 'A candidate row carried no usable id.' }
    }
    const paths = assetFiles(row)
    if (!paths) return { ok: false, reason: `Asset ${row.id} is not the shape this reads.` }
    assets.push({
      id: row.id,
      tenantId: row.tenant_id,
      keyBase: typeof row.key_base === 'string' ? row.key_base : '',
      paths,
      unreferencedSince: typeof row.unreferenced_since === 'string' ? row.unreferenced_since : null,
    })
  }
  return { ok: true, assets }
}

// ── The decision ───────────────────────────────────────────────────────────

/**
 * What one examination concluded.
 *
 *   referenced      something names a file of this asset — clear any clock
 *   unprovable      a path is not provably this site's — never purge, no clock
 *   incomplete      the evidence could not be read whole — conclude nothing
 *   unreferenced    nothing names it; start or keep the clock, purge when due
 */
export type SweepFinding =
  | { state: 'referenced'; referencedBy: string[] }
  | { state: 'unprovable'; path: string }
  | { state: 'incomplete'; incomplete: Array<{ source: SourceName; reason: IncompleteReason }> }
  | { state: 'unreferenced' }

/** The one complete read of a source, or why there is not exactly one. */
function only(evidence: SweepEvidence, name: SourceName): { ok: true; rows: Row[] } | { ok: false; reason: IncompleteReason } {
  const reads = evidence.sources.filter((s) => s.source === name)
  if (reads.length === 0) return { ok: false, reason: 'absent' }
  if (reads.length > 1) return { ok: false, reason: 'duplicate_source' }
  const read = reads[0]!
  return read.complete ? { ok: true, rows: read.rows } : { ok: false, reason: read.reason }
}

/**
 * PURE, AND THE WHOLE OF WHAT PERMITS A DELETE.
 *
 * Deliberately not `assess()` from `deletion.ts`: that function requires
 * exactly the seven canonical sources, reports the history ones as
 * `unexpected_source`, and its verdict is contractually `cleanup: 'blocked'`.
 * This is a different question with a stricter answer, so it is a different
 * function — rather than the reviewed one widened until it says yes.
 */
export function examine(evidence: SweepEvidence, asset: SweepAsset): SweepFinding {
  // Reading one site's evidence and deleting another's files is the worst
  // thing this file could do, so it is the first thing refused. Reported as
  // incomplete because that is what it is: no evidence about this asset.
  if (evidence.tenantId !== asset.tenantId) {
    return { state: 'incomplete', incomplete: [{ source: 'photos', reason: 'foreign_row' }] }
  }

  const incomplete: Array<{ source: SourceName; reason: IncompleteReason }> = []
  for (const name of SWEEP_SOURCES) {
    const read = only(evidence, name)
    if (!read.ok) incomplete.push({ source: name, reason: read.reason })
  }
  for (const s of evidence.sources) {
    if (!SWEEP_SOURCES.includes(s.source)) incomplete.push({ source: s.source, reason: 'unexpected_source' })
  }
  if (incomplete.length > 0) return { state: 'incomplete', incomplete }

  // Every key has to be provably this site's. A legacy or foreign path is one
  // another site may also name, and this read cannot see that site — so it is
  // refused rather than deleted on evidence that could not have found the
  // reference. An asset with no files at all passes here.
  for (const path of asset.paths) {
    if (!ownsKey(asset.tenantId, path)) return { state: 'unprovable', path }
  }

  const referencedBy: string[] = []
  for (const s of evidence.sources) {
    if (!s.complete) continue
    for (const row of s.rows) {
      const leaves = stringLeaves(row)
      if (asset.paths.some((path) => leaves.some((leaf) => namesFile(leaf, path)))) {
        referencedBy.push(`${s.source}:${String(row.id ?? row.tenant_id)}`)
      }
    }
  }
  if (referencedBy.length > 0) return { state: 'referenced', referencedBy }

  return { state: 'unreferenced' }
}

/** Has this asset been continuously unreferenced for long enough to purge? */
export function graceElapsed(unreferencedSince: string | null, now: Date, graceDays = GRACE_DAYS): boolean {
  if (!unreferencedSince) return false
  const started = Date.parse(unreferencedSince)
  if (Number.isNaN(started)) return false
  return now.getTime() - started >= graceDays * 24 * 60 * 60 * 1000
}

/**
 * How many usage rows still point at this asset. A VETO, never a permission:
 * `photo_usages` is a projection a failed sync can leave stale, so a zero adds
 * nothing to the canonical evidence above — but a non-zero is a reason to
 * stop. Null means the question could not be answered, which is also a stop.
 */
export async function usageCount(db: SweepDb, tenantId: string, assetId: string): Promise<number | null> {
  try {
    const { count, error } = await db
      .from('photo_usages')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('asset_id', assetId)
    if (error || typeof count !== 'number') return null
    return count
  } catch {
    // Unanswerable is a stop, and a thrown read is unanswerable.
    return null
  }
}

// ── The run ────────────────────────────────────────────────────────────────

export type SweepOutcome =
  | 'purge_deferred'
  | 'clock_started'
  | 'clock_cleared'
  | 'waiting_out_grace'
  | 'kept_referenced'
  | 'kept_unprovable'
  | 'kept_evidence_incomplete'
  | 'kept_usages_present'
  | 'kept_usage_check_failed'

export type SweepReport = {
  /** Always 'disabled'. Here so every log line and response says it. */
  physicalDeletion: typeof PHYSICAL_DELETION
  examined: number
  /**
   * Assets the withdrawn rule would have purged on this run. NOTHING was
   * deleted and no purge marker was written for them. Under concurrency the
   * observation can already be out of date by the time it is reported. That
   * is harmless while nothing acts on it, and it is why nothing may.
   */
  deferred: number
  /**
   * The file paths those assets record. None was deleted by this run; that is
   * all this number says. The sweeper reads no storage, so whether each file
   * is actually present in the bucket is not observed here.
   */
  deferredFiles: number
  clocksStarted: number
  clocksCleared: number
  /** True when it stopped because it ran out of time rather than work. */
  outOfTime: boolean
  outcomes: Partial<Record<SweepOutcome, number>>
  /**
   * FAILURES OF THE RUN ITSELF, not of an asset: the candidate read, a site's
   * evidence read, a batched bookkeeping write.
   *
   * Separate from `outcomes` because those are per-examined-asset and must keep
   * summing to `examined` — and separate from `notes` because a caller has to
   * be able to ASK whether anything went wrong without parsing prose. The CLI
   * exited 0 on a total candidate-read failure for exactly that reason: the
   * only record of it was a note.
   */
  runErrors: string[]
  /** For the log. Never shown to a photographer. */
  notes: { assetId: string; outcome: SweepOutcome; detail?: string }[]
}

export type SweepOptions = {
  now?: Date
  graceDays?: number
  maxAssets?: number
  budgetMs?: number
  /** Decide and report, write nothing at all. The CLI's --dry-run. */
  dryRun?: boolean
}

/**
 * ONE PASS of observation over the least recently examined assets.
 *
 * There is no storage parameter. That is the boundary, not a convenience: a
 * caller has no way to hand this function the bucket.
 *
 * Without `dryRun`, the only writes are the sweeper's own bookkeeping columns,
 * batched by outcome. With it, nothing is written.
 */
export async function sweep(db: SweepDb, options: SweepOptions = {}): Promise<SweepReport> {
  const {
    now = new Date(),
    graceDays = GRACE_DAYS,
    maxAssets = SWEEP_ASSETS,
    budgetMs = SWEEP_BUDGET_MS,
    dryRun = false,
  } = options

  const deadline = Date.now() + budgetMs
  const report: SweepReport = {
    physicalDeletion: PHYSICAL_DELETION,
    examined: 0,
    deferred: 0,
    deferredFiles: 0,
    clocksStarted: 0,
    clocksCleared: 0,
    outOfTime: false,
    outcomes: {},
    runErrors: [],
    notes: [],
  }

  const record = (assetId: string, outcome: SweepOutcome, detail?: string) => {
    report.outcomes[outcome] = (report.outcomes[outcome] ?? 0) + 1
    if (outcome !== 'clock_started' && outcome !== 'clock_cleared') {
      report.notes.push({ assetId, outcome, detail })
    }
  }

  const found = await candidateAssets(db, { limit: maxAssets })
  if (!found.ok) {
    // Nothing was examined, so this is not an outcome — it is the run failing.
    report.runErrors.push(`the candidate read failed: ${found.reason}`)
    return report
  }

  const bySite = new Map<string, SweepAsset[]>()
  for (const asset of found.assets) {
    const list = bySite.get(asset.tenantId) ?? []
    list.push(asset)
    bySite.set(asset.tenantId, list)
  }

  const stamp = now.toISOString()

  for (const [tenantId, assets] of bySite) {
    if (Date.now() >= deadline) {
      report.outOfTime = true
      break
    }

    /*
     * `readSource` catches its own rejections and reports the source as
     * incomplete, so this cannot normally throw — wrapped anyway, because
     * a run that aborts here would skip every remaining site.
     */
    let evidence: SweepEvidence
    try {
      evidence = await readSweepEvidence(db, tenantId)
    } catch (e) {
      report.runErrors.push(
        `${tenantId}: the evidence read failed: ${e instanceof Error ? e.message : 'no message'}`
      )
      continue
    }

    // Grouped writes for the three cases that only change timestamps.
    const checkedOnly: string[] = []
    const startClock: string[] = []
    const clearClock: string[] = []

    for (const asset of assets) {
      if (Date.now() >= deadline) {
        report.outOfTime = true
        break
      }
      report.examined += 1

      const finding = examine(evidence, asset)

      if (finding.state === 'incomplete') {
        // Conclude nothing. An existing clock is neither started nor cleared.
        checkedOnly.push(asset.id)
        record(asset.id, 'kept_evidence_incomplete', finding.incomplete.map((i) => `${i.source}:${i.reason}`).join(', '))
        continue
      }

      if (finding.state === 'unprovable') {
        checkedOnly.push(asset.id)
        record(asset.id, 'kept_unprovable', finding.path)
        continue
      }

      if (finding.state === 'referenced') {
        // Back in use, or never out of it. Any clock stops.
        //
        // ONE OUTCOME PER ASSET, deliberately: an earlier version recorded
        // both `clock_cleared` and `kept_referenced` here, which made the
        // outcome counts stop summing to `examined` and quietly turned the
        // report into something you could not add up.
        const why = finding.referencedBy.slice(0, 5).join(', ')
        if (asset.unreferencedSince) {
          clearClock.push(asset.id)
          record(asset.id, 'clock_cleared', why)
        } else {
          checkedOnly.push(asset.id)
          record(asset.id, 'kept_referenced', why)
        }
        continue
      }

      // Unreferenced. First sighting starts the clock.
      if (!asset.unreferencedSince) {
        startClock.push(asset.id)
        record(asset.id, 'clock_started')
        continue
      }

      if (!graceElapsed(asset.unreferencedSince, now, graceDays)) {
        checkedOnly.push(asset.id)
        record(asset.id, 'waiting_out_grace', asset.unreferencedSince)
        continue
      }

      // Due under the withdrawn rule. The usage veto is still read so the
      // report separates "would have purged" from "the projection objects".
      const usages = await usageCount(db, tenantId, asset.id)
      if (usages === null) {
        checkedOnly.push(asset.id)
        record(asset.id, 'kept_usage_check_failed')
        continue
      }
      if (usages > 0) {
        checkedOnly.push(asset.id)
        record(asset.id, 'kept_usages_present', `${usages} usage row(s)`)
        continue
      }

      /*
       * DEFERRED. Before Work's review the files were deleted here and then
       * marked with `swept_at` and `deleted_at`. Now only the count changes.
       * The clock is LEFT RUNNING: not cleared, not marked. A later reviewed
       * protocol therefore sees the same observation and makes its own
       * decision. (When a purge does exist again, `deleted_at` belongs at
       * purge time and nowhere else. The deployed reader and picker treat it
       * as "unavailable". See the history above.)
       */
      checkedOnly.push(asset.id)
      report.deferred += 1
      report.deferredFiles += asset.paths.length
      record(asset.id, 'purge_deferred', `${asset.paths.length} recorded file(s) not deleted; physical deletion is disabled`)
    }

    if (dryRun) continue

    /*
     * THE ONLY WRITE PATH IN THIS MODULE. It refuses any column outside
     * BOOKKEEPING_COLUMNS before it calls the database. That makes a
     * `swept_at` or `deleted_at` slipped into a patch a run error, not a
     * write.
     *
     * Each write is wrapped in its own async function rather than pushed as a
     * builder. A PostgREST builder is a THENABLE, not a Promise — pushing one
     * into an `Array<Promise<…>>` is TS2345, which is what Codex's typecheck
     * caught — and awaiting it in here also gives each write its own catch, so
     * `Promise.all` cannot reject and one failed group cannot lose the others.
     */
    const write = (patch: Record<string, unknown>, ids: string[]) =>
      (async (): Promise<{ error: { message: string } | null }> => {
        const stray = Object.keys(patch).filter((k) => !BOOKKEEPING_COLUMNS.includes(k))
        if (stray.length > 0) {
          return { error: { message: `refused to write non-bookkeeping column(s): ${stray.join(', ')}` } }
        }
        try {
          const { error } = await db
            .from('photo_assets')
            .update(patch)
            .eq('tenant_id', tenantId)
            .in('id', ids)
          return { error: error ? { message: error.message } : null }
        } catch (e) {
          return { error: { message: e instanceof Error ? e.message : 'a bookkeeping write failed' } }
        }
      })()

    /*
     * ── THE COUNTERS ARE EFFECTS, AND THE OUTCOMES ARE DECISIONS ────────────
     *
     * `outcomes.clock_started` says what the examination CONCLUDED, so it is
     * recorded above and keeps summing to `examined`. `report.clocksStarted`
     * says what actually CHANGED, so it is counted here — only for a group
     * whose write landed.
     *
     * The first version incremented both in the loop, which meant a failed
     * bookkeeping write reported clocks that were never started: the run told
     * you it had done something it had not. Same class as the double-count
     * that broke the outcome sums, and in a dry run it is the same question —
     * nothing is written, so nothing was started, while the outcomes still
     * show what WOULD have been.
     */
    const groups: Array<{ of: 'checked' | 'start' | 'clear'; ids: string[]; patch: Record<string, unknown> }> = []
    if (checkedOnly.length > 0) groups.push({ of: 'checked', ids: checkedOnly, patch: { sweep_checked_at: stamp } })
    if (startClock.length > 0) {
      groups.push({ of: 'start', ids: startClock, patch: { unreferenced_since: stamp, sweep_checked_at: stamp } })
    }
    if (clearClock.length > 0) {
      groups.push({ of: 'clear', ids: clearClock, patch: { unreferenced_since: null, sweep_checked_at: stamp } })
    }

    const settled = await Promise.all(
      groups.map((group) => write(group.patch, group.ids).then((answer) => ({ group, answer })))
    )

    for (const { group, answer } of settled) {
      if (answer.error) {
        // The examination stands; only the bookkeeping failed. Those assets
        // keep their old `sweep_checked_at`, so the next run looks at them
        // first — which is the safe direction for this to fail in.
        report.runErrors.push(
          `${tenantId}: a bookkeeping write failed for ${group.ids.length} ${group.of} asset(s): ${answer.error.message}`
        )
        continue
      }
      if (group.of === 'start') report.clocksStarted += group.ids.length
      if (group.of === 'clear') report.clocksCleared += group.ids.length
    }
  }

  return report
}
