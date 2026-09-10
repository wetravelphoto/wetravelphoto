import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import JournalCard from '@/components/blog/JournalCard'
import './journal.css'
import type { Metadata } from 'next'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Journal — WeTravelPhoto',
  description: 'Field notes and stories from the road, the water, and the cold places.',
}

type PostRow = {
  id: string
  slug: string
  title: string
  category: string | null
  excerpt: string | null
  featured_photo_id: string | null
  featured_custom_path: string | null
  published_at: string | null
  photos: { storage_path: string } | null
}

export default async function JournalPage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('blog_posts')
    .select('id, slug, title, category, excerpt, featured_photo_id, featured_custom_path, published_at, photos!blog_posts_featured_photo_id_fkey(storage_path)')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  const posts = (data ?? []) as unknown as PostRow[]

  function coverFor(post: PostRow): string | null {
    if (post.featured_custom_path) return photoUrl(post.featured_custom_path)
    if (post.photos?.storage_path) return photoUrl(post.photos.storage_path)
    return null
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 5rem' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <p className="eyebrow" style={{ margin: '0 0 0.75rem' }}>
            Field notes
          </p>
          <h1
            className="display"
            style={{ fontSize: 'clamp(2rem, 5vw, 3.1rem)', margin: '0 0 3rem', lineHeight: 1 }}
          >
            Journal
          </h1>

          {posts.length > 0 ? (
            <div className="journal-grid">
              {posts.map((post, i) => (
                <JournalCard
                  key={post.id}
                  slug={post.slug}
                  title={post.title}
                  category={post.category}
                  excerpt={post.excerpt}
                  imageUrl={coverFor(post)}
                  feature={i === 0}
                  showExcerpt={i === 0}
                />
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--ink-mute)' }}>No published entries yet.</p>
          )}
        </div>
      </div>

      <SiteFooter />
    </main>
  )
}
