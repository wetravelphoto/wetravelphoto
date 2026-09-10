import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import { estimateReadMinutes, type Block } from '@/lib/blocks'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import PostBody from '@/components/blog/PostBody'
import ShareRail from '@/components/blog/ShareRail'
import JournalCard from '@/components/blog/JournalCard'
import ViewTracker from '@/components/ViewTracker'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import '../journal.css'

export const revalidate = 60

async function getPost(slug: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('blog_posts')
    .select('*, albums(title, slug)')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  return data
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) return { title: 'Not found' }

  const featured = post.featured_custom_path ? photoUrl(post.featured_custom_path) : undefined

  const seoTitle = post.seo_title || post.title
  const seoDescription = post.seo_description || post.excerpt || undefined

  return {
    title: `${seoTitle} — WeTravelPhoto`,
    description: seoDescription,
    robots: post.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: seoTitle,
      description: seoDescription,
      type: 'article',
      publishedTime: post.published_at ?? undefined,
      images: featured ? [featured] : undefined,
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) notFound()

  const supabase = await createClient()
  const { data: related } = await supabase
    .from('blog_posts')
    .select('id, slug, title, category, excerpt, featured_custom_path')
    .eq('status', 'published')
    .neq('id', post.id)
    .order('published_at', { ascending: false })
    .limit(4)

  const blocks = (post.blocks as Block[] | null) ?? []
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

  const featuredPath = post.featured_custom_path ?? null

  const readMinutes = post.read_minutes ?? estimateReadMinutes(blocks)
  const album = post.albums as { title: string; slug: string } | null
  const tags = (post.tags as string[] | null) ?? []

  // Pull the intro out so it can render above the featured image
  const leadBlock = blocks.find((b) => b.type === 'lead') as { type: 'lead'; text: string } | undefined
  const bodyBlocks = blocks.filter((b) => b.type !== 'lead')

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <ViewTracker postId={post.id} />
      <SiteHeader />
      <ShareRail title={post.title} />

      <article style={{ flex: 1, paddingTop: '6.5rem', paddingBottom: '4rem' }}>
        <div className="post-shell">
          <p className="post-breadcrumb">
            <Link href="/journal">Journal</Link>
            {post.category && (
              <>
                <span className="sep">/</span>
                <span className="cat">{post.category}</span>
              </>
            )}
          </p>

          <h1 className="post-title">{post.title}</h1>

          <p className="post-meta">
            {post.published_at && (
              <span>
                {new Date(post.published_at).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            )}
            <span>·</span>
            <span>{readMinutes} min read</span>
          </p>

          {/* The intro sits above the featured image, as in the reference layout */}
          {leadBlock ? (
            <p className="post-lead">{leadBlock.text}</p>
          ) : (
            post.excerpt && <p className="post-lead">{post.excerpt}</p>
          )}

          {featuredPath && (
            <figure className="post-figure-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl(featuredPath)}
                alt=""
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </figure>
          )}

          <PostBody blocks={bodyBlocks} publicUrl={publicUrl} />

          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '2.5rem' }}>
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="meta"
                  style={{
                    border: '0.5px solid var(--line)',
                    padding: '0.15rem 0.5rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {album && (
            <div
              style={{
                borderTop: '0.5px solid var(--line)',
                marginTop: '3rem',
                paddingTop: '1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
                flexWrap: 'wrap',
              }}
            >
              <span className="meta">From the {album.title} collection</span>
              <Link href={`/trips/${album.slug}`} className="underline-link" style={{ fontSize: '0.78rem' }}>
                View album
              </Link>
            </div>
          )}
        </div>

        {related && related.length > 0 && (
          <div style={{ maxWidth: 1200, margin: '5rem auto 0', padding: '0 clamp(1.25rem, 4vw, 3rem)' }}>
            <p className="keep-reading-head">Keep reading</p>
            <div className="journal-grid">
              {related.map((r) => {
                const path = r.featured_custom_path ?? null
                return (
                  <JournalCard
                    key={r.id}
                    slug={r.slug}
                    title={r.title}
                    category={r.category}
                    excerpt={null}
                    imageUrl={path ? photoUrl(path) : null}
                    showExcerpt={false}
                  />
                )
              })}
            </div>
          </div>
        )}
      </article>

      <SiteFooter />
    </main>
  )
}
