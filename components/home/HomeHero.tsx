'use client'

import { useState } from 'react'
import Link from 'next/link'

export type HeroItem = {
  slug: string
  title: string
  subtitle: string | null
  imageUrl: string | null
}

/**
 * Full-screen hero. The image cross-fades as you hover the titles along the
 * bottom; it holds on whichever story you land on.
 */
export default function HomeHero({
  items,
  styleVars,
}: {
  items: HeroItem[]
  styleVars?: React.CSSProperties
}) {
  const [active, setActive] = useState(0)

  if (items.length === 0) return null
  const current = items[active]

  return (
    <section className="hero" style={styleVars}>
      {items.map((item, i) => (
        <div key={item.slug} className="hero-layer" data-active={i === active} aria-hidden={i !== active}>
          {item.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" loading={i === 0 ? 'eager' : 'lazy'} />
          )}
        </div>
      ))}

      <div className="hero-scrim" />

      <div className="hero-center">
        <h1 className="hero-title">
          <Link href={`/journal/${current.slug}`}>{current.title}</Link>
        </h1>
        {current.subtitle && <p className="hero-sub">{current.subtitle}</p>}
        <Link href={`/journal/${current.slug}`} className="hero-cta">
          Read the story
        </Link>
      </div>

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
            <span className="hero-picker-index">{String(i + 1).padStart(2, '0')}</span>
            <span className="hero-picker-title">{item.title}</span>
          </Link>
        ))}
      </nav>
    </section>
  )
}
