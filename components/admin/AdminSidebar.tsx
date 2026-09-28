'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import Icon, { type IconName } from '@/components/admin/Icon'
import { PLATFORM } from '@/lib/platform'

/**
 * THE RAIL
 * ════════
 *
 * ── Three groups, not one list ──────────────────────────────────────────────
 *
 * Website, Content and Business are three different jobs. Designing the site
 * is an afternoon; writing a journal entry is a Tuesday; answering an enquiry
 * is five minutes between shoots. A single list of eleven links makes you read
 * all eleven to find the one you want, every time, because there is nothing to
 * skip.
 *
 * Overview sits above the groups because it belongs to none of them.
 *
 * ── A destination that does not exist is drawn as one that does not exist ───
 *
 * Three of the places in this navigation have no page behind them in this
 * build: Domains, Media library, and Help & support. A fourth — Navigation —
 * exists only as a dialog inside the page editor.
 *
 * They are shown, greyed, marked "Soon", and not clickable. The alternative
 * was to leave them out, which hides the shape of the product, or to link them
 * to something that 404s, which is discovered by clicking — and once one link
 * in a sidebar has lied, the whole workspace is suspect. See `soon` below;
 * each one is a line to delete when its page lands.
 */

type Item = {
  label: string
  icon: IconName
  /** Absent for a destination this build does not have yet. */
  href?: string
  /** Only this exact path counts as being here — for a route others nest under. */
  exact?: boolean
  /** Other paths that mean the same place, so a sub-page keeps its rail item lit. */
  also?: string[]
  /** Why it is not clickable yet. Shown as the title, so hovering explains it. */
  soon?: string
}

type Group = { label?: string; items: Item[] }

const GROUPS: Group[] = [
  {
    items: [{ label: 'Overview', icon: 'overview', href: '/admin', exact: true }],
  },
  {
    label: 'Website',
    items: [
      { label: 'Pages', icon: 'pages', href: '/admin/pages', also: ['/edit'] },
      { label: 'Design', icon: 'design', href: '/admin/design' },
      {
        label: 'Navigation',
        icon: 'navigation',
        // It is real, but it lives inside the editor as "Pages & menu" rather
        // than as a screen of its own.
        href: '/edit/home?menu=1',
        soon: undefined,
      },
      {
        label: 'Domains',
        icon: 'domains',
        soon: 'Custom domains are not part of this build yet.',
      },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Galleries', icon: 'galleries', href: '/admin/trips' },
      { label: 'Journal', icon: 'journal', href: '/admin/journal' },
      {
        label: 'Media library',
        icon: 'media',
        soon: 'Photographs live inside their gallery in this build.',
      },
    ],
  },
  {
    label: 'Business',
    items: [
      { label: 'Store', icon: 'store', href: '/admin/shop' },
      { label: 'Clients', icon: 'clients', href: '/admin/clients' },
      { label: 'Inquiries', icon: 'inquiries', href: '/admin/messages' },
    ],
  },
]

const FOOT: Item[] = [
  { label: 'Settings', icon: 'settings', href: '/admin/settings' },
  { label: 'Help & support', icon: 'help', soon: 'No support centre in this build yet.' },
]

/**
 * Initials, for a site or a person with no picture on file.
 *
 * The FIRST two words, not the first and the last: "Gon Mata Photo" is GM,
 * which is how its owner would abbreviate it, and not GP, which is how a
 * naive first-and-last rule abbreviates it.
 */
