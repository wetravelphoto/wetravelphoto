import * as Sentry from '@sentry/nextjs'

/**
 * Next.js calls `register()` once per server runtime, before anything else
 * runs. The two config files are imported dynamically because each pulls in a
 * different build of the SDK and only one of them belongs in any given
 * runtime.
 *
 * `onRequestError` is the hook that catches what a `try/catch` cannot: an
 * error thrown while rendering a server component, which Next.js swallows into
 * a digest and a redacted message before anyone sees it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
