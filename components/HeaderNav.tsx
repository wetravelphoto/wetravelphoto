'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Logo from '@/components/Logo'
import type { NavLink } from '@/lib/menu'

export default function HeaderNav({
  overHero = false,
  siteTitle,
  logoUrl,
  logoHeight,
  align = 'split',
  navStyle,
  links,
}: {
  overHero?: boolean
  siteTitle: string
  logoUrl: string | null
  logoHeight: number
  align?: string
  navStyle?: React.CSSProperties
  /** The menu, resolved (lib/menu.ts). Folders carry `children`. */
  links: NavLink[]
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

  // The homepage is only "active" on itself, not on every address.
  const isActive = (href: string) =>
    !!href && !href.startsWith('http') && (href === '/' ? pathname === '/' : pathname.startsWith(href))

  // The phone menu always offers the way home, unless the menu already does.
  const hasHome = links.some((l) => l.href === '/' || l.children?.some((c) => c.href === '/'))

  const mode = overHero && !scrolled ? 'over' : 'solid'

  return (
    <>
      {/* data-chrome: what the editor's preview selects and repaints. */}
      <header
        className="site-header"
        data-chrome="header"
        data-mode={mode}
        data-align={align}
        style={navStyle}
      >
        <Link href="/" aria-label={siteTitle}>
          <Logo
            src={logoUrl}
            text={siteTitle}
            alt={siteTitle}
            tone={mode === 'over' ? 'light' : 'dark'}
            height={0}
            className="site-logo"
          />
        </Link>

        <nav className="site-nav">
          {links.map((link) =>
            link.children ? (
              // A folder: its heading opens the list on hover and on focus
              // (keyboard), with no script — see .site-nav-folder in home.css.
              <div key={link.id} className="site-nav-folder">
                <button
                  type="button"
                  className="site-nav-folder-label"
                  aria-haspopup="true"
                  data-active={link.children.some((c) => isActive(c.href))}
                >
                  {link.label}
                </button>
                <div className="site-nav-dropdown">
                  {link.children.map((child) => (
                    <MenuLink key={child.id} link={child} active={isActive(child.href)} />
                  ))}
                </div>
              </div>
            ) : (
              <MenuLink key={link.id} link={link} active={isActive(link.href)} />
            )
          )}
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
          {!hasHome && (
            <Link href="/" onClick={() => setMenuOpen(false)}>
              Home
            </Link>
          )}
          {links.map((link) =>
            link.children ? (
              <div key={link.id} className="mobile-menu-folder">
                <span className="mobile-menu-folder-label">{link.label}</span>
                {link.children.map((child) => (
                  <MenuLink key={child.id} link={child} onClick={() => setMenuOpen(false)} />
                ))}
              </div>
            ) : (
              <MenuLink key={link.id} link={link} onClick={() => setMenuOpen(false)} />
            )
          )}
        </div>
      )}
    </>
  )
}

/** One menu entry: a page on this site, or a link elsewhere. */
function MenuLink({
  link,
  active,
  onClick,
}: {
  link: NavLink
  active?: boolean
  onClick?: () => void
}) {
  if (link.external) {
    return (
      <a
        href={link.href}
        onClick={onClick}
        {...(link.newTab ? { target: '_blank' } : {})}
        rel="noopener noreferrer"
      >
        {link.label}
      </a>
    )
  }
  return (
    <Link href={link.href} data-active={active} onClick={onClick}>
      {link.label}
    </Link>
  )
}
