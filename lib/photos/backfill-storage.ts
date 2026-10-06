import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { r2Client } from '@/lib/r2'

/**
 * THE TWO THINGS THE BACKFILL MAY ASK OF THE BUCKET
 * ═════════════════════════════════════════════════
 *
 * P4 reads storage to VERIFY what a row or a document claims — does this file
 * exist, how big is it, what are the original's bytes — and nothing else. So
 * this interface has exactly two verbs, HEAD and GET, and the real one is built
 * from exactly `HeadObjectCommand` and `GetObjectCommand`. There is no write,
 * copy, move, delete or list here to call by mistake: the backfill cannot
 * change the bucket, and it cannot crawl it. Every key it asks about is one a
 * row or a saved document named, or a bounded set of known siblings of one
 * (the four sizes, the five original extensions, the flat file) — never a
 * prefix listing. .mk/backfill.ts reads this file to keep it that way.
 */

export type ObjectHead = { exists: true; bytes: number } | { exists: false }

export interface BackfillStorage {
  /** Whether the object exists, and its size. Throws only on a transport failure. */
  head(key: string): Promise<ObjectHead>
  /**
   * The object's bytes; null when there is no such object. Throws on a
   * transport failure, and when the object is larger than `maxBytes` — an
   * original is read in full to hash it, so the size is bounded first.
   */
  get(key: string, maxBytes: number): Promise<Buffer | null>
}

export class TooLargeError extends Error {
  constructor(key: string, bytes: number) {
    super(`${key} is ${bytes} bytes, over the read limit`)
    this.name = 'TooLargeError'
  }
}

const BUCKET = () => process.env.R2_BUCKET_NAME!

function isMissing(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
  return err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404
}

export const r2ReadOnly: BackfillStorage = {
  async head(key) {
    try {
      const r = await r2Client.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }))
      return { exists: true, bytes: Number(r.ContentLength ?? 0) }
    } catch (e) {
      if (isMissing(e)) return { exists: false }
      throw e
    }
  },

  async get(key, maxBytes) {
    try {
      const r = await r2Client.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }))
      const declared = Number(r.ContentLength ?? 0)
      if (declared > maxBytes) {
        // Not read: the stream is closed, not drained.
        const body = r.Body as unknown as { destroy?: () => void } | undefined
        body?.destroy?.()
        throw new TooLargeError(key, declared)
      }
      if (!r.Body) return null
      const bytes = Buffer.from(await r.Body.transformToByteArray())
      if (bytes.byteLength > maxBytes) throw new TooLargeError(key, bytes.byteLength)
      return bytes
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  },
}

/** Attempts per call before a transport failure is reported. */
export const STORAGE_ATTEMPTS = 3

/**
 * The same storage, retrying a TRANSPORT failure a bounded number of times.
 * "Not there" is an answer, not a failure, and is never retried; neither is an
 * object over the size limit.
 */
export function withRetries(storage: BackfillStorage, attempts = STORAGE_ATTEMPTS): BackfillStorage {
  const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let last: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn()
      } catch (e) {
        if (e instanceof TooLargeError) throw e
        last = e
      }
    }
    throw last
  }
  return {
    head: (key) => retry(() => storage.head(key)),
    get: (key, maxBytes) => retry(() => storage.get(key, maxBytes)),
  }
}
