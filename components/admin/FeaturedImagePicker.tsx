'use client'

import { useState } from 'react'
import ImagePickerModal from '@/components/admin/ImagePickerModal'
import type { BlockImage } from '@/lib/blocks'

/**
 * The featured image can come from any album or a fresh upload — it does
 * not depend on the post being linked to an album.
 */
export default function FeaturedImagePicker({
  initialPath,
  publicUrl,
}: {
  initialPath: string | null
  publicUrl: string
}) {
  const [path, setPath] = useState<string | null>(initialPath)
  const [open, setOpen] = useState(false)

  function handleSelect(images: BlockImage[]) {
    if (images[0]?.path) setPath(images[0].path)
    setOpen(false)
  }

  return (
    <div className="admin-field">
      Featured image
      <p className="admin-meta" style={{ margin: '0.2rem 0 0.5rem' }}>
        Shown at the top of the story, on the journal index, and in link previews.
      </p>

      {path ? (
        <div>
          <div style={{ position: 'relative', maxWidth: 340 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${publicUrl}/${path}`}
              alt=""
              style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' }}
            />
          </div>
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
            maxWidth: 340,
            border: '1px dashed var(--admin-line)',
            background: 'none',
            cursor: 'pointer',
            padding: '2rem 1rem',
            color: 'var(--admin-mute)',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
          }}
        >
          Choose a featured image
        </button>
      )}

      <input type="hidden" name="featured_path" value={path ?? ''} />

      {open && (
        <ImagePickerModal publicUrl={publicUrl} onClose={() => setOpen(false)} onSelect={handleSelect} />
      )}
    </div>
  )
}
