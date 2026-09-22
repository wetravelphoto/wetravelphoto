'use server'

import { requireEditor } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { r2Client } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { processPhoto } from '@/lib/derivatives'
import { revalidatePath } from 'next/cache'

/**
 * Generates the display sizes for photos uploaded before the ladder existed.
 * Works from whatever file is stored, so those photos stay capped at their
 * original 2400px — there is no higher-resolution source to recover.
 *
 * Runs in small batches so a long library doesn't exhaust the request.
 */
export async function backfillDerivatives(limit = 10) {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()

  const { data: photos, error } = await supabase
    .from('photos')
    .select('id, storage_path, derivatives')
    .or('derivatives.is.null,derivatives.eq.{}')
    .limit(limit)

  if (error) return { ok: false, message: error.message, done: 0, remaining: 0 }
  if (!photos || photos.length === 0) {
    return { ok: true, message: 'Everything is already processed.', done: 0, remaining: 0 }
  }

  let done = 0

  for (const photo of photos) {
    try {
      const object = await r2Client.send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: photo.storage_path,
        })
      )

      if (!object.Body) continue

      const buffer = Buffer.from(await object.Body.transformToByteArray())

      // Keep the existing key as the base so nothing already linked breaks
      const base = photo.storage_path.replace(/\.[^.]+$/, '')
      const processed = await processPhoto(buffer, base, 'jpg')

      await supabase
        .from('photos')
        .update({
          derivatives: processed.derivatives,
          width: processed.width,
          height: processed.height,
        })
        .eq('id', photo.id)

      done += 1
    } catch {
      // Skip anything unreadable rather than stopping the batch
    }
  }

  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .or('derivatives.is.null,derivatives.eq.{}')

  revalidatePath('/admin/settings')

  return {
    ok: true,
    message: `Processed ${done}. ${count ?? 0} still to go.`,
    done,
    remaining: count ?? 0,
  }
}

export async function countUnprocessed() {
  // A server action is a public endpoint: check who is asking before anything else.
  await requireEditor()
  const supabase = await createClient()

  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .or('derivatives.is.null,derivatives.eq.{}')

  return count ?? 0
}
