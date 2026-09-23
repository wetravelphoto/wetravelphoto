'use server'

import { requireEditor } from '@/lib/auth'
import { ownsKey } from '@/lib/storage-keys'
import { r2Client } from '@/lib/r2'
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'
import { processExistingOriginal } from '@/lib/derivatives'
import { syncProductsForPhoto } from '@/lib/products'
import exifr from 'exifr'
import { revalidatePath } from 'next/cache'

/**
 * Called once the browser has uploaded the original straight to R2. Reads it
 * back, pulls its metadata, builds the display sizes and records the photo.
 */
export async function registerPhoto(
  albumId: string,
  key: string,
  base: string,
  originalBytes: number
) {
  // A server action is a public endpoint: check who is asking before anything else.
  const { tenantId } = await requireEditor()

  // The key comes from the browser. Only this site's own uploads may be
  // registered — see lib/storage-keys.ts.
  if (!ownsKey(tenantId, key) || !ownsKey(tenantId, base) || !key.startsWith(`${base}/`)) {
    throw new Error('That upload does not belong to this site.')
  }

  const object = await r2Client.send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key })
  )

  if (!object.Body) throw new Error('Uploaded file could not be read back')

  const buffer = Buffer.from(await object.Body.transformToByteArray())

  // Lightroom keywords, capture date and GPS, straight from the file
  let tags: string[] = []
  let takenAt: string | null = null
  let latitude: number | null = null
  let longitude: number | null = null

  try {
    const meta = await exifr.parse(buffer, {
      iptc: true,
      xmp: true,
      gps: true,
      pick: ['Keywords', 'subject', 'DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'],
    })

    if (meta) {
      const raw = meta.Keywords ?? meta.subject ?? []
      const list = Array.isArray(raw) ? raw : [raw]
      tags = list
        .filter((k: unknown) => typeof k === 'string')
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 25)

      const date = meta.DateTimeOriginal ?? meta.CreateDate
      if (date instanceof Date && !isNaN(date.getTime())) takenAt = date.toISOString()

      if (typeof meta.latitude === 'number') latitude = meta.latitude
      if (typeof meta.longitude === 'number') longitude = meta.longitude
    }
  } catch {
    // Metadata is a bonus — a file without it still uploads fine
  }

  const processed = await processExistingOriginal(buffer, base, key)

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('photos')
    .select('sort_order')
    .eq('tenant_id', tenantId)
    .eq('album_id', albumId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSortOrder = (existing?.[0]?.sort_order ?? -1) + 1

  const { error } = await supabase.from('photos').insert({
    tenant_id: tenantId,
    album_id: albumId,
    storage_path: processed.displayPath,
    original_path: processed.originalPath,
    original_bytes: originalBytes || processed.originalBytes,
    derivatives: processed.derivatives,
    width: processed.width,
    height: processed.height,
    sort_order: nextSortOrder,
    tags,
    taken_at: takenAt,
    latitude,
    longitude,
  })

  if (error) throw new Error(error.message)

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
  await syncProductsForPhoto(photoId)

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
