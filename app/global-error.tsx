'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

/**
 * THE LAST PAGE BEFORE A WHITE SCREEN
 *
 * `global-error` replaces the root layout, so it has to bring its own `<html>`
 * and `<body>` and can take no fonts, colours or settings from the site —
 * whatever failed may be the very thing that would have provided them. Written
 * with inline styles and a system typeface for that reason.
 *
 * It reports, and then it says something a person can act on. "Application
 * error: a client-side exception has occurred" is Next.js's default and it
 * tells a photographer nothing except that today is going badly.
 *
 * `next/error` is deliberately not used: it belongs to the Pages Router and
 * pulls that runtime in behind it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: '#f7f6f3',
          color: '#1a1715',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          lineHeight: 1.6,
        }}
      >
        <main style={{ maxWidth: '34rem', textAlign: 'left' }}>
          <p
            style={{
              margin: '0 0 0.6rem',
              fontSize: '0.68rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#918b84',
            }}
          >
            Something went wrong
          </p>

          <h1 style={{ margin: '0 0 0.9rem', fontSize: '1.4rem', fontWeight: 500 }}>
            This page could not be shown.
          </h1>

          <p style={{ margin: '0 0 1.4rem', color: '#56514c' }}>
            Nothing you have saved is affected — this is the page failing to draw, not your
            work. Try again, and if it keeps happening the fault has already been reported.
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                fontFamily: 'inherit',
                fontSize: '0.8rem',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                padding: '0.6rem 1.15rem',
                background: '#1a1715',
                color: '#f7f6f3',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            {/* A real navigation, not <Link>. The router is part of what just
                failed, and a client-side transition out of a global error can
                land straight back in it. A full page load starts clean. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                fontFamily: 'inherit',
                fontSize: '0.8rem',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                padding: '0.6rem 1.15rem',
                border: '0.5px solid rgba(26, 23, 21, 0.2)',
                color: '#56514c',
                textDecoration: 'none',
              }}
            >
              Go home
            </a>
          </div>

          {/*
            The digest is the only thread between what the person is looking at
            and what was reported. Shown quietly, so "it said 7f3a9c" turns a
            vague report into one lookup.
          */}
          {error.digest && (
            <p style={{ margin: '1.6rem 0 0', fontSize: '0.72rem', color: '#918b84' }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