function initials(name: string | null | undefined): string {
  // Never throws. It is called from inside the render of a component that
  // wraps every admin screen, so a missing name here would take the whole
  // workspace down rather than draw one empty circle.
  const parts = (name ?? '').replace(/@.*$/, '').split(/[.\s_-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export default function AdminSidebar({
  email,
  unreadCount = 0,
  platformAdmin = false,
  siteName = '',
  siteLogoUrl = null,
  role,
  open = false,
  onClose,
}: {
  email: string
  /** Real unread messages. Zero draws nothing — see the badge below. */
  unreadCount?: number
  platformAdmin?: boolean
  siteName?: string
  siteLogoUrl?: string | null
  /** owner / admin / editor. There are no plans in this build, so this is the
      only true thing to put in the badge's place. */
  role?: string | null
  /** Small screens only: the drawer is open. */
  open?: boolean
  onClose?: () => void
}) {
  const pathname = usePathname()
  const [account, setAccount] = useState(false)
  const foot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!account) return
    const away = (e: MouseEvent) => {
      if (!foot.current?.contains(e.target as Node)) setAccount(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAccount(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [account])

  const here = (item: Item) => {
    if (!item.href) return false
    const path = item.href.split('?')[0]
    if (item.exact) return pathname === path
    return pathname.startsWith(path) || (item.also ?? []).some((p) => pathname.startsWith(p))
  }

  const draw = (item: Item) => {
    const count = item.href === '/admin/messages' ? unreadCount : 0
    const inside = (
      <>
        <Icon name={item.icon} />
        <span className="lg-nav-name">{item.label}</span>
        {/* Only when there is something unread. A badge showing 0 is a badge
            reporting that nothing happened. */}
        {count > 0 && (
          <span className="lg-nav-count" aria-label={`${count} unread`}>
            {count}
          </span>
        )}
        {item.soon && <span className="lg-nav-soon">Soon</span>}
      </>
    )

    if (!item.href) {
      return (
        <span key={item.label} className="lg-nav-item" data-soon title={item.soon} aria-disabled>
          {inside}
        </span>
      )
    }

    return (
      <Link
        key={item.label}
        href={item.href}
        className="lg-nav-item"
        aria-current={here(item) ? 'page' : undefined}
        onClick={onClose}
      >
        {inside}
      </Link>
    )
  }

  const groups = platformAdmin
    ? [
        ...GROUPS,
        { label: PLATFORM.name, items: [{ label: 'Sites', icon: 'domains' as IconName, href: '/admin/sites' }] },
      ]
    : GROUPS

  return (
    <aside className="lg-rail" data-open={open || undefined} aria-label="Workspace">
      <div className="lg-rail-head">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/admin" className="lg-brand">
            <span className="lg-brand-mark" aria-hidden>
              <Icon name="overview" size={14} strokeWidth={2} />
            </span>
            {/* Lowercase on purpose: it is the wordmark, not a sentence. */}
            <span>{PLATFORM.name.replace(/\s+/g, '').toLowerCase()}</span>
          </Link>
          <button
            type="button"
            className="lg-ico lg-rail-close"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <Icon name="close" />
          </button>
        </div>

        {/*
          * WHICH SITE THIS IS.
          *
          * A chevron only where there is somewhere to go: a photographer has
          * one site, and a control that opens nothing is worse than no
          * control. A platform admin editing someone else's site does have a
          * list, and gets the menu.
          */}
        {platformAdmin ? (
          <Link href="/admin/sites" className="lg-site" onClick={onClose}>
            <span className="lg-site-avatar" aria-hidden>
              {siteLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={siteLogoUrl} alt="" />
              ) : (
                initials(siteName)
              )}
            </span>
            <span className="lg-site-name">{siteName || 'Your site'}</span>
            <Icon name="chevron-down" size={14} className="lg-site-chev" />
          </Link>
        ) : (
          <div className="lg-site">
            <span className="lg-site-avatar" aria-hidden>
              {siteLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={siteLogoUrl} alt="" />
              ) : (
                initials(siteName)
              )}
            </span>
            <span className="lg-site-name">{siteName || 'Your site'}</span>
          </div>
        )}
      </div>

      <nav className="lg-nav" aria-label="Sections">
        {groups.map((group, i) => (
          <div key={group.label ?? `top-${i}`} className="lg-nav-group">
            {group.label && <p className="lg-nav-label">{group.label}</p>}
            {group.items.map(draw)}
          </div>
        ))}
      </nav>

      <div className="lg-rail-foot" ref={foot}>
        {FOOT.map(draw)}

        <div className="lg-menu-wrap">
          <button
            type="button"
            className="lg-account"
            aria-expanded={account}
            aria-haspopup="menu"
            onClick={() => setAccount((v) => !v)}
          >
            <span className="lg-site-avatar" aria-hidden>
              {initials(email)}
            </span>
            <span className="lg-account-name">{email.replace(/@.*$/, '')}</span>
            {role && <span className="lg-account-role">{role}</span>}
            <Icon name="chevron-down" size={14} className="lg-site-chev" />
          </button>

          {account && (
            <div className="lg-menu" data-at="up" role="menu" style={{ right: 0, left: 'auto' }}>
              <p className="lg-menu-note" style={{ paddingTop: 8 }}>
                {email}
              </p>
              <div className="lg-menu-sep" />
              <Link href="/admin/settings" className="lg-menu-item" role="menuitem" onClick={onClose}>
                <Icon name="settings" size={15} />
                Settings
              </Link>
              <Link href="/" target="_blank" rel="noreferrer" className="lg-menu-item" role="menuitem">
                <Icon name="external" size={15} />
                View site
              </Link>
              <div className="lg-menu-sep" />
              <form action="/admin/logout" method="post">
                <button type="submit" className="lg-menu-item" role="menuitem">
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
