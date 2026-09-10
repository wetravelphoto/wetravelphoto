'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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
  const touchStartX = useRef<number | null>(null)

  const close = useCallback(() => setOpenIndex(null), [])
  const next = useCallback(() => setOpenIndex((i) => (i === null ? null : (i + 1) % photos.length)), [photos.length])
  const prev = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i - 1 + photos.length) % photos.length)),
    [photos.length]
  )

  useEffect(() => {
    if (openIndex === null) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }

    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [openIndex, close, next, prev])

  const current = openIndex !== null ? photos[openIndex] : null
  const pad = 'clamp(1.25rem, 4vw, 3rem)'

  // With a hero enabled the first photo runs full width on its own
  const hero = heroFirst ? photos[0] : null
  const rest = heroFirst ? photos.slice(1) : photos
  const offset = heroFirst ? 1 : 0

  function renderBody() {
    if (rest.length === 0) return null

    if (layoutStyle === 'single_column') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 1000, margin: '0 auto' }}>
          {rest.map((photo, i) => (
            <Figure key={photo.id} photo={photo} publicUrl={publicUrl} onOpen={() => setOpenIndex(i + offset)} />
          ))}
        </div>
      )
    }

    if (layoutStyle === 'square') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2 }}>
          {rest.map((photo, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={`${publicUrl}/${photo.storage_path}`}
              alt={photo.alt_text ?? photo.caption ?? ''}
              loading="lazy"
              onClick={() => setOpenIndex(i + offset)}
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
            />
          ))}
        </div>
      )
    }

    if (layoutStyle === 'masonry') {
      return (
        <div style={{ columns: 'auto 3', columnGap: '2px' }}>
          {rest.map((photo, i) => (
            <div key={photo.id} style={{ breakInside: 'avoid', marginBottom: 2 }}>
              <Figure photo={photo} publicUrl={publicUrl} onOpen={() => setOpenIndex(i + offset)} />
            </div>
          ))}
        </div>
      )
    }

    // Justified rows — equal height per row, aspect ratios preserved
    const rows = buildRows(rest, 3.4)
    let cursor = offset

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} style={{ display: 'flex', gap: 2 }}>
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
        <div style={{ marginBottom: 2 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${publicUrl}/${hero.storage_path}`}
            alt={hero.alt_text ?? hero.caption ?? ''}
            onClick={() => setOpenIndex(0)}
            style={{ width: '100%', height: 'auto', display: 'block', cursor: 'zoom-in' }}
          />
          {hero.caption && (
            <p className="meta" style={{ padding: `0.6rem ${pad} 0`, margin: 0 }}>
              {hero.caption}
            </p>
          )}
        </div>
      )}

      <div style={{ padding: `0 ${pad} 4rem` }}>{renderBody()}</div>

      {current && openIndex !== null && (
        <div
          onClick={close}
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0].clientX
          }}
          onTouchEnd={(e) => {
            if (touchStartX.current === null) return
            const delta = e.changedTouches[0].clientX - touchStartX.current
            if (delta > 60) prev()
            if (delta < -60) next()
            touchStartX.current = null
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(12, 10, 9, 0.96)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'clamp(1rem, 4vw, 3rem)',
          }}
        >
          <button onClick={close} aria-label="Close" style={closeStyle}>
            &times;
          </button>

          {photos.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  prev()
                }}
                aria-label="Previous photo"
                style={navButtonStyle('left')}
              >
                &#8249;
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  next()
                }}
                aria-label="Next photo"
                style={navButtonStyle('right')}
              >
                &#8250;
              </button>
            </>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${publicUrl}/${current.storage_path}`}
            alt={current.alt_text ?? current.caption ?? ''}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', display: 'block' }}
          />

          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              marginTop: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1.25rem',
              color: '#faf9f6',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: '0.78rem', opacity: 0.6 }}>
              {String(openIndex + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}
            </span>
            {current.caption && <span style={{ fontSize: '0.82rem', opacity: 0.85 }}>{current.caption}</span>}
            {current.is_for_sale && (
              <span className="underline-link" style={{ fontSize: '0.78rem', letterSpacing: '0.06em', cursor: 'pointer' }}>
                Buy print
              </span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Figure({ photo, publicUrl, onOpen }: { photo: Photo; publicUrl: string; onOpen: () => void }) {
  return (
    <figure style={{ margin: 0, background: 'var(--surface-alt)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${publicUrl}/${photo.storage_path}`}
        alt={photo.alt_text ?? photo.caption ?? ''}
        loading="lazy"
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

const closeStyle: React.CSSProperties = {
  position: 'absolute',
  top: '1.25rem',
  right: '1.25rem',
  background: 'none',
  border: 'none',
  color: '#faf9f6',
  fontSize: '1.6rem',
  lineHeight: 1,
  cursor: 'pointer',
  opacity: 0.7,
}

function navButtonStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    [side]: 'clamp(0.5rem, 2vw, 1.5rem)',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#faf9f6',
    fontSize: '2.2rem',
    lineHeight: 1,
    cursor: 'pointer',
    opacity: 0.55,
    padding: '0.5rem',
  }
}
