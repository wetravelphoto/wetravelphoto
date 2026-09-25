'use client'

import { useEffect, useState, useRef } from 'react'
import type { BlockImage } from '@/lib/blocks'
import { fetchAlbumPhotos, registerJournalImage } from '@/app/actions/blog'
import { imageSrc } from '@/lib/images'

type AlbumOption = { id: string; title: string }
type PhotoOption = { id: string; storage_path: string; caption: string | null }

export default function ImagePickerModal({
  publicUrl,
  multiple = false,
  onClose,
  onSelect,
}: {
  publicUrl: string
  multiple?: boolean
  onClose: () => void
  onSelect: (images: BlockImage[]) => void
}) {
  const [albums, setAlbums] = useState<AlbumOption[]>([])
  const [albumId, setAlbumId] = useState<string>('')
  const [photos, setPhotos] = useState<PhotoOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchAlbumPhotos(null).then((res) => {
      setAlbums(res.albums)
      setAlbumId(res.albums[0]?.id ?? '')
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!albumId) return
    setLoading(true)
    fetchAlbumPhotos(albumId).then((res) => {
      setPhotos(res.photos)
      setLoading(false)
    })
  }, [albumId])

  function toggle(photo: PhotoOption) {
    if (!multiple) {
      onSelect([{ path: photo.storage_path, caption: photo.caption }])
      return
    }
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(photo.storage_path)) next.delete(photo.storage_path)
      else next.add(photo.storage_path)
      return next
    })
  }

  /** Files go straight to storage, so large photographs aren't capped by the
   *  request size limit the way a server upload would be. */
  async function handleUpload(files: FileList | null) {
    if (!files?.length) return

    setUploading(true)
    setError(null)

    const results: BlockImage[] = []

    try {
      for (const file of Array.from(files)) {
        const signedResponse = await fetch('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder: 'journal', contentType: file.type }),
        })

        const signed = await signedResponse.json()
        if (!signedResponse.ok) throw new Error(signed.error ?? 'Could not start the upload')

        const put = await fetch(signed.url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })

        if (!put.ok) throw new Error(`Storage rejected the file (${put.status})`)

        const path = await registerJournalImage(signed.key, signed.base)
        if (path) results.push({ path })
      }

      if (results.length) onSelect(multiple ? results : [results[0]])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="cover-modal" onClick={onClose}>
      <div
        className="admin-panel"
        style={{ maxWidth: 780, width: '100%', maxHeight: '84vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem' }}>
          <h2 className="admin-h2" style={{ margin: 0 }}>
            Choose {multiple ? 'images' : 'an image'}
          </h2>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {multiple && selected.size > 0 && (
              <button
                type="button"
                className="admin-btn admin-btn-sm"
                onClick={() =>
                  onSelect(
                    Array.from(selected).map((path) => ({
                      path,
                      caption: photos.find((p) => p.storage_path === path)?.caption ?? null,
                    }))
                  )
                }
              >
                Add {selected.size}
              </button>
            )}
            <button type="button" onClick={onClose} className="admin-btn admin-btn-sm admin-btn-ghost">
              Close
            </button>
          </div>
        </div>

        <div style={{ border: '1px dashed var(--admin-line)', padding: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>
          <p className="admin-meta" style={{ margin: '0 0 0.5rem' }}>
            {uploading ? 'Uploading…' : 'Upload a new image just for this post'}
          </p>

          {error && (
            <p className="admin-meta" style={{ margin: '0 0 0.5rem', color: 'var(--admin-danger)' }}>
              {error}
            </p>
          )}
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="admin-btn admin-btn-sm">
            Choose file{multiple ? 's' : ''}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple={multiple}
            hidden
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>

        {albums.length > 0 && (
          <label className="admin-field">
            Pick from an album
            <select value={albumId} onChange={(e) => setAlbumId(e.target.value)} className="admin-select">
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
        )}

        {loading ? (
          <p className="admin-meta">Loading…</p>
        ) : photos.length === 0 ? (
          <p className="admin-meta">No photos in this album yet.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.4rem' }}>
            {photos.map((photo) => {
              const isSelected = selected.has(photo.storage_path)
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => toggle(photo)}
                  style={{
                    padding: 0,
                    border: isSelected ? '2px solid var(--admin-accent)' : '0.5px solid var(--admin-line)',
                    background: 'none',
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageSrc(publicUrl, photo.storage_path)}
                    alt=""
                    style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
                  />
                  {isSelected && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 3,
                        right: 3,
                        background: 'var(--admin-accent)',
                        color: '#fff',
                        fontSize: '0.6rem',
                        padding: '1px 4px',
                      }}
                    >
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
