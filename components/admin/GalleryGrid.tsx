'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import GalleryCard from '@/components/admin/GalleryCard'
import { reorderAlbums } from '@/app/actions/galleries'

export type GalleryRow = {
  id: string
  title: string
  slug: string | null
  privacy: string
  photoCount: number
  coverUrl: string | null
  updatedAt: string | null
}

/**
 * Drag a card onto another to drop it into that position. Order is saved
 * straight away, so the public index matches without a second step.
 */
export default function GalleryGrid({
  rows,
  manualOrder,
}: {
  rows: GalleryRow[]
  manualOrder: boolean
}) {
  const [items, setItems] = useState(rows)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function drop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      setOverId(null)
      return
    }

    const from = items.findIndex((i) => i.id === dragId)
    const to = items.findIndex((i) => i.id === targetId)
    if (from === -1 || to === -1) return

    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)

    setItems(next)
    setDragId(null)
    setOverId(null)

    setSaving(true)
    await reorderAlbums(next.map((i) => i.id))
    setSaving(false)
    router.refresh()
  }

  return (
    <>
      {manualOrder && (
        <p className="admin-meta" style={{ margin: '0 0 0.75rem' }}>
          {saving ? 'Saving order…' : 'Drag a gallery onto another to reorder them.'}
        </p>
      )}

      <div className="gallery-grid">
        {items.map((row) => (
          <div
            key={row.id}
            draggable={manualOrder}
            onDragStart={() => setDragId(row.id)}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            onDragOver={(e) => {
              if (!manualOrder) return
              e.preventDefault()
              setOverId(row.id)
            }}
            onDrop={(e) => {
              e.preventDefault()
              drop(row.id)
            }}
            data-dragging={dragId === row.id}
            data-over={overId === row.id && dragId !== row.id}
            className="gallery-drag"
          >
            <GalleryCard
              id={row.id}
              title={row.title}
              slug={row.slug}
              privacy={row.privacy}
              photoCount={row.photoCount}
              coverUrl={row.coverUrl}
              updatedAt={row.updatedAt}
            />
          </div>
        ))}
      </div>
    </>
  )
}
