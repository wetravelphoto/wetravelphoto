import { photoUrl } from '@/lib/images'
import { formatTripDate } from '@/lib/dates'
import { styleVars } from '@/lib/type-styles'
import { num, str, type SectionSettings } from '@/lib/sections/registry'
import { editable, typeGroup } from '@/lib/sections/editable'
import type { SectionContext } from '@/lib/sections/context'
import Link from 'next/link'
import DragCarousel, { type CarouselItem } from '@/components/home/DragCarousel'
import CoverRenderer from '@/components/CoverRenderer'
import '@/app/gallery.css'

export default function GalleriesSection({
  settings,
  ctx,
}: {
  settings: SectionSettings
  ctx: SectionContext
}) {
  const limit = num(settings, 'limit', 0)
  const albums = limit > 0 ? ctx.albums.slice(0, limit) : ctx.albums

  // Each card shows the gallery's own composed cover, not just its first photo
  const items: CarouselItem[] = albums.map((album) => {
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

  if (str(settings, 'layout') === 'grid') {
    // The Galleries page: every gallery as a tile under a page heading. This is
    // the markup app/trips/page.tsx used to draw by hand. It takes no section
    // typography: its heading has its own type in gallery.css, and applying
    // the intro group here would restyle a page that never followed it.
    const eyebrow = str(settings, 'eyebrow')

    return (
      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 4rem' }}>
        <div className="gallery-index-head">
          {(eyebrow || ctx.editable) && (
            <p className="gallery-index-eyebrow" {...editable(ctx, 'eyebrow')}>
              {eyebrow}
            </p>
          )}
          <h1 className="gallery-index-heading" {...editable(ctx, 'heading')}>
            {str(settings, 'heading') || 'Galleries'}
          </h1>
        </div>

        {items.length > 0 ? (
          <div className="gallery-grid-public">
            {items.map((item) => (
              <Link key={item.href} href={item.href} className="gallery-tile">
                <div className="gallery-tile-cover">
                  {/* The gallery's own composed cover, as set in its settings */}
                  <CoverRenderer
                    height="100%"
                    sizes="(max-width: 620px) 100vw, (max-width: 1000px) 50vw, 33vw"
                    settings={item.cover}
                  />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--ink-mute)' }}>
            {ctx.albumError ? `Couldn't load galleries: ${ctx.albumError}` : 'Nothing published yet.'}
          </p>
        )}
      </div>
    )
  }

  return (
    <section className="carousel-section" style={styleVars(ctx.styles, 'intro')} {...typeGroup(ctx, 'intro')}>
      <div className="carousel-head">
        <h2 {...editable(ctx, 'heading')}>{str(settings, 'heading') || 'Recent trips'}</h2>
      </div>

      {items.length > 0 ? (
        <DragCarousel items={items} />
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
          {ctx.albumError
            ? `Couldn't load galleries: ${ctx.albumError}`
            : 'Nothing to show yet. Make a gallery public and give it a cover photo.'}
        </div>
      )}
    </section>
  )
}
