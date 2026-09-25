'use client'

import { useState, useEffect, useCallback } from 'react'
import { imageSrc } from '@/lib/images'

type Slide = { id: string; storage_path: string; caption: string | null }

/** Full-screen slideshow, advancing on a timer with keyboard control. */
export default function Slideshow({
  photos,
  publicUrl,
  startAt = 0,
  onClose,
}: {
  photos: Slide[]
  publicUrl: string
  startAt?: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(startAt)
  const [playing, setPlaying] = useState(true)

  const next = useCallback(() => setIndex((i) => (i + 1) % photos.length), [photos.length])
  const prev = useCallback(() => setIndex((i) => (i - 1 + photos.length) % photos.length), [photos.length])

  useEffect(() => {
    if (!playing || photos.length < 2) return
    const timer = setInterval(next, 4500)
    return () => clearInterval(timer)
  }, [playing, next, photos.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }

    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [next, prev, onClose])

  if (photos.length === 0) return null
  const current = photos[index]

  return (
    <div className="slideshow">
      <button onClick={onClose} className="slideshow-close" aria-label="Close slideshow">
        &times;
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageSrc(publicUrl, current.storage_path)} alt={current.caption ?? ''} className="slideshow-image" />

      <div className="slideshow-bar">
        <button onClick={prev} aria-label="Previous">
          &#8249;
        </button>

        <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>

        <button onClick={next} aria-label="Next">
          &#8250;
        </button>

        <span className="slideshow-count">
          {index + 1} / {photos.length}
        </span>

        {current.caption && <span className="slideshow-caption">{current.caption}</span>}
      </div>
    </div>
  )
}
