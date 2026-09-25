'use client'

import { useState } from 'react'
import PhotoPicker from '@/components/canvas/PhotoPicker'
import { imageSrc } from '@/lib/images'

/* eslint-disable @next/next/no-img-element */

/**
 * A section's photograph, in the editor's panel.
 *
 * The same shape as every other field: a hidden input carries the value, so
 * the Inspector's form save picks it up with everything else and there is no
 * separate "save the photo" path. Choosing or clearing fires `onChange` too,
 * because a photograph is the one setting you want on the page immediately
 * rather than after the next keystroke.
 */
export default function ImageField({
  name,
  label,
  value,
  publicUrl,
  note,
  onChange,
}: {
  name: string
  label: string
  value: string | null
  publicUrl: string
  note?: string
  onChange: (path: string | null) => void
}) {
  // Held locally so the new picture shows the moment it is chosen. Re-synced
  // when the stored value changes underneath (an Undo, a Discard).
  const [path, setPath] = useState<string | null>(value)
  const [seen, setSeen] = useState<string | null>(value)
  if (value !== seen) {
    setSeen(value)
    setPath(value)
  }

  const [open, setOpen] = useState(false)

  const set = (next: string | null) => {
    setPath(next)
    setSeen(next)
    onChange(next)
  }

  return (
    <div className="admin-field cv-img">
      {label}

      {path ? (
        <div className="cv-img-has">
          <img src={imageSrc(publicUrl, path)} alt="" />
          <div className="cv-img-tools">
            <button type="button" className="cv-btn cv-btn-ghost" onClick={() => setOpen(true)}>
              Change
            </button>
            <button type="button" className="cv-btn cv-btn-ghost" onClick={() => set(null)}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="cv-img-empty" onClick={() => setOpen(true)}>
          Choose or upload a photograph
        </button>
      )}

      <input type="hidden" name={name} value={path ?? ''} />

      {note && <span className="admin-meta">{note}</span>}

      {open && (
        <PhotoPicker
          publicUrl={publicUrl}
          title={label}
          onClose={() => setOpen(false)}
          onPick={(next) => {
            set(next)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
