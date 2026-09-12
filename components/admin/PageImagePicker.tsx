'use client'

import { useState } from 'react'
import ImagePickerModal from '@/components/admin/ImagePickerModal'
import type { BlockImage } from '@/lib/blocks'

/** Choose-or-clear photo field with a hidden input, for page editors. */
export default function PageImagePicker({
  name,
  label,
  initialPath,
  publicUrl,
  note,
}: {
  name: string
  label: string
  initialPath: string | null
  publicUrl: string
  note?: string
}) {
  const [path, setPath] = useState<string | null>(initialPath)
  const [open, setOpen] = useState(false)

  return (
    <div className="admin-field">
      {label}

      {path ? (
        <div style={{ marginTop: '0.4rem' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${publicUrl}/${path}`} alt="" style={{ width: '100%', maxWidth: 260, display: 'block' }} />
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={() => setOpen(true)} className="admin-btn admin-btn-sm admin-btn-ghost">
              Change
            </button>
            <button type="button" onClick={() => setPath(null)} className="admin-btn admin-btn-sm admin-btn-danger">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width: '100%',
            maxWidth: 260,
            marginTop: '0.4rem',
            border: '1px dashed var(--admin-line)',
            background: 'none',
            cursor: 'pointer',
            padding: '1.75rem 1rem',
            color: 'var(--admin-mute)',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
          }}
        >
          Choose a photo
        </button>
      )}

      <input type="hidden" name={name} value={path ?? ''} />

      {note && (
        <p className="admin-meta" style={{ margin: '0.4rem 0 0', lineHeight: 1.55 }}>
          {note}
        </p>
      )}

      {open && (
        <ImagePickerModal
          publicUrl={publicUrl}
          onClose={() => setOpen(false)}
          onSelect={(images: BlockImage[]) => {
            if (images[0]?.path) setPath(images[0].path)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
