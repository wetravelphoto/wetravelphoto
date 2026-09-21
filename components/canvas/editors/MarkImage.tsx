'use client'

import { useRef, useState } from 'react'
import { uploadMarkImage } from '@/app/actions/branding'
import { isBuiltInMark, markSrc } from '@/lib/sections/mark'

/* eslint-disable @next/next/no-img-element */

/**
 * The accent mark's picture: upload one, replace it, or take it away.
 *
 * Uploading stores the file and returns its key; `onChange` then writes that
 * key into the section in the draft, the same way every other canvas edit is
 * saved. Nothing reaches the live site until Publish.
 *
 * The preview sits on the page's light surface colour rather than the editor's
 * dark panel, because that is what the mark will be seen against — a dark
 * emblem on a dark panel would look like a broken upload.
 */
export default function MarkImage({
  value,
  publicUrl,
  onChange,
}: {
  value: unknown
  publicUrl: string
  onChange: (path: string | null) => void
}) {
  const saved = typeof value === 'string' && value ? value : null

  // Held locally so the new picture shows the moment the upload returns,
  // rather than after the save and the refresh. Re-synced when the stored
  // value changes underneath it (another tab, a Discard).
  const [path, setPath] = useState<string | null>(saved)
  const [seen, setSeen] = useState<string | null>(saved)
  if (saved !== seen) {
    setSeen(saved)
    setPath(saved)
  }

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const upload = async (chosen: File | undefined) => {
    if (!chosen) return
    setBusy(true)
    setMessage(null)

    const data = new FormData()
    data.append('file', chosen)

    try {
      const result = await uploadMarkImage(data)
      if (result.ok) {
        setPath(result.path)
        onChange(result.path)
      } else {
        setMessage(result.message)
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not upload that file.')
    } finally {
      setBusy(false)
      // Cleared so choosing the same file again still fires a change.
      if (file.current) file.current.value = ''
    }
  }

  const remove = () => {
    setPath(null)
    setMessage(null)
    onChange(null)
  }

  return (
    <div className="cv-mark">
      <span className="cv-focal-label">Mark</span>

      <div className="cv-mark-preview" data-empty={!path}>
        {path ? (
          <img src={markSrc(path, publicUrl)} alt="" />
        ) : (
          <span className="cv-mark-none">No mark yet</span>
        )}
      </div>

      {path && isBuiltInMark(path) && (
        <span className="admin-meta">The mark that came with your site.</span>
      )}

      <div className="cv-mark-actions">
        {/* Named after the setting so that clicking the mark in the page
            scrolls here and focuses this, like every other field. A button's
            name is never sent with the form unless it submits it. */}
        <button
          type="button"
          name="image_path"
          className="cv-btn cv-btn-ghost"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          {busy ? 'Uploading…' : path ? 'Replace…' : 'Upload…'}
        </button>
        {path && (
          <button type="button" className="cv-btn cv-btn-ghost" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept="image/svg+xml,image/png,image/webp,image/jpeg"
          hidden
          onChange={(e) => {
            // Kept from the settings form around it, whose change handler
            // would otherwise queue a pointless save of every other field.
            e.stopPropagation()
            upload(e.target.files?.[0])
          }}
        />
      </div>

      <span className="admin-meta">
        SVG, PNG, WebP or JPEG, up to 2 MB. A transparent background works best.
      </span>
      {message && <span className="cv-insp-error">{message}</span>}
    </div>
  )
}
