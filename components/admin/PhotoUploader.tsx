'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { uploadPhoto } from '@/app/actions/photos'

type Status = 'pending' | 'uploading' | 'done' | 'error'
type Item = { name: string; status: Status; message?: string }

export default function PhotoUploader({ albumId }: { albumId: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return

    const files = Array.from(fileList)
    setItems(files.map((f) => ({ name: f.name, status: 'pending' as Status })))
    setBusy(true)

    for (let i = 0; i < files.length; i++) {
      setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, status: 'uploading' } : item)))

      try {
        const formData = new FormData()
        formData.append('file', files[i])
        await uploadPhoto(albumId, formData)
        setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, status: 'done' } : item)))
      } catch (err) {
        setItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? { ...item, status: 'error', message: err instanceof Error ? err.message : 'Failed' }
              : item
          )
        )
      }
    }

    setBusy(false)

    // Pull the new photos into the grid straight away
    router.refresh()

    setTimeout(() => setItems([]), 2000)
  }

  const total = items.length
  const doneCount = items.filter((i) => i.status === 'done' || i.status === 'error').length
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100)
  const currentFile = items.find((i) => i.status === 'uploading')?.name
  const errorCount = items.filter((i) => i.status === 'error').length

  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <div
        className="admin-dropzone"
        data-dragging={dragging}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!busy) handleFiles(e.dataTransfer.files)
        }}
        style={{ cursor: busy ? 'default' : 'pointer', position: 'relative', overflow: 'hidden' }}
      >
        {busy || total > 0 ? (
          <div style={{ padding: '0.25rem 0' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: '0.6rem',
                gap: '1rem',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display), sans-serif',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontSize: '0.8rem',
                }}
              >
                {busy ? 'Uploading' : errorCount > 0 ? `Finished — ${errorCount} failed` : 'Complete'}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-display), sans-serif',
                  fontSize: '1.1rem',
                  color: 'var(--admin-accent)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {percent}%
              </span>
            </div>

            {/* Track */}
            <div
              style={{
                height: 3,
                background: 'rgba(26,23,21,0.1)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${percent}%`,
                  background: 'var(--admin-accent)',
                  transition: 'width 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '0.55rem',
                fontSize: '0.72rem',
                color: 'var(--admin-mute)',
                gap: '1rem',
              }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {currentFile ?? ''}
              </span>
              <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {doneCount} / {total}
              </span>
            </div>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>Drop photos here, or click to choose files</p>
            <p className="admin-meta" style={{ margin: '0.35rem 0 0' }}>
              JPEG or PNG · multiple files at once · resized automatically
            </p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {errorCount > 0 && !busy && (
        <div style={{ marginTop: '0.6rem' }}>
          {items
            .filter((i) => i.status === 'error')
            .map((item, i) => (
              <p key={i} style={{ fontSize: '0.72rem', color: 'var(--admin-danger)', margin: '0 0 0.2rem' }}>
                {item.name} — {item.message}
              </p>
            ))}
        </div>
      )}
    </div>
  )
}
