'use client'

import { useState } from 'react'
import { toggleFavorite } from '@/app/actions/favorites'
import PhotoLightbox from '@/components/PhotoLightbox'
import Slideshow from '@/components/Slideshow'
import GalleryToolbar, { DownloadGlyph } from '@/components/GalleryToolbar'
import PhotoLayout from '@/components/gallery/PhotoLayout'
import type { LayoutStyle } from '@/lib/gallery/layouts'
import type { GalleryPhotoView } from '@/lib/photos/render-view'

/** A shared photograph as the server resolved it — its id (favorites, downloads) and views. */
type Photo = GalleryPhotoView

/** The favorites tooltip, word for word as approved. */
export const FAVORITES_TIP = 'Tap the heart on any photo to add it to your favorites.'

/**
 * Starts a file transfer from one of the download routes. They answer with
 * `Content-Disposition: attachment`, so following the link saves a file and
 * the gallery stays on screen — a link click, not page navigation, which is
 * why this is not the router.
 */
function startDownload(path: string, params: Record<string, string>) {
  const link = document.createElement('a')
  link.href = `${path}?${new URLSearchParams(params)}`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

const Heart = ({ on, size = 17 }: { on: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M12 20.2 4.6 12.9a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 1 1 6.5 6.5Z" strokeLinejoin="round" />
  </svg>
)

export default function ClientGallery({
  photos,
  favoriteIds,
  albumId,
  token,
  galleryTitle,
  siteTitle,
  layout,
  heroFirst = false,
  shareUrl,
  allowDownloads = false,
}: {
  photos: Photo[]
  favoriteIds: string[]
  albumId: string
  token: string
  galleryTitle: string
  siteTitle: string
  layout: LayoutStyle
  heroFirst?: boolean
  /** This client's private link — what Share copies. */
  shareUrl: string
  allowDownloads?: boolean
}) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set(favoriteIds.filter((id) => photos.some((p) => p.id === id))))
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [slideshow, setSlideshow] = useState(false)
  const [preparing, setPreparing] = useState<'all' | 'favorites' | null>(null)
  const [onlyFavorites, setOnlyFavorites] = useState(false)

  async function handleFavorite(photoId: string) {
    const isFavorited = favorites.has(photoId)

    // Update immediately; the server call follows
    setFavorites((prev) => {
      const next = new Set(prev)
      if (isFavorited) next.delete(photoId)
      else next.add(photoId)
      return next
    })

    // The action takes the state BEFORE the toggle: true removes, false adds.
    await toggleFavorite(token, albumId, photoId, isFavorited)
  }

  function downloadZip(which: 'all' | 'favorites') {
    setPreparing(which)
    // The browser handles the transfer; the flag just gives feedback. The
    // route reads favorites from the database by this token's client — the
    // browser's list is never sent.
    startDownload('/api/download-all', which === 'favorites' ? { album: albumId, token, favorites: '1' } : { album: albumId, token })
    setTimeout(() => setPreparing(null), 4000)
  }

  function downloadOne(photoId: string) {
    startDownload('/api/download', { photo: photoId, token })
  }

  const shown = onlyFavorites ? photos.filter((p) => favorites.has(p.id)) : photos
  const current = openIndex !== null ? shown[openIndex] : null
  const count = favorites.size

  return (
    <>
      <GalleryToolbar
        galleryTitle={galleryTitle}
        siteTitle={siteTitle}
        actions={['slideshow']}
        onSlideshow={() => setSlideshow(true)}
        share={{ kind: 'private', url: shareUrl }}
      >
        {allowDownloads && (
          <>
            <button type="button" onClick={() => downloadZip('all')} disabled={preparing !== null} className="toolbar-btn">
              <DownloadGlyph />
              {preparing === 'all' ? 'Preparing…' : 'Download all'}
            </button>
            <button
              type="button"
              onClick={() => downloadZip('favorites')}
              disabled={preparing !== null || count === 0}
              className="toolbar-btn"
            >
              <DownloadGlyph />
              {preparing === 'favorites' ? 'Preparing…' : `Download favorites (${count})`}
            </button>
          </>
        )}
      </GalleryToolbar>

      <div className="client-subbar">
        <span className="tip-wrap">
          <button
            type="button"
            onClick={() => setOnlyFavorites((v) => !v)}
            className="toolbar-btn"
            data-on={onlyFavorites}
            aria-pressed={onlyFavorites}
            aria-describedby="favorites-tip"
          >
            <Heart on={onlyFavorites} size={16} />
            {onlyFavorites ? `Showing favorites (${count})` : `Favorites (${count})`}
          </button>
          <span role="tooltip" id="favorites-tip" className="tip">
            {FAVORITES_TIP}
          </span>
        </span>

        <span className="client-count">
          {shown.length} photograph{shown.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="album-grid-wrap client-layout">
        <PhotoLayout
          photos={shown}
          layout={layout}
          heroFirst={heroFirst && !onlyFavorites}
          onOpen={setOpenIndex}
          overlay={(photo) => (
            <>
              <button
                type="button"
                onClick={() => handleFavorite(photo.id)}
                aria-label={favorites.has(photo.id) ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={favorites.has(photo.id)}
                data-on={favorites.has(photo.id)}
              >
                <Heart on={favorites.has(photo.id)} />
              </button>
              {allowDownloads && (
                <button type="button" onClick={() => downloadOne(photo.id)} aria-label="Download">
                  <DownloadGlyph />
                </button>
              )}
            </>
          )}
        />

        {shown.length === 0 && <p className="client-empty">No favorites yet.</p>}
      </div>

      {openIndex !== null && current && (
        <PhotoLightbox
          photos={shown}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          actions={
            <>
              <button
                type="button"
                className="lightbox-action"
                data-on={favorites.has(current.id)}
                onClick={() => handleFavorite(current.id)}
              >
                {favorites.has(current.id) ? 'Favorited' : 'Favorite'}
              </button>

              {allowDownloads && (
                <button type="button" className="lightbox-action" onClick={() => downloadOne(current.id)}>
                  Download
                </button>
              )}
            </>
          }
        />
      )}

      {slideshow && <Slideshow photos={shown} onClose={() => setSlideshow(false)} />}
    </>
  )
}
