'use client'

import { useState } from 'react'
import { toggleFavorite } from '@/app/actions/favorites'
import PhotoLightbox from '@/components/PhotoLightbox'
import Slideshow from '@/components/Slideshow'
import GalleryToolbar from '@/components/GalleryToolbar'
import { SIZES_ATTR } from '@/lib/srcset'
import type { GalleryPhotoView } from '@/lib/photos/render-view'

/** A shared photograph as the server resolved it — its id (favourites, downloads) and views. */
type Photo = GalleryPhotoView

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

export default function ClientGallery({
  photos,
  favoriteIds,
  albumId,
  token,
  galleryTitle,
  siteTitle,
  allowDownloads = true,
}: {
  photos: Photo[]
  favoriteIds: string[]
  albumId: string
  token: string
  galleryTitle: string
  siteTitle: string
  allowDownloads?: boolean
}) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set(favoriteIds))
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [slideshow, setSlideshow] = useState(false)
  const [preparing, setPreparing] = useState(false)
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

  function downloadAll() {
    setPreparing(true)
    // The browser handles the transfer; the flag just gives feedback
    startDownload('/api/download-all', { album: albumId, token })
    setTimeout(() => setPreparing(false), 4000)
  }

  function downloadOne(photoId: string) {
    startDownload('/api/download', { photo: photoId, token })
  }

  const shown = onlyFavorites ? photos.filter((p) => favorites.has(p.id)) : photos
  const current = openIndex !== null ? shown[openIndex] : null

  return (
    <>
      <GalleryToolbar
        galleryTitle={galleryTitle}
        siteTitle={siteTitle}
        actions={allowDownloads ? ['slideshow', 'download'] : ['slideshow']}
        onSlideshow={() => setSlideshow(true)}
        onDownloadAll={downloadAll}
        downloading={preparing}
      />

      <div className="client-subbar">
        <button
          type="button"
          onClick={() => setOnlyFavorites((v) => !v)}
          className="toolbar-btn"
          data-on={onlyFavorites}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={onlyFavorites ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3">
            <path d="M12 20.2 4.6 12.9a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 1 1 6.5 6.5Z" strokeLinejoin="round" />
          </svg>
          {onlyFavorites ? 'Showing favourites' : `Favourites (${favorites.size})`}
        </button>

        <span className="client-count">
          {shown.length} photograph{shown.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="album-grid-wrap">
        <div className="client-grid">
          {shown.map((photo, i) => (
            <figure key={photo.id} className="client-tile">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.view.src}
                srcSet={photo.view.srcSet}
                sizes={SIZES_ATTR.grid}
                alt={photo.view.alt}
                loading="lazy"
                decoding="async"
                onClick={() => setOpenIndex(i)}
              />

              <div className="client-tile-actions">
                <button
                  type="button"
                  onClick={() => handleFavorite(photo.id)}
                  aria-label={favorites.has(photo.id) ? 'Remove from favourites' : 'Add to favourites'}
                  data-on={favorites.has(photo.id)}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill={favorites.has(photo.id) ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.3"
                  >
                    <path d="M12 20.2 4.6 12.9a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 1 1 6.5 6.5Z" strokeLinejoin="round" />
                  </svg>
                </button>

                {allowDownloads && (
                  <button type="button" onClick={() => downloadOne(photo.id)} aria-label="Download">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                      <path d="M12 3.5v12M7.5 11l4.5 4.5 4.5-4.5M4.5 19.5h15" />
                    </svg>
                  </button>
                )}
              </div>
            </figure>
          ))}
        </div>

        {shown.length === 0 && (
          <p className="client-empty">No favourites picked yet.</p>
        )}
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
                {favorites.has(current.id) ? 'Favourited' : 'Favourite'}
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

      {slideshow && (
        <Slideshow
          photos={shown}
          onClose={() => setSlideshow(false)}
        />
      )}
    </>
  )
}
