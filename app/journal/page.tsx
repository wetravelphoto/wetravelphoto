import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import { getSiteSettings } from '@/lib/site'
import { srcSetFromPath } from '@/lib/srcset'
import { formatTripDate } from '@/lib/dates'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import JournalCard from '@/components/blog/JournalCard'
import './journal.css'
import './journal-cards.css'
import type { Metadata } from 'next'

export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  return {
    title: `${settings.journal_page_heading || 'Journal'} — ${settings.site_title}`,
    description: settings.tagline ?? undefined,
  }
}

type PostRow = {
  id: string
  slug: string
  title: string
  category: string | null
  excerpt: string | null
  featured_photo_id: string | null
  featured_custom_path: string | null
  byline: string | null
  published_at: string | null
  photos: { storage_path: string } | null
}

export default async function JournalPage() {
  const supabase = await createClient()
  const settings = await getSiteSettings()

  const { data } = await supabase
    .from('blog_posts')
    .select('id, slug, title, category, excerpt, featured_custom_path, byline, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  const posts = (data ?? []) as unknown as PostRow[]

  function coverFor(post: PostRow): string | null {
    return post.featured_custom_path ? photoUrl(post.featured_custom_path) : null
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 5rem' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          {settings.journal_page_eyebrow && (
            <p className="eyebrow" style={{ margin: '0 0 0.75rem' }}>
              {settings.journal_page_eyebrow}
            </p>
          )}
          <h1
            className="display"
            style={{ fontSize: 'clamp(2rem, 5vw, 3.1rem)', margin: '0 0 3rem', lineHeight: 1 }}
          >
            {settings.journal_page_heading || 'Journal'}
          </h1>

          {posts.length > 0 ? (
            <div
              className="journal-grid"
              style={
                {
                  ['--journal-title-scale' as string]: String(settings.journal_title_scale ?? 1),
                } as React.CSSProperties
              }
            >
              {posts.map((post, i) => (
                <JournalCard
                  key={post.id}
                  slug={post.slug}
                  title={post.title}
                  category={post.category}
                  excerpt={post.excerpt}
                  byline={post.byline}
                  dateLabel={
                    post.published_at ? formatTripDate(post.published_at, 'full') : null
                  }
                  imageUrl={coverFor(post)}
                  imageSrcSet={srcSetFromPath(coverFor(post))}
                  feature={i === 0}
                  showExcerpt={settings.journal_show_excerpt !== false}
                  showByline={settings.journal_show_byline === true}
                  showDate={settings.journal_show_date === true}
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
