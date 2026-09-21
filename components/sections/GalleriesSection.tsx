import { photoUrl } from '@/lib/images'
import { formatTripDate } from '@/lib/dates'
import { styleVars } from '@/lib/type-styles'
import { num, str, type SectionSettings } from '@/lib/sections/registry'
import { editable, typeGroup } from '@/lib/sections/editable'
import type { SectionContext } from '@/lib/sections/context'
import DragCarousel, { type CarouselItem } from '@/components/home/DragCarousel'

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
