'use server'

import { requireEditor } from '@/lib/auth'
import { ownsKey } from '@/lib/storage-keys'
import { r2Client } from '@/lib/r2'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'
import { fromSupabase, ingestPhoto } from '@/lib/photos/ingest'
import { syncProductsForPhoto } from '@/lib/products'
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

export async function deletePhoto(albumId: string, photoId: string, storagePath: string) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()
  const supabase = await createClient()

  // A photo is now several files — the original plus each display size
  const { data: photo } = await supabase
    .from('photos')
    .select('original_path, derivatives')
    .eq('tenant_id', tenantId)
    .eq('id', photoId)
    .maybeSingle()

  const keys = new Set<string>([storagePath])
  if (photo?.original_path) keys.add(photo.original_path)

  for (const value of Object.values((photo?.derivatives ?? {}) as Record<string, string>)) {
    if (value) keys.add(value)
  }

  await Promise.all(
    [...keys].map((Key) =>
      r2Client
        .send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key }))
        // One missing object shouldn't block removing the record
        .catch(() => null)
    )
  )

  const { error } = await supabase
    .from('photos')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', photoId)
  if (error) throw new Error(error.message)

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
