import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import { attachCovers } from '@/lib/album-covers'
import { srcSetFromPath, SIZES_ATTR } from '@/lib/srcset'
import { formatTripDate } from '@/lib/dates'
import { getSiteSettings } from '@/lib/site'
import { getInstagramFeed } from '@/lib/instagram'
import InstagramFeed from '@/components/home/InstagramFeed'
import { styleVars, type TypeStyles } from '@/lib/type-styles'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import HomeHero, { type HeroItem } from '@/components/home/HomeHero'
import FixedHero from '@/components/home/FixedHero'
import DragCarousel, { type CarouselItem } from '@/components/home/DragCarousel'
import ContactSection from '@/components/ContactSection'
import BirdBadge from '@/components/BirdBadge'
import Link from 'next/link'
import './home.css'
import './home-polish.css'
import './hero.css'
import './instagram.css'
import './contact-footer.css'

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
  trip_start_date: string | null
  created_at: string
  cover_photo_id: string | null
  cover_custom_path: string | null
  cover_video_path: string | null
  cover_focal_x: number | null
  cover_focal_y: number | null
  cover_title_enabled: boolean | null
  cover_title_text: string | null
  cover_subtitle: string | null
  cover_preset: string | null
  cover_font: string | null
  cover_title_scale: number | null
  cover_title_color: string | null
  cover_overlay_type: string | null
  cover_overlay_opacity: number | null
  cover_show_location: boolean | null
  cover_show_date: boolean | null
  cover_date_format: string | null
  // Covers are resolved separately by attachCovers — see lib/album-covers.ts
}

