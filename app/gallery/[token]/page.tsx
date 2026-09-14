import { createClient } from '@/lib/supabase/server'
import { photoUrl, focalPosition } from '@/lib/images'
import ClientGallery from '@/components/ClientGallery'
import { getSiteSettings } from '@/lib/site'
import { notFound } from 'next/navigation'
import '@/app/gallery.css'
import '@/app/lightbox.css'

export default async function ClientGalleryPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()
  const settings = await getSiteSettings()

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('access_token', token)
    .maybeSingle()

  if (!client) notFound()

  const { data: shares } = await supabase
    .from('album_clients')
    .select('album_id, albums(*)')
    .eq('client_id', client.id)

  const albums = (shares ?? [])
    .map((s) => s.albums as unknown as Record<string, unknown>)
    .filter(Boolean)

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

  const albumIds = albums.map((a) => a.id as string)

  const { data: allPhotos } = await supabase
    .from('photos')
    .select('id, album_id, storage_path, derivatives, caption, alt_text, width, height, is_for_sale, taken_at, sort_order')
    .in('album_id', albumIds)
    .order('sort_order', { ascending: true })

  const { data: favorites } = await supabase
    .from('favorites')
    .select('photo_id')
    .eq('client_id', client.id)

  const favoriteIds = favorites?.map((f) => f.photo_id) ?? []
  const publicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? ''

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
          Hello, {client.name}
        </h1>
        <p className="meta" style={{ marginTop: '0.75rem', maxWidth: '46ch' }}>
          Star the photos you like so I know which ones stood out, and download anything you want to keep.
        </p>
      </header>

      {albums.map((album) => {
        const photos = allPhotos?.filter((p) => p.album_id === album.id) ?? []
        const cover =
          photos.find((p) => p.id === album.cover_photo_id) ?? photos[0]

        return (
          <section key={album.id as string} style={{ marginBottom: '2rem' }}>
            {cover && (
              <div style={{ position: 'relative', height: 'min(45vh, 380px)', overflow: 'hidden', background: 'var(--ink)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl(cover.storage_path)}
                  alt=""
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
              publicUrl={publicUrl}
              galleryTitle={(album.cover_title_text as string) || (album.title as string)}
              siteTitle={settings.site_title}
              allowDownloads={album.allow_downloads !== false}
            />
          </section>
        )
      })}
    </main>
  )
}
