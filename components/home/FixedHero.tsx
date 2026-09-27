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
  /**
   * WHAT A PHONE SHOWS INSTEAD, WHEN IT HAS BEEN GIVEN SOMETHING OF ITS OWN.
   *
   * Null — the usual case, and every site that has never touched it — means
   * the phone shows the same backdrop, drawn once, with nothing duplicated and
   * nothing hidden.
   *
   * Already resolved when it is here: the desktop's values showing through
   * wherever the phone has none (lib/sections/backdrop.ts), so this component
   * never has to know what "following" means.
   */
  backdropMobile?: Backdrop | null
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

/** The one breakpoint the site has. Kept beside DEVICE_QUERY, which is its twin. */
const PHONE_WIDTH = '(max-width: 760px)'
const WIDE_WIDTH = '(min-width: 761px)'

/**
 * A PHOTOGRAPH — OR TWO, OF WHICH THE BROWSER FETCHES ONE.
 *
 * `<source media>` is the whole reason a per-size backdrop is worth having
 * rather than merely possible. Two `<img>` elements with one hidden by CSS
 * would download both: `display: none` is a painting instruction and the
 * fetch has already started by the time it applies. A `<picture>` settles the
 * question in the parser, before anything goes over the wire.
 *
 * `<img>` carries no `src` when the two differ. That is deliberate and not a
 * bug: inside a `<picture>` the `src` is the LAST resort, so giving it one
 * would hand a phone the desktop's photograph in any browser that decided it
 * preferred the fallback. The sources cover every width between them, and the
 * one width a source does not cover is a width the element is removed at.
 */
function Still({
  wide,
  phone,
  crop,
  className,
}: {
  /** Wide screens. Null when this size shows something else entirely. */
  wide: string | null
  phone: string | null
  crop: string
  className?: string
}) {
  if (!wide && !phone) return null

  const common = {
    className,
    fetchPriority: 'high' as const,
    decoding: 'async' as const,
    style: { objectPosition: crop },
  }

  // The common case, and every site that has never touched the phone: one
  // photograph, one element, nothing to choose between.
  // eslint-disable-next-line @next/next/no-img-element
  if (wide === phone) return <img src={wide as string} alt="" {...common} />

  return (
    <picture>
      {phone && <source media={PHONE_WIDTH} srcSet={phone} />}
      {wide && <source media={WIDE_WIDTH} srcSet={wide} />}
      <img
        alt=""
        {...common}
        {...(wide && phone ? {} : { 'data-at': wide ? 'desktop' : 'mobile' })}
      />
    </picture>
  )
}

/**
 * SILENT, LOOPING, AND NOT THE ONLY THING THERE.
 *
 * `muted` is not a preference: a video that asks to autoplay with sound is
 * blocked by every browser, so without it the hero would simply not play.
 * `playsInline` stops iOS taking it fullscreen the moment it starts.
 *
 * The poster is what a visitor sees while it downloads. What they see INSTEAD
 * of it, when they have asked their system for less motion, is the still
 * beneath — chosen in CSS (prefers-reduced-motion in app/hero.css) rather than
 * here, because that can change on a device without a new page being served.
 *
 * Whether this is in the page at all is decided by the caller, and for a film
 * only one width plays, by the browser: see `splitFilm`.
 */
