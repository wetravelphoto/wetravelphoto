import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { drain } from '@/lib/jobs/run'

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
 */
export const dynamic = 'force-dynamic'

/*
 * Five minutes is the platform maximum on every plan. The drain's own budget
 * is well under it (see `drain`), so this is the outer fence rather than the
 * thing that stops it: a worker killed by the platform is the case the lease
 * has to recover from, and it should never be reached.
 */
export const maxDuration = 300

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

  // Comfortably inside maxDuration, with room for the response.
  const report = await drain(db, { budgetMs: 240_000 })

  if (report.errors.length > 0) {
    console.error('[jobs] drain finished with errors', report.errors)
  }

  return NextResponse.json({
    claimed: report.claimed,
    done: report.done,
    failed: report.failed,
    outOfTime: report.outOfTime,
  })
}
