'use client'

import { useState } from 'react'
import AlbumGallery from '@/components/AlbumGallery'
import GalleryToolbar, { type ToolbarAction } from '@/components/GalleryToolbar'
import Slideshow from '@/components/Slideshow'
import type { GalleryPhotoView } from '@/lib/photos/render-view'

/** A gallery photograph as the server resolved it — its views, never its row. */
type Photo = GalleryPhotoView

/**
 * Wraps the grid with the toolbar and slideshow, so the page stays a server
 * component while these controls keep their own state.
 */
export default function GalleryView({
  photos,
  layoutStyle,
  heroFirst,
  galleryTitle,
  siteTitle,
  canDownload = false,
  onDownloadAll,
  downloading = false,
}: {
  photos: Photo[]
  layoutStyle: string
  heroFirst: boolean
  galleryTitle: string
  siteTitle: string
  canDownload?: boolean
  onDownloadAll?: () => void
  downloading?: boolean
}) {
  const [slideshowOpen, setSlideshowOpen] = useState(false)

  const actions: ToolbarAction[] = ['slideshow']
  if (canDownload) actions.push('download')

  return (
    <>
      <GalleryToolbar
        galleryTitle={galleryTitle}
        siteTitle={siteTitle}
        actions={actions}
        onSlideshow={() => setSlideshowOpen(true)}
        onDownloadAll={onDownloadAll}
        downloading={downloading}
      />

      <div className="album-grid-wrap">
        <AlbumGallery
          photos={photos}
          layoutStyle={layoutStyle}
          heroFirst={heroFirst}
        />
      </div>

      {slideshowOpen && (
        <Slideshow photos={photos} onClose={() => setSlideshowOpen(false)} />
      )}
    </>
  )
}
