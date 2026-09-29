import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE QUEUE'S VOCABULARY
 * ══════════════════════
 *
 * The table and its two functions are in
 * `db/migrations/2026-09-29_jobs.sql`, and the long explanation of why the
 * queue works the way it does is at the top of that file. This is the shape
 * the application sees.
 */

/**
 * WHAT A JOB CAN BE.
 *
 * A closed list rather than a free string, so a typo is a build error on the
 * line that enqueues it rather than a row that sits in the queue failing
 * permanently with "no handler". The database column is `text` — it has to be,
 * because a deploy that removes a kind must not make rows already in the table
 * unreadable — so this is the front door's lock, not the back door's.
 */
export const JOB_KINDS = ['photo.derivatives'] as const

export type JobKind = (typeof JOB_KINDS)[number]

export type Job = {
  id: string
  tenant_id: string
  kind: string
  payload: Record<string, unknown>
  dedupe_key: string | null
  status: 'queued' | 'running' | 'done' | 'failed'
  attempts: number
  max_attempts: number
  run_after: string
  locked_at: string | null
  locked_by: string | null
  lease_until: string | null
  last_error: string | null
  created_at: string
  finished_at: string | null
}

/**
 * WHAT A HANDLER IS GIVEN.
 *
 * The tenant is passed separately from the payload even though it is on the
 * row, because it is the one value a handler must never take from the payload:
 * a payload is data somebody's browser caused to be written, and a tenant read
 * from it would be a tenant a caller could choose.
 */
export type JobContext = {
  db: SupabaseClient
  tenantId: string
  payload: Record<string, unknown>
  job: Job
}

/**
 * HANDLERS MUST BE IDEMPOTENT. Not "should" — the queue will run one twice.
 *
 * A worker killed after doing the work but before reporting it leaves a job
 * whose lease runs out and is claimed again, and there is no way to tell that
 * case apart from a worker killed before doing anything. So every handler has
 * to end in the same state whether it runs once or five times: check whether
 * the work is already done and return, or write the result in a way that
 * overwrites rather than accumulates.
 *
 * Throwing is how a handler reports failure. The message is kept on the row.
 * Throw `PermanentJobError` for something retrying cannot fix.
 */
export type JobHandler = (ctx: JobContext) => Promise<void>

/**
 * A failure that will not get better. Five attempts at a photograph that has
 * been deleted is five times the noise and none of the information.
 */
export class PermanentJobError extends Error {
  readonly permanent = true
  constructor(message: string) {
    super(message)
    this.name = 'PermanentJobError'
  }
}

export function isPermanent(error: unknown): boolean {
  return error instanceof PermanentJobError
}
