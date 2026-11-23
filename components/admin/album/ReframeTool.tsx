'use client'

import { useRef, useState } from 'react'
import { CoverPhoto } from '@/components/covers/GalleryCover'
import { COVER_ZOOM, clampFocal, clampZoom } from '@/lib/covers/registry'
import type { CoverImage } from '@/lib/covers/model'

/**
 * REFRAME — replaces "Set focal point" (approved design: Reframe.dc.html)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Drag the photograph, zoom 100–250 %, a rule-of-thirds grid, the cut-off part
 * shown faded, and the desktop and phone crops side by side sharing ONE focal
 * point. It stores what covers always stored — `cover_focal_x/y` — plus the
 * zoom (`cover_zoom`, migration 20261122233150).
 *
 * Both crops are drawn by CoverPhoto, the component the cover itself uses, so
 * what is framed here is what the page shows. Its geometry is CSS's own: the
 * focal point is `object-position`, and zoom scales about that same point. The
 * drag below inverts exactly that: for a frame `w` wide showing an image `W`
 * wide at zoom `z`, the image's left edge sits at fx·(w − W·z).
 */

export type Frame = { wide: number; narrow: number }

export default function ReframeTool({
  image,
  frame,
  initial,
  onDone,
  onCancel,
  onChangePhoto,
}: {
  image: CoverImage
  /** The style's crops (registry `slot`): width ÷ height, wide screen and phone. */
  frame: Frame
  initial: { focalX: number; focalY: number; zoom: number }
  onDone: (v: { focalX: number; focalY: number; zoom: number }) => void
  onCancel: () => void
  onChangePhoto?: () => void
}) {
  const [fx, setFx] = useState(clampFocal(initial.focalX))
  const [fy, setFy] = useState(clampFocal(initial.focalY))
  const [z, setZ] = useState(clampZoom(initial.zoom))
  const [grid, setGrid] = useState(true)
  const [natural, setNatural] = useState<number | null>(image.width && image.height ? image.width / image.height : null)
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // The desktop crop: as wide as fits, never taller than 420px on screen.
  const dw = Math.round(Math.min(620, 420 * frame.wide))
  const dh = Math.round(dw / frame.wide)
  // The phone crop: 180px wide, as tall as its aspect says.
  const pw = 180
  const ph = Math.round(pw / frame.narrow)

  const ratio = natural ?? 1.5
  // The photograph's drawn size in the desktop frame: cover-fit, then zoomed.
  const baseW = ratio > frame.wide ? dh * ratio : dw
  const baseH = ratio > frame.wide ? dh : dw / ratio
  const W = baseW * z
  const H = baseH * z
  const left = fx * (dw - W)
  const top = fy * (dh - H)

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = { x: e.clientX, y: e.clientY, fx, fy }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = drag.current
    if (!g) return
    // Dragging right moves the photograph right, i.e. shows more of its left.
    const spanX = dw - W
    const spanY = dh - H
    if (spanX < -0.5) setFx(clampFocal(g.fx + (e.clientX - g.x) / spanX))
    if (spanY < -0.5) setFy(clampFocal(g.fy + (e.clientY - g.y) / spanY))
  }
  function onUp() {
    drag.current = null
    setDragging(false)
  }
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 0.05 : 0.01
    if (e.key === 'ArrowLeft') setFx((v) => clampFocal(v - step))
    else if (e.key === 'ArrowRight') setFx((v) => clampFocal(v + step))
    else if (e.key === 'ArrowUp') setFy((v) => clampFocal(v - step))
    else if (e.key === 'ArrowDown') setFy((v) => clampFocal(v + step))
    else return
    e.preventDefault()
  }

  const thirds = (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {[33.333, 66.666].map((p) => (
        <div key={`v${p}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${p}%`, width: 1, background: 'rgba(255,255,255,0.6)' }} />
      ))}
      {[33.333, 66.666].map((p) => (
        <div key={`h${p}`} style={{ position: 'absolute', left: 0, right: 0, top: `${p}%`, height: 1, background: 'rgba(255,255,255,0.6)' }} />
      ))}
    </div>
  )

  return (
    <div className="cover-modal" onClick={onCancel}>
      <div className="reframe" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Reframe the cover photo">
        <aside className="reframe-side">
          <div>
            <h2 className="admin-h2" style={{ margin: 0 }}>Cover photo</h2>
            <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>Drag the photo to choose what shows.</p>
          </div>

          {onChangePhoto && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.src} alt="" style={{ width: 88, height: 56, objectFit: 'cover', display: 'block' }} />
              <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={onChangePhoto}>
                Change photo
              </button>
            </div>
          )}

          <label className="admin-field" style={{ margin: 0 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              Zoom <span className="admin-meta">{Math.round(z * 100)}%</span>
            </span>
            <input
              type="range"
              min={COVER_ZOOM.min * 100}
              max={COVER_ZOOM.max * 100}
              step={1}
              value={Math.round(z * 100)}
              onChange={(e) => setZ(clampZoom(Number(e.target.value) / 100))}
              style={{ width: '100%', accentColor: 'var(--admin-accent)' }}
            />
            <span className="admin-meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Fill</span>
              <span>Close crop</span>
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
            Show grid
          </label>

          <div style={{ borderTop: '0.5px solid var(--admin-line)', paddingTop: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 500 }}>One focal point, every screen</p>
            <p className="admin-meta" style={{ margin: '0.25rem 0 0', lineHeight: 1.5 }}>
              Desktop and phone crop around the same spot, so you set it once.
            </p>
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="admin-btn admin-btn-ghost"
              style={{ flex: 1 }}
              onClick={() => {
                setFx(0.5)
                setFy(0.5)
                setZ(1)
              }}
            >
              Reset
            </button>
            <button type="button" className="admin-btn" style={{ flex: 1 }} onClick={() => onDone({ focalX: fx, focalY: fy, zoom: z })}>
              Done
            </button>
          </div>
        </aside>

        <div className="reframe-stage">
          <div>
            <p className="admin-meta" style={{ margin: '0 0 0.5rem' }}>Desktop</p>
            <div style={{ position: 'relative', width: dw, height: dh }}>
              {/* The whole photograph, faded: what falls outside the frame is cut. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.src}
                alt=""
                aria-hidden="true"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget
                  if (!natural && img.naturalWidth && img.naturalHeight) setNatural(img.naturalWidth / img.naturalHeight)
                }}
                style={{ position: 'absolute', left, top, width: W, height: H, maxWidth: 'none', opacity: 0.28, pointerEvents: 'none' }}
              />
              <div
                role="slider"
                tabIndex={0}
                aria-label="Desktop crop of the cover photo — drag, or use the arrow keys, to reposition"
                // A slider must report a value: the horizontal position, 0–100;
                // the text gives both axes.
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(fx * 100)}
                aria-valuetext={`${Math.round(fx * 100)}% across, ${Math.round(fy * 100)}% down`}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onKeyDown={onKey}
                style={{
                  position: 'absolute',
                  inset: 0,
                  overflow: 'hidden',
                  touchAction: 'none',
                  cursor: dragging ? 'grabbing' : 'grab',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.9), 0 18px 40px rgba(0,0,0,0.18)',
                }}
              >
                <CoverPhoto image={image} focalX={fx} focalY={fy} zoom={z} className="reframe-photo" sizes="620px" />
                {grid && thirds}
              </div>
            </div>
            <p className="admin-meta" style={{ margin: '0.6rem 0 0' }}>The faded area is what gets cut off.</p>
          </div>

          <div>
            <p className="admin-meta" style={{ margin: '0 0 0.5rem' }}>Phone</p>
            <div
              role="img"
              aria-label="Phone crop preview"
              style={{ position: 'relative', width: pw, height: ph, overflow: 'hidden', borderRadius: 14, boxShadow: '0 0 0 5px #141210' }}
            >
              <CoverPhoto image={image} focalX={fx} focalY={fy} zoom={z} className="reframe-photo" sizes="180px" />
              {grid && thirds}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
