'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { deleteAlbum } from '@/app/actions/galleries'

export default function GalleryCard({
  id,
  title,
  slug,
  privacy,
  photoCount,
  coverUrl,
  updatedAt,
}: {
  id: string
  title: string
  slug: string | null
  privacy: string
  photoCount: number
  coverUrl: string | null
  updatedAt: string | null
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    setBusy(true)
    await deleteAlbum(id)
    setBusy(false)
    router.refresh()
  }

  const isPublic = privacy === 'public'
  const canView = isPublic && !!slug

  return (
    <div className="admin-panel gallery-card">
      <Link href={`/admin/trips/${id}`} className="gallery-card-media">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" loading="lazy" />
        ) : (
          <span className="admin-meta">No cover</span>
        )}
      </Link>

      <div className="gallery-card-body">
        <Link href={`/admin/trips/${id}`} className="gallery-card-title">
          {title}
        </Link>

        <div className="gallery-card-meta">
          <span className="admin-tag" data-tone={isPublic ? 'live' : 'private'}>
            {privacy.replace('_', ' ')}
          </span>
          <span className="admin-meta">
            {photoCount} photo{photoCount === 1 ? '' : 's'}
          </span>
          {updatedAt && (
            <span className="admin-meta">
              {new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>

        <div className="gallery-card-actions">
          <Link href={`/admin/trips/${id}`} className="admin-btn admin-btn-sm admin-btn-ghost">
            Edit
          </Link>

          {canView ? (
            <Link href={`/trips/${slug}`} target="_blank" className="admin-btn admin-btn-sm admin-btn-ghost">
              View ↗
            </Link>
          ) : (
            // Kept in place so every card's buttons line up
            <span
              className="admin-btn admin-btn-sm admin-btn-ghost"
              data-disabled="true"
              title="Only public galleries have a public page"
            >
              View ↗
            </span>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => (confirming ? handleDelete() : setConfirming(true))}
            onBlur={() => setConfirming(false)}
            className="admin-btn admin-btn-sm admin-btn-danger"
            title="Deletes the gallery and every photo in it"
          >
            {busy ? '…' : confirming ? 'Confirm' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
