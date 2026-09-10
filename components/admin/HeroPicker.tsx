'use client'

import { useState, useMemo, useRef } from 'react'

export type PostOption = {
  id: string
  title: string
  category: string | null
  imagePath: string | null
}

/**
 * Search-and-select for the hero stories, with thumbnails, drag-to-reorder,
 * and a per-slot title override that only affects the hero.
 */
export default function HeroPicker({
  posts,
  initialIds,
  initialTitles,
  publicUrl,
  onChange,
  onTitlesChange,
}: {
  posts: PostOption[]
  initialIds: string[]
  initialTitles: Record<string, string>
  publicUrl: string
  onChange?: (ids: string[]) => void
  onTitlesChange?: (titles: Record<string, string>) => void
}) {
  const [selected, setSelected] = useState<string[]>(initialIds.filter((id) => posts.some((p) => p.id === id)))
  const [titles, setTitles] = useState<Record<string, string>>(initialTitles ?? {})
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function update(ids: string[]) {
    setSelected(ids)
    onChange?.(ids)
  }

  function setTitle(id: string, value: string) {
    const next = { ...titles }
    if (value.trim()) next[id] = value
    else delete next[id]
    setTitles(next)
    onTitlesChange?.(next)
  }

  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return posts
      .filter((p) => !selected.includes(p.id))
      .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [posts, query, selected])

  function add(id: string) {
    if (selected.length >= 3 || selected.includes(id)) return
    update([...selected, id])
    setQuery('')
    setOpen(false)
  }

  function remove(id: string) {
    update(selected.filter((s) => s !== id))
    setTitle(id, '')
  }

  function drop(target: number) {
    if (dragIndex === null || dragIndex === target) {
      setDragIndex(null)
      setOverIndex(null)
      return
    }
    const next = [...selected]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(target, 0, moved)
    update(next)
    setDragIndex(null)
    setOverIndex(null)
  }

  return (
    <div>
      <div className="hero-slots">
        {[0, 1, 2].map((slot) => {
          const id = selected[slot]
          const post = id ? byId.get(id) : undefined

          if (!post) {
            return (
              <div key={slot} className="hero-slot" data-empty="true">
                <span className="hero-slot-index">{String(slot + 1).padStart(2, '0')}</span>
                <span className="admin-meta">Empty</span>
              </div>
            )
          }

          return (
            <div
              key={post.id}
              className="hero-slot-wrap"
              data-dragging={dragIndex === slot}
              data-over={overIndex === slot && dragIndex !== slot}
              onDragOver={(e) => {
                e.preventDefault()
                setOverIndex(slot)
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop(slot)
              }}
            >
              <div
                className="hero-slot"
                draggable
                onDragStart={() => setDragIndex(slot)}
                onDragEnd={() => {
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                title="Drag to reorder"
              >
                <span className="hero-slot-index">{String(slot + 1).padStart(2, '0')}</span>

                <div className="hero-slot-thumb">
                  {post.imagePath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${publicUrl}/${post.imagePath}`} alt="" draggable={false} />
                  ) : (
                    <span className="admin-meta" style={{ fontSize: '0.6rem' }}>
                      No image
                    </span>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="hero-slot-title">{post.title}</p>
                  {post.category && <p className="admin-meta">{post.category}</p>}
                  {!post.imagePath && (
                    <p className="admin-meta" style={{ color: 'var(--admin-danger)' }}>
                      Needs a featured image
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => remove(post.id)}
                  className="admin-btn admin-btn-sm admin-btn-ghost"
                  aria-label={`Remove ${post.title}`}
                >
                  ×
                </button>
              </div>

              {/* Display name for the hero only — the story keeps its own title */}
              <input
                type="text"
                value={titles[post.id] ?? ''}
                onChange={(e) => setTitle(post.id, e.target.value)}
                placeholder={`Show as: ${post.title}`}
                className="admin-input hero-slot-rename"
                autoComplete="off"
              />
            </div>
          )
        })}
      </div>

      {selected.length < 3 && (
        <div className="hero-search">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setOpen(false), 150)
            }}
            placeholder="Search stories by title or category…"
            className="admin-input"
            style={{ marginTop: 0 }}
            autoComplete="off"
          />

          {open && matches.length > 0 && (
            <ul className="hero-results">
              {matches.map((post) => (
                <li key={post.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (blurTimer.current) clearTimeout(blurTimer.current)
                      add(post.id)
                    }}
                  >
                    <span className="hero-result-thumb">
                      {post.imagePath && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${publicUrl}/${post.imagePath}`} alt="" />
                      )}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="hero-result-title">{post.title}</span>
                      {post.category && <span className="admin-meta"> · {post.category}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {open && query && matches.length === 0 && (
            <ul className="hero-results">
              <li>
                <span style={{ padding: '0.6rem 0.7rem', display: 'block' }} className="admin-meta">
                  No published stories match that.
                </span>
              </li>
            </ul>
          )}
        </div>
      )}

      <p className="admin-meta" style={{ margin: '0.6rem 0 0', lineHeight: 1.55 }}>
        Leave all three empty to fall back to your three most recent stories. A display name changes the hero
        only — the story keeps its real title everywhere else.
      </p>

      <input type="hidden" name="featured_post_ids" value={selected.join(',')} />
      <input type="hidden" name="hero_titles" value={JSON.stringify(titles)} />
    </div>
  )
}
