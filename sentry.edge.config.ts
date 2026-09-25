import * as Sentry from '@sentry/nextjs'
import { baseOptions, watching } from '@/lib/observability'

/**
 * The edge runtime: middleware, which is where a request first learns which
 * site it is for. Small surface, but an error here breaks every page at once,
 * so it is the last place worth leaving unwatched.
 */
if (watching) {
  Sentry.init(baseOptions())
}
