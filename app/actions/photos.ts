'use server'

import { requireEditor } from '@/lib/auth'
import { ownsKey } from '@/lib/storage-keys'
import { createClient } from '@/lib/supabase/server'
import { fromSupabase, ingestPhoto } from '@/lib/photos/ingest'
import { syncProductsForPhoto } from '@/lib/products'
import { syncAlbum } from '@/lib/photos/usages'
import { revalidatePath } from 'next/cache'

/**
 * Called once the browser has uploaded the original straight to R2. Reads it
 * back, pulls its metadata, builds the display sizes and records the photo —
 * since P2 through lib/photos/ingest.ts, which writes the photograph's asset,
 * its `photos` row and its gallery usage in one database transaction.
 *
 * `originalBytes` is the browser's `file.size`. It is no longer used: the
 * byte count stored is the one the server measured from the bytes it read
 * back (P2). The parameter stays so the uploader's call does not change.
 */
export async function registerPhoto(
  albumId: string,
  key: string,
  base: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  originalBytes: number
) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()

  // The key comes from the browser. Only this site's own uploads may be
  // registered — see lib/storage-keys.ts.
  if (!ownsKey(tenantId, key) || !ownsKey(tenantId, base) || !key.startsWith(`${base}/`)) {
    throw new Error('That upload does not belong to this site.')
  }

  const supabase = await createClient()
  await ingestPhoto(
    { route: 'gallery', tenantId, albumId, keyBase: base, sourceKey: key },
    { db: fromSupabase(supabase) }
  )

  revalidatePath(`/admin/trips/${albumId}`)
}

/**
 * Removes a photograph from its gallery: the `photos` membership row, and
 * nothing in storage (P6, retention-first). The original, every display size
 * and the asset stay exactly as they were — another gallery, a section, a
 * draft or a story may still show the same files, and the usage projection
 * that could say so may be stale. Physical cleanup is a later, separate step.
 *
 * Because no file is deleted, no file has to be proved this site's: a row
 * from before the `t/<tenant>/` prefix is removed like any other.
 *
 * The row's cascades are unchanged: its catalogue entry, products,
 * favourites and downloads go with it, and keeping the files does not bring
 * them back.
 *
 * `storagePath` is the browser's and is ignored. The parameter stays so the
 * caller does not change.
 */
export async function deletePhoto(
  albumId: string,
  photoId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  storagePath: string
) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { data: photo, error: readError } = await supabase
    .from('photos')
    .select('album_id')
    .eq('tenant_id', tenantId)
    .eq('id', photoId)
    .maybeSingle()

  // No row on this site (or no answer) means nothing is touched.
  if (readError) throw new Error('That photograph could not be read, so nothing was removed.')
  if (!photo) throw new Error('That photograph is not on this site.')

  const { error } = await supabase
    .from('photos')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', photoId)
  if (error) throw new Error('That photograph could not be removed.')

  // Its gallery and shop usages went with the row, by cascade; its cover
  // usage, if it was the chosen cover, did not (P3). The album is the one the
  // row said it was in, not the one the browser named.
  await syncAlbum(tenantId, photo.album_id as string)

  revalidatePath(`/admin/trips/${albumId}`)
}

export async function updateCaption(albumId: string, photoId: string, formData: FormData) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const caption = formData.get('caption') as string
  const supabase = await createClient()

  const { error } = await supabase
    .from('photos')
    .update({ caption })
    .eq('tenant_id', tenantId)
    .eq('id', photoId)
  if (error) throw new Error(error.message)

  revalidatePath(`/admin/trips/${albumId}`)
}

export async function updatePhotoTags(albumId: string, photoId: string, tags: string[]) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const clean = tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
  const { error } = await supabase
    .from('photos')
    .update({ tags: clean })
    .eq('tenant_id', tenantId)
    .eq('id', photoId)
  if (error) throw new Error(error.message)

  revalidatePath(`/admin/trips/${albumId}`)
}

export async function toggleForSale(albumId: string, photoId: string, currentValue: boolean) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  const { error } = await supabase
    .from('photos')
    .update({ is_for_sale: !currentValue })
    .eq('tenant_id', tenantId)
    .eq('id', photoId)

  if (error) throw new Error(error.message)

  // The flag alone doesn't make a photo buyable — it needs the product rows
  // that carry the sizes and prices.
  await syncProductsForPhoto(tenantId, photoId)

  revalidatePath(`/admin/trips/${albumId}`)
  revalidatePath('/admin/shop')
  revalidatePath('/shop')
  revalidatePath(`/shop/${photoId}`)
}

export async function reorderPhotos(albumId: string, orderedIds: string[]) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  await Promise.all(
    orderedIds.map((photoId, index) =>
      supabase
        .from('photos')
        .update({ sort_order: index })
        .eq('tenant_id', tenantId)
        .eq('id', photoId)
    )
  )

  revalidatePath(`/admin/trips/${albumId}`)
}
