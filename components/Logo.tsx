/* eslint-disable @next/next/no-img-element */

/**
 * Falls back to the built-in marks when no custom logo has been uploaded,
 * so a fresh site still looks finished.
 */
const BUILT_IN = {
  word: '/logos/we-travel-photo-word.svg',
  wordmark: '/logos/we-travel-photo-wordmark.svg',
  full: '/logos/we-travel-photo-full.svg',
  bird: '/logos/we-travel-photo-bird.svg',
}

export default function Logo({
  variant = 'word',
  src,
  alt = '',
  tone = 'dark',
  height = 26,
  className,
}: {
  variant?: keyof typeof BUILT_IN
  src?: string | null
  alt?: string
  tone?: 'dark' | 'light'
  height?: number
  className?: string
}) {
  const source = src || BUILT_IN[variant]

  // Custom uploads are assumed to be supplied in the right colour already;
  // only the built-in marks get inverted for use over photographs.
  const invert = tone === 'light' && !src

  return (
    <img
      src={source}
      alt={alt}
      className={className}
      style={{
        height,
        width: 'auto',
        display: 'block',
        filter: invert ? 'brightness(0) invert(1)' : undefined,
      }}
    />
  )
}
