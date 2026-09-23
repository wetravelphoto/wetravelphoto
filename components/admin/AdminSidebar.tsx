'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PLATFORM } from '@/lib/platform'

const groups: { label: string; links: { href: string; label: string; exact?: boolean }[] }[] = [
  {
    label: 'Content',
    links: [
      { href: '/admin', label: 'Dashboard', exact: true },
      { href: '/admin/trips', label: 'Galleries' },
      { href: '/admin/journal', label: 'Journal' },
      { href: '/admin/pages', label: 'Pages' },
    ],
  },
  {
    label: 'Selling',
    links: [
      { href: '/admin/shop/catalog', label: 'Catalogue' },
      { href: '/admin/shop/scenes', label: 'Room' },
      { href: '/admin/shop', label: 'Sizes & categories', exact: true },
      { href: '/admin/shop/settings', label: 'Shop settings' },
    ],
  },
  {
    label: 'People',
    links: [
      { href: '/admin/clients', label: 'Clients' },
      { href: '/admin/messages', label: 'Messages' },
    ],
  },
  {
    label: 'Site',
    links: [
      { href: '/admin/design', label: 'Design' },
      { href: '/admin/settings', label: 'Settings' },
    ],
  },
]

export default function AdminSidebar({
  email,
  unreadCount = 0,
  platformAdmin = false,
}: {
  email: string
  unreadCount?: number
  /** Shows the cross-site group. Nobody else has anything to see there. */
  platformAdmin?: boolean
}) {
  const pathname = usePathname()

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  return (
    <aside className="admin-sidebar">
      {/* The platform's name, not the site's: this is the photographer's
          workspace. Their site's own name is on the site. */}
      <Link href="/admin" className="admin-brand">
        {PLATFORM.name}
      </Link>

      <nav className="admin-nav">
        {(platformAdmin
          ? [...groups, { label: PLATFORM.name, links: [{ href: '/admin/sites', label: 'Sites' }] }]
          : groups
        ).map((group) => (
          <div key={group.label} className="admin-nav-group">
            <p className="admin-nav-label">{group.label}</p>
            {group.links.map((link) => (
              <Link key={link.href} href={link.href} data-active={isActive(link.href, link.exact)}>
                {link.label}
                {link.href === '/admin/messages' && unreadCount > 0 && (
                  <span className="admin-nav-badge">{unreadCount}</span>
                )}
              </Link>
            ))}
          </div>
        ))}

        <div className="admin-nav-group">
          <Link href="/" target="_blank">
            View site ↗
          </Link>
        </div>
      </nav>

      <div className="admin-sidebar-foot">
        <p style={{ margin: '0 0 0.5rem', wordBreak: 'break-all' }}>{email}</p>
        <form action="/admin/logout" method="post">
          <button type="submit">Sign out</button>
        </form>
      </div>
    </aside>
  )
}
