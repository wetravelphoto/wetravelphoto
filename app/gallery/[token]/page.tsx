import { focalPosition } from '@/lib/images'
import ClientGallery from '@/components/ClientGallery'
import { getSiteSettings } from '@/lib/site'
import { notFound } from 'next/navigation'
import { openSharedGallery } from '@/lib/photos/public'
import '@/app/gallery.css'
import '@/app/lightbox.css'

export default async function ClientGalleryPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // Everything on this page comes from one verified token. These tables are no
  // longer readable with the anon key at all, so there is no path to them that
  // does not start here. See lib/gallery-access.ts — and lib/photos/public.ts,
  // which resolves the photographs of exactly the albums the token opens and
  // hands the browser a view of each, never the row.
  const shared = await openSharedGallery(token)
  if (!shared) notFound()
  const { access, albums, favoriteIds } = shared

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

  return (
    <main style={{ minHeight: '100vh' }}>
      <header
        style={{
          padding: 'clamp(2.5rem, 6vw, 4rem) clamp(1.25rem, 4vw, 3rem) 2rem',
          borderBottom: '0.5px solid var(--line)',
        }}
      >
        <p className="eyebrow" style={{ margin: '0 0 0.6rem' }}>
          {settings.site_title} — private gallery
        </p>
        <h1 className="display" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', margin: 0, lineHeight: 1 }}>
          Hello, {access.clientName}
        </h1>
        <p className="meta" style={{ marginTop: '0.75rem', maxWidth: '46ch' }}>
          Star the photos you like so I know which ones stood out, and download anything you want to keep.
        </p>
      </header>

      {albums.map(({ album, cover, photos }) => {

        return (
          <section key={album.id as string} style={{ marginBottom: '2rem' }}>
            {cover && (
              <div style={{ position: 'relative', height: 'min(45vh, 380px)', overflow: 'hidden', background: 'var(--ink)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cover.src}
                  {...(cover.srcSet ? { srcSet: cover.srcSet } : {})}
                  alt={cover.alt}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: focalPosition(
                      album.cover_focal_x as number | null,
                      album.cover_focal_y as number | null
                    ),
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(to top, rgba(20,16,14,0.55), transparent 55%)',
                  }}
                />
                <h2
                  className="display"
                  style={{
                    position: 'absolute',
                    bottom: '1.25rem',
                    left: 'clamp(1.25rem, 4vw, 3rem)',
                    color: '#faf9f6',
                    fontSize: 'clamp(1.3rem, 3vw, 2rem)',
                    margin: 0,
                  }}
                >
                  {(album.cover_title_text as string) || (album.title as string)}
                </h2>
              </div>
            )}

            <ClientGallery
              photos={photos}
              favoriteIds={favoriteIds}
              albumId={album.id as string}
              token={token}
              galleryTitle={(album.cover_title_text as string) || (album.title as string)}
              siteTitle={settings.site_title}
              // `=== true`, not `!== false`. The two download paths used to
              // disagree about the default — the zip gate demanded true, this
              // showed the button unless it was explicitly false — so a null
              // or missing value opened one door and not the other. One
              // question, asked the same way in both places.
              allowDownloads={album.allow_downloads === true}
            />
          </section>
        )
      })}
    </main>
  )
}
