'use server'

import { createClient } from '@/lib/supabase/server'
import { r2Client } from '@/lib/r2'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { revalidatePath } from 'next/cache'

/**
 * Removes a gallery, its photo records, and the underlying files in R2.
 * The database rows cascade; the storage objects have to go explicitly.
 */
export async function deleteAlbum(albumId: string) {
  const supabase = await createClient()

  const { data: album } = await supabase
    .from('albums')
    .select('cover_custom_path, cover_video_path')
    .eq('id', albumId)
    .maybeSingle()

  const { data: photos } = await supabase.from('photos').select('storage_path').eq('album_id', albumId)

  const keys = [
    ...(photos ?? []).map((p) => p.storage_path),
    album?.cover_custom_path,
    album?.cover_video_path,
  ].filter(Boolean) as string[]

  if (keys.length > 0) {
    // DeleteObjects takes up to 1000 keys per call
    for (let i = 0; i < keys.length; i += 1000) {
      await r2Client.send(
        new DeleteObjectsCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
        })
      )
    }
  }

  const { error } = await supabase.from('albums').delete().eq('id', albumId)
  if (error) throw new Error(error.message)

  revalidatePath('/admin/trips')
  revalidatePath('/admin')
  revalidatePath('/')
  revalidatePath('/trips')
}
