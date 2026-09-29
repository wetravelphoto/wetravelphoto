import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { handlerFor } from '@/lib/jobs/handlers'
import { isPermanent, type Job, type JobHandler } from '@/lib/jobs/types'

/**
 * THE WORKER
 * ══════════
 *
 * Takes one job, runs it, reports the result, repeats until it runs out of
 * time or work. Everything that makes that safe is in the database — see the
 * four numbered notes at the top of `db/migrations/2026-09-29_jobs.sql`. This
 * file is the part that has to be careful about TIME.
 *
 * ── Why one job at a time ───────────────────────────────────────────────────
 *
 * `claim_jobs` will hand over a batch, and one day something cheap will want
 * that. This asks for one. A batch means jobs that were claimed — attempt
 * counted, lease taken — and then never started because the budget ran out
 * between them, and each of those sits `running` until its lease expires while
 * nothing is running it. Claiming one at a time costs a round trip against
 * work measured in seconds and makes that state impossible.
 *
 * ── Why the budget is smaller than the platform's own limit ─────────────────
 *
 * A worker killed by the platform is exactly the case the lease exists to
 * recover from, and recovery costs the lease's length in wasted waiting. So
 * this stops itself first: it will not START a job it has not got time to
 * finish, and returns a report instead. The lease is longer than the whole
 * function could ever run (ten minutes against a 300-second ceiling), so a
 * worker that is merely slow is never overtaken by a second one.
 */

/** Ten minutes — comfortably longer than any Vercel function may run. */
const LEASE = '10 minutes'

export type DrainReport = {
  worker: string
  claimed: number
  done: number
  failed: number
  /** True when it stopped because it ran out of time rather than work. */
  outOfTime: boolean
  /** What went wrong, for the log. Not shown to a photographer. */
  errors: { id: string; kind: string; message: string }[]
}

export type DrainOptions = {
  /**
   * One site, or every site. The cron passes nothing; a photographer pressing
   * a button passes their own tenant, taken from their session and never from
   * anything they sent.
   */
  tenantId?: string
  /** How long this invocation may spend. Kept well under `maxDuration`. */
  budgetMs?: number
  /** A ceiling on how many jobs one invocation will take, whatever the clock says. */
  maxJobs?: number
  /**
   * WHICH FUNCTION RUNS WHICH KIND. Defaults to the real registry.
   *
   * A seam, and the only one: `.mk/jobs.ts` drives this loop against a real
   * Postgres with handlers that succeed, throw, or throw permanently on
   * demand, which is the only way to watch a retry actually happen. The
   * alternative was a fake database, and a fake that supplies what the real
   * one does is how a green suite comes to mean nothing — the claim, the
   * lease, the backoff and the attempt count are the whole of what is being
   * tested and all four live in SQL.
   */
  resolve?: (kind: string) => JobHandler | null
}

export async function drain(
  db: SupabaseClient,
  { tenantId, budgetMs = 45_000, maxJobs = 100, resolve = handlerFor }: DrainOptions = {}
): Promise<DrainReport> {
  /*
   * A fresh name every invocation. It is what `finish_job` matches on, so it
   * has to be unique across every instance that might be running right now —
   * which rules out anything derived from the deployment, the region or the
   * process, since Vercel will happily run two of those at once.
   */
  const worker = randomUUID()
  const deadline = Date.now() + budgetMs

  const report: DrainReport = {
    worker,
    claimed: 0,
    done: 0,
    failed: 0,
    outOfTime: false,
    errors: [],
  }

  while (report.claimed < maxJobs) {
    if (Date.now() >= deadline) {
      report.outOfTime = true
      break
    }

    const { data, error } = await db.rpc('claim_jobs', {
      p_worker: worker,
      p_limit: 1,
      p_lease: LEASE,
      p_tenant: tenantId ?? null,
    })

    if (error) {
      report.errors.push({ id: '-', kind: 'claim', message: error.message })
      break
    }

    const job = (data as Job[] | null)?.[0]
    if (!job) break // nothing waiting

    report.claimed += 1

    const handler = resolve(job.kind)

    if (!handler) {
      await finish(db, job, worker, `No handler for "${job.kind}".`, true, report)
      continue
    }

    try {
      await handler({ db, tenantId: job.tenant_id, payload: job.payload ?? {}, job })
      await finish(db, job, worker, null, false, report)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'It failed with no message.'
      await finish(db, job, worker, message, isPermanent(e), report)
    }
  }

  return report
}

async function finish(
  db: SupabaseClient,
  job: Job,
  worker: string,
  error: string | null,
  permanent: boolean,
  report: DrainReport
) {
  const { data, error: rpcError } = await db.rpc('finish_job', {
    p_id: job.id,
    p_worker: worker,
    p_error: error,
    p_permanent: permanent,
  })

  if (rpcError) {
    report.errors.push({ id: job.id, kind: job.kind, message: rpcError.message })
    return
  }

  /*
   * NULL MEANS SOMEBODY ELSE HAS IT NOW.
   *
   * This worker stalled long enough for its lease to run out, another drain
   * reclaimed the job, and the database has refused to let this one write over
   * the new holder's result. Worth a line in the log rather than a silent
   * shrug: it is the one symptom of a lease that is too short for the work.
   */
  const row = data as Job | null
  if (!row) {
    report.errors.push({
      id: job.id,
      kind: job.kind,
      message: 'The lease had already been taken by another worker; the result was dropped.',
    })
    return
  }

  if (error) {
    report.errors.push({ id: job.id, kind: job.kind, message: error })
    if (row.status === 'failed') report.failed += 1
  } else {
    report.done += 1
  }
}
