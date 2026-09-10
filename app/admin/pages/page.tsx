import Link from 'next/link'

export const dynamic = 'force-dynamic'

const pages = [
  {
    href: '/admin/pages/home',
    title: 'Homepage',
    description: 'Hero stories, intro block, galleries carousel, journal row and contact section.',
    live: '/',
  },
  {
    href: '/admin/pages/about',
    title: 'About',
    description: 'The standalone about page. Separate from the intro block on the homepage.',
    live: '/about',
  },
  {
    href: '/admin/pages/contact',
    title: 'Contact',
    description: 'Intro copy and the public email shown above the form.',
    live: '/contact',
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
          The trips index, journal index and 404 page are laid out in code. If you want copy control over
          any of them, that&apos;s a small addition.
        </p>
      </div>
    </div>
  )
}
