'use client'

import { useState, useEffect, useCallback } from 'react'
import FramedArt from '@/components/shop/FramedArt'
import { frameAspect, frameRatio } from '@/lib/frame'

/** The large framed print on a product page. Click shows it bigger, framed. */
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
  const [stageHeight, setStageHeight] = useState<number | null>(null)

  // The frame's width follows from its height, so the enlarged view works out
  // the tallest height that still leaves the whole frame on screen. A panorama
  // is limited by the window's width, a portrait by its height.
  const measure = useCallback(() => {
    const aspect = frameAspect(frameRatio(width, height))
    setStageHeight(Math.floor(Math.min(window.innerHeight * 0.88, (window.innerWidth * 0.94) / aspect)))
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
        className="framed-hero"
        onClick={() => setOpen(true)}
        aria-label="View larger"
      >
        <FramedArt
          imageUrl={imageUrl}
          srcSet={srcSet}
          alt={alt}
          width={width}
          height={height}
          sizes="(max-width: 900px) 80vw, 620px"
          eager
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
          <div
            className="framed-lightbox-stage"
            style={
              stageHeight
                ? ({ '--stage-h': `${stageHeight}px` } as React.CSSProperties)
                : undefined
            }
            onClick={(e) => e.stopPropagation()}
          >
            <FramedArt
              imageUrl={imageUrl}
              srcSet={srcSet}
              alt={alt}
              width={width}
              height={height}
              sizes="88vw"
              eager
            />
          </div>
        </div>
      )}
    </>
  )
}
