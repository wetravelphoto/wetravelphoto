'use client'

import { useState } from 'react'
import type { CanvasSection } from '@/components/canvas/Canvas'

/**
 * The page, as a column of sections you can drag.
 *
 * Deliberately a list of NAMES rather than a strip of thumbnails. The plan
 * called for thumbnails, and they are the right answer once sections can repeat
 * — three galleries down a page are indistinguishable by name. With six
 * sections of six different types, a thumbnail is a smaller, blurrier version
 * of the thing already filling the middle of the screen, and it costs a render
 * per section to produce. Names now; thumbnails when repeats arrive.
 */
export default function SectionRail({
  sections,
  selected,
  onSelect,
  onReorder,
  onToggle,
  onRemove,
  onAdd,
}: {
  sections: CanvasSection[]
  selected: string | null
  onSelect: (id: string | null) => void
  onReorder: (next: CanvasSection[]) => void
  onToggle: (id: string, visible: boolean) => void
  onRemove: (id: string, label: string) => void
  onAdd: () => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const move = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= sections.length || from === to) return
    const next = [...sections]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    onReorder(next)
  }

  return (
    <aside className="cv-rail" aria-label="Sections">
      <p className="cv-rail-head">Page</p>

      <ol className="cv-sections">
        {sections.map((row, i) => (
          <li
            key={row.id}
            className="cv-item"
            data-on={selected === row.id}
            data-hidden={!row.visible}
            data-dragging={dragId === row.id}
            data-over={overId === row.id && dragId !== row.id}
            draggable
            onDragStart={() => setDragId(row.id)}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setOverId(row.id)
            }}
            onDrop={() => {
              if (dragId && dragId !== row.id) {
                move(
                  sections.findIndex((s) => s.id === dragId),
                  sections.findIndex((s) => s.id === row.id)
                )
              }
              setDragId(null)
              setOverId(null)
            }}
          >
            <span className="cv-grip" aria-hidden="true">
              ⠿
            </span>

            <button type="button" className="cv-item-name" onClick={() => onSelect(row.id)}>
              <span className="cv-item-label">{row.label}</span>
              <span className="cv-item-sub">{summarize(row)}</span>
            </button>

            <span className="cv-item-tools">
              <button
                type="button"
                className="cv-ico"
                onClick={() => onToggle(row.id, !row.visible)}
                title={row.visible ? 'Hide' : 'Show'}
                aria-label={row.visible ? `Hide ${row.label}` : `Show ${row.label}`}
              >
                {row.visible ? '◉' : '○'}
              </button>

              {/* Keyboard equivalents for the drag. A rail you can only reorder
                  with a mouse is a rail some people cannot reorder. */}
              <button
                type="button"
                className="cv-ico"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                aria-label={`Move ${row.label} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="cv-ico"
                onClick={() => move(i, i + 1)}
                disabled={i === sections.length - 1}
                aria-label={`Move ${row.label} down`}
              >
                ↓
              </button>

              {!row.permanent && (
                <button
                  type="button"
                  className="cv-ico cv-ico-bad"
                  onClick={() => onRemove(row.id, row.label)}
                  aria-label={`Remove ${row.label}`}
                >
                  ×
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>

      <button type="button" className="cv-add" onClick={onAdd}>
        + Add a section
      </button>
    </aside>
  )
}

/** A one-line reminder of what this section is currently showing. */
function summarize(row: CanvasSection): string {
  for (const key of ['heading', 'title', 'label']) {
    const value = row.settings[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return row.blurb
}
