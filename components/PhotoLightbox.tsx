'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export type LightboxPhoto = {
  id: string
  storage_path: string
  caption: string | null
  alt_text: string | null
  is_for_sale?: boolean
}

type Transform = { scale: number; x: number; y: number }

const RESET: Transform = { scale: 1, x: 0, y: 0 }
const MAX_SCALE = 5

/**
 * Full-screen viewer. Pinch or double-tap to zoom, drag to pan, swipe to move
 * between photographs when not zoomed in.
 */
export default function PhotoLightbox({
  photos,
  publicUrl,
  index,
  onClose,
  onIndexChange,
  actions,
}: {
  photos: LightboxPhoto[]
  publicUrl: string
  index: number
  onClose: () => void
  onIndexChange: (next: number) => void
  actions?: React.ReactNode
}) {
  const [transform, setTransform] = useState<Transform>(RESET)
  const zoomed = transform.scale > 1.01

  // Gesture bookkeeping, kept in a ref so it never triggers a re-render
  const gesture = useRef({
    pointers: new Map<number, { x: number; y: number }>(),
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: 0,
    lastTap: 0,
  })

  const step = useCallback(
    (direction: 1 | -1) => {
      setTransform(RESET)
      onIndexChange((index + direction + photos.length) % photos.length)
    },
    [index, photos.length, onIndexChange]
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }

    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose, step])

  // Reset the zoom whenever the photograph changes
  useEffect(() => setTransform(RESET), [index])

  const current = photos[index]
  if (!current) return null

  function distanceBetween(points: { x: number; y: number }[]) {
    const [a, b] = points
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerDown(e: React.PointerEvent) {
    const g = gesture.current
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    g.moved = 0

    if (g.pointers.size === 2) {
      const points = [...g.pointers.values()]
      g.startDistance = distanceBetween(points)
      g.startScale = transform.scale
      g.originX = transform.x
      g.originY = transform.y
    } else {
      g.startX = e.clientX
      g.startY = e.clientY
      g.originX = transform.x
      g.originY = transform.y
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g.pointers.has(e.pointerId)) return

    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Two fingers: pinch to zoom
    if (g.pointers.size === 2 && g.startDistance > 0) {
      const points = [...g.pointers.values()]
      const ratio = distanceBetween(points) / g.startDistance
      const scale = Math.min(MAX_SCALE, Math.max(1, g.startScale * ratio))
      setTransform((t) => ({ ...t, scale }))
      return
    }

    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    g.moved = Math.max(g.moved, Math.hypot(dx, dy))

    // Zoomed in, a drag pans the photograph
    if (zoomed) {
      setTransform((t) => ({ ...t, x: g.originX + dx, y: g.originY + dy }))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current
    const wasPinching = g.pointers.size === 2
    g.pointers.delete(e.pointerId)

    if (wasPinching) {
      g.startDistance = 0
      // Snap back if the pinch ended close to natural size
      setTransform((t) => (t.scale < 1.05 ? RESET : t))
      return
    }

    // Double tap toggles zoom
    const now = Date.now()
    if (g.moved < 8) {
      if (now - g.lastTap < 300) {
        setTransform((t) => (t.scale > 1.01 ? RESET : { scale: 2.5, x: 0, y: 0 }))
        g.lastTap = 0
        return
      }
      g.lastTap = now
    }

    // A horizontal swipe changes photograph, but only at natural size
    if (!zoomed && g.moved > 60) {
      const dx = e.clientX - g.startX
      if (Math.abs(dx) > 60) step(dx > 0 ? -1 : 1)
    }
  }

  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !zoomed) return
    e.preventDefault()
    const next = Math.min(MAX_SCALE, Math.max(1, transform.scale - e.deltaY * 0.003))
    setTransform((t) => (next <= 1.01 ? RESET : { ...t, scale: next }))
  }

  return (
    <div className="lightbox" onClick={() => !zoomed && onClose()}>
      <button onClick={onClose} className="lightbox-close" aria-label="Close">
        &times;
      </button>

      {photos.length > 1 && !zoomed && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation()
              step(-1)
            }}
            className="lightbox-nav"
            data-side="left"
            aria-label="Previous photo"
          >
            &#8249;
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              step(1)
            }}
            className="lightbox-nav"
            data-side="right"
            aria-label="Next photo"
          >
            &#8250;
          </button>
        </>
      )}

      <div
        className="lightbox-stage"
        data-zoomed={zoomed}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${publicUrl}/${current.storage_path}`}
          alt={current.alt_text ?? current.caption ?? ''}
          draggable={false}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transition: gesture.current.pointers.size === 0 ? 'transform 0.22s ease-out' : 'none',
          }}
        />
      </div>

      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-count">
          {String(index + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}
        </span>

        {current.caption && <span className="lightbox-caption">{current.caption}</span>}

        {zoomed && (
          <button type="button" onClick={() => setTransform(RESET)} className="lightbox-reset">
            Reset zoom
          </button>
        )}

        {actions}
      </div>
    </div>
  )
}
