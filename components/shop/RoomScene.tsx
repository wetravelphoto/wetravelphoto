'use client'

import { useEffect, useRef, useState } from 'react'
import FramedArt from '@/components/shop/FramedArt'
import { frameMetrics } from '@/lib/frame'
import { fitInQuad, matrix3dFor, quadToPixels, referenceWidth, type Quad } from '@/lib/perspective'
import type { RoomSceneRecord } from '@/lib/scenes'

/**
 * A print hung in a photograph of a real room.
 *
 * Nothing is composited and nothing is stored: the frame is the same frame the
 * rest of the shop uses, mapped onto the four corners of the wall space with a
 * CSS perspective transform. Replace the photograph, change the moulding, and
 * every room updates — there are no stale mockups to regenerate.
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
  const outerAspect = m.widthFactor / m.heightFactor

  let art: { transform: string; width: number; height: number } | null = null

  if (box) {
    const wall = quadToPixels(scene.corners as Quad, box.w, box.h)
    const piece = fitInQuad(wall, outerAspect)
    const refW = referenceWidth(piece)
    const refH = refW / outerAspect
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
        </div>
      )}
    </div>
  )
}