export default async function HomePage() {
  const supabase = await createClient()
  const settings = await getSiteSettings()
  const styles = (settings.type_styles ?? {}) as TypeStyles

  const { data: postData } = await supabase
    .from('blog_posts')
    .select('id, slug, title, category, excerpt, featured_custom_path, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })

  const posts = (postData ?? []) as PostRow[]

  const featuredIds = settings.featured_post_ids ?? []
  const featured = featuredIds.length
    ? (featuredIds.map((id) => posts.find((p) => p.id === id)).filter(Boolean) as PostRow[])
    : posts.slice(0, 3)

  const heroTitles = (settings.hero_titles ?? {}) as Record<string, string>
  const heroSubtitles = (settings.hero_subtitles ?? {}) as Record<string, string>

  const heroFocal = (settings.hero_focal ?? {}) as Record<
    string,
    { x: number; y: number; mx: number; my: number }
  >

  const heroItems: HeroItem[] = featured.slice(0, 3).map((post) => {
    const point = heroFocal[post.id] ?? { x: 0.5, y: 0.5, mx: 0.5, my: 0.5 }

    return {
      slug: post.slug,
      // Display name and subtitle override the story's own copy in the hero only
      title: heroTitles[post.id] || post.title,
      subtitle: heroSubtitles[post.id] || null,
      imageUrl: post.featured_custom_path ? photoUrl(post.featured_custom_path) : null,
      // Without this the hero blocks first paint on a 2400px file
      imageSrcSet: post.featured_custom_path
        ? srcSetFromPath(photoUrl(post.featured_custom_path))
        : undefined,
      focal: { x: point.x, y: point.y },
      focalMobile: { x: point.mx, y: point.my },
    }
  })

  const latestPosts = posts.slice(0, settings.journal_count ?? 3)

  // No photo embed here. Fetching every photo of every gallery to pick one
  // cover each is what made this page time out and 502.
  const { data: albumData, error: albumError } = await supabase
    .from('albums')
    .select('*')
    .eq('privacy_type', 'public')
    // Same order as /trips and the admin grid — set by dragging in /admin/trips
    .order('display_order', { ascending: true })

  const albums = await attachCovers((albumData ?? []) as unknown as AlbumRow[])

  // Each card shows the gallery's own composed cover, not just its first photo
  const carouselItems: CarouselItem[] = albums.map((album) => {
    const showText = album.cover_title_enabled !== false

    return {
      href: `/trips/${album.slug}`,
      title: album.title,
      cover: {
        title: showText ? album.cover_title_text || album.title : '',
        subtitle: showText ? album.cover_subtitle : null,
        location: album.location,
        dateLabel: formatTripDate(
          album.trip_start_date ?? album.created_at,
          album.cover_date_format ?? 'month_year'
        ),
        showLocation: showText && !!album.cover_show_location,
        showDate: showText && !!album.cover_show_date,
        layout: album.cover_preset,
        font: album.cover_font,
        titleScale: album.cover_title_scale ?? 1,
        color: album.cover_title_color,
        focalX: album.cover_focal_x ?? 0.5,
        focalY: album.cover_focal_y ?? 0.5,
        overlayType: album.cover_overlay_type,
        overlayOpacity: album.cover_overlay_opacity ?? 0.35,
        imageUrl: album.coverUrl,
        // Lets the browser pick a 400/800px file for a card instead of the
        // 2400px one storage_path points at
        imageSrcSet: album.coverSrcSet,
        videoUrl: album.cover_video_path ? photoUrl(album.cover_video_path) : null,
        showButton: false,
      },
    }
  })

  const introParagraphs = (settings.intro_body ?? '').split('\n\n').filter(Boolean)

  const instagramPosts = settings.show_instagram ? await getInstagramFeed(9) : []

  return (
    <main>
      <SiteHeader overHero={heroItems.length > 0} />

      {/* Fall back to the standing image whenever there are no stories to show */}
      {settings.hero_mode === 'fixed' || heroItems.length === 0 ? (
        <FixedHero
          imageUrl={settings.hero_image_path ? photoUrl(settings.hero_image_path) : null}
          title={settings.hero_fixed_title}
          subtitle={settings.hero_fixed_subtitle}
          ctaLabel={settings.hero_fixed_cta_label}
          ctaHref={settings.hero_fixed_cta_href}
          focal={{
            x: settings.hero_fixed_focal?.x ?? 0.5,
            y: settings.hero_fixed_focal?.y ?? 0.5,
          }}
          focalMobile={{
            x: settings.hero_fixed_focal?.mx ?? 0.5,
            y: settings.hero_fixed_focal?.my ?? 0.5,
          }}
          showMark={settings.hero_show_mark !== false}
          markPosition={settings.hero_title_position ?? 'center'}
          logoUrl={settings.logo_header_path ? photoUrl(settings.logo_header_path) : null}
          siteTitle={settings.site_title}
          styleVars={styleVars(styles, 'hero')}
        />
      ) : (
        <HomeHero
          items={heroItems}
          titlePosition={settings.hero_title_position ?? 'center'}
          showMark={settings.hero_show_mark !== false}
          storyAlign={settings.hero_story_align ?? 'left'}
          overlayTitle={settings.hero_fixed_title}
          overlaySubtitle={settings.hero_fixed_subtitle}
          ctaLabel={settings.hero_fixed_cta_label}
          ctaHref={settings.hero_fixed_cta_href}
          styleVars={styleVars(styles, 'hero')}
        />
      )}

      <BirdBadge />

      {settings.show_intro !== false &&
        (settings.intro_heading || introParagraphs.length > 0 || settings.intro_image_path) && (
          <section className="home-section" style={styleVars(styles, 'intro')}>
            <div className="home-inner intro-grid" data-side={settings.intro_image_side}>
              {settings.intro_image_path && (
                <div className="intro-media">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl(settings.intro_image_path)}
                    srcSet={srcSetFromPath(photoUrl(settings.intro_image_path))}
                    sizes={SIZES_ATTR.halfWidth}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
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

      {settings.show_galleries !== false && (
        <section className="carousel-section" style={styleVars(styles, 'intro')}>
          <div className="carousel-head">
            <h2>{settings.carousel_heading || 'Recent trips'}</h2>
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

      {settings.show_journal !== false && latestPosts.length > 0 && (
        <section className="home-section" style={styleVars(styles, 'journal')}>
          <div className="home-inner">
            <div className="journal-section-head">
              <h2 className="section-title">{settings.journal_heading || 'From the journal'}</h2>
            </div>

            <div className="journal-trio">
              {latestPosts.map((post) => (
                <Link key={post.id} href={`/journal/${post.slug}`} className="trio-card">
                  <div className="trio-media">
                    <div className="trio-image">
                      {post.featured_custom_path && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photoUrl(post.featured_custom_path)}
                          srcSet={srcSetFromPath(photoUrl(post.featured_custom_path))}
                          sizes={SIZES_ATTR.grid}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
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

      {settings.show_instagram && (
        <InstagramFeed
          posts={instagramPosts}
          heading={settings.instagram_heading}
          handle={settings.instagram_handle}
        />
      )}

      {settings.show_contact_section !== false && (
        <ContactSection
          styleVars={styleVars(styles, 'contact')}
          settings={{
            eyebrow: settings.contact_eyebrow,
            heading: settings.contact_heading,
            intro: settings.contact_intro,
            note: settings.contact_note,
            tagline: settings.contact_tagline,
            imageUrl: settings.contact_image_path ? photoUrl(settings.contact_image_path) : null,
            imageSide: settings.contact_image_side ?? 'left',
            instagramUrl: settings.instagram_url,
            instagramHandle: settings.instagram_handle,
            facebookUrl: settings.facebook_url,
            youtubeUrl: settings.youtube_url,
            email: settings.email_public,
          }}
        />
      )}

      <SiteFooter />
    </main>
  )
}
