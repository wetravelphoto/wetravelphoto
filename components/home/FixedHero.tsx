'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ROWS, COLUMNS, drawnAt, type DrawnAt, type Spot, type SpotPair } from '@/lib/sections/spots'
import { sizesFor, type Shown } from '@/lib/sections/shown'
import type { TextVars } from '@/lib/sections/text-style'

/**
 * WHAT IS BEHIND THE WORDS.
 *
 * One shape for all three, so the hero draws a backdrop rather than branching
 * on which kind it got in four different places.
 */
export type Backdrop = {
  kind: 'image' | 'video' | 'color'
  imageUrl: string | null
  videoUrl: string | null
  /** Shown while the video loads — and INSTEAD of it, for reduced motion. */
  posterUrl: string | null
  color: string
  /** 0–80. How much darker, so the words stay readable. */
  dim: number
}

export type FixedHeroProps = {
  backdrop: Backdrop
  title: string | null
  subtitle: string | null
  ctaLabel: string | null
  ctaHref: string | null
  focal: { x: number; y: number }
  focalMobile: { x: number; y: number }
  /**
   * Where each piece of copy sits on the photograph, per size. See
   * lib/sections/spots.ts — the phone follows the desktop until it is given a
   * place of its own.
   */
  titleSpot: SpotPair
  subtitleSpot: SpotPair
  ctaSpot: SpotPair
  /** Which sizes each piece is drawn on. See lib/sections/shown.ts. */
  shown?: Record<string, Shown>
  /**
   * Typography chosen for individual pieces of text, keyed by the field name.
   * Written as custom properties on the element itself; the stylesheet reads
   * them in front of the section's own, so an unset one falls through.
   */
  text?: TextVars
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
  backdrop,
  title,
  subtitle,
  ctaLabel,
  ctaHref,
  focal,
  focalMobile,
  titleSpot,
  subtitleSpot,
  ctaSpot,
  shown = {},
  text = {},
  styleVars,
  editable = false,
}: FixedHeroProps) {
  const field = (key: string) => (editable ? { 'data-field': key } : {})
  /**
   * This piece of copy's own typography, for every device at once — as PROPS,
   * not a style object. The custom properties only become the `--txt-*` the
   * stylesheet reads because of a rule keyed on `data-txt`, so the attribute
   * travels with them and cannot be left off.
   */
  const own = (key: string) => text[key] ?? {}
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
  const crop = `${point.x * 100}% ${point.y * 100}%`

  const showTitle = Boolean(title) || editable
  const showSubtitle = Boolean(subtitle) || editable
  const showCta = Boolean(ctaLabel && ctaHref)

  /**
   * WHICH WIDTHS THIS NODE IS FOR — null when this place is not one of them.
   *
   * An element sits inside the container for its place, because that is what
   * makes two elements sharing a place stack rather than overlap, and CSS
   * cannot move a node between containers. So one that sits somewhere else on
   * the phone is drawn in both containers with one hidden at each width
   * (app/hero.css), and one that only appears on the phone is not drawn for
   * the desktop at all.
   *
   * `both` is the common case and the default: drawn once, hidden never,
   * nothing duplicated.
   */
  const placed = (pair: SpotPair, field: string, here: Spot): DrawnAt | null =>
    drawnAt(pair, here, sizesFor(shown[field] ?? 'all'))

  /** The attribute, present only when there is something for CSS to do. */
  const only = (kind: DrawnAt) => (kind === 'both' ? {} : { 'data-at': kind })

  return (
    <section
      className="hero"
      data-backdrop={backdrop.kind}
      style={
        {
          ...styleVars,
          '--hero-bg': backdrop.color,
          '--hero-dim': `${backdrop.dim}%`,
        } as React.CSSProperties
      }
      {...(editable ? { 'data-type-root': '' } : {})}
    >
      <div className="hero-layer" data-active="true" data-kind={backdrop.kind}>
        {backdrop.kind === 'image' && backdrop.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backdrop.imageUrl}
            alt=""
            fetchPriority="high"
            decoding="async"
            style={{ objectPosition: crop }}
          />
        )}

        {backdrop.kind === 'video' && backdrop.videoUrl && (
          /*
           * SILENT, LOOPING, AND NOT THE ONLY THING THERE.
           *
           * `muted` is not a preference: a video that asks to autoplay with
           * sound is blocked by every browser, so without it the hero would
           * simply not play. `playsInline` stops iOS taking it fullscreen the
           * moment it starts.
           *
           * The poster is what a visitor sees while it downloads, and it is
           * ALSO what they see instead of it when they have asked their
           * system for less motion — a full-screen moving backdrop is exactly
           * what that setting is for. That choice is made in CSS
           * (prefers-reduced-motion in app/hero.css) rather than here,
           * because it can change without a new page being served.
           */
          <video
            src={backdrop.videoUrl}
            poster={backdrop.posterUrl ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            // Decorative: it carries no information the words do not.
            aria-hidden="true"
            tabIndex={-1}
            style={{ objectPosition: crop }}
          />
        )}

        {/* The still, for reduced motion and for the moment before the video
            has enough of itself to play. CSS decides which of the two shows. */}
        {backdrop.kind === 'video' && backdrop.posterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="hero-still"
            src={backdrop.posterUrl}
            alt=""
            fetchPriority="high"
            decoding="async"
            style={{ objectPosition: crop }}
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
                  {showTitle &&
                    (() => {
                      const at = placed(titleSpot, 'title', here)
                      return (
                        at && (
                          <h1
                            className="hero-fixed-title"
                            {...own('title')}
                            {...only(at)}
                            {...field('title')}
                            {...grip('title_spot')}
                          >
                            {title}
                          </h1>
                        )
                      )
                    })()}
                  {showSubtitle &&
                    (() => {
                      const at = placed(subtitleSpot, 'subtitle', here)
                      return (
                        at && (
                          <p
                            className="hero-fixed-sub"
                            {...own('subtitle')}
                            {...only(at)}
                            {...field('subtitle')}
                            {...grip('subtitle_spot')}
                          >
                            {subtitle}
                          </p>
                        )
                      )
                    })()}
                  {showCta &&
                    (() => {
                      const at = placed(ctaSpot, 'cta_label', here)
                      return (
                        at && (
                          <Link
                            href={ctaHref as string}
                            className="hero-fixed-cta"
                            {...own('cta_label')}
                            {...only(at)}
                            {...field('cta_label')}
                            {...grip('cta_spot')}
                          >
                            {ctaLabel}
                          </Link>
                        )
                      )
                    })()}
                </div>
              )
            })}
          </div>
        ))}
      </div>

    </section>
  )
}
