import { GetObjectCommand } from '@aws-sdk/client-s3'
import { r2Client } from '@/lib/r2'
import { processPhoto } from '@/lib/derivatives'
import { PermanentJobError, type JobContext } from '@/lib/jobs/types'

/**
 * DISPLAY SIZES FOR ONE PHOTOGRAPH
 * ════════════════════════════════
 *
 * The first thing to go through the queue, and the one that most obviously
 * needed it: this used to run in a `do…while` loop in the browser. Closing the
 * tab stopped it, nothing remembered where it had got to, a photograph that
 * failed was skipped silently, and a photograph that failed every time was
 * invisible.
 *
 * ── One photograph per job, on purpose ──────────────────────────────────────
 *
 * A job that did ten would retry all ten because of one, and a single
 * unreadable file would keep nine good ones from ever being processed. One
 * each costs eighty rows for eighty photographs, which is nothing, and buys
 * exact retries and a failure that names the photograph.
 *
 * ── Why this is safe to run twice ───────────────────────────────────────────
 *
 * It has to be — see the note on `JobHandler`. Two things make it so:
 *
 *   · it returns immediately when the photograph already has its derivatives,
 *     so the second run does no work at all;
 *   · and if it does run twice, `processPhoto` writes the same derivative keys
 *     from the same source file, so the second pass overwrites the first with
 *     identical bytes rather than adding anything.
 */
export async function derivePhoto({ db, tenantId, payload }: JobContext): Promise<void> {
  const photoId = typeof payload.photoId === 'string' ? payload.photoId : null
  if (!photoId) throw new PermanentJobError('The job did not say which photograph.')

  const { data: photo, error } = await db
    .from('photos')
    .select('id, storage_path, derivatives')
    .eq('tenant_id', tenantId)
    .eq('id', photoId)
    .maybeSingle()

  // A read that failed is worth retrying; a photograph that is not there is
  // not. Deleting a photograph while its job is queued is an ordinary thing to
  // do, and it should leave one tidy failed row rather than five.
  if (error) throw new Error(`Could not read the photograph: ${error.message}`)
  if (!photo) throw new PermanentJobError('That photograph is no longer in the library.')

  const already = photo.derivatives as Record<string, unknown> | null
  if (already && Object.keys(already).length > 0) return

  if (!photo.storage_path) {
    throw new PermanentJobError('That photograph has no stored file.')
  }

  const object = await r2Client.send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: photo.storage_path as string,
    })
  )

  if (!object.Body) throw new PermanentJobError('The stored file is empty.')

  const buffer = Buffer.from(await object.Body.transformToByteArray())

  // The existing key stays the base, so nothing already linked to this
  // photograph breaks. Unchanged from the loop this replaces.
  const base = (photo.storage_path as string).replace(/\.[^.]+$/, '')
  const processed = await processPhoto(buffer, base, 'jpg')

  const { error: writeError } = await db
    .from('photos')
    .update({
      derivatives: processed.derivatives,
      width: processed.width,
      height: processed.height,
    })
    .eq('tenant_id', tenantId)
    .eq('id', photoId)

  if (writeError) throw new Error(`Could not save the sizes: ${writeError.message}`)
}
