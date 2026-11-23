import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import ClientGallery from '@/components/ClientGallery'
import CoverFirst, { type FirstCover } from '@/components/gallery/CoverFirst'
import { getSiteSettings } from '@/lib/site'
import { openSharedGallery, type SharedAlbum } from '@/lib/photos/public'
import { albumCover, legacyCoverSettings } from '@/lib/covers/album-cover'
import { layoutStyleOf } from '@/lib/gallery/layouts'
import '@/app/gallery.css'
import '@/app/lightbox.css'

export const metadata = { robots: { index: false, follow: false } }

export default async function ClientGalleryPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { token } = await params
  const asked = (await searchParams).album

  // Everything on this page comes from one verified token. These tables are no
  // longer readable with the anon key at all, so there is no path to them that
  // does not start here. See lib/gallery-access.ts — and lib/photos/public.ts,
  // which resolves the photographs of exactly the albums the token opens and
  // hands the browser a view of each, never the row.
  const shared = await openSharedGallery(token)
  if (!shared) notFound()
  const { albums, favoriteIds } = shared

  const settings = await getSiteSettings()

  if (albums.length === 0) {
    return (
      <main style={{ padding: '6rem 2rem', textAlign: 'center' }}>
        <p className="eyebrow" style={{ margin: '0 0 0.75rem' }}>
          {settings.site_title}
        </p>
        <h1 className="display" style={{ fontSize: '1.5rem' }}>
          Nothing shared with you yet
        </h1>
        <p className="meta" style={{ marginTop: '0.75rem' }}>
          Once a gallery is ready, it will appear here.
        </p>
      </main>
    )
  }

  // Exactly one album: straight to its cover. Several: the chooser, then the
  // chosen one's cover. The album id from the address is only ever looked up
  // among the albums this token opened — anything else shows the chooser.
  const chosen = albums.length === 1 ? albums[0]! : albums.find((a) => a.album.id === asked) ?? null
  const shareUrl = `${await requestOrigin()}/gallery/${token}`

  if (!chosen) return <AlbumChooser albums={albums} token={token} siteTitle={settings.site_title} />

  const { album, cover, photos } = chosen
  const title = String((album.cover_title_text as string) || album.title || '')
  const styled = albumCover({ album, cover, photos, siteTitle: settings.site_title })
  const first: FirstCover | null = styled
    ? { kind: 'style', ...styled }
    : cover
      ? { kind: 'legacy', settings: legacyCoverSettings(album, cover) }
      : null

  const gallery = (
    <>
      {albums.length > 1 && (
        <nav className="client-back">
          <Link href={`/gallery/${token}`}>All galleries</Link>
        </nav>
      )}
      <ClientGallery
        photos={photos}
        favoriteIds={favoriteIds}
        albumId={album.id}
        token={token}
        galleryTitle={title}
        siteTitle={settings.site_title}
        layout={layoutStyleOf(album.layout_style)}
        heroFirst={album.gallery_hero === true}
        shareUrl={shareUrl}
        // `=== true`, not `!== false`. The two download paths used to disagree
        // about the default; one question, asked the same way everywhere —
        // and the routes now ask it too.
        allowDownloads={album.allow_downloads === true}
      />
    </>
  )

  return <main style={{ minHeight: '100vh' }}>{first ? <CoverFirst cover={first}>{gallery}</CoverFirst> : gallery}</main>
}

/** Several albums on one link: their covers and titles, nothing else. */
function AlbumChooser({ albums, token, siteTitle }: { albums: SharedAlbum[]; token: string; siteTitle: string }) {
  return (
    <main className="client-chooser">
      <p className="client-chooser-name">{siteTitle}</p>
      <ul>
        {albums.map(({ album, cover }) => (
          <li key={album.id}>
            <Link href={`/gallery/${token}?album=${encodeURIComponent(album.id)}`}>
              <span className="client-chooser-cover">
                {cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover.src} srcSet={cover.srcSet} sizes="(max-width: 700px) 100vw, 50vw" alt="" loading="lazy" />
                )}
              </span>
              <span className="client-chooser-title">{String((album.cover_title_text as string) || album.title || '')}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}

/** The link as the client reached it — never NEXT_PUBLIC_SITE_URL, which is unset often enough to offer localhost. */
async function requestOrigin(): Promise<string> {
  const host = (await headers()).get('host') ?? ''
  const scheme = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'
  return `${scheme}://${host}`
}
