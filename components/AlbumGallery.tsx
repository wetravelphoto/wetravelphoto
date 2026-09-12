'use client'

import { useState } from 'react'
import PhotoLightbox from '@/components/PhotoLightbox'
import { srcSetFor, displayUrl, SIZES_ATTR } from '@/lib/srcset'

type Photo = {
  id: string
  storage_path: string
  derivatives?: Record<string, string> | null
  caption: string | null
  alt_text: string | null
  is_for_sale: boolean
  width: number | null
  height: number | null
}

/**
 * Groups photos into rows whose combined aspect ratios fill the width,
 * so every photo keeps its true proportions and rows still line up.
 */
function buildRows(photos: Photo[], targetRatio: number): Photo[][] {
  const rows: Photo[][] = []
  let current: Photo[] = []
  let ratioSum = 0

  for (const photo of photos) {
    const ratio = (photo.width ?? 3) / (photo.height ?? 2)
    current.push(photo)
    ratioSum += ratio

    if (ratioSum >= targetRatio) {
      rows.push(current)
      current = []
      ratioSum = 0
    }
  }

  if (current.length) rows.push(current)
  return rows
}

export default function AlbumGallery({
  photos,
  layoutStyle,
  publicUrl,
  heroFirst = false,
}: {
  photos: Photo[]
  layoutStyle: string
  publicUrl: string
  heroFirst?: boolean
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const pad = 'clamp(1.25rem, 4vw, 3rem)'

  // With a hero enabled the first photo runs full width on its own
  const hero = heroFirst ? photos[0] : null
  const rest = heroFirst ? photos.slice(1) : photos
  const offset = heroFirst ? 1 : 0

  function renderBody() {
    if (rest.length === 0) return null

    if (layoutStyle === 'single_column') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--grid-gap)', maxWidth: 1000, margin: '0 auto' }}>
          {rest.map((photo, i) => (
            <Figure key={photo.id} photo={photo} publicUrl={publicUrl} onOpen={() => setOpenIndex(i + offset)} />
          ))}
        </div>
      )
    }

    if (layoutStyle === 'square') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--grid-gap)' }}>
          {rest.map((photo, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={displayUrl(photo)}
              srcSet={srcSetFor(photo)}
              sizes={SIZES_ATTR.grid}
              alt={photo.alt_text ?? photo.caption ?? ''}
              width={photo.width ?? undefined}
              height={photo.height ?? undefined}
              loading="lazy"
              decoding="async"
              onClick={() => setOpenIndex(i + offset)}
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
            />
          ))}
        </div>
      )
    }

    if (layoutStyle === 'masonry') {
      // Deal the photos into columns in turn, so every column is used even
      // when there are only a few images.
      const columnCount = Math.min(3, Math.max(1, rest.length))
      const columns: { photo: Photo; index: number }[][] = Array.from(
        { length: columnCount },
        () => []
      )

      rest.forEach((photo, i) => {
        columns[i % columnCount].push({ photo, index: i + offset })
      })

      return (
        <div style={{ display: 'flex', gap: 'var(--grid-gap)', alignItems: 'flex-start' }}>
          {columns.map((column, c) => (
            <div
              key={c}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--grid-gap)',
              }}
            >
              {column.map(({ photo, index }) => (
                <Figure
                  key={photo.id}
                  photo={photo}
                  publicUrl={publicUrl}
                  onOpen={() => setOpenIndex(index)}
                />
              ))}
            </div>
          ))}
        </div>
      )
    }

    // Justified rows — equal height per row, aspect ratios preserved
    const rows = buildRows(rest, 3.4)
    let cursor = offset

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--grid-gap)' }}>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} style={{ display: 'flex', gap: 'var(--grid-gap)' }}>
            {row.map((photo) => {
              const index = cursor++
              const ratio = (photo.width ?? 3) / (photo.height ?? 2)
              return (
                <div key={photo.id} style={{ flexGrow: ratio, flexBasis: 0, minWidth: 0 }}>
                  <Figure photo={photo} publicUrl={publicUrl} onOpen={() => setOpenIndex(index)} />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      {hero && (
        // Sits inside the same margins as the grid below it
        <div style={{ padding: `0 ${pad}`, marginBottom: 'var(--grid-gap)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl(hero)}
            srcSet={srcSetFor(hero)}
            sizes={SIZES_ATTR.fullWidth}
            alt={hero.alt_text ?? hero.caption ?? ''}
            width={hero.width ?? undefined}
            height={hero.height ?? undefined}
            fetchPriority="high"
            decoding="async"
            onClick={() => setOpenIndex(0)}
            style={{ width: '100%', height: 'auto', display: 'block', cursor: 'zoom-in' }}
          />
          {hero.caption && (
            <p className="meta" style={{ paddingTop: '0.6rem', margin: 0 }}>
              {hero.caption}
            </p>
          )}
        </div>
      )}

      <div style={{ padding: `0 ${pad} 4rem` }}>{renderBody()}</div>

      {openIndex !== null && (
        <PhotoLightbox
          photos={photos}
          publicUrl={publicUrl}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  )
}

function Figure({ photo, publicUrl, onOpen }: { photo: Photo; publicUrl: string; onOpen: () => void }) {
  return (
    <figure style={{ margin: 0, background: 'var(--surface-alt)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={displayUrl(photo)}
        srcSet={srcSetFor(photo)}
        sizes={SIZES_ATTR.grid}
        alt={photo.alt_text ?? photo.caption ?? ''}
        /* Declaring the shape reserves the space, so the page doesn't jump
           around as photographs arrive */
        width={photo.width ?? undefined}
        height={photo.height ?? undefined}
        loading="lazy"
        decoding="async"
        onClick={onOpen}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'zoom-in' }}
      />
      {photo.caption && (
        <figcaption className="meta" style={{ padding: '0.5rem 0.2rem 0.9rem' }}>
          {photo.caption}
        </figcaption>
      )}
    </figure>
  )
}
