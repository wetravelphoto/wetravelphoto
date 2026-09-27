'use client'

import FocalPicker from '@/components/admin/FocalPicker'
import { imageSrc } from '@/lib/images'

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
  device,
}: {
  value: unknown
  imagePath: string | null
  publicUrl: string
  onChange: (next: Focal) => void
  /** Which crop to edit — the switcher at the top of the editor decides. */
  device: 'desktop' | 'mobile'
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
      {/* No label of its own: the group above is called Focal point, and a
          heading immediately under an identical heading is noise. */}
      <span className="admin-meta">
        Drag to set what stays in frame. You are cropping the{' '}
        {device === 'mobile' ? 'phone' : 'desktop'} version — switch size at the
        top of the editor to crop the other.
      </span>

      <FocalPicker
        imageUrl={imageSrc(publicUrl, imagePath)}
        desktop={{ x: focal.x ?? 0.5, y: focal.y ?? 0.5 }}
        mobile={{ x: focal.mx ?? 0.5, y: focal.my ?? 0.5 }}
        device={device}
        onChange={({ desktop, mobile }) =>
          onChange({ x: desktop.x, y: desktop.y, mx: mobile.x, my: mobile.y })
        }
      />
    </div>
  )
}
