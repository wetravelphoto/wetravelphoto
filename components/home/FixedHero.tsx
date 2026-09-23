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
  editable = false,
}: FixedHeroProps) {
  const field = (key: string) => (editable ? { 'data-field': key } : {})
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
    <section
      className="hero"
      data-title-pos={markPosition}
      style={styleVars}
      {...(editable ? { 'data-live': 'title_position', 'data-type-root': '' } : {})}
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

      {showMark && (
        <div className="hero-mark">
          <Logo src={logoUrl} text={siteTitle} alt={siteTitle} tone="light" height={0} className="hero-wordmark" />
        </div>
      )}

      {(title || subtitle || (ctaLabel && ctaHref) || editable) && (
        <div className="hero-fixed-copy">
          {(title || editable) && (
            <h1 className="hero-fixed-title" {...field('title')}>
              {title}
            </h1>
          )}
          {(subtitle || editable) && (
            <p className="hero-fixed-sub" {...field('subtitle')}>
              {subtitle}
            </p>
          )}
          {ctaLabel && ctaHref && (
            <Link href={ctaHref} className="hero-fixed-cta" {...field('cta_label')}>
              {ctaLabel}
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
