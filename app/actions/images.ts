'use server'

import { createClient } from '@/lib/supabase/server'
import { requireEditor } from '@/lib/auth'
import { ownsKey } from '@/lib/storage-keys'
import { editorLibraryDb } from '@/lib/photos/editor-library'
import { fromSupabase, ingestPhoto } from '@/lib/photos/ingest'
import { EditorRefused, authRefusal, libraryFailure, registrationFailure } from '@/lib/photos/replies'
import {
  listItems,
  listSources,
  readListQuery,
  resolveRefs,
  uploadedItem,
  type LibraryDb,
  type LibraryItem,
  type LibrarySource,
} from '@/lib/photos/library'

/**
 * PHOTOGRAPHS FOR THE EDITOR'S PICKER
 * ═══════════════════════════════════
 *
 * The library the picker (components/photos/AssetPicker.tsx) browses, read
 * through lib/photos/library.ts:
 *
 *  · **All photographs** — every usable photograph of this site, once each,
 *    whatever it is used for.
 *  · **Uploads** (`site_images`) — photographs uploaded from inside the
 *    editor, for the site itself: the About portrait, the picture beside an
 *    introduction, a share image. Never shown to a visitor as a list.
 *  · **Pages & stories** — photographs in no gallery and not in Uploads: those
 *    uploaded inside a story, custom gallery covers.
 *  · **Galleries** (`albums` / `photos`) — the public work, each photograph
 *    with its gallery row, which is what a chosen gallery cover is.
 *
 * A file goes straight from the browser to R2 with a signed URL
 * (`/api/upload-url`), so a full-resolution photograph is not capped by the
 * request size limit. Only afterwards does the browser ask the server to
 * REGISTER it — and that is the moment the key is checked against this site's
 * own prefix, because the key came from the browser and a key is a read into a
 * shared bucket. See lib/storage-keys.ts.
 *
 * Every function here is a server action, which is a public endpoint, so every
 * one of them asks who is calling before it does anything — and every read is
 * filtered to THAT site by name, platform admin or not (a platform admin's
 * row-level security lets them see every site, so RLS alone would not keep a
 * picker to one). A failure is answered as a failure with words a
 * photographer can read, never as an empty library: Next hides a thrown
 * server-action message in production.
 */

export type LibraryReply<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * The site `requireEditor()` decided, and the library's database for it: the
 * photographer's own client for rows, the canonical read for what each row may
 * be shown as (lib/photos/editor-library.ts).
 */
async function library(): Promise<{ tenantId: string; db: LibraryDb }> {
  let tenantId: string
  try {
    ;({ tenantId } = await requireEditor())
  } catch (e) {
    // requireEditor's own refusals are written for a photographer; anything
    // else thrown while asking is answered in fixed words (lib/photos/replies.ts).
    throw new EditorRefused(authRefusal(e))
  }
  return { tenantId, db: await editorLibraryDb() }
}

/** Only words this code wrote reach the browser: see lib/photos/replies.ts. */
async function answer<T>(work: () => Promise<T>): Promise<LibraryReply<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (e) {
    return { ok: false, message: libraryFailure(e) }
  }
}

/**
 * The library, then this site's galleries, a page at a time (`nextCursor`).
 * `albumIds` narrows it to those galleries (a chosen gallery cover); it is a
 * caller's choice, re-checked against this site, never an authorisation.
 */
export async function listLibrarySources(opts?: {
  albumIds?: string[] | null
  cursor?: string | null
}): Promise<LibraryReply<{ sources: LibrarySource[]; nextCursor: string | null }>> {
  return answer(async () => {
    const { tenantId, db } = await library()
    return listSources(db, tenantId, { albumIds: opts?.albumIds ?? null, cursor: opts?.cursor ?? null })
  })
}

