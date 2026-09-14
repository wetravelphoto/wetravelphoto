'use client'

import { useEffect, useRef, useState } from 'react'
import FramedArt from '@/components/shop/FramedArt'
import { frameMetrics } from '@/lib/frame'
import { fitInQuad, matrix3dFor, quadToPixels, referenceWidth, type Quad } from '@/lib/perspective'
import type { RoomSceneRecord } from '@/lib/scenes'

/**
 * A print hung in a photograph of a real room.
 *
 * Nothing is composited and nothing is stored: the artwork is mapped onto the
 * four corners of the wall space with a CSS perspective transform. Replace the
 * photograph and every room updates — there are no stale mockups to
 * regenerate.
 *
 * A room comes one of two ways. If it already has a frame in it, that frame
 * has real light and a real shadow and we only drop the photograph into its
 * opening; drawing our own over the top would give a frame inside a frame. An
 * empty wall gets the whole framed piece instead.
 *
 * The corners are percentages, so the maths needs the drawn size of the
 * picture, which only the browser knows. Until it's measured the frame is held
 * back rather than shown in the wrong place for a frame.
 */
export default function RoomScene({
  scene,
  imageUrl,
  srcSet,
  alt,
  width,
  height,
  sizes,
  eager = false,
}: {
  scene: RoomSceneRecord
  imageUrl: string
  srcSet?: string
  alt: string
  width: number | null
  height: number | null
  sizes?: string
  eager?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect
      if (w > 0 && h > 0) setBox({ w, h })
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const m = frameMetrics(width, height)

  // With a frame already in the picture, the corners mark the artwork opening
  // and the print's own shape is what has to fit; otherwise it's the frame's
  // outer shape, mat and moulding included.
  const aspect = scene.hasFrame ? m.artRatio : m.widthFactor / m.heightFactor

  let art: { transform: string; width: number; height: number } | null = null

  if (box) {
    const wall = quadToPixels(scene.corners as Quad, box.w, box.h)
    const piece = fitInQuad(wall, aspect)
    const refW = referenceWidth(piece)
    const refH = refW / aspect
    const transform = matrix3dFor(piece, refW, refH)

    if (transform) art = { transform, width: refW, height: refH }
  }

  return (
    <div
      ref={ref}
      className="scene"
      style={{ aspectRatio: scene.width && scene.height ? `${scene.width} / ${scene.height}` : '3 / 2' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="scene-room"
        src={scene.imageUrl}
        srcSet={scene.srcSet}
        sizes={sizes}
        alt={scene.name}
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
      />

      {art && (
        <div
          className="scene-art"
          style={{ width: art.width, height: art.height, transform: art.transform }}
        >
          {scene.hasFrame ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              className="scene-print"
              src={imageUrl}
              srcSet={srcSet}
              sizes={sizes}
              alt={alt}
              decoding="async"
              loading={eager ? 'eager' : 'lazy'}
            />
          ) : (
            <FramedArt
              imageUrl={imageUrl}
              srcSet={srcSet}
              alt={alt}
              width={width}
              height={height}
              sizes={sizes}
              eager={eager}
              fill
            />
          )}
        </div>
      )}
    </div>
  )
}
