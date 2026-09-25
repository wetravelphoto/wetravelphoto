import * as Sentry from '@sentry/nextjs'
import { baseOptions, watching } from '@/lib/observability'

/**
 * The Node runtime: server components, server actions, route handlers, the
 * cron jobs. This is where the errors that matter happen — a server action
 * that throws in production is redacted by Next.js into "an error occurred in
 * the Server Components render", which is React #441 and is unreadable by
 * design. Sentry sees the real one.
 */
if (watching) {
  Sentry.init(baseOptions())
}
