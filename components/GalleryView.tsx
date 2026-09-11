'use client'

import { useState } from 'react'
import AlbumGallery from '@/components/AlbumGallery'
import GalleryToolbar, { type ToolbarAction } from '@/components/GalleryToolbar'
import Slideshow from '@/components/Slideshow'

type Photo = {
  id: string
  storage_path: string
  caption: string | null
  alt_text: string | null
  is_for_sale: boolean
  width: number | null
  height: number | null
}

/**
 * Wraps the grid with the toolbar and slideshow, so the page stays a server
 * component while these controls keep their own state.
 */
export default function GalleryView({
  photos,
  layoutStyle,
  publicUrl,
  heroFirst,
  galleryTitle,
  siteTitle,
  canDownload = false,
  onDownloadAll,
  downloading = false,
}: {
  photos: Photo[]
  layoutStyle: string
  publicUrl: string
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
          publicUrl={publicUrl}
          heroFirst={heroFirst}
        />
      </div>

      {slideshowOpen && (
        <Slideshow photos={photos} publicUrl={publicUrl} onClose={() => setSlideshowOpen(false)} />
      )}
    </>
  )
}
