'use client'

import { useState } from 'react'
import { toggleFavorite } from '@/app/actions/favorites'

type Photo = {
  id: string
  storage_path: string
  caption: string | null
  alt_text: string | null
}

export default function ClientGallery({
  photos,
  favoriteIds,
  albumId,
  token,
  publicUrl,
}: {
  photos: Photo[]
  favoriteIds: string[]
  albumId: string
  token: string
  publicUrl: string
}) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set(favoriteIds))
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  async function handleFavorite(photoId: string) {
    const isFavorited = favorites.has(photoId)

    // Update the UI immediately, then persist
    setFavorites((prev) => {
      const next = new Set(prev)
      if (isFavorited) next.delete(photoId)
      else next.add(photoId)
      return next
    })

    try {
      await toggleFavorite(token, albumId, photoId, isFavorited)
    } catch {
      // Roll back if the save failed
      setFavorites((prev) => {
        const next = new Set(prev)
        if (isFavorited) next.add(photoId)
        else next.delete(photoId)
        return next
      })
    }
  }

  const current = openIndex !== null ? photos[openIndex] : null

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '2px',
          padding: '0 clamp(1.25rem, 4vw, 3rem) 4rem',
        }}
      >
        {photos.map((photo, index) => {
          const isFav = favorites.has(photo.id)
          return (
            <div key={photo.id} style={{ position: 'relative', background: 'var(--surface-alt)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${publicUrl}/${photo.storage_path}`}
                alt={photo.alt_text ?? photo.caption ?? ''}
                loading="lazy"
                onClick={() => setOpenIndex(index)}
                style={{
                  width: '100%',
                  aspectRatio: '1',
                  objectFit: 'cover',
                  display: 'block',
                  cursor: 'zoom-in',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  display: 'flex',
                  gap: '0.5rem',
                  padding: '0.5rem',
                  background: 'linear-gradient(to top, rgba(20,16,14,0.7), transparent)',
                }}
              >
                <button
                  onClick={() => handleFavorite(photo.id)}
                  aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: isFav ? '#e8b48c' : '#faf9f6',
                    cursor: 'pointer',
                    fontSize: '1.05rem',
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  {isFav ? '★' : '☆'}
                </button>
                <a
                  href={`/api/download?token=${token}&photo=${photo.id}`}
                  style={{ color: '#faf9f6', fontSize: '0.7rem', letterSpacing: '0.05em', opacity: 0.9 }}
                >
                  Download
                </a>
              </div>
            </div>
          )
        })}
      </div>

      {current && openIndex !== null && (
        <div
          onClick={() => setOpenIndex(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(12,10,9,0.96)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${publicUrl}/${current.storage_path}`}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain' }}
          />
        </div>
      )}
    </>
  )
}
