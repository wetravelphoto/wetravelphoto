export function photoUrl(storagePath: string): string {
  return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${storagePath}`
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