function Film({
  url,
  poster,
  crop,
  ...rest
}: {
  url: string
  poster: string | null
  crop: string
} & React.HTMLAttributes<HTMLVideoElement>) {
  return (
    <video
      src={url}
      poster={poster ?? undefined}
      autoPlay
      muted
      loop
      playsInline
      // Decorative: it carries no information the words do not.
      aria-hidden="true"
      tabIndex={-1}
      style={{ objectPosition: crop }}
      {...rest}
    />
  )
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
  backdropMobile = null,
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

  /**
   * WHICH WIDTH THIS IS — AND NULL UNTIL THE BROWSER HAS SAID.
   *
   * Three states rather than two, because "not a phone" and "not yet known"
   * are different answers and exactly one thing depends on the difference: a
   * film that the OTHER size does not show must not be in the served markup at
   * all, or the phone starts downloading a video it will never play before a
   * line of JavaScript has run — which is the whole point of letting the
   * backdrop differ. Where both sizes play the same film it is rendered on the
   * server as it always was, and none of this is consulted.
   */
  const [narrow, setNarrow] = useState<boolean | null>(null)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const isMobile = narrow === true
  const mounted = narrow !== null

  const point = isMobile ? focalMobile : focal
  const crop = `${point.x * 100}% ${point.y * 100}%`

  /*
   * ── WHAT EACH WIDTH FETCHES ────────────────────────────────────────────────
   *
   * One backdrop per size, reduced to three questions: is there a photograph,
   * is there a film, is there a still under it. A backdrop that is a color
   * answers no to all three, which is also why a photograph left over from a
   * previous choice is never fetched.
   */
  const phone = backdropMobile ?? backdrop
  const pick = (b: Backdrop) => ({
    image: b.kind === 'image' ? b.imageUrl : null,
    video: b.kind === 'video' ? b.videoUrl : null,
    still: b.kind === 'video' ? b.posterUrl : null,
  })
  const wide = pick(backdrop)
  const small = pick(phone)

  /**
   * A FILM ONLY ONE WIDTH PLAYS IS MOUNTED BY THAT WIDTH.
   *
   * `<source media>` settles a photograph before anything is fetched, so two
   * photographs cost one download. A `<video>` has no such trick worth
   * trusting — `display: none` does not stop the download, and a media
   * attribute on a `<source>` inside a video element is ignored by browsers —
   * so the only honest answer is not to put it in the page.
   */
  const splitFilm = wide.video !== small.video
  const showWideFilm = wide.video && (!splitFilm || (mounted && !isMobile))
  const showSmallFilm = small.video && splitFilm && mounted && isMobile

  /** The attribute, present only where there is something for CSS to hide. */
  const at = (kind: 'desktop' | 'mobile') => (splitFilm ? { 'data-at': kind } : {})

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
      /*
       * THE ELEMENT THE EDITOR REPAINTS WHILE A SLIDER MOVES.
       *
       * `dim` and the background color each declare a `live` property in the
       * registry, and a declaration is a promise: the renderer must write that
       * exact property on an element tagged `data-live` with the setting's
       * name, or the editor writes it into thin air.
       *
       * This section never carried the tag. The controls still worked, slowly,
       * because the save's re-render drew them — and then the editor stopped
       * asking for a re-render when a change had already been painted, which
       * this had not been, and both controls went from slow to silent. A
       * `live` field with nothing behind it is now a test failure.
       */
      {...(editable ? { 'data-live': 'dim backdrop_color backdrop' } : {})}
      /*
       * The phone's kind, only where it differs — it is what tells the
       * stylesheet whether to draw the gradient over a photograph or leave a
       * flat color alone at that width.
       */
      {...(backdropMobile && backdropMobile.kind !== backdrop.kind
        ? { 'data-backdrop-m': backdropMobile.kind }
        : {})}
      /*
       * BOTH SIZES' VALUES AT ONCE, UNDER TWO NAMES.
       *
       * An inline style attribute cannot carry a media query, so the darkening
       * and the color go on as `-d` and `-m` and one rule in app/hero.css
       * resolves them into the `--hero-dim` and `--hero-bg` the rest of the
       * stylesheet reads. Same mechanism as the per-element typography in
       * globals.css, for the same reason: an unset custom property makes its
       * consumer's own fallback apply, so "the phone has not been given one"
       * needs no value to express.
       */
      style={
        {
          ...styleVars,
          '--hero-bg-d': backdrop.color,
          '--hero-dim-d': `${backdrop.dim}%`,
          ...(backdropMobile
            ? {
                '--hero-bg-m': backdropMobile.color,
                '--hero-dim-m': `${backdropMobile.dim}%`,
              }
            : {}),
        } as React.CSSProperties
      }
      {...(editable ? { 'data-type-root': '' } : {})}
    >
      <div className="hero-layer" data-active="true" data-kind={backdrop.kind}>
        {/* The photograph — or two, of which exactly one is fetched. */}
        <Still wide={wide.image} phone={small.image} crop={crop} />

        {/* The still under a film, on the same terms. It is what shows while
            the film downloads and INSTEAD of it for anyone who has asked for
            less motion (app/hero.css), so it is a real element, not just the
            poster attribute. */}
        <Still className="hero-still" wide={wide.still} phone={small.still} crop={crop} />

        {showWideFilm && <Film url={wide.video as string} poster={wide.still} crop={crop} {...at('desktop')} />}
        {showSmallFilm && <Film url={small.video as string} poster={small.still} crop={crop} {...at('mobile')} />}
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
