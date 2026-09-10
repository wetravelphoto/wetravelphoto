import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import { getSiteSettings } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import HomeHero, { type HeroItem } from '@/components/home/HomeHero'
import DragCarousel, { type CarouselItem } from '@/components/home/DragCarousel'
import ContactForm from '@/components/ContactForm'
import Link from 'next/link'
import './home.css'

export const revalidate = 60

type PostRow = {
  id: string
  slug: string
  title: string
  category: string | null
  excerpt: string | null
  featured_custom_path: string | null
  published_at: string | null
}

type AlbumRow = {
  id: string
  slug: string
  title: string
  location: string | null
  cover_photo_id: string | null
  cover_custom_path: string | null
  photos: { id: string; storage_path: string }[]
}

export default async function HomePage() {
  const supabase = await createClient()
  const settings = await getSiteSettings()

  const { data: postData } = await supabase
    .from('blog_posts')
    .select('id, slug, title, category, excerpt, featured_custom_path, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  const posts = (postData ?? []) as PostRow[]

  // Hand-picked hero stories if set, otherwise the three most recent
  const featuredIds = settings.featured_post_ids ?? []
  const featured = featuredIds.length
    ? (featuredIds.map((id) => posts.find((p) => p.id === id)).filter(Boolean) as PostRow[])
    : posts.slice(0, 3)

  const heroTitles = (settings.hero_titles ?? {}) as Record<string, string>

  const heroItems: HeroItem[] = featured.slice(0, 3).map((post) => ({
    slug: post.slug,
    // A hero display name overrides the story title here only
    title: heroTitles[post.id] || post.title,
    category: post.category,
    imageUrl: post.featured_custom_path ? photoUrl(post.featured_custom_path) : null,
  }))

  // The journal row shows the three newest stories, whatever the hero uses
  const latestPosts = posts.slice(0, settings.journal_count ?? 3)

  const { data: albumData, error: albumError } = await supabase
    .from('albums')
    .select('*, photos!photos_album_id_fkey(id, storage_path)')
    .eq('privacy_type', 'public')
    .order('created_at', { ascending: false })

  const albums = (albumData ?? []) as unknown as AlbumRow[]

  function albumCover(album: AlbumRow): string | null {
    if (album.cover_custom_path) return photoUrl(album.cover_custom_path)
    const list = album.photos ?? []
    const cover = list.find((p) => p.id === album.cover_photo_id) ?? list[0]
    return cover ? photoUrl(cover.storage_path) : null
  }

  const carouselItems: CarouselItem[] = albums.map((album) => ({
    href: `/trips/${album.slug}`,
    title: album.title,
    meta: album.location,
    imageUrl: albumCover(album),
  }))

  const introParagraphs = (settings.intro_body ?? '').split('\n\n').filter(Boolean)

  return (
    <main>
      <SiteHeader overHero={heroItems.length > 0} />

      {heroItems.length > 0 ? (
        <HomeHero items={heroItems} />
      ) : (
        <div style={{ height: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p className="meta">Publish a story with a featured image to fill the hero.</p>
        </div>
      )}

      {settings.show_intro !== false &&
        (settings.intro_heading || introParagraphs.length > 0 || settings.intro_image_path) && (
        <section className="home-section">
          <div className="home-inner intro-grid" data-side={settings.intro_image_side}>
            {settings.intro_image_path && (
              <div className="intro-media">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(settings.intro_image_path)} alt="" loading="lazy" />
              </div>
            )}

            <div>
              {settings.intro_kicker && <p className="intro-kicker">{settings.intro_kicker}</p>}
              {settings.intro_heading && <h2 className="intro-heading">{settings.intro_heading}</h2>}
              <div className="intro-body">
                {introParagraphs.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Galleries — the matted, draggable carousel */}
      {settings.show_galleries !== false && (
      <section className="carousel-section">
        <div className="carousel-head">
          <h2>{settings.carousel_heading || 'Recent trips'}</h2>
          <Link href="/trips">All trips</Link>
        </div>

        {carouselItems.length > 0 ? (
          <DragCarousel items={carouselItems} />
        ) : (
          <div
            style={{
              maxWidth: 1240,
              margin: '0 auto',
              padding: '2rem clamp(1.25rem, 4vw, 3rem)',
              opacity: 0.6,
              fontSize: '0.85rem',
            }}
          >
            {albumError
              ? `Couldn't load galleries: ${albumError.message}`
              : 'Nothing to show yet. Make a gallery public and give it a cover photo.'}
          </div>
        )}
      </section>
      )}

      {/* Journal — latest three, with a link through to the full index */}
      {settings.show_journal !== false && latestPosts.length > 0 && (
        <section className="home-section">
          <div className="home-inner">
            <div className="section-head">
              <h2 className="section-title">{settings.journal_heading || 'From the journal'}</h2>
            </div>

            <div className="journal-trio">
              {latestPosts.map((post) => (
                <Link key={post.id} href={`/journal/${post.slug}`} className="trio-card">
                  <div className="trio-media">
                    <div className="trio-image">
                      {post.featured_custom_path && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoUrl(post.featured_custom_path)} alt="" loading="lazy" />
                      )}
                    </div>
                    {post.category && <span className="trio-label">{post.category}</span>}
                  </div>

                  <h3 className="trio-title">{post.title}</h3>
                  {post.excerpt && <p className="trio-excerpt">{post.excerpt}</p>}
                </Link>
              ))}
            </div>

            <div className="section-cta">
              <Link href="/journal">View all stories</Link>
            </div>
          </div>
        </section>
      )}

      {settings.show_contact_section !== false && (
        <section className="home-section home-contact">
          <div className="home-inner contact-grid">
            <div>
              <h2>{settings.contact_heading || 'Get in touch'}</h2>
              {settings.contact_intro && (
                <p style={{ color: 'var(--ink-soft)', lineHeight: 1.8, margin: 0, maxWidth: '42ch' }}>
                  {settings.contact_intro}
                </p>
              )}
              {settings.email_public && (
                <p style={{ marginTop: '1.25rem' }}>
                  <a href={`mailto:${settings.email_public}`} className="underline-link" style={{ fontSize: '0.85rem' }}>
                    {settings.email_public}
                  </a>
                </p>
              )}
            </div>

            <ContactForm />
          </div>
        </section>
      )}

      <SiteFooter showNewsletter />
    </main>
  )
}
