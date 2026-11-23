import { openGallery } from '@/lib/photos/public'
import { photoUrl } from '@/lib/images'
import SiteHeader from '@/components/SiteHeader'
import AlbumPasswordGate from '@/components/AlbumPasswordGate'
import GalleryView from '@/components/GalleryView'
import CoverFirst, { type FirstCover } from '@/components/gallery/CoverFirst'
import { albumCover, legacyCoverSettings } from '@/lib/covers/album-cover'
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

  // Every album that reached this point is open — public, unlisted, or a
  // password album past its gate (the locked and missing cases returned
  // above, before any photograph was resolved) — and every one opens on its
  // cover, full screen, with the gallery beneath (client-gallery-v2: cover
  // first for all privacy types). A registry style (`v2:<key>`) draws through
  // GalleryCover; a legacy preset — `plate` included — through the old
  // CoverRenderer with exactly the settings it always had
  // (legacyCoverSettings), only full screen and with a "View gallery" button.
  const image = gallery.cover.coverUrl ? { src: gallery.cover.coverUrl, srcSet: gallery.cover.coverSrcSet, alt: '' } : null
  const styled = albumCover({ album, cover: image, photos, siteTitle: settings.site_title })
  const videoUrl = album.cover_video_path ? photoUrl(album.cover_video_path) : null
  const first: FirstCover | null = styled
    ? { kind: 'style', ...styled }
    : image
      ? { kind: 'legacy', settings: legacyCoverSettings(album, image, videoUrl) }
      : null

  const body = (
    <>
      <SiteHeader />
      <div id={first ? undefined : 'gallery'}>
        <AlbumIntro album={album} />
      </div>
      <GalleryView
        photos={photos}
        layoutStyle={album.layout_style ?? (styled ? 'grid' : 'masonry')}
        heroFirst={album.gallery_hero ?? false}
        galleryTitle={album.title}
        siteTitle={settings.site_title}
        canDownload={false}
      />
    </>
  )

  // No cover photograph at all: nothing to open on, so the gallery as before.
  return <main>{first ? <CoverFirst cover={first}>{body}</CoverFirst> : body}</main>
}

/** The album's description and tags, between its cover and its photographs. */
function AlbumIntro({ album }: { album: Record<string, unknown> }) {
  const tags = album.show_tags === false ? [] : ((album.tags as string[] | null) ?? [])
  const descAlign = ((album.description_align as string | null) ?? 'left') as 'left' | 'center' | 'right'
  const descScale = (album.description_scale as number | null) ?? 1
  const description = album.description as string | null
  if (!description && tags.length === 0) return null
  return (
      <div style={{ padding: '0 clamp(1.25rem, 4vw, 3rem)' }}>
        {description && (
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
            {description}
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
  )
}
