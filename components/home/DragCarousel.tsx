'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

export type CarouselItem = {
  href: string
  title: string
  meta: string | null
  imageUrl: string | null
}

/** Horizontal strip of framed prints you drag through. */
export default function DragCarousel({ items }: { items: CarouselItem[] }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const state = useRef({ startX: 0, startScroll: 0, moved: 0 })

  function down(clientX: number) {
    const track = trackRef.current
    if (!track) return
    setDragging(true)
    state.current = { startX: clientX, startScroll: track.scrollLeft, moved: 0 }
  }

  function move(clientX: number) {
    const track = trackRef.current
    if (!track || !dragging) return
    const delta = clientX - state.current.startX
    state.current.moved = Math.abs(delta)
    track.scrollLeft = state.current.startScroll - delta
  }

  function scrollBy(direction: 1 | -1) {
    const track = trackRef.current
    if (!track) return
    const card = track.querySelector('.carousel-card') as HTMLElement | null
    const step = card ? card.offsetWidth + 24 : track.clientWidth * 0.7
    track.scrollBy({ left: direction * step, behavior: 'smooth' })
  }

  return (
    <div className="carousel">
      <div
        ref={trackRef}
        className="carousel-track"
        data-dragging={dragging}
        onMouseDown={(e) => down(e.clientX)}
        onMouseMove={(e) => move(e.clientX)}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
        onTouchStart={(e) => down(e.touches[0].clientX)}
        onTouchMove={(e) => move(e.touches[0].clientX)}
        onTouchEnd={() => setDragging(false)}
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="carousel-card"
            // A real drag shouldn't also count as a click
            onClick={(e) => {
              if (state.current.moved > 6) e.preventDefault()
            }}
            draggable={false}
          >
            <div className="carousel-mat">
              <div className="carousel-image">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" loading="lazy" draggable={false} />
                )}
              </div>
              {item.meta && <span className="carousel-side-label">{item.meta}</span>}
            </div>

            <p className="carousel-title">{item.title}</p>
          </Link>
        ))}
      </div>

      <div className="carousel-controls">
        <span className="carousel-hint">Drag to explore</span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button type="button" onClick={() => scrollBy(-1)} aria-label="Previous">
            &#8249;
          </button>
          <button type="button" onClick={() => scrollBy(1)} aria-label="Next">
            &#8250;
          </button>
        </div>
      </div>
    </div>
  )
}
