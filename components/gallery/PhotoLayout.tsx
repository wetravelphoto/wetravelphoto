'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  arrangementFor,
  editorialRows,
  justifiedRows,
  masonryColumns,
  masonryDeal,
  ratioOf,
  type LayoutStyle,
  type Row,
} from '@/lib/gallery/layouts'
import { SIZES_ATTR } from '@/lib/srcset'
import type { ImageView } from '@/lib/photos/render-view'
import './photo-layout.css'

/** What a tile needs: an id, the photograph's own size, and its views. Never a row. */
export type LayoutPhoto = {
  readonly id: string
  readonly width: number | null
  readonly height: number | null
  readonly caption?: string | null
  readonly view: ImageView
  readonly full?: ImageView
}

/**
 * THE ONE GALLERY RENDERER
 * ════════════════════════
 *
 * The public album, the client's private link and the editor's live preview
 * all draw their photographs through this component, so what the photographer
 * previews is what the client sees. lib/gallery/layouts.ts decides the
 * arrangement; this measures its own width and draws it.
 *
 * Every tile is sized by its own photograph's ratio (`aspect-ratio`), so a
 * landscape tile can never sit in a slot sized for a portrait neighbour —
 * which is what used to leave a large empty grey block under landscape photos
 * in the client grid (a CSS grid row stretched every tile to the tallest).
 *
 * The first render assumes `assumedWidth` (the server cannot measure); the
 * real width replaces it before paint on the client.
 */
export default function PhotoLayout({
  photos,
  layout,
  heroFirst = false,
  onOpen,
  overlay,
  assumedWidth = 1200,
}: {
  photos: readonly LayoutPhoto[]
  layout: LayoutStyle
  heroFirst?: boolean
  onOpen?: (index: number) => void
  /** Per-tile controls drawn over the photograph (favourite, download). */
  overlay?: (photo: LayoutPhoto, index: number) => ReactNode
  assumedWidth?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(assumedWidth)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // offsetWidth is the layout width, untouched by the editor preview's CSS
    // scale. A ResizeObserver reports once as soon as it observes, before
    // paint, so there is no separate first measurement.
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.offsetWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const gap = width < 520 ? 6 : width < 900 ? 10 : 14
  const hero = heroFirst && photos.length > 1 ? photos[0]! : null
  const rest = hero ? photos.slice(1) : photos
  const offset = hero ? 1 : 0
  const arrangement = arrangementFor(layout, rest.length)
  const ratios = rest.map((p) => ratioOf(p.width, p.height))

  const tile = (photo: LayoutPhoto, i: number, extra: React.CSSProperties = {}, view: ImageView = photo.view, sizes: string = SIZES_ATTR.grid) => (
    <figure key={photo.id} className="pl-tile" style={extra}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={view.src}
        srcSet={view.srcSet}
        sizes={sizes}
        alt={view.alt}
        loading={i < 4 ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onClick={onOpen ? () => onOpen(i) : undefined}
        style={onOpen ? undefined : { cursor: 'default' }}
      />
      {overlay && <div className="pl-overlay">{overlay(photo, i)}</div>}
    </figure>
  )

  const rows = (list: Row[]) => (
    <div className="pl-rows" style={{ gap }}>
      {list.map((row, r) => (
        <div
          key={r}
          className="pl-row"
          style={{ gap, height: row.height, justifyContent: row.filled ? 'flex-start' : 'center' }}
        >
          {row.items.map((item) => tile(rest[item.index]!, item.index + offset, { width: item.width, flex: `0 0 ${item.width}px` }))}
        </div>
      ))}
    </div>
  )

  let body: ReactNode = null
  switch (arrangement) {
    case 'none':
      break
    case 'single': {
      const p = rest[0]!
      body = (
        <div className="pl-single">
          {tile(p, offset, ratioStyle(ratioOf(p.width, p.height)), p.full ?? p.view, SIZES_ATTR.fullWidth)}
          {p.caption && <p className="pl-caption">{p.caption}</p>}
        </div>
      )
      break
    }
    case 'justified':
      body = rows(justifiedRows(ratios, width, gap))
      break
    case 'editorial':
      body = rows(editorialRows(ratios, width, gap))
      break
    case 'masonry': {
      const cols = masonryDeal(ratios, masonryColumns(width, rest.length))
      body = (
        <div className="pl-masonry" style={{ gap }}>
          {cols.map((col, c) => (
            <div key={c} className="pl-col" style={{ gap }}>
              {col.map((i) => tile(rest[i]!, i + offset, { aspectRatio: `${ratios[i]}` }))}
            </div>
          ))}
        </div>
      )
      break
    }
    case 'square':
      body = (
        <div className="pl-square" style={{ gap, gridTemplateColumns: `repeat(${squareColumns(width, rest.length)}, minmax(0, 1fr))` }}>
          {rest.map((p, i) => tile(p, i + offset, { aspectRatio: '1' }))}
        </div>
      )
      break
    case 'column':
      body = (
        <div className="pl-column">
          {rest.map((p, i) => {
            const r = ratios[i]!
            return (
              <div key={p.id} className="pl-column-item" data-portrait={r < 1 ? '' : undefined}>
                {tile(p, i + offset, ratioStyle(r), p.full ?? p.view, SIZES_ATTR.fullWidth)}
                {p.caption && <p className="pl-caption">{p.caption}</p>}
              </div>
            )
          })}
        </div>
      )
      break
  }

  return (
    <div ref={ref} className="pl-root" data-arrangement={arrangement}>
      {hero && (
        <div className="pl-hero" style={{ marginBottom: gap }}>
          {tile(hero, 0, { aspectRatio: `${ratioOf(hero.width, hero.height)}` }, hero.full ?? hero.view, SIZES_ATTR.fullWidth)}
        </div>
      )}
      {body}
    </div>
  )
}

/** A tile's shape, plus the ratio as a variable the stylesheet uses to cap its height at the screen's. */
function ratioStyle(r: number): React.CSSProperties {
  return { aspectRatio: `${r}`, ['--pl-ratio' as string]: r } as React.CSSProperties
}

function squareColumns(width: number, count: number): number {
  const byWidth = width < 520 ? 2 : width < 900 ? 3 : width < 1300 ? 4 : 5
  return Math.max(1, Math.min(byWidth, count))
}
