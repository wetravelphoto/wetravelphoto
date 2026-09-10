'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import CoverRenderer, { type CoverSettings } from '@/components/CoverRenderer'

export type CarouselItem = {
  href: string
  title: string
  cover: CoverSettings
}

const GAP = 16

/** Sliver of the neighbouring cards visible either side. */
function peekFor(width: number) {
  return Math.min(Math.max(20, width * 0.05), 80)
}

/**
 * Infinite carousel on a transformed track. Each card shows the gallery's own
 * composed cover — layout, typography and overlay included — rather than a
 * bare photograph.
 */
export default function DragCarousel({ items }: { items: CarouselItem[] }) {
  const viewportRef = useRef<HTMLDivElement>(null)

  const count = items.length
  const looping = count > 1
  const slides = looping ? [...items, ...items, ...items] : items

  const [width, setWidth] = useState(0)
  const [index, setIndex] = useState(looping ? count : 0)
  const [animate, setAnimate] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)

  const drag = useRef({ startX: 0, moved: 0, active: false })

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const update = () => setWidth(viewport.clientWidth)
    update()

    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (width === 0) return
    const id = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(id)
  }, [width])

  const peek = peekFor(width)
  const narrow = width > 0 && width < 820
  const cardWidth = narrow
    ? Math.max(120, width - peek * 2)
    : Math.max(120, (width - peek * 2 - GAP) / 2)
  const step = cardWidth + GAP

  const handleTransitionEnd = useCallback(() => {
    if (!looping) return

    if (index >= count * 2 || index < count) {
      const normalised = (((index - count) % count) + count) % count
      setAnimate(false)
      setIndex(normalised + count)
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)))
    }
  }, [index, count, looping])

  function start(clientX: number) {
    if (width === 0) return
    drag.current = { startX: clientX, moved: 0, active: true }
    setAnimate(false)
  }

  function move(clientX: number) {
    if (!drag.current.active) return
    const delta = clientX - drag.current.startX
    drag.current.moved = Math.abs(delta)
    setDragOffset(delta)
  }

  function end() {
    if (!drag.current.active) return
    drag.current.active = false

    const offset = dragOffset
    const threshold = step * 0.33

    let shift = 0
    if (offset < -threshold) shift = Math.max(1, Math.round(-offset / step))
    else if (offset > threshold) shift = -Math.max(1, Math.round(offset / step))

    setDragOffset(0)
    setAnimate(true)
    setIndex((i) => i + shift)
  }

  const x = width === 0 ? 0 : peek - index * step + dragOffset

  return (
    <div
      className="carousel-viewport"
      ref={viewportRef}
      style={{ overflow: 'hidden', cursor: drag.current.active ? 'grabbing' : 'grab' }}
    >
      <div
        style={{
          display: 'flex',
          gap: `${GAP}px`,
          transform: `translate3d(${x}px, 0, 0)`,
          transition: animate ? 'transform 850ms cubic-bezier(0.33, 1, 0.68, 1)' : 'none',
          willChange: 'transform',
          touchAction: 'pan-y',
          visibility: width === 0 ? 'hidden' : 'visible',
        }}
        onTransitionEnd={handleTransitionEnd}
        onMouseDown={(e) => {
          e.preventDefault()
          start(e.clientX)
        }}
        onMouseMove={(e) => move(e.clientX)}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={(e) => start(e.touches[0].clientX)}
        onTouchMove={(e) => move(e.touches[0].clientX)}
        onTouchEnd={end}
      >
        {slides.map((item, i) => (
          <Link
            key={`${item.href}-${i}`}
            href={item.href}
            className="carousel-card"
            style={{ flex: '0 0 auto', width: `${cardWidth}px`, userSelect: 'none' }}
            onClick={(e) => {
              // A real drag shouldn't also count as a click
              if (drag.current.moved > 6) e.preventDefault()
            }}
            draggable={false}
          >
            <div className="carousel-mat">
              <div className="carousel-cover">
                {/* The gallery's own cover composition, scaled to the frame */}
                <CoverRenderer settings={item.cover} height="100%" />
              </div>
            </div>

            <span className="carousel-view">View gallery</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
