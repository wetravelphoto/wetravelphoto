'use client'

import { useState } from 'react'
import ImagePickerModal from '@/components/admin/ImagePickerModal'
import type { BlockImage } from '@/lib/blocks'

type PostOption = { id: string; title: string; category: string | null }

/** Hero story picker plus the intro block's photo and side. */
export default function HomepageFields({
  posts,
  featuredIds,
  introImagePath,
  introSide,
  publicUrl,
}: {
  posts: PostOption[]
  featuredIds: string[]
  introImagePath: string | null
  introSide: string
  publicUrl: string
}) {
  const [selected, setSelected] = useState<string[]>(featuredIds.filter(Boolean))
  const [imagePath, setImagePath] = useState<string | null>(introImagePath)
  const [side, setSide] = useState(introSide || 'left')
  const [pickerOpen, setPickerOpen] = useState(false)

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id)
      if (prev.length >= 3) return prev
      return [...prev, id]
    })
  }

  return (
    <>
      <div className="admin-field">
        Featured stories
        <p className="admin-meta" style={{ margin: '0.2rem 0 0.6rem', lineHeight: 1.55 }}>
          Up to three. Their featured images fill the hero, and the titles along the bottom switch between
          them on hover. Leave empty to use the three most recent.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {posts.length === 0 && (
            <span className="admin-meta" style={{ fontStyle: 'italic' }}>
              No published stories yet.
            </span>
          )}
          {posts.map((post) => {
            const index = selected.indexOf(post.id)
            const isOn = index !== -1
            const atLimit = !isOn && selected.length >= 3
            return (
              <label
                key={post.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  fontSize: '0.85rem',
                  padding: '0.25rem 0',
                  opacity: atLimit ? 0.45 : 1,
                }}
              >
                <input type="checkbox" checked={isOn} onChange={() => toggle(post.id)} disabled={atLimit} />
                {isOn && (
                  <span
                    style={{
                      fontFamily: 'var(--font-display), sans-serif',
                      fontSize: '0.65rem',
                      color: 'var(--admin-accent)',
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                )}
                <span>{post.title}</span>
                {post.category && <span className="admin-meta">· {post.category}</span>}
              </label>
            )
          })}
        </div>

        <input type="hidden" name="featured_post_ids" value={selected.join(',')} />
      </div>

      <div className="admin-field">
        Intro photo
        {imagePath ? (
          <div style={{ marginTop: '0.4rem' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${publicUrl}/${imagePath}`} alt="" style={{ width: '100%', maxWidth: 240, display: 'block' }} />
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={() => setPickerOpen(true)} className="admin-btn admin-btn-sm admin-btn-ghost">
                Change
              </button>
              <button type="button" onClick={() => setImagePath(null)} className="admin-btn admin-btn-sm admin-btn-danger">
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            style={{
              width: '100%',
              maxWidth: 240,
              marginTop: '0.4rem',
              border: '1px dashed var(--admin-line)',
              background: 'none',
              cursor: 'pointer',
              padding: '1.6rem 1rem',
              color: 'var(--admin-mute)',
              fontFamily: 'inherit',
              fontSize: '0.85rem',
            }}
          >
            Choose a photo
          </button>
        )}
        <input type="hidden" name="intro_image_path" value={imagePath ?? ''} />
      </div>

      <label className="admin-field">
        Intro photo position
        <select name="intro_image_side" value={side} onChange={(e) => setSide(e.target.value)} className="admin-select">
          <option value="left">Photo left, text right</option>
          <option value="right">Photo right, text left</option>
        </select>
      </label>

      {pickerOpen && (
        <ImagePickerModal
          publicUrl={publicUrl}
          onClose={() => setPickerOpen(false)}
          onSelect={(images: BlockImage[]) => {
            if (images[0]?.path) setImagePath(images[0].path)
            setPickerOpen(false)
          }}
        />
      )}
    </>
  )
}
