'use server'

import { r2Client } from '@/lib/r2'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'
import sharp from 'sharp'
import exifr from 'exifr'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'

export async function uploadPhoto(albumId: string, formData: FormData) {
  const file = formData.get('file') as File
  if (!file) throw new Error('No file provided')

  const buffer = Buffer.from(await file.arrayBuffer())

  // Pull Lightroom keywords, capture date and GPS out of the file's metadata
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

  const image = sharp(buffer).rotate()
  const metadata = await image.metadata()

  const optimized = await image
    .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  const key = `photos/${albumId}/${randomUUID()}.jpg`

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: optimized,
      ContentType: 'image/jpeg',
    })
  )

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('photos')
    .select('sort_order')
    .eq('album_id', albumId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSortOrder = (existing?.[0]?.sort_order ?? -1) + 1

  const { error } = await supabase.from('photos').insert({
    album_id: albumId,
    storage_path: key,
    width: metadata.width,
    height: metadata.height,
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
  const supabase = await createClient()

  await r2Client.send(
    new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: storagePath })
  )

  const { error } = await supabase.from('photos').delete().eq('id', photoId)
  if (error) throw new Error(error.message)

  revalidatePath(`/admin/trips/${albumId}`)
}

export async function updateCaption(albumId: string, photoId: string, formData: FormData) {
  const caption = formData.get('caption') as string
  const supabase = await createClient()

  const { error } = await supabase.from('photos').update({ caption }).eq('id', photoId)
  if (error) throw new Error(error.message)

  revalidatePath(`/admin/trips/${albumId}`)
}

export async function updatePhotoTags(albumId: string, photoId: string, tags: string[]) {
  const supabase = await createClient()

  const clean = tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
  const { error } = await supabase.from('photos').update({ tags: clean }).eq('id', photoId)
  if (error) throw new Error(error.message)

  revalidatePath(`/admin/trips/${albumId}`)
}

export async function toggleForSale(albumId: string, photoId: string, currentValue: boolean) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('photos')
    .update({ is_for_sale: !currentValue })
    .eq('id', photoId)

  if (error) throw new Error(error.message)

  revalidatePath(`/admin/trips/${albumId}`)
}

export async function reorderPhotos(albumId: string, orderedIds: string[]) {
  const supabase = await createClient()

  await Promise.all(
    orderedIds.map((photoId, index) =>
      supabase.from('photos').update({ sort_order: index }).eq('id', photoId)
    )
  )

  revalidatePath(`/admin/trips/${albumId}`)
}
