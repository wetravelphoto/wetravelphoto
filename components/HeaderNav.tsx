'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Logo from '@/components/Logo'

export default function HeaderNav({
  overHero = false,
  siteTitle,
  logoUrl,
  logoHeight,
  align = 'split',
  navStyle,
  labels,
  showAbout = true,
}: {
  overHero?: boolean
  siteTitle: string
  logoUrl: string | null
  logoHeight: number
  align?: string
  navStyle?: React.CSSProperties
  labels: { galleries: string; journal: string; about: string; contact: string }
  showAbout?: boolean
}) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    if (!overHero) return
    function onScroll() {
      setScrolled(window.scrollY > window.innerHeight * 0.7)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [overHero])

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  const links = [
    { href: '/trips', label: labels.galleries },
    { href: '/journal', label: labels.journal },
    ...(showAbout ? [{ href: '/about', label: labels.about }] : []),
    { href: '/contact', label: labels.contact },
  ]

  const mode = overHero && !scrolled ? 'over' : 'solid'

  return (
    <>
      <header className="site-header" data-mode={mode} data-align={align} style={navStyle}>
        <Link href="/" aria-label={siteTitle}>
          <Logo
            variant="word"
            src={logoUrl}
            alt={siteTitle}
            tone={mode === 'over' ? 'light' : 'dark'}
            height={0}
            className="site-logo"
          />
        </Link>

        <nav className="site-nav">
          {links.map((link) => (
            <Link key={link.href} href={link.href} data-active={pathname.startsWith(link.href)}>
              {link.label}
            </Link>
          ))}
        </nav>

        <button className="menu-toggle" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <svg width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M0 1h22M0 7h22M0 13h22" />
          </svg>
        </button>
      </header>

      {menuOpen && (
        <div className="mobile-menu">
          <button className="mobile-menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            &times;
          </button>
          <Link href="/" onClick={() => setMenuOpen(false)}>
            Home
          </Link>
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
