'use client'

import { useState, useEffect, useCallback } from 'react'
import FramedArt from '@/components/shop/FramedArt'
import RoomScene from '@/components/shop/RoomScene'
import { frameMetrics } from '@/lib/frame'
import type { RoomSceneRecord } from '@/lib/scenes'

/**
 * The picture side of a product page: one large view, a strip of alternatives
 * under it, and a click to see the chosen one full screen.
 *
 * The first view is the print framed against the wall. The rest are the room
 * scenes, generated live — see RoomScene.
 */
export default function ProductViews({
  imageUrl,
  srcSet,
  alt,
  width,
  height,
  scenes,
  hint,
}: {
  imageUrl: string
  srcSet?: string
  alt: string
  width: number | null
  height: number | null
  scenes: RoomSceneRecord[]
  hint?: string | null
}) {
  const [active, setActive] = useState(0)
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

  const art = { imageUrl, srcSet, alt, width, height }
  const views = [null, ...scenes]
  const current = views[Math.min(active, views.length - 1)]

  // How wide the frame may be drawn on the bare wall, as a percentage of the
  // box. Whichever way the piece is more extreme decides: a panorama runs out
  // of width, a tall print runs out of height. Worked out here rather than in
  // CSS because it needs the frame's own proportions, and getting it wrong is
  // what crops a portrait top and bottom.
  //
  // On a bare wall the frame fills its container's width (see FramedArt's fill
  // mode), so its height is width x heightFactor/widthFactor — which is why
  // the widthFactor belongs in here. Leaving it out is what cropped a tall
  // print top and bottom.
  const m = frameMetrics(width, height)
  const solo = `${Math.min(88, (69 * m.widthFactor) / m.heightFactor).toFixed(2)}%`

  return (
    <div className="views">
      <button
        type="button"
        className="views-stage"
        onClick={() => setOpen(true)}
        aria-label="View larger"
      >
        {current ? (
          <RoomScene
            scene={current}
            {...art}
            sizes="(max-width: 900px) 92vw, 46vw"
            eager={active === 1}
          />
        ) : (
          <div className="views-plain">
            <div className="framed-solo" style={{ '--solo': solo } as React.CSSProperties}>
              <FramedArt {...art} sizes="(max-width: 900px) 84vw, 520px" eager fill />
            </div>
          </div>
        )}

        {hint && (
          <span className="framed-hint" aria-hidden>
            {hint}
          </span>
        )}
      </button>

      {views.length > 1 && (
        <div className="views-strip" role="tablist" aria-label="Views">
          {views.map((view, index) => (
            <button
              key={view?.id ?? 'frame'}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-label={view ? view.name : 'The print, framed'}
              className="views-thumb"
              data-active={index === active}
              onClick={() => setActive(index)}
            >
              {view ? (
                <RoomScene scene={view} {...art} sizes="180px" />
              ) : (
                <div className="views-plain">
                  <div
                    className="framed-solo"
                    style={{ '--solo': solo } as React.CSSProperties}
                  >
                    <FramedArt {...art} sizes="180px" fill />
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

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
            <FramedArt {...art} sizes="90vw" eager />
          </div>
        </div>
      )}
    </div>
  )
}
