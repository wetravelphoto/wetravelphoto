import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminDashboard() {
  const supabase = await createClient()

  const [albums, photos, posts, drafts, clients, unread, signups] = await Promise.all([
    supabase.from('albums').select('id', { count: 'exact', head: true }),
    supabase.from('photos').select('id', { count: 'exact', head: true }),
    supabase.from('blog_posts').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    supabase.from('blog_posts').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('clients').select('id', { count: 'exact', head: true }),
    supabase.from('contact_messages').select('id', { count: 'exact', head: true }).eq('is_read', false),
    supabase.from('newsletter_signups').select('id', { count: 'exact', head: true }),
  ])

  const since = new Date()
  since.setDate(since.getDate() - 30)

  const { data: views } = await supabase
    .from('page_views')
    .select('visitor_hash')
    .gte('viewed_at', since.toISOString())

  const uniqueVisitors = new Set(views?.map((v) => v.visitor_hash)).size

  const { data: recentAlbums } = await supabase
    .from('albums')
    .select('id, title, privacy_type, updated_at, photos(id)')
    .order('updated_at', { ascending: false })
    .limit(4)

  const { data: recentPosts } = await supabase
    .from('blog_posts')
    .select('id, title, status, updated_at')
    .order('updated_at', { ascending: false })
    .limit(4)

  return (
    <div style={{ maxWidth: 980 }}>
      <h1 className="admin-h1" style={{ marginBottom: '0.4rem' }}>
        Dashboard
      </h1>
      <p className="admin-meta" style={{ margin: '0 0 1.75rem' }}>
        {views?.length ?? 0} page views · {uniqueVisitors} visitors in the last 30 days
      </p>

      <div className="stat-row">
        <Stat label="Trips" value={albums.count ?? 0} href="/admin/trips" />
        <Stat label="Photographs" value={photos.count ?? 0} />
        <Stat label="Published stories" value={posts.count ?? 0} href="/admin/journal" />
        <Stat label="Drafts" value={drafts.count ?? 0} href="/admin/journal" />
        <Stat label="Clients" value={clients.count ?? 0} href="/admin/clients" />
        <Stat label="Unread messages" value={unread.count ?? 0} href="/admin/messages" tone={unread.count ? 'alert' : undefined} />
        <Stat label="Newsletter signups" value={signups.count ?? 0} />
      </div>

      <div className="dash-split">
        <section className="admin-panel">
          <div className="dash-head">
            <h2 className="admin-h2" style={{ margin: 0 }}>
              Recent trips
            </h2>
            <Link href="/admin/trips/new" className="admin-btn admin-btn-sm">
              New trip
            </Link>
          </div>

          {recentAlbums && recentAlbums.length > 0 ? (
            <ul className="dash-list">
              {recentAlbums.map((album) => (
                <li key={album.id}>
                  <Link href={`/admin/trips/${album.id}`}>{album.title}</Link>
                  <span className="admin-tag" data-tone={album.privacy_type === 'public' ? 'live' : 'private'}>
                    {album.privacy_type.replace('_', ' ')}
                  </span>
                  <span className="admin-meta">{(album.photos as { id: string }[])?.length ?? 0} photos</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-meta" style={{ margin: 0 }}>
              No trips yet.
            </p>
          )}
        </section>

        <section className="admin-panel">
          <div className="dash-head">
            <h2 className="admin-h2" style={{ margin: 0 }}>
              Recent stories
            </h2>
            <Link href="/admin/journal/new" className="admin-btn admin-btn-sm">
              New story
            </Link>
          </div>

          {recentPosts && recentPosts.length > 0 ? (
            <ul className="dash-list">
              {recentPosts.map((post) => (
                <li key={post.id}>
                  <Link href={`/admin/journal/${post.id}`}>{post.title}</Link>
                  <span className="admin-tag" data-tone={post.status === 'published' ? 'live' : undefined}>
                    {post.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-meta" style={{ margin: 0 }}>
              No stories yet.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  href,
  tone,
}: {
  label: string
  value: number
  href?: string
  tone?: 'alert'
}) {
  const body = (
    <>
      <p className="stat-value" data-tone={tone}>
        {value}
      </p>
      <p className="admin-meta" style={{ margin: '0.3rem 0 0' }}>
        {label}
      </p>
    </>
  )

  if (href) {
    return (
      <Link href={href} className="admin-panel stat-card">
        {body}
      </Link>
    )
  }

  return <div className="admin-panel stat-card">{body}</div>
}
