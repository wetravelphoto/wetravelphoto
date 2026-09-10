import { createClient } from '@/lib/supabase/server'
import JournalTable from '@/components/admin/JournalTable'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function BlogListPage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('blog_posts')
    .select('*, profiles(display_name, email)')
    .order('created_at', { ascending: false })

  const posts = (data ?? []).map((post) => {
    const author = post.profiles as { display_name: string | null; email: string } | null
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      category: post.category,
      status: post.status,
      published_at: post.published_at,
      created_at: post.created_at,
      author: author?.display_name || author?.email?.split('@')[0] || '',
    }
  })

  return (
    <div style={{ maxWidth: 980 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.75rem',
          flexWrap: 'wrap',
        }}
      >
        <h1 className="admin-h1">Journal</h1>
        <Link href="/admin/journal/new" className="admin-btn">
          New story
        </Link>
      </div>

      {posts.length > 0 ? (
        <JournalTable posts={posts} />
      ) : (
        <div className="admin-empty">
          <p style={{ margin: '0 0 1rem' }}>No stories yet.</p>
          <Link href="/admin/journal/new" className="admin-btn">
            Write your first story
          </Link>
        </div>
      )}
    </div>
  )
}
