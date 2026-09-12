'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Logo from '@/components/Logo'

export type FixedHeroProps = {
  imageUrl: string | null
  title: string | null
  subtitle: string | null
  ctaLabel: string | null
  ctaHref: string | null
  focal: { x: number; y: number }
  focalMobile: { x: number; y: number }
  showMark: boolean
  markPosition: string
  logoUrl: string | null
  siteTitle: string
  styleVars?: React.CSSProperties
}

/**
 * A single standing hero image — used when there are no featured stories, or
 * when the site would rather lead with one photograph than a rotation.
 */
export default function FixedHero({
  imageUrl,
  title,
  subtitle,
  ctaLabel,
  ctaHref,
  focal,
  focalMobile,
  showMark,
  markPosition,
  logoUrl,
  siteTitle,
  styleVars,
}: FixedHeroProps) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const point = isMobile ? focalMobile : focal

  return (
    <section className="hero" data-title-pos={markPosition} style={styleVars}>
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

      {showMark && (
        <div className="hero-mark">
          <Logo variant="word" src={logoUrl} alt={siteTitle} tone="light" height={0} className="hero-wordmark" />
        </div>
      )}

      {(title || subtitle || (ctaLabel && ctaHref)) && (
        <div className="hero-fixed-copy">
          {title && <h1 className="hero-fixed-title">{title}</h1>}
          {subtitle && <p className="hero-fixed-sub">{subtitle}</p>}
          {ctaLabel && ctaHref && (
            <Link href={ctaHref} className="hero-fixed-cta">
              {ctaLabel}
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
