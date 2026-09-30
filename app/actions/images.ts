'use server'

import { createClient } from '@/lib/supabase/server'
import { requireEditor } from '@/lib/auth'
import { ownsKey } from '@/lib/storage-keys'
import { fromSupabase, ingestPhoto } from '@/lib/photos/ingest'

/**
 * PHOTOGRAPHS FOR THE EDITOR'S PICKER
 * ═══════════════════════════════════
 *
 * Two sources, and they are different things:
 *
 *  · **Uploads** (`site_images`) — photographs uploaded from inside the
 *    editor, for the site itself: the About portrait, the picture beside an
 *    introduction, a share image. Never shown to a visitor as a list.
 *  · **Galleries** (`albums` / `photos`) — the public work. Already uploaded
 *    in Admin, and offered here so a page can reuse one.
 *
 * A file goes straight from the browser to R2 with a signed URL
 * (`/api/upload-url`), so a full-resolution photograph is not capped by the
 * request size limit. Only afterwards does the browser ask the server to
 * REGISTER it — and that is the moment the key is checked against this site's
 * own prefix, because the key came from the browser and a key is a read into a
 * shared bucket. See lib/storage-keys.ts.
 *
 * Every function here is a server action, which is a public endpoint, so every
 * one of them asks who is calling before it does anything.
 */

export type PickerImage = {
  id: string
  path: string
  caption: string | null
}

export type PickerSource = {
  /** 'uploads', or an album id. */
  id: string
  label: string
  kind: 'uploads' | 'album'
}

/** The sources the picker offers, in the order it shows them. */
export async function listPickerSources(): Promise<PickerSource[]> {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: albums } = await supabase
    .from('albums')
    .select('id, title')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  return [
    { id: 'uploads', label: 'Uploads', kind: 'uploads' },
    ...(albums ?? []).map((a) => ({
      id: a.id as string,
      label: (a.title as string) || 'Untitled gallery',
      kind: 'album' as const,
    })),
  ]
}

/**
 * The photographs in one source. `uploads` is this site's own uploads, newest
 * first; anything else is an album id, and row-level security is what decides
 * whether this account may see it — the id is never trusted on its own.
 */
export async function listPickerImages(source: string): Promise<PickerImage[]> {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  if (source === 'uploads') {
    const { data } = await supabase
      .from('site_images')
      .select('id, storage_path, filename')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(200)

    return (data ?? []).map((row) => ({
      id: row.id as string,
      path: row.storage_path as string,
      caption: (row.filename as string) ?? null,
    }))
  }

  const { data } = await supabase
    .from('photos')
    .select('id, storage_path, caption')
    .eq('tenant_id', tenantId)
    .eq('album_id', source)
    .order('sort_order')

  return (data ?? []).map((row) => ({
    id: row.id as string,
    path: row.storage_path as string,
    caption: (row.caption as string) ?? null,
  }))
}

/**
 * Called once the browser has put a file in the bucket. Builds the display
 * sizes, files it under Uploads, and hands back the path a page should point
 * at.
 *
 * Registering is NOT publishing. The path goes into the draft like any other
 * setting, so an uploaded photograph reaches the live site on Publish and a
 * Discard leaves nothing behind but an unused file.
 *
 * Since P2 the photograph's asset and its Uploads row are written in one
 * database transaction (lib/photos/ingest.ts). If that fails, the upload
 * FAILS: this used to hand back a usable path even when the Uploads row could
 * not be written, leaving a file no table mentioned. Now the attempt's files
 * are cleaned up and the picker is told, in the same `{ ok: false }` shape it
 * already shows.
 */
export async function registerSiteImage(
  key: string,
  base: string,
  filename?: string
): Promise<{ ok: true; path: string; id: string | null } | { ok: false; message: string }> {
  const { tenantId } = await requireEditor()

  // The key comes from the browser. Only this site's own uploads may be
  // registered — otherwise a signed-in account on one site could register
  // another site's original, at full resolution, into its own page.
  if (!ownsKey(tenantId, key) || !ownsKey(tenantId, base) || !key.startsWith(`${base}/`)) {
    return { ok: false, message: 'That upload does not belong to this site.' }
  }

  const supabase = await createClient()
  try {
    const result = await ingestPhoto(
      { route: 'site', tenantId, keyBase: base, sourceKey: key, filename },
      { db: fromSupabase(supabase) }
    )
    return { ok: true, path: result.displayPath, id: result.siteImageId ?? null }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'That file could not be read as a photograph.',
    }
  }
}

/**
 * Takes a photograph out of the Uploads list. The files stay in the bucket:
 * they cost almost nothing, and a published page may still point at them —
 * deleting them would turn a live page into broken images.
 */
export async function forgetSiteImage(id: string): Promise<{ ok: boolean; message: string }> {
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  // No tenant filter needed and none wanted: row-level security decides which
  // rows this account can see, and adding a filter here would suggest it is
  // the thing keeping sites apart.
  const { error } = await supabase
    .from('site_images')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', id)
  if (error) return { ok: false, message: error.message }

  return { ok: true, message: 'Removed from Uploads.' }
}
