'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import FocalPicker, { type FocalPoint } from '@/components/admin/FocalPicker'

export type PostOption = {
  id: string
  title: string
  category: string | null
  imagePath: string | null
}

type Focal = { x: number; y: number; mx: number; my: number }

const EMPTY_FOCAL: Focal = { x: 0.5, y: 0.5, mx: 0.5, my: 0.5 }

/**
 * Three slots, each its own dropdown with a search field at the top. Clearer
 * than one shared search bar, since it's obvious which slot you're filling.
 */
export default function HeroPicker({
  posts,
  initialIds,
  initialTitles,
  initialSubtitles,
  initialFocal,
  publicUrl,
  onChange,
  onTitlesChange,
  onSubtitlesChange,
}: {
  posts: PostOption[]
  initialIds: string[]
  initialTitles: Record<string, string>
  initialSubtitles: Record<string, string>
  initialFocal: Record<string, Focal>
  publicUrl: string
  onChange?: (ids: string[]) => void
  onTitlesChange?: (titles: Record<string, string>) => void
  onSubtitlesChange?: (subtitles: Record<string, string>) => void
}) {
  const [selected, setSelected] = useState<(string | null)[]>(() => {
    const filled = initialIds.filter((id) => posts.some((p) => p.id === id))
    return [filled[0] ?? null, filled[1] ?? null, filled[2] ?? null]
  })

  const [titles, setTitles] = useState<Record<string, string>>(initialTitles ?? {})
  const [subtitles, setSubtitles] = useState<Record<string, string>>(initialSubtitles ?? {})
  const [focal, setFocal] = useState<Record<string, Focal>>(initialFocal ?? {})
  const [openSlot, setOpenSlot] = useState<number | null>(null)
  const [framingSlot, setFramingSlot] = useState<number | null>(null)

  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts])

  function commit(next: (string | null)[]) {
    setSelected(next)
    onChange?.(next.filter(Boolean) as string[])
  }

  function choose(slot: number, id: string | null) {
    const next = [...selected]
    next[slot] = id
    commit(next)
    setOpenSlot(null)
  }

  function setTitle(id: string, value: string) {
    const next = { ...titles }
    if (value.trim()) next[id] = value
    else delete next[id]
    setTitles(next)
    onTitlesChange?.(next)
  }

  function setSubtitle(id: string, value: string) {
    const next = { ...subtitles }
    if (value.trim()) next[id] = value
    else delete next[id]
    setSubtitles(next)
    onSubtitlesChange?.(next)
  }

  function setFocalFor(id: string, next: { desktop: FocalPoint; mobile: FocalPoint }) {
    setFocal((prev) => ({
      ...prev,
      [id]: { x: next.desktop.x, y: next.desktop.y, mx: next.mobile.x, my: next.mobile.y },
    }))
  }

  return (
    <div>
      <div className="hero-slots">
        {[0, 1, 2].map((slot) => {
          const id = selected[slot]
          const post = id ? byId.get(id) : undefined
          const point = id ? (focal[id] ?? EMPTY_FOCAL) : EMPTY_FOCAL

          return (
            <div key={slot} className="hero-slot-card">
              <div className="hero-slot-head">
                <span className="hero-slot-index">{String(slot + 1).padStart(2, '0')}</span>

                <SlotDropdown
                  posts={posts}
                  selectedId={id}
                  takenIds={selected.filter((s, i) => s && i !== slot) as string[]}
                  open={openSlot === slot}
                  onOpen={() => setOpenSlot(openSlot === slot ? null : slot)}
                  onClose={() => setOpenSlot(null)}
                  onChoose={(chosen) => choose(slot, chosen)}
                  publicUrl={publicUrl}
                />
              </div>

              {post && (
                <div className="hero-slot-fields">
                  <input
                    type="text"
                    value={titles[post.id] ?? ''}
                    onChange={(e) => setTitle(post.id, e.target.value)}
                    placeholder={`Show as: ${post.title}`}
                    className="admin-input"
                    autoComplete="off"
                  />

                  <input
                    type="text"
                    value={subtitles[post.id] ?? ''}
                    onChange={(e) => setSubtitle(post.id, e.target.value)}
                    placeholder="Subtitle (optional)"
                    className="admin-input"
                    autoComplete="off"
                  />

                  {post.imagePath ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setFramingSlot(framingSlot === slot ? null : slot)}
                        className="admin-btn admin-btn-sm admin-btn-ghost"
                        style={{ width: '100%' }}
                      >
                        {framingSlot === slot ? 'Hide framing' : 'Framing'}
                      </button>

                      {framingSlot === slot && (
                        <div className="hero-slot-focal">
                          <FocalPicker
                            imageUrl={`${publicUrl}/${post.imagePath}`}
                            desktop={{ x: point.x, y: point.y }}
                            mobile={{ x: point.mx, y: point.my }}
                            onChange={(next) => setFocalFor(post.id, next)}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="admin-meta" style={{ margin: 0, color: 'var(--admin-danger)' }}>
                      This story has no featured image, so the hero would be blank.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="admin-meta" style={{ margin: '0.6rem 0 0', lineHeight: 1.55 }}>
        Leave all three empty to use your three most recent stories.
      </p>

      <input
        type="hidden"
        name="featured_post_ids"
        value={(selected.filter(Boolean) as string[]).join(',')}
      />
      <input type="hidden" name="hero_titles" value={JSON.stringify(titles)} />
      <input type="hidden" name="hero_subtitles" value={JSON.stringify(subtitles)} />
      <input type="hidden" name="hero_focal" value={JSON.stringify(focal)} />
    </div>
  )
}

/** A dropdown whose first field is a search box. */
function SlotDropdown({
  posts,
  selectedId,
  takenIds,
  open,
  onOpen,
  onClose,
  onChoose,
  publicUrl,
}: {
  posts: PostOption[]
  selectedId: string | null | undefined
  takenIds: string[]
  open: boolean
  onOpen: () => void
  onClose: () => void
  onChoose: (id: string | null) => void
  publicUrl: string
}) {
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = posts.find((p) => p.id === selectedId)

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else setQuery('')
  }, [open])

  // Clicking anywhere else closes it
  useEffect(() => {
    if (!open) return

    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onClose()
    }

    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, onClose])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return posts
      .filter((p) => !takenIds.includes(p.id))
      .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q))
  }, [posts, query, takenIds])

  return (
    <div className="slot-dropdown" ref={wrapRef}>
      <button type="button" className="slot-trigger" onClick={onOpen} data-empty={!selected}>
        {selected ? (
          <>
            <span className="slot-thumb">
              {selected.imagePath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${publicUrl}/${selected.imagePath}`} alt="" />
              )}
            </span>
            <span className="slot-trigger-text">
              <span className="slot-trigger-title">{selected.title}</span>
              {selected.category && <span className="admin-meta">{selected.category}</span>}
            </span>
          </>
        ) : (
          <span className="slot-trigger-text">
            <span className="slot-trigger-title">Empty</span>
            <span className="admin-meta">Choose a story</span>
          </span>
        )}

        <span className="slot-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="slot-menu">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stories…"
            className="admin-input slot-search"
            autoComplete="off"
          />

          <ul>
            {selected && (
              <li>
                <button type="button" onClick={() => onChoose(null)} className="slot-clear">
                  Clear this slot
                </button>
              </li>
            )}

            {matches.map((post) => (
              <li key={post.id}>
                <button type="button" onClick={() => onChoose(post.id)} data-active={post.id === selectedId}>
                  <span className="slot-thumb">
                    {post.imagePath && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${publicUrl}/${post.imagePath}`} alt="" />
                    )}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="slot-trigger-title">{post.title}</span>
                    {post.category && <span className="admin-meta"> · {post.category}</span>}
                  </span>
                </button>
              </li>
            ))}

            {matches.length === 0 && (
              <li>
                <span className="admin-meta" style={{ display: 'block', padding: '0.7rem' }}>
                  {posts.length === 0 ? 'No published stories yet.' : 'Nothing matches that.'}
                </span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
