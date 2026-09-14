'use client'

import { useState, useEffect } from 'react'
import FramedArt from '@/components/shop/FramedArt'

/**
 * The framed print on a product page: click to see it larger.
 *
 * The enlarged view shows the frame too — what's being sold is the piece on a
 * wall, not the file.
 */
export default function FramedPrint({
  imageUrl,
  srcSet,
  alt,
  width,
  height,
}: {
  imageUrl: string
  srcSet?: string
  alt: string
  width: number | null
  height: number | null
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        className="framed-trigger"
        onClick={() => setOpen(true)}
        aria-label="View larger"
      >
        <FramedArt
          imageUrl={imageUrl}
          srcSet={srcSet}
          alt={alt}
          width={width}
          height={height}
          sizes="(max-width: 900px) 92vw, 46vw"
        />
        <span className="framed-hint" aria-hidden>
          Click to enlarge
        </span>
      </button>

      {open && (
        <div
          className="framed-lightbox"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
        >
          <button
            type="button"
            className="framed-lightbox-close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            &times;
          </button>

          {/* A click on the artwork shouldn't dismiss the view */}
          <div className="framed-lightbox-stage" onClick={(e) => e.stopPropagation()}>
            <FramedArt
              imageUrl={imageUrl}
              srcSet={srcSet}
              alt={alt}
              width={width}
              height={height}
              sizes="90vw"
            />
          </div>
        </div>
      )}
    </>
  )
}
