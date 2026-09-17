'use client'

import FocalPicker from '@/components/admin/FocalPicker'

type Focal = { x?: number; y?: number; mx?: number; my?: number }

/**
 * Where the hero's standing photograph stays anchored when it is cropped.
 *
 * Desktop and phone are stored separately because the hero is wide on one and
 * tall on the other, and the interesting part of a landscape is rarely in the
 * middle of the portrait crop of it.
 *
 * Stored as a single `focal` object — { x, y } for desktop and { mx, my } for
 * phone — which is the shape HeroSection reads. The picker speaks in two
 * points, so this translates between them and nothing else does.
 */
export default function HeroFocal({
  value,
  imagePath,
  publicUrl,
  onChange,
  onDevice,
}: {
  value: unknown
  imagePath: string | null
  publicUrl: string
  onChange: (next: Focal) => void
  /** Puts the preview into the width whose crop is being edited. */
  onDevice?: (device: 'desktop' | 'mobile') => void
}) {
  const focal = (value ?? {}) as Focal

  if (!imagePath) {
    return (
      <div className="sec-custom">
        <span className="sec-custom-label">Crop</span>
        <span className="admin-meta">
          Choose a standing photograph first — there is nothing to crop until there is one.
        </span>
      </div>
    )
  }

  return (
    <div className="cv-focal">
      <span className="cv-focal-label">Crop</span>
      <span className="admin-meta">
        Drag to set what stays in frame. Phone and desktop crop differently.
      </span>

      <FocalPicker
        imageUrl={`${publicUrl}/${imagePath}`}
        desktop={{ x: focal.x ?? 0.5, y: focal.y ?? 0.5 }}
        mobile={{ x: focal.mx ?? 0.5, y: focal.my ?? 0.5 }}
        onDevice={onDevice}
        onChange={({ desktop, mobile }) =>
          onChange({ x: desktop.x, y: desktop.y, mx: mobile.x, my: mobile.y })
        }
      />
    </div>
  )
}
