'use client'

import { useRef, useState, useCallback } from 'react'
import type { Quad, Point } from '@/lib/perspective'
import type { RoomSceneRecord } from '@/lib/scenes'

const LABELS = ['Top left', 'Top right', 'Bottom right', 'Bottom left']

/**
 * Marking where art hangs in a room.
 *
 * Four draggable corners over the photograph, kept as percentages so they hold
 * at any size. A quad rather than a box because a wall is rarely photographed
 * square-on — dragging the far corners in is what makes a print sit on the
 * wall instead of floating in front of it.
 *
 * The corners ride in a hidden field, so the surrounding form saves them with
 * everything else and the page needs no client-side submit of its own.
 */
export default function SceneEditor({ scene }: { scene: RoomSceneRecord }) {
  const [corners, setCorners] = useState<Quad>(scene.corners)
  const [dragging, setDragging] = useState<number | null>(null)
  const surface = useRef<HTMLDivElement>(null)

  const moveTo = useCallback((index: number, clientX: number, clientY: number) => {
    const node = surface.current
    if (!node) return

    const box = node.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return

    // A little slack outside the picture is deliberate: a wall often runs off
    // the edge of the frame, and clamping hard would make those unmarkable.
    const clamp = (n: number) => Math.min(110, Math.max(-10, n))

    const point: Point = [
      clamp(((clientX - box.left) / box.width) * 100),
      clamp(((clientY - box.top) / box.height) * 100),
    ]

    setCorners((current) => {
      const next = [...current] as Quad
      next[index] = point
      return next
    })
  }, [])

  function onPointerDown(index: number) {
    return (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setDragging(index)
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragging === null) return
    moveTo(dragging, e.clientX, e.clientY)
  }

  function onPointerUp() {
    setDragging(null)
  }

  /** Arrow keys nudge, so a corner can be placed exactly without a mouse. */
  function onKeyDown(index: number) {
    return (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 2 : 0.4
      const delta: Record<string, Point> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }

      const d = delta[e.key]
      if (!d) return

      e.preventDefault()
      setCorners((current) => {
        const next = [...current] as Quad
        next[index] = [current[index][0] + d[0], current[index][1] + d[1]]
        return next
      })
    }
  }

  const polygon = corners.map(([x, y]) => `${x}% ${y}%`).join(', ')

  return (
    <div className="scene-editor">
      <div
        ref={surface}
        className="scene-editor-surface"
        style={{
          aspectRatio: scene.width && scene.height ? `${scene.width} / ${scene.height}` : '3 / 2',
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={scene.imageUrl} srcSet={scene.srcSet} sizes="(max-width: 900px) 92vw, 620px" alt="" />

        <div className="scene-editor-shade" style={{ clipPath: `polygon(${polygon})` }} />

        {corners.map((point, index) => (
          <button
            key={index}
            type="button"
            className="scene-editor-handle"
            data-dragging={dragging === index}
            style={{ left: `${point[0]}%`, top: `${point[1]}%` }}
            onPointerDown={onPointerDown(index)}
            onKeyDown={onKeyDown(index)}
            aria-label={`${LABELS[index]} corner`}
          >
            <span>{index + 1}</span>
          </button>
        ))}
      </div>

      <input type="hidden" name="corners" value={JSON.stringify(corners)} />

      <p className="admin-meta scene-editor-note">
        Drag the four corners onto the wall space where a print should hang, in the order
        1–2–3–4. Pull the far corners in to match the angle of the wall. Arrow keys nudge a
        selected corner; hold shift to move faster.
      </p>
    </div>
  )
}
