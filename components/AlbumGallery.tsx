'use client'

import { useState } from 'react'
import PhotoLightbox from '@/components/PhotoLightbox'
import PhotoLayout from '@/components/gallery/PhotoLayout'
import { layoutStyleOf } from '@/lib/gallery/layouts'
import type { GalleryPhotoView } from '@/lib/photos/render-view'

/**
 * A gallery photograph as the server resolved it (lib/photos/public.ts): its
 * id, caption, layout size and its views — never the row it came from.
 */
type Photo = GalleryPhotoView

/**
 * The public album's grid. The arrangement itself is components/gallery/
 * PhotoLayout.tsx — the same component the client's private link and the
 * editor's preview draw — so all three agree.
 */
export default function AlbumGallery({
  photos,
  layoutStyle,
  heroFirst = false,
}: {
  photos: Photo[]
  layoutStyle: string
  heroFirst?: boolean
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <>
      <div style={{ padding: '0 clamp(1.25rem, 4vw, 3rem) 4rem', maxWidth: 1600, margin: '0 auto' }}>
        <PhotoLayout photos={photos} layout={layoutStyleOf(layoutStyle)} heroFirst={heroFirst} onOpen={setOpenIndex} />
      </div>

      {openIndex !== null && (
        <PhotoLightbox
          photos={photos}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  )
}
