import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobKind } from '@/lib/jobs/types'

/**
 * PUTTING WORK IN THE QUEUE
 * ═════════════════════════
 *
 * Deliberately small. Everything difficult — claiming, leases, retries,
 * bounded attempts — is in the database, where it can be right for every
 * caller at once rather than right in whichever file remembered to do it.
 *
 * ── NOTHING HERE WRITES TO `jobs` DIRECTLY ──────────────────────────────────
 *
 * The table grants no INSERT to anybody. `enqueue_jobs` is the door, and it
 * names four columns — tenant, kind, payload, dedupe key — leaving the other
 * eleven to their defaults, so no caller of this function can enqueue a job
 * that is already `running`, already out of attempts, holding a lease, or due
 * in a decade. The long version is at the top of
 * `db/migrations/2026-09-29_jobs.sql`.
 *
 * The first draft of this file did a plain `.from('jobs').upsert(…)` with
 * `grant insert to authenticated` behind it. Row-level security would have
 * kept those rows on the right SITE, and that is all it would have kept: a
 * policy decides which rows a caller may touch, not what they may put in them.
 * A signed-in account could have posted straight to PostgREST and written a
 * job on its own site with `max_attempts` at a million.
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
}

/**
 * ADDS WORK FOR ONE SITE.
 *
 * `tenantId` is a parameter rather than something this reads for itself: every
 * caller already knows whose work it is, from a session, and a queue that
 * guessed would be a queue that could guess wrong. The column has no default
 * for the same reason (`2026-09-24_no_guessing_tenant.sql`).
 *
 * Called with the SIGNED-IN photographer's client, not the service role. The
 * check inside `enqueue_jobs` — the same rule the table's policy states — is
 * then what proves they may only queue work onto a site they are entitled to,
 * and it is the database that proves it rather than this function or its
 * caller. A platform admin working on somebody else's address passes it by the
 * `is_platform_admin()` branch, which is why the tenant is passed in rather
 * than derived: for them `current_tenant_id()` is their OWN site, not the one
 * on screen.
 *
 * Returns how many rows were actually written. A duplicate is not an error: it
 * means the work is already waiting, which is the outcome the caller wanted.
 *
 * Every item must be the same `kind` — one call, one kind, because the kind is
 * the thing the database allow-lists and a mixed batch would make the
 * allow-list a per-row question.
 */
export async function enqueue(
  db: SupabaseClient,
  tenantId: string,
  items: EnqueueItem[]
): Promise<{ queued: number; duplicates: number; error: string | null }> {
  if (items.length === 0) return { queued: 0, duplicates: 0, error: null }

  const kind = items[0]!.kind
  if (items.some((item) => item.kind !== kind)) {
    return { queued: 0, duplicates: 0, error: 'One call, one kind of job.' }
  }

  const { data, error } = await db.rpc('enqueue_jobs', {
    p_tenant: tenantId,
    p_kind: kind,
    p_items: items.map((item) => ({
      payload: item.payload ?? {},
      dedupe_key: item.dedupeKey ?? null,
    })),
  })

  if (error) return { queued: 0, duplicates: 0, error: error.message }

  const queued = typeof data === 'number' ? data : 0
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
 *
 * Read with the photographer's own client — `select` is the one privilege
 * `authenticated` has on this table — so the site is narrowed by the table's
 * policy and not only by the `.eq()` below. Two gates over the same question,
 * and the inner one cannot be forgotten.
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
