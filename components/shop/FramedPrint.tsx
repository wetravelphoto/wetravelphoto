'use client'

import { useState, useEffect } from 'react'
import type { Frame } from '@/lib/catalog'

/**
 * A photograph shown inside the shop's mockup frame.
 *
 * The frame is a real photograph of a real frame, and the print is positioned
 * into its mat opening using percentages measured from that image — so it
 * holds at any width and a tenant can swap in their own frame by supplying
 * new measurements.
 *
 * `contain`, never `cover`: a print is not cropped to fit its mat. A panorama
 * sits with more mat above and below, which is how one is actually mounted.
 */
export default function FramedPrint({
  frame,
  imageUrl,
  srcSet,
  alt,
  sizes = '(max-width: 900px) 100vw, 55vw',
}: {
  frame: Frame
  imageUrl: string
  srcSet?: string
  alt: string
  sizes?: string
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

  const art = (
    <div className="framed-art" style={{ backgroundImage: `url(${frame.path})` }}>
      <div
        className="framed-opening"
        style={{
          top: `${frame.top}%`,
          left: `${frame.left}%`,
          width: `${frame.width}%`,
          height: `${frame.height}%`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} srcSet={srcSet} sizes={sizes} alt={alt} decoding="async" />
      </div>
    </div>
  )

  return (
    <>
      <button
        type="button"
        className="framed-trigger"
        onClick={() => setOpen(true)}
        aria-label="View larger"
      >
        {art}
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

          {/* Stop a click on the artwork itself from closing the view */}
          <div className="framed-lightbox-stage" onClick={(e) => e.stopPropagation()}>
            <div className="framed-art" style={{ backgroundImage: `url(${frame.path})` }}>
              <div
                className="framed-opening"
                style={{
                  top: `${frame.top}%`,
                  left: `${frame.left}%`,
                  width: `${frame.width}%`,
                  height: `${frame.height}%`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} srcSet={srcSet} sizes="92vw" alt={alt} decoding="async" />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
