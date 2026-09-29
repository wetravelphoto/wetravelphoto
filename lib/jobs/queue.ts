import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobKind } from '@/lib/jobs/types'

/**
 * PUTTING WORK IN THE QUEUE
 * ═════════════════════════
 *
 * Deliberately small. Everything difficult — claiming, leases, retries,
 * bounded attempts — is in the database, where it can be right for every
 * caller at once rather than right in whichever file remembered to do it.
 */

export type EnqueueItem = {
  kind: JobKind
  payload?: Record<string, unknown>
  /**
   * The same key twice, while the first is still queued or running, is ONE
   * job. Leave it out for work that genuinely should happen once per request.
   * See the note on `dedupe_key` in the migration.
   */
  dedupeKey?: string | null
  /** Not before this. For work that should wait. */
  runAfter?: Date
  maxAttempts?: number
}

/**
 * ADDS WORK FOR ONE SITE.
 *
 * `tenantId` is a parameter rather than something this reads for itself: every
 * caller already knows whose work it is, from a session or from a job it is
 * running, and a queue that guessed would be a queue that could guess wrong.
 * The column has no default for the same reason
 * (`2026-09-24_no_guessing_tenant.sql`).
 *
 * Called with the SIGNED-IN photographer's client wherever there is one, so
 * the row-level security policy is the thing that proves they may only queue
 * work onto their own site — not this function, and not the caller.
 *
 * Returns how many rows were actually written. A duplicate is not an error: it
 * means the work is already waiting, which is the outcome the caller wanted.
 */
export async function enqueue(
  db: SupabaseClient,
  tenantId: string,
  items: EnqueueItem[]
): Promise<{ queued: number; duplicates: number; error: string | null }> {
  if (items.length === 0) return { queued: 0, duplicates: 0, error: null }

  /*
   * `ignoreDuplicates` turns the partial unique index from an error into a
   * no-op. Without it, queueing eighty photographs when one is already waiting
   * would fail the whole insert and queue none of them — which is how "press
   * the button twice" would become "press the button twice and nothing happens
   * at all".
   *
   * NO `onConflict` TARGET, and that is not an oversight. Naming the columns
   * produces `on conflict (tenant_id, kind, dedupe_key) do nothing`, and
   * Postgres refuses that against a PARTIAL unique index unless the statement
   * repeats the index's own `where` clause — which PostgREST gives no way to
   * send. Measured against the real index rather than reasoned about: the
   * targeted form fails with "there is no unique or exclusion constraint
   * matching the ON CONFLICT specification", and the untargeted form inserts
   * every row that is not a duplicate and skips the ones that are.
   *
   * The rows are built inline rather than in a variable above so that the
   * tenant is visible IN the statement: scripts/check-tenant-scoping.mjs reads
   * the text around a `.from(...)`, and a payload assembled a dozen lines
   * earlier is a payload it cannot see.
   */
  const { data, error } = await db
    .from('jobs')
    .upsert(
      items.map((item) => ({
        tenant_id: tenantId,
        kind: item.kind,
        payload: item.payload ?? {},
        dedupe_key: item.dedupeKey ?? null,
        ...(item.runAfter ? { run_after: item.runAfter.toISOString() } : {}),
        ...(item.maxAttempts ? { max_attempts: item.maxAttempts } : {}),
      })),
      { ignoreDuplicates: true }
    )
    .select('id')

  if (error) return { queued: 0, duplicates: 0, error: error.message }

  const queued = data?.length ?? 0
  return { queued, duplicates: items.length - queued, error: null }
}

export type QueueCounts = {
  queued: number
  running: number
  failed: number
}

/**
 * WHAT IS WAITING, AND WHAT GAVE UP.
 *
 * `failed` is the one worth showing a photographer: a job that has used every
 * attempt is finished and nothing will pick it up again, so if nothing says so
 * on a screen it is invisible for ever. That is the failure mode the old
 * browser loop had, and the reason this is here in the first phase rather than
 * a later one.
 */
export async function queueCounts(
  db: SupabaseClient,
  tenantId: string,
  kind?: JobKind
): Promise<QueueCounts> {
  let query = db
    .from('jobs')
    .select('status')
    .eq('tenant_id', tenantId)
    .in('status', ['queued', 'running', 'failed'])

  if (kind) query = query.eq('kind', kind)

  const { data } = await query

  const counts: QueueCounts = { queued: 0, running: 0, failed: 0 }
  for (const row of data ?? []) {
    const status = row.status as keyof QueueCounts
    if (status in counts) counts[status] += 1
  }
  return counts
}
