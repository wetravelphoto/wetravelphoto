/* eslint-disable @next/next/no-img-element */

/**
 * THE SITE'S NAME, HOWEVER IT IS DRAWN
 * ════════════════════════════════════
 *
 * This used to fall back to a set of built-in SVGs when no logo had been
 * uploaded, "so a fresh site still looks finished". With one site that was
 * true and harmless. With two it is the worst kind of bug: those files are
 * WeTravelPhoto's wordmark and WeTravelPhoto's bird, so the first thing a new
 * photographer saw at the top of their own homepage was **somebody else's
 * brand** — not a placeholder they would think to replace, but a finished-
 * looking mark belonging to a stranger.
 *
 * So the fallback is now the site's own name, set in its own display
 * typeface. It is what Squarespace and Format do, for the same reason: a name
 * in good type is not a compromise, it is a perfectly respectable wordmark,
 * and it is *theirs* on the first render with nothing uploaded and nothing
 * configured.
 *
 * The order:
 *
 *   1. `src` — a logo the photographer uploaded. Always wins.
 *   2. `text` — the site's name, set as type.
 *   3. nothing at all — rather than a mark belonging to another site.
 *
 * The built-in files still exist and still work; they are simply no longer a
 * *default*. WeTravelPhoto's own rows name them explicitly
 * (db/migrations/2026-09-23_own_marks.sql), so that site is unchanged.
 */

export default function Logo({
  src,
  text,
  alt = '',
  tone = 'dark',
  height = 26,
  className,
}: {
  /** An uploaded logo. A full URL, or null when there is none. */
  src?: string | null
  /** The site's name, drawn as type when there is no uploaded logo. */
  text?: string | null
  alt?: string
  tone?: 'dark' | 'light'
  height?: number
  className?: string
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        style={{
          // A height of 0 hands sizing to CSS, so it can differ per device
          height: height === 0 ? undefined : height,
          width: 'auto',
          display: 'block',
        }}
      />
    )
  }

  const name = (text ?? '').trim()
  if (!name) return null

  /**
   * Type, not an image. `currentColor` means it inherits whatever the header,
   * footer or hero has already decided about colour — including the light
   * treatment over a photograph — so there is nothing here to keep in step
   * with the `tone` of a picture behind it.
   *
   * `1em` under a height of 0 lets the surrounding CSS size it exactly as it
   * sizes an uploaded logo, so a site that later uploads one does not shift.
   */
  return (
    <span
      className={className}
      data-logo="text"
      style={{
        display: 'block',
        fontFamily: 'var(--font-display, var(--admin-font, serif))',
        fontSize: height === 0 ? undefined : height * 0.62,
        lineHeight: 1.1,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: tone === 'light' ? '#faf9f6' : 'currentColor',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </span>
  )
}
