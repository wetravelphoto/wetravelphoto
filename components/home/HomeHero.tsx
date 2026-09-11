'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Logo from '@/components/Logo'

export type HeroItem = {
  slug: string
  title: string
  subtitle: string | null
  imageUrl: string | null
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
  styleVars,
}: {
  items: HeroItem[]
  titlePosition?: string
  showMark?: boolean
  styleVars?: React.CSSProperties
}) {
  const [active, setActive] = useState(0)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  if (items.length === 0) return null
  const current = items[active]

  function step(direction: 1 | -1) {
    setActive((i) => (i + direction + items.length) % items.length)
  }

  return (
    <section className="hero" data-title-pos={titlePosition} style={styleVars}>
      {items.map((item, i) => {
        // Fall back to centre if no focal point has been set for this story
        const point = (isMobile ? item.focalMobile : item.focal) ?? { x: 0.5, y: 0.5 }
        return (
          <div key={item.slug} className="hero-layer" data-active={i === active} aria-hidden={i !== active}>
            {item.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt=""
                loading={i === 0 ? 'eager' : 'lazy'}
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

      {/* --- phones: one bar, the current story, a button --- */}
      <div className="hero-bar-mobile">
        <div className="hero-bar-progress">
          {items.map((_, i) => (
            <span key={i} data-active={i === active} />
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
            data-active={i === active}
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
