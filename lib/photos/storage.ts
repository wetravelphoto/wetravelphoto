import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { r2Client } from '@/lib/r2'

/**
 * THE THREE THINGS INGESTION DOES TO THE BUCKET
 * ═════════════════════════════════════════════
 *
 * Read an upload back, write a display size, delete what a failed attempt left
 * behind. That is the whole seam — deliberately not a storage abstraction. It
 * exists so `.mk/ingest.ts` can prove what ingestion reads, writes, hashes and
 * cleans up without a real bucket; everything in production goes through
 * `r2Storage`, which is exactly the calls the upload actions made before P2.
 */
export interface PhotoStorage {
  /** The object's bytes, or null when there is no such object or it is empty. */
  read(key: string): Promise<Buffer | null>
  write(key: string, body: Buffer, contentType: string): Promise<void>
  /** Deletes each key; returns the keys it could NOT delete. Never throws. */
  remove(keys: string[]): Promise<string[]>
}

const BUCKET = () => process.env.R2_BUCKET_NAME!

export const r2Storage: PhotoStorage = {
  async read(key) {
    const object = await r2Client.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }))
    if (!object.Body) return null
    const bytes = Buffer.from(await object.Body.transformToByteArray())
    return bytes.byteLength > 0 ? bytes : null
  },

  async write(key, body, contentType) {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: BUCKET(),
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    )
  },

  async remove(keys) {
    const failed: string[] = []
    await Promise.all(
      keys.map((Key) =>
        r2Client.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key })).catch(() => {
          failed.push(Key)
        })
      )
    )
    return failed
  },
}

/**
 * The same storage, remembering every key it was asked to write — including
 * the ones written before something later in the attempt failed. That list is
 * what a failed attempt cleans up, so it must not depend on the processing
 * code finishing.
 */
export function recording(storage: PhotoStorage): PhotoStorage & { written: string[] } {
  const written: string[] = []
  return {
    written,
    read: (key) => storage.read(key),
    async write(key, body, contentType) {
      written.push(key)
      await storage.write(key, body, contentType)
    },
    remove: (keys) => storage.remove(keys),
  }
}