/** One page of one source. The query is validated whole before anything is read. */
export async function listLibraryItems(query: unknown): Promise<LibraryReply<{ items: LibraryItem[]; nextCursor: string | null }>> {
  return answer(async () => {
    const q = readListQuery(query)
    const { tenantId, db } = await library()
    return listItems(db, tenantId, q)
  })
}

/** What a slot already holds, positionally; `null` for one that is not this site's to show. */
export async function resolveLibraryItems(refs: unknown): Promise<LibraryReply<Array<LibraryItem | null>>> {
  return answer(async () => {
    const { tenantId, db } = await library()
    return resolveRefs(db, tenantId, refs)
  })
}

/**
 * Called once the browser has put a file in the bucket. Builds the display
 * sizes, files it under Uploads, and hands back the path a page should point
 * at — with the photograph's identity and the item the picker shows (P5).
 *
 * Registering is NOT publishing. The path goes into the draft like any other
 * setting, so an uploaded photograph reaches the live site on Publish and a
 * Discard leaves nothing behind but an unused file.
 *
 * Since P2 the photograph's asset and its Uploads row are written in one
 * database transaction (lib/photos/ingest.ts). If that fails, the upload
 * FAILS: the attempt's files are cleaned up — unless a committed asset
 * already owns them — and the picker is told, in the `{ ok: false }` shape.
 *
 * Calling this again for the same key and base is how a picker retries a
 * registration whose answer was lost: the database function reuses the
 * asset it already committed for that base rather than making a second.
 */
export async function registerSiteImage(
  key: string,
  base: string,
  filename?: string
): Promise<
  | { ok: true; path: string; id: string | null; assetId: string; item: LibraryItem | null }
  | { ok: false; message: string }
> {
  const { tenantId } = await requireEditor()

  // The key comes from the browser. Only this site's own uploads may be
  // registered — otherwise a signed-in account on one site could register
  // another site's original, at full resolution, into its own page.
  if (!ownsKey(tenantId, key) || !ownsKey(tenantId, base) || !key.startsWith(`${base}/`)) {
    return { ok: false, message: 'That upload does not belong to this site.' }
  }

  const supabase = await createClient()
  let result: Awaited<ReturnType<typeof ingestPhoto>>
  try {
    result = await ingestPhoto(
      { route: 'site', tenantId, keyBase: base, sourceKey: key, filename },
      { db: fromSupabase(supabase) }
    )
  } catch (e) {
    return { ok: false, message: registrationFailure(e) }
  }

  // Read back as the library shows it. A read that fails here does not undo
  // a registration that succeeded: the item is simply not offered yet.
  // The site was decided above; asking again could only turn a registration
  // that succeeded into a thrown answer.
  const item = await editorLibraryDb()
    .then((db) => uploadedItem(db, tenantId, result.assetId, 'upload'))
    .catch(() => null)
  return { ok: true, path: result.displayPath, id: result.siteImageId ?? null, assetId: result.assetId, item }
}

/**
 * Takes a photograph out of the Uploads list. Only its Uploads entry goes:
 * the photograph itself (its asset) stays in the library under All
 * photographs, and its files stay in the bucket — a published page may still
 * point at them, and deleting them would turn a live page into broken images.
 *
 * Named by the photograph's identity, which is what the picker holds (P5); the
 * Uploads row is found on THIS site by that identity. Row-level security
 * applies as well, but the tenant filter is what keeps a platform admin's
 * delete to the site being edited.
 */
export async function forgetSiteImage(assetId: string): Promise<{ ok: boolean; message: string }> {
  const { tenantId } = await requireEditor()
  if (typeof assetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(assetId)) {
    return { ok: false, message: 'That photograph is not in Uploads.' }
  }
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('site_images')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('asset_id', assetId)
    .select('id')
  if (error) return { ok: false, message: 'That photograph could not be taken out of Uploads just now.' }
  if (!Array.isArray(data) || data.length === 0) return { ok: false, message: 'That photograph is not in Uploads.' }

  return { ok: true, message: 'Taken out of Uploads. It is still in All photographs.' }
}
