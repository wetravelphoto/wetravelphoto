import { albumBySlug, photosForAlbum } from '@/lib/album-access'
import { photoUrl } from '@/lib/images'
import { srcSetFor, displayUrl, srcSetFromPath } from '@/lib/srcset'
import { formatTripDate } from '@/lib/dates'
import SiteHeader from '@/components/SiteHeader'
import AlbumPasswordGate from '@/components/AlbumPasswordGate'
import TripCover from '@/components/TripCover'
import ViewTracker from '@/components/ViewTracker'
import GalleryView from '@/components/GalleryView'
import { getSiteSettings } from '@/lib/site'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import '../../gallery.css'

export default async function TripPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // A password-gated album cannot be read with the anon key any more — its row
  // carries password_hash, and the policy that used to expose it handed that
  // to anyone who asked. albumBySlug reads it server-side and strips the hash
  // before it can reach a page. The gate below is unchanged.
  const album = await albumBySlug(slug)

  if (!album) notFound()
  if (album.privacy_type === 'client_only') notFound()

  if (album.privacy_type === 'password') {
    const cookieStore = await cookies()
    const granted = cookieStore.get(`album_access_${album.id}`)?.value === 'granted'
    // Photographs are fetched below, after this returns — a locked album never
    // loads them at all, so there is nothing in the payload to read past.
    if (!granted) return <AlbumPasswordGate slug={slug} title={album.title as string} />
  }

  const orderColumn = album.sort_order === 'manual' ? 'sort_order' : 'taken_at'
  const ascending = album.sort_order !== 'date_desc'

  const settings = await getSiteSettings()

  // Explicit columns, not '*'. At 300 photographs the unused columns (tags,
  // gps, timestamps) are pure weight in the server-rendered payload, which is
  // sent to every visitor whether they scroll that far or not.
  // The anon key can read a public album's photographs under RLS; anything
  // else needs the privileged read, and we only get here once its gate has
  // passed.
  const photos = await photosForAlbum(
    album.id,
    orderColumn as string,
    ascending,
    album.privacy_type === 'public'
  )

  const coverPhoto = photos?.find((p) => p.id === album.cover_photo_id) ?? photos?.[0]

  // The cover is the largest thing on the page and was being served at full
  // size with no alternatives offered.
  const customCoverUrl = album.cover_custom_path ? photoUrl(album.cover_custom_path) : null
  const imageUrl = customCoverUrl ?? (coverPhoto ? displayUrl(coverPhoto) : null)
  const imageSrcSet = customCoverUrl
    ? srcSetFromPath(customCoverUrl)
    : coverPhoto
      ? srcSetFor(coverPhoto)
      : undefined

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
      <ViewTracker albumId={album.id} />
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
        photos={photos ?? []}
        layoutStyle={album.layout_style ?? 'masonry'}
        publicUrl={process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''}
        heroFirst={album.gallery_hero ?? false}
        galleryTitle={album.title}
        siteTitle={settings.site_title}
        canDownload={false}
      />
    </main>
  )
}
