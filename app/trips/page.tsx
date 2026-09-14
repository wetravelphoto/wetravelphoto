import { createClient } from '@/lib/supabase/server'
import { photoUrl } from '@/lib/images'
import { attachCovers } from '@/lib/album-covers'
import { formatTripDate } from '@/lib/dates'
import CoverRenderer from '@/components/CoverRenderer'
import { getSiteSettings } from '@/lib/site'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import Link from 'next/link'
import '../gallery.css'
import type { Metadata } from 'next'

export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings()
  return {
    title: `${settings.galleries_heading || 'Galleries'} — ${settings.site_title}`,
    description: settings.tagline ?? undefined,
  }
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
  // Covers are resolved separately by attachCovers
}


export default async function GalleriesPage() {
  const supabase = await createClient()
  const settings = await getSiteSettings()

  // Covers are resolved by a second bounded query rather than embedding every
  // photo of every gallery — see lib/album-covers.ts
  const { data } = await supabase
    .from('albums')
    .select('*')
    .eq('privacy_type', 'public')
    // display_order is the gallery's position, set by dragging in the admin.
    // albums.sort_order is text and means the photo sort mode inside an album.
    .order('display_order', { ascending: true })

  const albums = await attachCovers((data ?? []) as unknown as AlbumRow[])

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <div style={{ flex: 1, padding: '7rem clamp(1.25rem, 4vw, 3rem) 4rem' }}>
        <div className="gallery-index-head">
          {settings.galleries_eyebrow && (
            <p className="gallery-index-eyebrow">{settings.galleries_eyebrow}</p>
          )}
          <h1 className="gallery-index-heading">{settings.galleries_heading || 'Galleries'}</h1>
        </div>

        {albums.length > 0 ? (
          <div className="gallery-grid-public">
            {albums.map((album) => {
              const showText = album.cover_title_enabled !== false

              return (
                <Link
                  key={album.id}
                  href={`/trips/${album.slug}`}
                  className="gallery-tile"
                >
                  <div className="gallery-tile-cover">
                    {/* The gallery's own composed cover, as set in its settings */}
                    <CoverRenderer
                      height="100%"
                      settings={{
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
                        imageSrcSet: album.coverSrcSet,
                        videoUrl: album.cover_video_path ? photoUrl(album.cover_video_path) : null,
                        showButton: false,
                      }}
                    />
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <p style={{ color: 'var(--ink-mute)' }}>Nothing published yet.</p>
        )}
      </div>

      <SiteFooter />
    </main>
  )
}
