'use client'

import { useState, useEffect, useCallback } from 'react'
import FramedArt from '@/components/shop/FramedArt'
import { frameMetrics } from '@/lib/frame'

/** The hero print on a product page. Click shows it bigger, still framed. */
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
  const [stageWidth, setStageWidth] = useState<number | null>(null)

  // A frame sizes itself from the column it hangs in, so the enlarged view
  // works out the widest column that still leaves the whole frame on screen —
  // a panorama runs out of width first, a portrait runs out of height.
  const measure = useCallback(() => {
    const m = frameMetrics(width, height)
    setStageWidth(
      Math.floor(
        Math.min(
          (window.innerWidth * 0.94) / m.widthFactor,
          (window.innerHeight * 0.9) / m.heightFactor
        )
      )
    )
  }, [width, height])

  useEffect(() => {
    if (!open) return

    measure()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', measure)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', measure)
      document.body.style.overflow = previous
    }
  }, [open, measure])

  return (
    <>
      <button
        type="button"
        className="product-trigger"
        onClick={() => setOpen(true)}
        aria-label="View larger"
      >
        <div className="framed-solo">
          <FramedArt
            imageUrl={imageUrl}
            srcSet={srcSet}
            alt={alt}
            width={width}
            height={height}
            sizes="(max-width: 900px) 84vw, 520px"
            eager
          />
        </div>
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
          <div
            className="framed-lightbox-stage"
            style={
              stageWidth ? ({ '--stage-w': `${stageWidth}px` } as React.CSSProperties) : undefined
            }
            onClick={(e) => e.stopPropagation()}
          >
            <FramedArt
              imageUrl={imageUrl}
              srcSet={srcSet}
              alt={alt}
              width={width}
              height={height}
              sizes="90vw"
              eager
            />
          </div>
        </div>
      )}
    </>
  )
}
