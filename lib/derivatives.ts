import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2Client } from '@/lib/r2'

import { SIZES, type SizeKey, type Derivatives } from '@/lib/image-sizes'

// Re-exported so existing server-side imports keep working
export { SIZES }
export type { SizeKey, Derivatives }

/**
 * WebP at 82 is visually indistinguishable from JPEG 85 on screen and lands
 * roughly a third smaller. Effort 4 keeps uploads responsive — higher settings
 * shave a few more percent for a lot more CPU time.
 */
const WEBP = { quality: 82, effort: 4 } as const

const BUCKET = () => process.env.R2_BUCKET_NAME!

async function put(key: string, body: Buffer, contentType: string) {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  )
}

export type ProcessedPhoto = {
  originalPath: string
  originalBytes: number
  displayPath: string
  derivatives: Derivatives
  width: number
  height: number
}

/**
 * Stores the untouched original plus a ladder of WebP sizes. The original is
 * what clients download; the derivatives are what the site displays.
 */
export async function processPhoto(
  buffer: Buffer,
  keyBase: string,
  originalExtension: string
): Promise<ProcessedPhoto> {
  const image = sharp(buffer, { failOn: 'none' })
  const meta = await image.metadata()

  // rotate() applies the EXIF orientation, so stored pixels match what you see
  const upright = sharp(buffer, { failOn: 'none' }).rotate()
  const uprightMeta = await upright.metadata()

  const width = uprightMeta.width ?? meta.width ?? 0
  const height = uprightMeta.height ?? meta.height ?? 0
  const longEdge = Math.max(width, height)

  // 1. The original, exactly as supplied
  const originalPath = `${keyBase}/original.${originalExtension}`
  await put(originalPath, buffer, `image/${originalExtension === 'jpg' ? 'jpeg' : originalExtension}`)

  // 2. The display ladder, skipping any size larger than the source
  const derivatives: Derivatives = {}

  for (const size of SIZES) {
    // Always produce the smallest so thumbnails exist even for small uploads
    if (size > longEdge && size !== SIZES[0]) continue

    const resized = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp(WEBP)
      .toBuffer()

    const key = `${keyBase}/${size}.webp`
    await put(key, resized, 'image/webp')
    derivatives[`${size}` as SizeKey] = key
  }

  // The largest derivative is the default when no srcset applies
  const displayPath =
    derivatives['2400'] ?? derivatives['1600'] ?? derivatives['800'] ?? derivatives['400']!

  return {
    originalPath,
    originalBytes: buffer.byteLength,
    displayPath,
    derivatives,
    width,
    height,
  }
}

export function extensionFor(mime: string, fallback = 'jpg'): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/tiff': 'tif',
    'image/avif': 'avif',
  }
  return map[mime] ?? fallback
}


/**
 * Builds the display ladder for an original that has already been uploaded
 * directly to storage. Used by the presigned upload flow.
 */
export async function processExistingOriginal(
  buffer: Buffer,
  keyBase: string,
  originalPath: string
): Promise<ProcessedPhoto> {
  const upright = sharp(buffer, { failOn: 'none' }).rotate()
  const meta = await upright.metadata()

  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const longEdge = Math.max(width, height)

  const derivatives: Derivatives = {}

  for (const size of SIZES) {
    if (size > longEdge && size !== SIZES[0]) continue

    const resized = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp(WEBP)
      .toBuffer()

    const key = `${keyBase}/${size}.webp`
    await put(key, resized, 'image/webp')
    derivatives[`${size}` as SizeKey] = key
  }

  const displayPath =
    derivatives['2400'] ?? derivatives['1600'] ?? derivatives['800'] ?? derivatives['400']!

  return {
    originalPath,
    originalBytes: buffer.byteLength,
    displayPath,
    derivatives,
    width,
    height,
  }
}
