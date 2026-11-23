import { openGallery } from '@/lib/photos/public'
import { photoUrl } from '@/lib/images'
import { formatTripDate } from '@/lib/dates'
import SiteHeader from '@/components/SiteHeader'
import AlbumPasswordGate from '@/components/AlbumPasswordGate'
import TripCover from '@/components/TripCover'
import GalleryView from '@/components/GalleryView'
import { getSiteSettings } from '@/lib/site'
import { notFound } from 'next/navigation'
import '../../gallery.css'

export default async function TripPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // The album's own gate (lib/album-access.ts openAlbum, through
  // lib/photos/public.ts): a password-gated album's row is read server-side
  // with its hash stripped; a client-only album is not here; a locked album
  // never loads its photographs at all, so there is nothing in the payload to
  // read past. Only an open album's photographs and cover are resolved, and
  // what reaches the browser is a view of each — never the row.
  const gallery = await openGallery(slug)

  if (gallery.status === 'missing') notFound()
  if (gallery.status === 'locked') {
    return <AlbumPasswordGate slug={slug} title={gallery.album.title as string} />
  }

  const { album, photos } = gallery
  const settings = await getSiteSettings()

  // The cover is the largest thing on the page: a custom cover with the ladder
  // derived from its path, the chosen photograph or the first, with its sizes.
  const imageUrl = gallery.cover.coverUrl
  const imageSrcSet = gallery.cover.coverSrcSet

  const dateLabel = formatTripDate(
    album.trip_start_date ?? album.created_at,
    album.cover_date_format ?? 'month_year'
  )

  const showText = album.cover_title_enabled !== false
  const tags = album.show_tags === false ? [] : ((album.tags as string[] | null) ?? [])
  const descAlign = (album.description_align ?? 'left') as 'left' | 'center' | 'right'
  const descScale = album.description_scale ?? 1

  return (
    <main>
      <SiteHeader />

      {imageUrl && (
        <TripCover
          settings={{
            title: showText ? album.cover_title_text || album.title : '',
            subtitle: showText ? album.cover_subtitle : null,
            location: album.location,
            dateLabel,
            showLocation: showText && album.cover_show_location,
            showDate: showText && album.cover_show_date,
            layout: album.cover_preset,
            font: album.cover_font,
            titleScale: album.cover_title_scale ?? 1,
            color: album.cover_title_color,
            focalX: album.cover_focal_x ?? 0.5,
            focalY: album.cover_focal_y ?? 0.5,
            overlayType: album.cover_overlay_type,
            overlayOpacity: album.cover_overlay_opacity ?? 0.35,
            imageUrl,
            imageSrcSet,
            videoUrl: album.cover_video_path ? photoUrl(album.cover_video_path) : null,
            showButton: showText && album.cover_show_button,
            buttonText: album.cover_button_text,
          }}
        />
      )}

      <div id="gallery" style={{ padding: '0 clamp(1.25rem, 4vw, 3rem)' }}>
        {album.description && (
          <p
            style={{
              maxWidth: descAlign === 'center' ? '58ch' : '52ch',
              color: 'var(--ink-soft)',
              lineHeight: 1.8,
              margin: descAlign === 'center' ? '1.5rem auto 0' : '1.5rem 0 0',
              marginLeft: descAlign === 'right' ? 'auto' : undefined,
              fontSize: `${(1.0625 * descScale).toFixed(3)}rem`,
              textAlign: descAlign,
            }}
          >
            {album.description}
          </p>
        )}

        {tags.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              marginTop: '1rem',
              justifyContent: descAlign === 'center' ? 'center' : descAlign === 'right' ? 'flex-end' : 'flex-start',
            }}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="meta"
                style={{ border: '0.5px solid var(--line)', padding: '0.15rem 0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <GalleryView
        photos={photos}
        layoutStyle={album.layout_style ?? 'masonry'}
        heroFirst={album.gallery_hero ?? false}
        galleryTitle={album.title}
        siteTitle={settings.site_title}
        canDownload={false}
      />
    </main>
  )
}
