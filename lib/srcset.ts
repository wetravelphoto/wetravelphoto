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
