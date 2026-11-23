import { IngestError } from '@/lib/photos/ingest'
import { LibraryError } from '@/lib/photos/library'

/**
 * WHAT A PICKER ACTION MAY SAY WHEN IT FAILS
 * ══════════════════════════════════════════
 *
 * The editor's photograph actions (app/actions/images.ts, and the journal
 * registration in app/actions/blog.ts) answer a failure as `{ ok: false,
 * message }`, and that message is serialised to the browser. So it is only
 * ever a sentence this code wrote: a `LibraryError`'s, an ingestion refusal
 * whose reason carries a fixed sentence, one of `requireEditor()`'s own
 * refusals — or a fixed fallback. Never an arbitrary `Error.message`, which
 * can quote a provider's reply, a storage path or a key.
 */

export const LIBRARY_FAILED = 'Your photographs could not be read just now.'
export const AUTH_REFUSED = 'This site’s photographs can’t be changed from this account just now. Sign in again and try once more.'
export const REGISTER_FAILED = 'The photograph could not be recorded. Try again.'

/**
 * `requireEditor()`'s refusals (lib/auth.ts), word for word: each is written
 * for a photographer. Anything else thrown while asking who is calling (a
 * session or provider fault) is answered with AUTH_REFUSED. `.mk/picker-editor.ts`
 * holds this list to lib/auth.ts, so a reworded refusal is noticed rather than
 * silently becoming the fallback.
 */
export const AUTH_SENTENCES: readonly string[] = [
  'You are signed out. Sign in again and your draft will still be here.',
  'This account is not attached to a site yet, so it cannot edit one.',
  'This account can view this site but not change it.',
  'This is not your site. You are signed in to a different one — open your own address to edit it.',
]

/** A refusal from asking who is calling, already in safe words. */
export class EditorRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditorRefused'
  }
}

export function authRefusal(e: unknown): string {
  return e instanceof Error && AUTH_SENTENCES.includes(e.message) ? e.message : AUTH_REFUSED
}

/** A library action's failure, as the browser may see it. */
export function libraryFailure(e: unknown): string {
  if (e instanceof LibraryError || e instanceof EditorRefused) return e.message
  return LIBRARY_FAILED
}

/**
 * An ingestion failure, as the browser may see it. `ownership`, `unreadable`
 * and `processing` carry the fixed sentences lib/photos/ingest.ts writes;
 * `registration` may carry the database's own error text, so it never passes.
 */
export function registrationFailure(e: unknown): string {
  if (e instanceof IngestError && e.reason !== 'registration') return e.message
  return REGISTER_FAILED
}
