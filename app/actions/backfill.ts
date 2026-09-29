'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enqueue, queueCounts, type QueueCounts } from '@/lib/jobs/queue'
import { drain } from '@/lib/jobs/run'
import { revalidatePath } from 'next/cache'

/**
 * DISPLAY SIZES FOR PHOTOGRAPHS UPLOADED BEFORE THE LADDER EXISTED
 * ═══════════════════════════════════════════════════════════════
 *
 * This used to be a `do…while` loop IN THE BROWSER calling a server action ten
 * photographs at a time. Four things were wrong with that and none of them was
 * visible while it worked:
 *
 *   · closing the tab stopped it, and nothing remembered where it had got to;
 *   · a photograph that failed was skipped by a bare `catch {}` and never
 *     tried again;
 *   · a photograph that failed EVERY time was invisible — it was simply always
 *     in the "still to go" count, with nothing anywhere saying why;
 *   · and the whole thing ran inside a request, so a slow batch was a timeout.
 *
 * The work is now rows in `jobs`, one per photograph. Queueing is idempotent,
 * each photograph is retried on its own with backoff, five attempts is the
 * end, and the end is a row a query can find. What this action does is queue
 * the work and then spend one request's worth of time on it — and the nightly
 * cron finishes whatever is left, whether or not anybody is watching.
 */

export type BackfillResult = {
  ok: boolean
  message: string
  /** Photographs still without their sizes, after this run. */
  remaining: number
  queue: QueueCounts
}

/** Photographs in this site that have no derivatives yet. */
async function unprocessed(
  db: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  limit?: number
) {
  let query = db
    .from('photos')
    .select('id')
    .eq('tenant_id', tenantId)
    .or('derivatives.is.null,derivatives.eq.{}')

  if (limit) query = query.limit(limit)

  return query
}

/**
 * Queues every unprocessed photograph, then works on them for about half a
 * minute.
 *
 * Returns rather than throws on a failure, because the panel shows the message
 * and a thrown server action reaches the photographer as a redacted React
 * error and nothing else.
 */
export async function backfillDerivatives(): Promise<BackfillResult> {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const db = await createClient()

  const empty: QueueCounts = { queued: 0, running: 0, failed: 0 }

  const { data: photos, error } = await unprocessed(db, tenantId)
  if (error) return { ok: false, message: error.message, remaining: 0, queue: empty }

  /*
   * Queued through the PHOTOGRAPHER'S OWN client, not the service role.
   *
   * The policy on `jobs` is then what proves these rows land on their own
   * site — the database refuses a job for anybody else's tenant, whatever this
   * code does. Draining needs the service role (the queue's two functions are
   * granted to it alone), and that is one line further down where the tenant
   * is already fixed.
   */
  if (photos && photos.length > 0) {
    const { error: queueError } = await enqueue(
      db,
      tenantId,
      /*
       * Just the photographs. `enqueue_jobs` checks each id is really one of
       * this site's, builds the payload from what it validated, and derives
       * the dedupe key from the same id — so there is one waiting job per
       * photograph however many times this is pressed, and the key cannot
       * disagree with the work. Longer lists are split by `enqueue` into runs
       * the function will accept.
       */
      photos.map((photo) => ({
        kind: 'photo.derivatives' as const,
        payload: { photoId: photo.id as string },
      }))
    )
    if (queueError) {
      return { ok: false, message: queueError, remaining: photos.length, queue: empty }
    }
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return {
      ok: false,
      message:
        'The work is queued, but SUPABASE_SERVICE_ROLE_KEY is not set on this deployment, ' +
        'so nothing can run it.',
      remaining: photos?.length ?? 0,
      queue: await queueCounts(db, tenantId, 'photo.derivatives'),
    }
  }

  // Well inside the request's own limit, with room to read the counts and
  // render the answer afterwards.
  const report = await drain(admin, { tenantId, budgetMs: 30_000 })

  const { data: left } = await unprocessed(db, tenantId)
  const remaining = left?.length ?? 0
  const queue = await queueCounts(db, tenantId, 'photo.derivatives')

  revalidatePath('/admin/settings')

  const parts: string[] = []
  parts.push(report.done === 1 ? 'Processed one photograph.' : `Processed ${report.done}.`)
  if (remaining > 0) {
    parts.push(
      `${remaining} still to go` +
        (report.outOfTime ? ' — press it again to carry on, or leave it to run overnight.' : '.')
    )
  }
  if (queue.failed > 0) {
    parts.push(
      queue.failed === 1
        ? 'One photograph could not be processed after several tries.'
        : `${queue.failed} photographs could not be processed after several tries.`
    )
  }
  if (remaining === 0 && queue.failed === 0) parts.push('Everything is processed.')

  return { ok: true, message: parts.join(' '), remaining, queue }
}

export async function countUnprocessed(): Promise<number> {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const db = await createClient()

  const { count } = await db
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .or('derivatives.is.null,derivatives.eq.{}')

  return count ?? 0
}

/** What the queue looks like for this site, for the panel's own heading. */
export async function derivativeQueue(): Promise<QueueCounts> {
  const { tenantId } = await requireEditor()
  const db = await createClient()
  return queueCounts(db, tenantId, 'photo.derivatives')
}
