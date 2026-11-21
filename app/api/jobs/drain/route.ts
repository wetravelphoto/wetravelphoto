import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { drain } from '@/lib/jobs/run'
import { r2Storage } from '@/lib/photos/storage'
import { SWEEP_BUDGET_MS, sweep } from '@/lib/photos/sweep'

/**
 * Scheduled job: runs whatever is waiting in the queue, for every site.
 *
 * FAILS CLOSED, exactly as `/api/instagram/refresh` does and for the reason
 * that endpoint's own comment records: it used to skip the check entirely when
 * CRON_SECRET was unset, which made it a public endpoint. An unset secret here
 * would be worse — this one does work on every site on the platform.
 *
 * It runs with the service-role client because there is no signed-in user. The
 * tenant is never guessed: every job carries its own, and every handler is
 * given that tenant rather than reading one.
 *
 * ── The schedule, and the plan it is on ─────────────────────────────────────
 *
 * `vercel.json` schedules this DAILY, because a Hobby account rejects anything
 * more frequent at deploy time — a cron expression that would run more than
 * once a day fails the deployment outright. Daily is a safety net rather than
 * a scheduler: the work photographers actually wait for is started by them, in
 * the admin, which drains their own site on the spot. On Pro this becomes
 * `*​/5 * * * *` — one string in vercel.json — and the safety net becomes the
 * scheduler.
 *
 * ── AND IT SWEEPS (P6) ──────────────────────────────────────────────────────
 *
 * After the queue, this runs the photo sweeper: the only thing on the platform
 * that deletes a stored file. It is NOT a job kind, deliberately — `jobs`
 * grants INSERT to nobody, `enqueue_jobs` is the only door and allow-lists one
 * kind, and widening that door would cost a migration and hand a browser the
 * ability to queue sweeps. See `lib/photos/sweep.ts` and
 * .ai-handoff/p6-sweeper-design-claude.md.
 *
 * Daily is the right cadence for a thirty-day grace period, so unlike the
 * queue this is not waiting for Pro. A sweep that runs out of budget simply
 * continues tomorrow; there is no partial state.
 */
export const dynamic = 'force-dynamic'

/*
 * Five minutes is the platform maximum on every plan. The drain's own budget
 * is well under it (see `drain`), so this is the outer fence rather than the
 * thing that stops it: a worker killed by the platform is the case the lease
 * has to recover from, and it should never be reached.
 */
export const maxDuration = 300

/*
 * A sweep's `runErrors` are failures of the RUN — the candidate read, a site's
 * evidence read, a batched bookkeeping write — and they increment none of the
 * per-asset counters. Left out of the log and the response, a sweep that did
 * nothing at all reads "examined 0", exactly the shape the CLI once reported
 * as success. The total is always given; the detail is bounded, in count and
 * in length, because a message comes from a database or a network error and
 * its size is not ours to choose.
 */
const RUN_ERRORS_SHOWN = 10
const RUN_ERROR_CHARS = 300

function runErrorSummary(errors: string[]) {
  return {
    total: errors.length,
    detail: errors
      .slice(0, RUN_ERRORS_SHOWN)
      .map((e) => (e.length > RUN_ERROR_CHARS ? `${e.slice(0, RUN_ERROR_CHARS)}…` : e)),
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let db
  try {
    db = createAdminClient()
  } catch {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment.' },
      { status: 500 }
    )
  }

  /*
   * Comfortably inside maxDuration, with room for the sweep and the response.
   * This was 240s before the sweeper; the queue keeps first claim on the
   * budget because a photographer may be waiting on a job, while nothing is
   * waiting on a sweep.
   */
  const started = Date.now()
  const report = await drain(db, { budgetMs: 200_000 })

  if (report.errors.length > 0) {
    console.error('[jobs] drain finished with errors', report.errors)
  }

  /*
   * Whatever is left of the function's own window, minus a margin for the
   * response. If the queue used everything, the sweep is skipped rather than
   * started with no time to finish an asset — the next run picks it up.
   */
  const left = 285_000 - (Date.now() - started)
  const sweepBudget = Math.max(0, Math.min(SWEEP_BUDGET_MS, left))

  let swept = null
  let runErrors = null
  if (sweepBudget >= 5_000) {
    swept = await sweep(db, r2Storage, { budgetMs: sweepBudget })
    runErrors = runErrorSummary(swept.runErrors)
    if (runErrors.total > 0) {
      console.error('[p6] sweep run failed', runErrors)
    }
    if (swept.notes.length > 0) {
      console.error('[p6] sweep did not purge', swept.notes.slice(0, 20))
    }
    /*
     * `examined` is also the answer to whether this cron ran at all: every
     * examined asset gets a `sweep_checked_at`, so
     * `select count(*) from photo_assets where sweep_checked_at is not null`
     * settles natural cron execution without a monitor or a job invocation.
     */
    console.log('[p6] sweep', {
      examined: swept.examined,
      purged: swept.purged,
      filesDeleted: swept.filesDeleted,
      clocksStarted: swept.clocksStarted,
      clocksCleared: swept.clocksCleared,
      outOfTime: swept.outOfTime,
      outcomes: swept.outcomes,
      runErrors: runErrors.total,
    })
  }

  return NextResponse.json({
    claimed: report.claimed,
    done: report.done,
    failed: report.failed,
    outOfTime: report.outOfTime,
    sweep: swept
      ? {
          examined: swept.examined,
          purged: swept.purged,
          filesDeleted: swept.filesDeleted,
          clocksStarted: swept.clocksStarted,
          clocksCleared: swept.clocksCleared,
          outOfTime: swept.outOfTime,
          outcomes: swept.outcomes,
          runErrors,
        }
      : { skipped: 'no budget left after the queue' },
  })
}
