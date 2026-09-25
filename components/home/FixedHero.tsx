'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ROWS, COLUMNS, spot, type Spot } from '@/lib/sections/spots'

export type FixedHeroProps = {
  imageUrl: string | null
  title: string | null
  subtitle: string | null
  ctaLabel: string | null
  ctaHref: string | null
  focal: { x: number; y: number }
  focalMobile: { x: number; y: number }
  /** Where each piece of copy sits on the photograph. See lib/sections/spots.ts. */
  titleSpot: Spot
  subtitleSpot: Spot
  ctaSpot: Spot
  styleVars?: React.CSSProperties
  /**
   * True only inside the editor's preview: tags the title, subtitle and button
   * so each can be hovered and selected on its own. This component takes props
   * rather than a settings object, so the flag comes in the same way.
   */
  editable?: boolean
}

/**
 * A single standing hero image — used when there are no featured stories, or
 * when the site would rather lead with one photograph than a rotation.
 *
 * ── The nine places ─────────────────────────────────────────────────────────
 *
 * The title, subtitle and button used to be one block welded to the bottom of
 * the picture, centred, with a "Title position" control that did not move
 * them. Each now names its own place out of nine (lib/sections/spots.ts) and
 * is rendered into that place's container; two that choose the same place
 * stack in reading order rather than landing on top of one another.
 *
 * Every container is rendered, empty ones included. That costs nine divs and
 * buys two things: the editor can light up a place while something is being
 * dragged towards it, and dropping an element there is a DOM move into the
 * very container the server will use — so the preview's instant feedback is
 * the same answer the refresh brings, not a second guess at it.
 */
export default function FixedHero({
  imageUrl,
  title,
  subtitle,
  ctaLabel,
  ctaHref,
  focal,
  focalMobile,
  titleSpot,
  subtitleSpot,
  ctaSpot,
  styleVars,
  editable = false,
}: FixedHeroProps) {
  const field = (key: string) => (editable ? { 'data-field': key } : {})
  /** Only in the editor: what the drag picks up, and which setting it writes. */
  const grip = (settingKey: string) =>
    editable ? { 'data-spot-drag': settingKey, draggable: false } : {}

  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const point = isMobile ? focalMobile : focal

  const at = {
    title: spot(titleSpot),
    subtitle: spot(subtitleSpot),
    cta: spot(ctaSpot),
  }

  const showTitle = Boolean(title) || editable
  const showSubtitle = Boolean(subtitle) || editable
  const showCta = Boolean(ctaLabel && ctaHref)

  return (
    <section
      className="hero"
      style={styleVars}
      {...(editable ? { 'data-type-root': '' } : {})}
    >
      <div className="hero-layer" data-active="true">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            fetchPriority="high"
            decoding="async"
            style={{ objectPosition: `${point.x * 100}% ${point.y * 100}%` }}
          />
        )}
      </div>

      <div className="hero-scrim" />

      <div className="hero-spots" {...(editable ? { 'data-spots': '' } : {})}>
        {ROWS.map((row) => (
          <div key={row} className="hero-row" data-row={row}>
            {COLUMNS.map((column) => {
              const here = `${row}-${column}` as Spot
              return (
                <div key={here} className="hero-spot" data-spot={here} data-col={column}>
                  {showTitle && at.title === here && (
                    <h1 className="hero-fixed-title" {...field('title')} {...grip('title_spot')}>
                      {title}
                    </h1>
                  )}
                  {showSubtitle && at.subtitle === here && (
                    <p className="hero-fixed-sub" {...field('subtitle')} {...grip('subtitle_spot')}>
                      {subtitle}
                    </p>
                  )}
                  {showCta && at.cta === here && (
                    <Link
                      href={ctaHref as string}
                      className="hero-fixed-cta"
                      {...field('cta_label')}
                      {...grip('cta_spot')}
                    >
                      {ctaLabel}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

    </section>
  )
}
