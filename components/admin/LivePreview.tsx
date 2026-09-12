'use client'

import { useRef, useState, useEffect } from 'react'
import DeviceSwitch from '@/components/admin/DeviceSwitch'

const WIDTHS = { desktop: 1440, mobile: 390 } as const

/**
 * Embeds the real page rather than approximating it, so what you see is
 * exactly what visitors get. It shows saved content — press Refresh after
 * saving to pull the latest.
 */
export default function LivePreview({
  path,
  label = 'Live preview',
}: {
  path: string
  label?: string
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [wide, setWide] = useState(false)
  const [nonce, setNonce] = useState(() => Date.now())
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)

  const width = WIDTHS[device]

  // Scale the full-width page down to whatever space the rail has
  useEffect(() => {
    const el = frameRef.current
    if (!el) return

    const measure = () => setScale(el.clientWidth / width)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [width])

  const src = `${path}${path.includes('?') ? '&' : '?'}preview=${nonce}`

  return (
    <>
      <div className="preview-toolbar">
        <span className="admin-meta">{label}</span>

        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setNonce(Date.now())}
            className="admin-btn admin-btn-sm admin-btn-ghost"
            title="Reload the preview"
          >
            Refresh
          </button>
          <DeviceSwitch device={device} onDevice={setDevice} onExpand={() => setWide(true)} />
        </div>
      </div>

      <div className="live-frame" ref={frameRef}>
        <div
          className="live-frame-scaler"
          style={{ width, height: 900, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          <iframe key={`${device}-${nonce}`} src={src} title="Preview" width={width} height={900} />
        </div>
      </div>

      <p className="admin-meta" style={{ margin: '0.6rem 0 0', lineHeight: 1.5 }}>
        Shows the published page. Save, then refresh to see your changes.
      </p>

      {wide && (
        <div className="preview-overlay" onClick={() => setWide(false)}>
          <div className="preview-overlay-inner" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setWide(false)}
              className="admin-btn admin-btn-sm preview-overlay-close"
            >
              Close
            </button>

            <iframe
              key={`wide-${device}-${nonce}`}
              src={src}
              title="Preview"
              className="live-frame-wide"
              style={{ width: device === 'mobile' ? 390 : '100%' }}
            />
          </div>
        </div>
      )}
    </>
  )
}
