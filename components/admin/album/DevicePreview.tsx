'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** The two screens the editor previews at, in real CSS pixels. */
export const DEVICES = {
  desktop: { width: 1440, height: 900, label: 'Desktop' },
  mobile: { width: 390, height: 844, label: 'Phone' },
} as const
export type Device = keyof typeof DEVICES

/**
 * Draws its children at a device's true width — 1440 or 390 CSS pixels — and
 * scales the result down to fit. Nothing inside knows it is a preview: the
 * cover's container units, the gallery's measured width and every media rule
 * see the device's own size, so the preview lays out exactly as the page does
 * on that screen. (A CSS transform does not change layout size.)
 */
export default function DevicePreview({
  width,
  maxWidth,
  clipHeight,
  children,
  className,
}: {
  /** The logical width the children are laid out at. */
  width: number
  /** The most room the scaled preview may take on screen. */
  maxWidth?: number
  /** Show at most this many logical pixels of height (a thumbnail). */
  clipHeight?: number
  children: ReactNode
  className?: string
}) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.25)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const room = Math.min(o.clientWidth || width, maxWidth ?? Infinity)
      setScale(room > 0 ? room / width : 0.25)
      setHeight(i.offsetHeight)
    }
    // Reports once on observe (before paint), then on every change.
    const ro = new ResizeObserver(measure)
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [width, maxWidth])

  const shown = clipHeight ? Math.min(height || clipHeight, clipHeight) : height

  return (
    <div ref={outer} className={className} style={{ width: '100%' }}>
      <div
        style={{
          width: width * scale,
          height: shown * scale,
          overflow: 'hidden',
          position: 'relative',
          margin: '0 auto',
        }}
      >
        <div
          ref={inner}
          style={{ width, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
