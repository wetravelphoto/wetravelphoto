'use client'

import { useRef, useState, useEffect } from 'react'

export type FocalPoint = { x: number; y: number }

/**
 * Click or drag on the image to set where it stays anchored when cropped.
 * Desktop and mobile are stored separately, since the hero is wide on one
 * and tall on the other.
 */
export default function FocalPicker({
  imageUrl,
  desktop,
  mobile,
  onChange,
  onDevice,
}: {
  imageUrl: string
  desktop: FocalPoint
  mobile: FocalPoint
  onChange: (next: { desktop: FocalPoint; mobile: FocalPoint }) => void
  /**
   * Which crop is being looked at. The canvas uses it to put the preview into
   * the matching width — cropping for the phone while looking at the desktop
   * layout is guessing.
   */
  onDevice?: (device: 'desktop' | 'mobile') => void
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [dragging, setDragging] = useState(false)

  // Mirrored locally so the dot tracks the cursor even if the parent is slow
  // to hand the value back down.
  const [local, setLocal] = useState({ desktop, mobile })
  const frameRef = useRef<HTMLDivElement>(null)

  // Follow the parent when it changes from the outside (e.g. a new image)
  useEffect(() => {
    setLocal({ desktop, mobile })
  }, [desktop.x, desktop.y, mobile.x, mobile.y])

  const point = device === 'desktop' ? local.desktop : local.mobile

  function apply(clientX: number, clientY: number) {
    const frame = frameRef.current
    if (!frame) return

    const rect = frame.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    const rounded = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }

    const next =
      device === 'desktop'
        ? { desktop: rounded, mobile: local.mobile }
        : { desktop: local.desktop, mobile: rounded }

    setLocal(next)
    onChange(next)
  }

  function reset() {
    const centre = { x: 0.5, y: 0.5 }
    const next =
      device === 'desktop'
        ? { desktop: centre, mobile: local.mobile }
        : { desktop: local.desktop, mobile: centre }

    setLocal(next)
    onChange(next)
  }

  return (
    <div className="focal-picker">
      <div className="focal-tabs">
        <button
          type="button"
          onClick={() => {
            setDevice('desktop')
            onDevice?.('desktop')
          }}
          data-active={device === 'desktop'}
        >
          Desktop
        </button>
        <button
          type="button"
          onClick={() => {
            setDevice('mobile')
            onDevice?.('mobile')
          }}
          data-active={device === 'mobile'}
        >
          Mobile
        </button>
        <button type="button" onClick={reset} className="focal-reset">
          Centre
        </button>
      </div>

      {/* The frame matches the hero's shape on that device, so what you see
          here is the crop a visitor gets */}
      <div
        ref={frameRef}
        className="focal-frame"
        data-device={device}
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          apply(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (dragging) apply(e.clientX, e.clientY)
        }}
        onPointerUp={(e) => {
          setDragging(false)
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onPointerCancel={() => setDragging(false)}
        title="Click or drag to set the focal point"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          style={{ objectPosition: `${point.x * 100}% ${point.y * 100}%` }}
        />
        <span className="focal-dot" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />
      </div>

      <p className="admin-meta" style={{ margin: '0.4rem 0 0' }}>
        {device === 'desktop' ? 'Wide crop' : 'Tall crop'} · {Math.round(point.x * 100)}% /{' '}
        {Math.round(point.y * 100)}%
      </p>
    </div>
  )
}
