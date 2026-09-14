'use client'

import { useEffect, useRef, useState } from 'react'
import FramedArt from '@/components/shop/FramedArt'
import { frameMetrics } from '@/lib/frame'
import { fitInQuad, matrix3dFor, quadToPixels, referenceWidth } from '@/lib/perspective'
import { imageFor, type PresetRoom } from '@/lib/preset-rooms'

/**
 * A print hung in a photograph of a real room.
 *
 * Nothing is composited and nothing is stored: the frame is the same frame the
 * rest of the shop uses, mapped onto the four corners of the wall with a CSS
 * perspective transform. Replace the photograph and every mockup updates.
 *
 * What stops it looking like a sticker is the light. The frame is exposed down
 * to the room's own level, washed with the wall's colour, and darkened across
 * its width the way the window light falls off — all measured off the room
 * photograph itself. See lib/preset-rooms.ts.
 *
 * The corners are percentages, so the maths needs the drawn size of the
 * picture, which only the browser knows. Until it's measured the frame is held
 * back rather than shown in the wrong place.
 */
export default function RoomScene({
  room,
  imageUrl,
  srcSet,
  alt,
  width,
  height,
  sizes,
  eager = false,
}: {
  room: PresetRoom
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
  const aspect = m.widthFactor / m.heightFactor

  let art: { transform: string; width: number; height: number } | null = null

  if (box) {
    const wall = quadToPixels(room.corners, box.w, box.h)
    const piece = fitInQuad(wall, aspect)
    const refW = referenceWidth(piece)
    const refH = refW / aspect
    const transform = matrix3dFor(piece, refW, refH)

    if (transform) art = { transform, width: refW, height: refH }
  }

  const photo = imageFor(room)

  return (
    <div
      ref={ref}
      className="scene"
      style={{ aspectRatio: `${room.width} / ${room.height}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="scene-room"
        src={photo.src}
        srcSet={photo.srcSet}
        sizes={sizes}
        alt={room.name}
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
      />

      {art && (
        <div
          className="scene-art"
          style={
            {
              width: art.width,
              height: art.height,
              transform: art.transform,
              '--exposure': String(room.light.exposure),
              '--wash': room.light.wash,
              '--falloff': String(room.light.falloff),
              '--shadow': String(room.light.shadow),
            } as React.CSSProperties
          }
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

          {/* The room's light, over the piece: its colour, and the fall-off
              away from the window. Multiply, so it only ever darkens. */}
          <span className="scene-light" aria-hidden />

          {/* A whisper of glass catching the window */}
          <span className="scene-glass" aria-hidden />
        </div>
      )}
    </div>
  )
}
