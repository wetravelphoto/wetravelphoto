import { derivePhoto } from '@/lib/jobs/derive'
import { JOB_KINDS, type JobHandler, type JobKind } from '@/lib/jobs/types'

/**
 * WHICH FUNCTION DOES WHICH KIND OF WORK.
 *
 * One place, typed by `JobKind`, so a kind added to the list without a handler
 * is a build error rather than a row that sits in the queue failing with "no
 * handler" and nothing to tell anybody why.
 *
 * `Record<JobKind, …>` is what enforces that: TypeScript requires every member
 * of the union to have an entry. Add 'newsletter.sync' to JOB_KINDS and the
 * build stops here until something is written to do it.
 */
export const HANDLERS: Record<JobKind, JobHandler> = {
  'photo.derivatives': derivePhoto,
}

/**
 * A kind read back OUT of the database, which is a `text` column and can
 * therefore hold anything an older deploy wrote. Returns null for a kind
 * nothing handles; the drain fails that job permanently rather than retrying,
 * because a missing handler does not appear on the fifth attempt.
 */
export function handlerFor(kind: string): JobHandler | null {
  return (JOB_KINDS as readonly string[]).includes(kind)
    ? HANDLERS[kind as JobKind]
    : null
}
