'use client'

import { useEffect, useRef, useState } from 'react'
import FocalPicker from '@/components/admin/FocalPicker'

export type StoryOption = {
  id: string
  title: string
  imagePath: string | null
}

type Focal = { x: number; y: number; mx: number; my: number }

/**
 * Which stories lead the site, what they are called there, and where each
 * photograph is cropped.
 *
 * Four settings move together here — featured_post_ids, titles, subtitles and
 * story_focal — which is why they are edited in one place and saved in one
 * write. The titles and subtitles are OVERRIDES for the hero only: the story
 * keeps its own name everywhere else, and clearing the box gives it back.
 *
 * AN EMPTY LIST IS NOT "NO STORIES". HeroSection falls back to the three most
 * recent published posts, so a site that has never touched this still has a
 * hero. The panel says so rather than showing an empty box that looks broken.
 */
const DEBOUNCE_MS = 450

export default function HeroStories({
  ids,
  titles,
  subtitles,
  focals,
  options,
  publicUrl,
  onChange,
}: {
  ids: string[]
  titles: Record<string, string>
  subtitles: Record<string, string>
  focals: Record<string, Focal>
  /** Published stories that have a photograph to show. */
  options: StoryOption[]
  publicUrl: string
  onChange: (values: {
    featured_post_ids?: string[]
    titles?: Record<string, string>
    subtitles?: Record<string, string>
    story_focal?: Record<string, Focal>
  }) => void
}) {
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  /**
   * The order, held locally so a reorder moves the row under the cursor now
   * rather than after the round trip. Reconciled by VALUE whenever the server
   * sends a different list — which is also how a Discard finds its way back in.
   */
  const [localIds, setLocalIds] = useState(ids)
  const [lastIds, setLastIds] = useState(ids.join(','))
  if (ids.join(',') !== lastIds) {
    setLastIds(ids.join(','))
    setLocalIds(ids)
  }

  // Text is held locally and written behind a debounce, the same as the rest of
  // the inspector — otherwise every keystroke is a round trip.
  const [text, setText] = useState({ titles, subtitles })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const signature = JSON.stringify({ titles, subtitles })
  const [lastSignature, setLastSignature] = useState(signature)
  if (signature !== lastSignature) {
    setLastSignature(signature)
    setText({ titles, subtitles })
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const queueText = (next: { titles: Record<string, string>; subtitles: Record<string, string> }) => {
    setText(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange(next), DEBOUNCE_MS)
  }

  const chosen = localIds
    .map((id) => options.find((o) => o.id === id))
    .filter(Boolean) as StoryOption[]
  const rest = options.filter((o) => !localIds.includes(o.id))

  const setOrder = (next: string[]) => {
    setLocalIds(next)
    onChange({ featured_post_ids: next })
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= localIds.length) return
    const next = [...localIds]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    setOrder(next)
  }

  return (
    <div className="cv-stories">
      <span className="cv-focal-label">Featured stories</span>

      {localIds.length === 0 ? (
        <p className="admin-meta">
          Nothing chosen, so the hero shows your three most recent stories and follows along as you
          publish. Choose some to fix which ones appear.
        </p>
      ) : (
        <p className="admin-meta">
          {localIds.length === 3 ? 'Three stories' : `${localIds.length} of 3`} — the hero shows them in this
          order.
        </p>
      )}

      <ol className="cv-story-list">
        {chosen.map((story, i) => {
          const focal = focals[story.id] ?? { x: 0.5, y: 0.5, mx: 0.5, my: 0.5 }
          const isOpen = open === story.id

          return (
            <li key={story.id} className="cv-story" data-open={isOpen}>
              <div className="cv-story-head">
                {story.imagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="cv-story-thumb" src={`${publicUrl}/${story.imagePath}`} alt="" />
                ) : (
                  <span className="cv-story-thumb cv-story-thumb-empty" aria-hidden="true" />
                )}

                <button
                  type="button"
                  className="cv-item-name"
                  onClick={() => setOpen(isOpen ? null : story.id)}
                  aria-expanded={isOpen}
                >
                  <span className="cv-item-label">{text.titles[story.id] || story.title}</span>
                  <span className="cv-item-sub">
                    {text.titles[story.id] ? `Story: ${story.title}` : 'Using the story’s own title'}
                  </span>
                </button>

                <span className="cv-item-tools">
                  <button
                    type="button"
                    className="cv-ico"
                    onClick={() => move(i, i - 1)}
                    disabled={i === 0}
                    aria-label="Move earlier"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="cv-ico"
                    onClick={() => move(i, i + 1)}
                    disabled={i === localIds.length - 1}
                    aria-label="Move later"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="cv-ico cv-ico-bad"
                    onClick={() => setOrder(localIds.filter((x) => x !== story.id))}
                    aria-label="Remove from the hero"
                  >
                    ×
                  </button>
                </span>
              </div>

              {isOpen && (
                <div className="cv-story-body">
                  <label className="admin-field">
                    Title in the hero
                    <input
                      type="text"
                      value={text.titles[story.id] ?? ''}
                      placeholder={story.title}
                      onChange={(e) =>
                        queueText({
                          titles: { ...text.titles, [story.id]: e.target.value },
                          subtitles: text.subtitles,
                        })
                      }
                    />
                    <span className="admin-meta">
                      Empty uses the story’s own title. Only the hero is affected.
                    </span>
                  </label>

                  <label className="admin-field">
                    Sub-heading
                    <input
                      type="text"
                      value={text.subtitles[story.id] ?? ''}
                      onChange={(e) =>
                        queueText({
                          titles: text.titles,
                          subtitles: { ...text.subtitles, [story.id]: e.target.value },
                        })
                      }
                    />
                  </label>

                  {story.imagePath && (
                    <div className="cv-focal">
                      <span className="cv-focal-label">Crop</span>
                      <FocalPicker
                        imageUrl={`${publicUrl}/${story.imagePath}`}
                        desktop={{ x: focal.x, y: focal.y }}
                        mobile={{ x: focal.mx, y: focal.my }}
                        onChange={({ desktop, mobile }) =>
                          onChange({
                            story_focal: {
                              ...focals,
                              [story.id]: {
                                x: desktop.x,
                                y: desktop.y,
                                mx: mobile.x,
                                my: mobile.y,
                              },
                            },
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {localIds.length < 3 && rest.length > 0 && (
        <button type="button" className="cv-add" onClick={() => setAdding(!adding)}>
          {adding ? 'Never mind' : '+ Feature a story'}
        </button>
      )}

      {adding && (
        <div className="cv-story-picker">
          {rest.map((story) => (
            <button
              key={story.id}
              type="button"
              className="cv-story-option"
              onClick={() => {
                setAdding(false)
                setOrder([...localIds, story.id])
              }}
            >
              {story.imagePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="cv-story-thumb" src={`${publicUrl}/${story.imagePath}`} alt="" />
              ) : (
                <span className="cv-story-thumb cv-story-thumb-empty" aria-hidden="true" />
              )}
              <span className="cv-item-label">{story.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
