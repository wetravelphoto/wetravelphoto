'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { reorderPhotos, deletePhoto, updateCaption, toggleForSale } from '@/app/actions/photos'

type Photo = {
  id: string
  storage_path: string
  caption: string | null
  alt_text: string | null
  is_for_sale: boolean
}

export default function PhotoGrid({
  photos: serverPhotos,
  albumId,
  publicUrl,
}: {
  photos: Photo[]
  albumId: string
  publicUrl: string
}) {
  const [photos, setPhotos] = useState(serverPhotos)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const captionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const router = useRouter()

  // Local state would otherwise ignore new photos arriving from the server
  // after an upload, leaving the grid stale until a full page reload.
  const serverKey = serverPhotos.map((p) => p.id).join(',')
  useEffect(() => {
    setPhotos(serverPhotos)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey])

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null)
      setOverId(null)
      return
    }

    const from = photos.findIndex((p) => p.id === draggingId)
    const to = photos.findIndex((p) => p.id === targetId)
    if (from === -1 || to === -1) return

    const next = [...photos]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)

    setPhotos(next)
    setDraggingId(null)
    setOverId(null)
    setSaving(true)

    reorderPhotos(albumId, next.map((p) => p.id))
      .catch(() => setPhotos(serverPhotos))
      .finally(() => setSaving(false))
  }

  function handleCaptionChange(photoId: string, value: string) {
    const timers = captionTimers.current
    const existing = timers.get(photoId)
    if (existing) clearTimeout(existing)

    timers.set(
      photoId,
      setTimeout(() => {
        const fd = new FormData()
        fd.append('caption', value)
        updateCaption(albumId, photoId, fd)
        timers.delete(photoId)
      }, 800)
    )
  }

  async function handleDelete(photo: Photo) {
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
    setConfirmId(null)
    await deletePhoto(albumId, photo.id, photo.storage_path)
    router.refresh()
  }

  async function handleSale(photo: Photo) {
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, is_for_sale: !p.is_for_sale } : p)))
    await toggleForSale(albumId, photo.id, photo.is_for_sale)
  }

  if (photos.length === 0) {
    return <div className="admin-empty">Upload your first photos using the box above.</div>
  }

  return (
    <>
      <p className="admin-meta" style={{ margin: '0 0 0.75rem' }}>
        Drag any photo to reorder. {saving && <span style={{ color: 'var(--admin-accent)' }}>Saving…</span>}
      </p>

      <div className="admin-thumb-grid">
        {photos.map((photo) => (
          <div
            key={photo.id}
            draggable
            onDragStart={() => setDraggingId(photo.id)}
            onDragEnd={() => {
              setDraggingId(null)
              setOverId(null)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setOverId(photo.id)
            }}
            onDrop={() => handleDrop(photo.id)}
            className="admin-panel"
            style={{
              padding: '0.6rem',
              cursor: 'grab',
              opacity: draggingId === photo.id ? 0.4 : 1,
              outline: overId === photo.id && draggingId !== photo.id ? '2px solid var(--admin-accent)' : 'none',
              outlineOffset: '-1px',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${publicUrl}/${photo.storage_path}`}
              alt={photo.alt_text ?? ''}
              draggable={false}
              style={{
                width: '100%',
                aspectRatio: '1',
                objectFit: 'cover',
                display: 'block',
                marginBottom: '0.5rem',
                pointerEvents: 'none',
              }}
            />

            <input
              type="text"
              defaultValue={photo.caption ?? ''}
              placeholder="Caption…"
              onChange={(e) => handleCaptionChange(photo.id, e.target.value)}
              onDragStart={(e) => e.preventDefault()}
              className="admin-input"
              autoComplete="off"
              style={{ marginTop: 0, marginBottom: '0.45rem', fontSize: '0.78rem', padding: '0.35rem 0.45rem' }}
            />

            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => handleSale(photo)}
                className="admin-btn admin-btn-sm admin-btn-ghost"
                data-active={photo.is_for_sale}
                title="Available to buy"
              >
                {photo.is_for_sale ? '$ On' : '$'}
              </button>

              <button
                type="button"
                onClick={() => (confirmId === photo.id ? handleDelete(photo) : setConfirmId(photo.id))}
                onBlur={() => setConfirmId(null)}
                className="admin-btn admin-btn-sm admin-btn-danger"
                style={{ marginLeft: 'auto' }}
              >
                {confirmId === photo.id ? 'Confirm' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
