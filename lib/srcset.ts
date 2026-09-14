import { photoUrl } from '@/lib/images'
import { SIZES, type Derivatives } from '@/lib/image-sizes'

export type Sizeable = {
  storage_path: string
  derivatives?: Derivatives | null
}

/**
 * Builds a srcset from whatever derivatives a photo has. Photos uploaded
 * before the ladder existed simply fall back to their single stored file, so
 * mixing old and new uploads is safe.
 */
export function srcSetFor(photo: Sizeable): string | undefined {
  const set = photo.derivatives
  if (!set || Object.keys(set).length === 0) return undefined

  const entries = SIZES.map((size) => {
    const key = set[`${size}` as keyof Derivatives]
    return key ? `${photoUrl(key)} ${size}w` : null
  }).filter(Boolean)

  return entries.length > 0 ? entries.join(', ') : undefined
}

/** The file to use when srcset isn't supported or isn't needed. */
export function displayUrl(photo: Sizeable): string {
  const set = photo.derivatives
  const best = set?.['2400'] ?? set?.['1600'] ?? set?.['800'] ?? set?.['400']
  return photoUrl(best ?? photo.storage_path)
}

/**
 * Builds a srcset from a stored path alone, for images that have no
 * `derivatives` record of their own — hero stories, journal covers, the intro
 * and contact images. They're written by the same pipeline, which keeps only
 * the largest path, so without this they load at full resolution everywhere.
 *
 * Safe because the ladder only ever skips sizes *larger* than the source (see
 * lib/derivatives.ts). If a path ends in 2400.webp then 1600, 800 and 400 all
 * exist. Every size at or below the stored one is real; nothing above it is
 * ever referenced.
 *
 * Returns undefined for anything that isn't a ladder path, so legacy uploads
 * and original.jpg fall through to the bare src untouched.
 */
export function srcSetFromPath(url: string | null | undefined): string | undefined {
  if (!url) return undefined

  const match = url.match(/^(.*)\/(400|800|1600|2400)\.webp(\?.*)?$/)
  if (!match) return undefined

  const base = match[1]
  const cap = Number(match[2])

  const entries = SIZES.filter((size) => size <= cap).map(
    (size) => `${base}/${size}.webp ${size}w`
  )

  // A single candidate tells the browser nothing it didn't already know
  return entries.length > 1 ? entries.join(', ') : undefined
}

/**
 * Tells the browser how wide the image will actually be drawn, so it can pick
 * the right file before layout. Without this it assumes full viewport width
 * and over-fetches.
 */
export const SIZES_ATTR = {
  grid: '(max-width: 620px) 100vw, (max-width: 1000px) 50vw, 33vw',
  halfWidth: '(max-width: 760px) 100vw, 50vw',
  fullWidth: '100vw',
  thumb: '(max-width: 620px) 50vw, 220px',
} as const
