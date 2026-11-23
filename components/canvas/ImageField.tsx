'use client'

import { useState } from 'react'
import PhotoPicker from '@/components/canvas/PhotoPicker'
import { imageSrc } from '@/lib/images'
import { BASE_DEVICE, DEVICE_LABEL, deviceKey, type Device } from '@/lib/sections/devices'
import type { Field, SectionSettings } from '@/lib/sections/registry'
import {
  bundleValues,
  confirmedChoice,
  isPhotoField,
  ownBundle,
  photoRole,
  type PhotoChoice,
} from '@/lib/sections/image-bundle'
import type { PickerResult } from '@/lib/photos/picker-state'
import { choose, initialView, observe } from '@/components/canvas/image-field-state'

/* eslint-disable @next/next/no-img-element */

/**
 * A section's photograph, in the editor's panel.
 *
 * A hidden input still carries the path, so the Inspector's form save reads
 * it with everything else. Choosing or removing goes further: the path, the
 * photograph's identity and this placement's description are written as ONE
 * save (lib/sections/image-bundle.ts), because an identity left beside a
 * different path is a photograph the page then refuses to show.
 *
 * On a narrower size the field is either following the desktop — showing its
 * photograph and description, storing nothing — or holding a choice of its
 * own. It goes back to following only when the picker says the photographer
 * kept exactly what it follows (`keepsInherited`) or through "Follow desktop";
 * an explicit phone choice stays explicit, even when it is the desktop's own
 * photograph with no words of its own.
 *
 * The choice shows at once, while its save is still travelling; what the
 * field shows meanwhile is components/canvas/image-field-state.ts.
 */
export default function ImageField({
  field,
  device,
  settings,
  publicUrl,
  note,
  onSave,
}: {
  field: Field
  device: Device
  /** The section's stored settings — both sizes, not the panel's view of one. */
  settings: SectionSettings
  publicUrl: string
  note?: string
  /** Every key of the bundle, in one object. Also fired with the effective path for the panel. */
  onSave: (values: Record<string, unknown>, effectivePath: string | null) => void
}) {
  const narrower = device !== BASE_DEVICE && !!field.device
  const base = narrower ? ownBundle(field, BASE_DEVICE, settings) : null
  const stored = ownBundle(field, narrower ? device : BASE_DEVICE, settings)

  // Adjusting state during render when the stored bundle moves underneath.
  const [view, setView] = useState(() => initialView(stored))
  const observed = observe(view, stored)
  if (observed !== view) setView(observed)
  const own = observed.own

  const [open, setOpen] = useState(false)
  const following = narrower && own === null
  const shown = own ?? (narrower ? base : null)
  const photo = isPhotoField(field)

  const write = (next: PhotoChoice | null) => {
    // A video slot the picker happens to edit (the hero's film) keeps its
    // one key, exactly as before: a video has no photograph identity.
    const kept = next && !photo ? { path: next.path, assetId: null, alt: null } : next
    const after = choose(observed, kept)
    if (!after) return // unchanged: nothing to save
    setView(after)
    const at = narrower ? device : BASE_DEVICE
    const values = photo ? bundleValues(field, at, kept) : { [deviceKey(field.key, at)]: kept?.path ?? null }
    onSave(values, (kept ?? (narrower ? base : null))?.path ?? null)
  }

  const confirm = (result: PickerResult) => {
    setOpen(false)
    const c = result.choices[0]
    if (!c && !result.keepsInherited) return
    write(confirmedChoice(narrower, result.keepsInherited, c ? { path: c.path, assetId: c.assetId, alt: c.alt } : null))
  }

  return (
    <div className="admin-field cv-img">
      {field.label}

      {shown ? (
        <div className="cv-img-has">
          <img src={imageSrc(publicUrl, shown.path)} alt="" />
          <div className="cv-img-tools">
            <button type="button" className="cv-btn cv-btn-ghost" onClick={() => setOpen(true)}>
              Change
            </button>
            {/* On a narrower size, removing its own choice is following again. */}
            {!following && (
              <button type="button" className="cv-btn cv-btn-ghost" onClick={() => write(null)}>
                {narrower ? `Follow ${DEVICE_LABEL[BASE_DEVICE].toLowerCase()}` : 'Remove'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <button type="button" className="cv-img-empty" onClick={() => setOpen(true)}>
          Choose or upload a photograph
        </button>
      )}

      <input type="hidden" name={field.key} value={shown?.path ?? ''} />

      {note && <span className="admin-meta">{note}</span>}

      {open && (
        <PhotoPicker
          publicUrl={publicUrl}
          title={field.label}
          slot={{
            label: narrower ? `${field.label} · ${DEVICE_LABEL[device]}` : field.label,
            // Declared by the registry; a video slot carries no description of a photograph.
            role: photo ? photoRole(field) : 'decorative',
            // What a following phone actually shows: the desktop's photograph
            // AND its placement description — offered for display only, never
            // written into the phone's own bundle.
            inherited:
              narrower && base
                ? { ref: { assetId: base.assetId, path: base.path, alt: base.alt }, label: DEVICE_LABEL[BASE_DEVICE] }
                : null,
          }}
          current={own ? [{ assetId: own.assetId, path: own.path, alt: own.alt }] : []}
          onClose={() => setOpen(false)}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}
