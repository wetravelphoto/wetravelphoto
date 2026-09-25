/**
 * A photograph that ships with the platform rather than one somebody uploaded.
 *
 * New sites start with a small sample gallery so the first thing a
 * photographer sees is a site with pictures in it, not an outline of one.
 * Those files live in `public/samples/` and are served from this origin — NOT
 * copied into each site's bucket, which would mean paying to store the same
 * six photographs once per customer and would make "delete this gallery"
 * capable of destroying them for everyone.
 *
 * Matched narrowly, exactly as `lib/sections/mark.ts` matches `/logos/`: a
 * value starting with "/" is a URL on this origin, and "//somewhere.else/x"
 * is a URL on ANY origin. Anything that is not precisely /samples/<path> is
 * treated as a storage key, which can only ever resolve inside the bucket.
 */
const BUILT_IN_PHOTO = /^\/samples\/[\w-]+\/[\w-]+\.webp$/

export function isSamplePhoto(storagePath: string | null | undefined): boolean {
  return typeof storagePath === 'string' && BUILT_IN_PHOTO.test(storagePath)
}

export function photoUrl(storagePath: string): string {
  if (isSamplePhoto(storagePath)) return storagePath
  return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${storagePath}`
}

/**
 * The same answer, for the thirty-odd components that are handed the bucket's
 * address as a prop rather than reading the environment.
 *
 * Every one of them was writing `` `${publicUrl}/${path}` `` by hand, which is
 * correct for an uploaded photograph and wrong for a sample: it asks the
 * bucket for a file that lives on this origin, and the picker draws a broken
 * image icon. It showed up first in the hero's crop box, where the big preview
 * beside it rendered the same photograph perfectly — because that one went
 * through `photoUrl()` and this one did not.
 *
 * The rule is not "remember to check" — it is that there should be one place
 * that knows, and a bare template literal should look wrong. `markSrc()` in
 * lib/sections/mark.ts is the same idea for `/logos/`.
 */
export function imageSrc(publicUrl: string, storagePath: string): string {
  if (isSamplePhoto(storagePath)) return storagePath
  return `${publicUrl}/${storagePath}`
}

export function focalPosition(x: number | null, y: number | null): string {
  return `${((x ?? 0.5) * 100).toFixed(1)}% ${((y ?? 0.5) * 100).toFixed(1)}%`
}

/** Fine noise texture, inlined so it costs no extra request. */
export const GRAIN_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

export type OverlayType = 'none' | 'darken' | 'gradient' | 'grain' | 'darken_grain'

/**
 * Returns the CSS for the overlay layer sitting above a cover image.
 * Rendered as an absolutely positioned div covering the photo.
 */
export function overlayStyle(
  type: string | null,
  opacity: number | null
): React.CSSProperties | null {
  const o = opacity ?? 0.35
  const kind = (type ?? 'none') as OverlayType

  if (kind === 'none') return null

  if (kind === 'darken') {
    return { background: `rgba(12, 10, 9, ${o})` }
  }

  if (kind === 'gradient') {
    return {
      background: `linear-gradient(to top, rgba(12,10,9,${Math.min(o * 1.8, 0.95)}) 0%, rgba(12,10,9,0) 65%)`,
    }
  }

  if (kind === 'grain') {
    return {
      backgroundImage: GRAIN_DATA_URI,
      opacity: o,
      mixBlendMode: 'overlay',
    }
  }

  // darken_grain is rendered as two stacked layers by the caller
  return { background: `rgba(12, 10, 9, ${o})` }
}

export function hasGrain(type: string | null): boolean {
  return type === 'grain' || type === 'darken_grain'
}
