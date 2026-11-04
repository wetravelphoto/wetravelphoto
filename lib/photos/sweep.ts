import type { SupabaseClient } from '@supabase/supabase-js'
import { ownsKey } from '@/lib/storage-keys'
import { isSamplePhoto } from '@/lib/images'
import type { PhotoStorage } from '@/lib/photos/storage'
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
 * THE SWEEPER — the only thing on the platform that deletes a stored file
 * ═════════════════════════════════════════════════════════════════════════
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
 * So no removal action writes anything, `deleted_at` is never written by this
 * phase at all, and the sweeper keeps its own three columns
 * (`2026-11-03_photo_sweeper.sql`), which nothing already deployed reads:
 *
 *     unreferenced_since   when it first saw the asset referenced by nothing
 *     sweep_checked_at     when it last examined it
 *     swept_at             its files are gone
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
 * - Partial deletion is not atomic. A key the bucket refuses leaves the asset
 *   unmarked, so a later run retries every key — deleting an object that is
 *   already gone succeeds, which is what makes that safe.
 */

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
  | 'purged'
  | 'clock_started'
  | 'clock_cleared'
  | 'waiting_out_grace'
  | 'kept_referenced'
  | 'kept_unprovable'
  | 'kept_evidence_incomplete'
  | 'kept_usages_present'
  | 'kept_usage_check_failed'
  | 'kept_storage_failed'
  | 'kept_write_failed'

export type SweepReport = {
  examined: number
  purged: number
  filesDeleted: number
  clocksStarted: number
  clocksCleared: number
  /** True when it stopped because it ran out of time rather than work. */
  outOfTime: boolean
  outcomes: Partial<Record<SweepOutcome, number>>
  /** For the log. Never shown to a photographer. */
  notes: { assetId: string; outcome: SweepOutcome; detail?: string }[]
}

export type SweepOptions = {
  now?: Date
  graceDays?: number
  maxAssets?: number
  budgetMs?: number
  /** Decide and report, write nothing and delete nothing. The CLI's --dry-run. */
  dryRun?: boolean
}

/**
 * ONE PASS over the least recently examined assets.
 *
 * Writes are batched by outcome where they can be — most assets on a healthy
 * site are referenced, and that case is one evidence read plus one update for
 * the whole group rather than a round trip each. A purge is per asset, because
 * each one deletes its own files.
 */
export async function sweep(
  db: SweepDb,
  storage: PhotoStorage,
  options: SweepOptions = {}
): Promise<SweepReport> {
  const {
    now = new Date(),
    graceDays = GRACE_DAYS,
    maxAssets = SWEEP_ASSETS,
    budgetMs = SWEEP_BUDGET_MS,
    dryRun = false,
  } = options

  const deadline = Date.now() + budgetMs
  const report: SweepReport = {
    examined: 0,
    purged: 0,
    filesDeleted: 0,
    clocksStarted: 0,
    clocksCleared: 0,
    outOfTime: false,
    outcomes: {},
    notes: [],
  }

  const record = (assetId: string, outcome: SweepOutcome, detail?: string) => {
    report.outcomes[outcome] = (report.outcomes[outcome] ?? 0) + 1
    if (outcome !== 'purged' && outcome !== 'clock_started' && outcome !== 'clock_cleared') {
      report.notes.push({ assetId, outcome, detail })
    }
  }

  const found = await candidateAssets(db, { limit: maxAssets })
  if (!found.ok) {
    report.notes.push({ assetId: '-', outcome: 'kept_evidence_incomplete', detail: found.reason })
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
      report.notes.push({
        assetId: '-',
        outcome: 'kept_evidence_incomplete',
        detail: `${tenantId}: ${e instanceof Error ? e.message : 'the evidence read failed'}`,
      })
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
        // Conclude nothing. An existing clock is neither started nor cleared,
        // because a purge re-checks it from fresh evidence anyway.
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
          report.clocksCleared += 1
          record(asset.id, 'clock_cleared', why)
        } else {
          checkedOnly.push(asset.id)
          record(asset.id, 'kept_referenced', why)
        }
        continue
      }

      // Unreferenced. First sighting starts the clock and purges nothing.
      if (!asset.unreferencedSince) {
        startClock.push(asset.id)
        report.clocksStarted += 1
        record(asset.id, 'clock_started')
        continue
      }

      if (!graceElapsed(asset.unreferencedSince, now, graceDays)) {
        checkedOnly.push(asset.id)
        record(asset.id, 'waiting_out_grace', asset.unreferencedSince)
        continue
      }

      // Due. The veto is re-read now rather than trusted from the batch.
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

      if (dryRun) {
        report.purged += 1
        report.filesDeleted += asset.paths.length
        record(asset.id, 'purged', 'dry run')
        continue
      }

      const failed = asset.paths.length > 0 ? await storage.remove(asset.paths) : []
      if (failed.length > 0) {
        checkedOnly.push(asset.id)
        record(asset.id, 'kept_storage_failed', `${failed.length} of ${asset.paths.length} key(s)`)
        continue
      }

      let error: { message: string } | null = null
      try {
        const answer = await db
          .from('photo_assets')
          .update({ swept_at: stamp, sweep_checked_at: stamp })
          .eq('id', asset.id)
          .eq('tenant_id', tenantId)
        error = answer.error
      } catch (e) {
        error = { message: e instanceof Error ? e.message : 'the purge marker could not be written' }
      }

      if (error) {
        // The files are gone and the row does not say so. A later run deletes
        // keys that are already deleted, which succeeds, and marks again.
        record(asset.id, 'kept_write_failed', error.message)
        continue
      }

      report.purged += 1
      report.filesDeleted += asset.paths.length
      record(asset.id, 'purged')
    }

    if (dryRun) continue

    const writes: Array<Promise<{ error: { message: string } | null }>> = []
    if (checkedOnly.length > 0) {
      writes.push(
        db.from('photo_assets').update({ sweep_checked_at: stamp }).eq('tenant_id', tenantId).in('id', checkedOnly)
      )
    }
    if (startClock.length > 0) {
      writes.push(
        db
          .from('photo_assets')
          .update({ unreferenced_since: stamp, sweep_checked_at: stamp })
          .eq('tenant_id', tenantId)
          .in('id', startClock)
      )
    }
    if (clearClock.length > 0) {
      writes.push(
        db
          .from('photo_assets')
          .update({ unreferenced_since: null, sweep_checked_at: stamp })
          .eq('tenant_id', tenantId)
          .in('id', clearClock)
      )
    }

    let settled: Array<{ error: { message: string } | null }> = []
    try {
      settled = await Promise.all(writes)
    } catch (e) {
      settled = [{ error: { message: e instanceof Error ? e.message : 'a bookkeeping write failed' } }]
    }

    for (const done of settled) {
      if (done.error) {
        // The examination stands; only the bookkeeping failed. Those assets
        // keep their old `sweep_checked_at`, so the next run looks at them
        // first — which is the safe direction for this to fail in.
        report.notes.push({ assetId: '-', outcome: 'kept_write_failed', detail: done.error.message })
      }
    }
  }

  return report
}
