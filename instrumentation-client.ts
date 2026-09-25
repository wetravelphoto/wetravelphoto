import * as Sentry from '@sentry/nextjs'
import { baseOptions, watching } from '@/lib/observability'

/**
 * The browser. Deliberately the plainest of the three.
 *
 * **No session replay.** It is the feature everyone switches on first and it
 * is the wrong fit here twice over: the admin is full of a photographer's
 * unpublished work and their clients' faces, and a replay records all of it to
 * somebody else's servers. A photographer did not agree to that when they
 * signed up to host a portfolio. If a bug ever genuinely needs it, it can be
 * turned on for one session with the person's knowledge.
 *
 * **No user feedback widget** either — with two testers, the feedback channel
 * is a text message.
 */
if (watching) {
  Sentry.init(baseOptions())
}

/** Lets client-side navigations be attributed to the route they started from. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
