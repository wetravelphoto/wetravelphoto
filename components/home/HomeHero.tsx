'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Logo from '@/components/Logo'

export type HeroItem = {
  slug: string
  title: string
  subtitle: string | null
  imageUrl: string | null
  imageSrcSet?: string
  focal?: { x: number; y: number }
  focalMobile?: { x: number; y: number }
}

/**
 * Full-screen hero. The site wordmark sits over the photograph; the story
 * titles run along the bottom and swap the image on hover. On phones it
 * collapses to one thick bar with the current story and a button.
 */
export default function HomeHero({
  items,
  titlePosition = 'center',
  showMark = true,
  storyAlign = 'left',
  overlayTitle,
  overlaySubtitle,
  ctaLabel,
  ctaHref,
  styleVars,
  editable = false,
}: {
  items: HeroItem[]
  titlePosition?: string
  showMark?: boolean
  storyAlign?: string
  overlayTitle?: string | null
  overlaySubtitle?: string | null
  ctaLabel?: string | null
  ctaHref?: string | null
  /**
   * True only inside the editor's preview: tags the overlay title, subtitle and
   * button so each can be hovered and selected on its own. The story titles
   * along the bottom are NOT tagged — they come from the posts themselves and
   * are overridden through a custom editor, not a plain text field.
   */
  editable?: boolean
  styleVars?: React.CSSProperties
}) {
  const [active, setActive] = useState(0)
  // Held here so the rotation can be paused while a story is being edited.
  const [pinned, setPinned] = useState<number | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  /**
   * In the editor, the panel can ask for one story to be held on screen.
   * Without it, editing the second story's crop happens against whichever
   * photograph the rotation happens to be showing — which is editing blind.
   *
   * ABOVE the early return, because hooks have to run in the same order on
   * every render and `items.length === 0` is a real case — a site with no
   * published stories renders nothing here.
   */
  useEffect(() => {
    if (!editable) return

    const onPin = (e: Event) => {
      const index = (e as CustomEvent<{ index: number | null }>).detail?.index ?? null
      setPinned(index)
      if (index !== null) setActive(index)
    }

    window.addEventListener('wtp:hero-story', onPin)
    return () => window.removeEventListener('wtp:hero-story', onPin)
  }, [editable])

  if (items.length === 0) return null

  /**
   * What is actually on screen. `active` is the rotation; `pinned` is the
   * editor holding one story still. Everything below reads THIS — an earlier
   * version pinned only the words, so hovering a story title slid the
   * photograph out from under the crop being edited.
   */
  const shown = pinned ?? active
  const current = items[shown]

  function step(direction: 1 | -1) {
    setActive((i) => (i + direction + items.length) % items.length)
  }

  return (
    <section
      className="hero"
      data-title-pos={titlePosition}
      data-story-align={storyAlign}
      style={styleVars}
      // In the editor: both layout attributes and the typography variables on
      // this element can be changed live. See LiveSpec in the registry.
      {...(editable
        ? { 'data-live': 'title_position story_align', 'data-type-group': 'hero' }
        : {})}
    >
      {items.map((item, i) => {
        // Fall back to centre if no focal point has been set for this story
        const point = (isMobile ? item.focalMobile : item.focal) ?? { x: 0.5, y: 0.5 }
        return (
          <div key={item.slug} className="hero-layer" data-active={i === shown} aria-hidden={i !== shown}>
            {item.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                srcSet={item.imageSrcSet}
                sizes="100vw"
                alt=""
                loading={i === 0 ? 'eager' : 'lazy'}
                /* The first hero is the largest thing a visitor waits for */
                fetchPriority={i === 0 ? 'high' : 'auto'}
                decoding="async"
                style={{ objectPosition: `${point.x * 100}% ${point.y * 100}%` }}
              />
            )}
          </div>
        )
      })}

      <div className="hero-scrim" />

      {/* The site's own mark carries the image; the story is named below */}
      {showMark && (
        <div className="hero-mark">
          <Logo variant="word" tone="light" height={0} className="hero-wordmark" />
        </div>
      )}

      {/* Copy that belongs to the site rather than to any one story */}
      {(overlayTitle || overlaySubtitle || (ctaLabel && ctaHref) || editable) && (
        <div className="hero-overlay-copy">
          {(overlayTitle || editable) && (
            <p className="hero-fixed-title" {...(editable ? { 'data-field': 'title' } : {})}>
              {overlayTitle}
            </p>
          )}
          {(overlaySubtitle || editable) && (
            <p className="hero-fixed-sub" {...(editable ? { 'data-field': 'subtitle' } : {})}>
              {overlaySubtitle}
            </p>
          )}
          {ctaLabel && ctaHref && (
            <Link
              href={ctaHref}
              className="hero-fixed-cta"
              {...(editable ? { 'data-field': 'cta_label' } : {})}
            >
              {ctaLabel}
            </Link>
          )}
        </div>
      )}

      {/* --- phones: one bar, the current story, a button --- */}
      <div className="hero-bar-mobile">
        <div className="hero-bar-progress">
          {items.map((_, i) => (
            <span key={i} data-active={i === shown} />
          ))}
        </div>

        <button
          type="button"
          className="hero-bar-arrow"
          onClick={() => step(-1)}
          aria-label="Previous story"
        >
          &#8249;
        </button>

        <div className="hero-bar-copy">
          <p className="hero-bar-title">{current.title}</p>
          {current.subtitle && <p className="hero-bar-sub">{current.subtitle}</p>}
          <Link href={`/journal/${current.slug}`} className="hero-bar-cta">
            View story
          </Link>
        </div>

        <button type="button" className="hero-bar-arrow" onClick={() => step(1)} aria-label="Next story">
          &#8250;
        </button>
      </div>

      {/* --- wider screens: all three titles --- */}
      <nav className="hero-picker" aria-label="Featured stories">
        {items.map((item, i) => (
          <Link
            key={item.slug}
            href={`/journal/${item.slug}`}
            className="hero-picker-item"
            data-active={i === shown}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
          >
            <span className="hero-picker-bar" />
            <span className="hero-picker-body">
              <span className="hero-picker-title">{item.title}</span>
              {item.subtitle && <span className="hero-picker-sub">{item.subtitle}</span>}
            </span>
            <span className="hero-picker-cta">View story</span>
          </Link>
        ))}
      </nav>
    </section>
  )
}
