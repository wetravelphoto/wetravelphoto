import { PermanentJobError } from '@/lib/jobs/types'

/**
 * THE RETIRED DERIVATIVE JOB
 * ══════════════════════════
 *
 * `photo.derivatives` used to read a pre-ladder photograph from the bucket,
 * write a WebP ladder AND an `original.jpg` beside it — a copy of the resized
 * JPEG, not the photographer's original — and update the photos row, with no
 * asset. That made it a second, unchecked ingestion route, and the one P2 left
 * as a named exemption for P4.
 *
 * P4 retires it (claude/photo-migration-plan.md). Every legacy photograph now
 * gets its asset from the backfill (lib/photos/backfill.ts), which writes
 * nothing to storage and records a flat-era file as exactly what it is. Nothing
 * in the application queues this kind any more, and the admin control that did
 * is gone.
 *
 * The kind itself stays: `enqueue_jobs`' allow-list still names it (changing
 * that is a migration of its own), and a row queued before this deploy must
 * end cleanly. So the handler does no work and fails PERMANENTLY — one tidy
 * failed row with the reason, never five retries, never a file written.
 */
export async function derivePhoto(): Promise<void> {
  throw new PermanentJobError(
    'Retired in P4: display sizes are no longer made by this job, and legacy photographs get their assets from the backfill.'
  )
}
