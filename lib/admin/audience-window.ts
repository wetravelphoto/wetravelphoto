/**
 * HOW FAR BACK THE OVERVIEW IS LOOKING.
 *
 * Its own file, with no imports, because BOTH sides need it: the server reads
 * the window out of the URL to run the queries, and the client draws the
 * picker. Leaving it in lib/admin/overview.ts — which opens a database
 * connection — meant the client component that imports the labels dragged the
 * server's Supabase client into the browser bundle, and the build said so.
 *
 * The rule this is an instance of: anything two sides share lives somewhere
 * neither side's machinery can reach.
 */

export type Window = 7 | 30 | 90

export const WINDOWS: { days: Window; label: string }[] = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
]

/** A window from a query string, or the usual one. Never throws. */
export function windowOf(value: unknown): Window {
  const n = Number(value)
  return (WINDOWS.find((w) => w.days === n)?.days ?? 30) as Window
}
