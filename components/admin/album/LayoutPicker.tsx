'use client'

import PhotoLayout, { type LayoutPhoto } from '@/components/gallery/PhotoLayout'
import DevicePreview from '@/components/admin/album/DevicePreview'
import { LAYOUT_STYLES, STORABLE_LAYOUTS, type LayoutStyle } from '@/lib/gallery/layouts'

/**
 * Each gallery layout, previewed with this album's own photographs through
 * the very renderer the page uses — not a diagram. `editorial` is drawn but
 * cannot be chosen until the database accepts it (lib/gallery/layouts.ts
 * STORABLE_LAYOUTS; `square` is accepted since migration 20261122233837).
 */
export default function LayoutPicker({
  value,
  photos,
  onPick,
}: {
  value: LayoutStyle
  photos: readonly LayoutPhoto[]
  onPick: (layout: LayoutStyle) => void
}) {
  const sample = photos.slice(0, 9)
  return (
    <div className="layout-pick-grid">
      {LAYOUT_STYLES.map((l) => {
        const storable = STORABLE_LAYOUTS.includes(l.key)
        return (
          <button
            key={l.key}
            type="button"
            className="cover-layout-swatch layout-pick"
            data-active={value === l.key}
            aria-pressed={value === l.key}
            disabled={!storable}
            onClick={() => onPick(l.key)}
          >
            <span className="layout-pick-thumb" aria-hidden="true">
              {sample.length > 0 ? (
                <DevicePreview width={960} clipHeight={560}>
                  <div style={{ background: '#faf9f6', padding: 24 }}>
                    <PhotoLayout photos={sample} layout={l.key} assumedWidth={912} />
                  </div>
                </DevicePreview>
              ) : (
                <span className="admin-meta" style={{ display: 'block', padding: '1.5rem 0.5rem', textAlign: 'center' }}>
                  Add photos to preview
                </span>
              )}
            </span>
            <span>{l.label}</span>
            {!storable && <span className="cover-style-note">Needs a database update</span>}
          </button>
        )
      })}
    </div>
  )
}
