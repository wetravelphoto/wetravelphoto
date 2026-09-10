import { createClient } from '@/lib/supabase/server'
import { photoUrl, focalPosition } from '@/lib/images'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Link from 'next/link'
import '../home.css'
import type { Metadata } from 'next'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Trips — WeTravelPhoto',
  description: 'Photographic collections from each trip.',
}

type AlbumRow = {
  id: string
  slug: string
  title: string
  location: string | null
  cover_photo_id: string | null
  cover_custom_path: string | null
  cover_focal_x: number | null
  cover_focal_y: number | null
  photos: { id: string; storage_path: string }[]
}

const TILE_PATTERN = ['hero', 'tall', 'third', 'third', 'third', 'half', 'half'] as const

export default async function TripsPage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('albums')
    .select('*, photos!photos_album_id_fkey(id, storage_path)')
    .eq('privacy_type', 'public')
    .order('created_at', { ascending: false })

  const albums = (data ?? []) as unknown as AlbumRow[]

  function coverFor(album: AlbumRow): string | null {
    if (album.cover_custom_path) return photoUrl(album.cover_custom_path)
    const list = album.photos ?? []
    const cover = list.find((p) => p.id === album.cover_photo_id) ?? list[0]
    return cover ? photoUrl(cover.storage_path) : null
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 4rem' }}>
        <div className="home-inner">
          <p className="intro-kicker">Collections</p>
          <h1
            className="display"
            style={{ fontSize: 'clamp(2rem, 5vw, 3.1rem)', margin: '0 0 2.5rem', lineHeight: 1 }}
          >
            Trips
          </h1>

          {albums.length > 0 ? (
            <div className="trip-grid">
              {albums.map((album, i) => {
                const cover = coverFor(album)
                return (
                  <Link
                    key={album.id}
                    href={`/trips/${album.slug}`}
                    className="trip-tile"
                    data-size={TILE_PATTERN[i % TILE_PATTERN.length]}
                  >
                    {cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cover}
                        alt=""
                        loading="lazy"
                        style={{ objectPosition: focalPosition(album.cover_focal_x, album.cover_focal_y) }}
                      />
                    )}
                    <div className="trip-tile-scrim" />
                    <div className="trip-tile-copy">
                      {album.location && <p className="trip-tile-loc">{album.location}</p>}
                      <p className="trip-tile-name">{album.title}</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <p style={{ color: 'var(--ink-mute)' }}>No public trips yet.</p>
          )}
        </div>
      </div>

      <SiteFooter />
    </main>
  )
}
