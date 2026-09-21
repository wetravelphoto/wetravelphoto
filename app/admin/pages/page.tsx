import Link from 'next/link'

export const dynamic = 'force-dynamic'

const pages = [
  {
    href: '/edit/home',
    title: 'Homepage',
    description: 'Edited on the page itself: sections, words, photographs, crops and type. Changes stay in a draft until you publish.',
    live: '/',
  },
  {
    href: '/edit/about',
    title: 'About',
    description: 'Edited on the page itself, as sections. Starts as your photograph beside your story.',
    live: '/about',
  },
  {
    href: '/edit/contact',
    title: 'Contact',
    description: 'Edited on the page itself, as sections. Starts as a heading, a few lines and the form.',
    live: '/contact',
  },
  {
    href: '/edit/journal',
    title: 'Journal',
    description: 'Edited on the page itself, as sections. Starts as every story, the newest drawn large.',
    live: '/journal',
  },
  {
    href: '/edit/galleries',
    title: 'Galleries',
    description: 'Edited on the page itself, as sections. Starts as every public gallery as a tile.',
    live: '/trips',
  },
  {
    href: '/edit/shop',
    title: 'Shop',
    description: 'Edited on the page itself, as sections: the print wall. Opening the shop, prices and shipping are in Shop settings.',
    live: '/shop',
  },
]

export default function PagesIndex() {
  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="admin-h1" style={{ marginBottom: '0.4rem' }}>
        Pages
      </h1>
      <p className="admin-meta" style={{ margin: '0 0 1.75rem' }}>
        Edit the copy and layout of each public page.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {pages.map((page) => (
          <div key={page.href} className="admin-panel page-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link href={page.href} className="page-row-title">
                {page.title}
              </Link>
              <p className="admin-meta" style={{ margin: '0.3rem 0 0', lineHeight: 1.55 }}>
                {page.description}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
              <Link href={page.live} target="_blank" className="admin-btn admin-btn-sm admin-btn-ghost">
                View ↗
              </Link>
              <Link href={page.href} className="admin-btn admin-btn-sm">
                Edit
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="admin-panel" style={{ marginTop: '1.25rem' }}>
        <h2 className="admin-h2">Not editable yet</h2>
        <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
          The 404 page is still laid out in code.
        </p>
      </div>
    </div>
  )
}
