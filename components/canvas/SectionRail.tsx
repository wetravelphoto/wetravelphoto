'use client'

import { Fragment, useState } from 'react'
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
  onDuplicate,
  onPageSettings,
}: {
  sections: CanvasSection[]
  selected: string | null
  onSelect: (id: string | null) => void
  onReorder: (next: CanvasSection[]) => void
  onToggle: (id: string, visible: boolean) => void
  onRemove: (id: string, label: string) => void
  /** Open the picker; the new section goes after `after`, or at the end if null. */
  onAdd: (after: string | null) => void
  onDuplicate: (id: string) => void
  /** Show the page's own settings (search and sharing) in the right panel. */
  onPageSettings: () => void
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
      <div className="cv-rail-top">
        <p className="cv-rail-head">Sections</p>
        {/* The same thing clicking empty space does: select nothing, which
            shows the page's own settings. */}
        <button
          type="button"
          className="cv-rail-page"
          data-on={selected === null}
          onClick={onPageSettings}
          title="Search results and link sharing for this page"
        >
          Page settings
        </button>
      </div>

      {/* The header and footer bracket every page's sections. Not movable and
          not removable: they belong to the site, and are edited here from any
          page. */}
      <button
        type="button"
        className="cv-chrome-row"
        data-on={selected === '__header'}
        onClick={() => onSelect('__header')}
      >
        <span className="cv-item-label">Header</span>
        <span className="cv-item-sub">Logo and menu · every page</span>
      </button>

      <ol className="cv-sections">
        {sections.map((row, i) => (
          <Fragment key={row.id}>
          <li
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

              {!row.singleton && (
                <button
                  type="button"
                  className="cv-ico"
                  onClick={() => onDuplicate(row.id)}
                  title="Duplicate"
                  aria-label={`Duplicate ${row.label}`}
                >
                  ⧉
                </button>
              )}

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

          {/* Insert here: a thin line between rows that shows a + on hover,
              so a section can go exactly where it is wanted rather than at
              the bottom and then be dragged up. */}
          {i < sections.length - 1 && (
            <li className="cv-insert" role="presentation">
              <button
                type="button"
                className="cv-insert-btn"
                onClick={() => onAdd(row.id)}
                aria-label={`Add a section after ${row.label}`}
                title="Add a section here"
              >
                <span aria-hidden="true">+</span>
              </button>
            </li>
          )}
          </Fragment>
        ))}
      </ol>

      <button type="button" className="cv-add" onClick={() => onAdd(null)}>
        + Add a section at the end
      </button>

      <button
        type="button"
        className="cv-chrome-row"
        data-on={selected === '__footer'}
        onClick={() => onSelect('__footer')}
      >
        <span className="cv-item-label">Footer</span>
        <span className="cv-item-sub">Links, newsletter, copyright · every page</span>
      </button>
    </aside>
  )
}

/** A one-line reminder of what this section is currently showing. */
function summarize(row: CanvasSection): string {
  // Where it shows, first — a section missing from the desktop preview is
  // otherwise a mystery.
  const where =
    row.settings.hide_on === 'mobile'
      ? 'Not on phones · '
      : row.settings.hide_on === 'desktop'
        ? 'Phones only · '
        : ''

  for (const key of ['heading', 'title', 'label']) {
    const value = row.settings[key]
    if (typeof value === 'string' && value.trim()) return where + value
  }
  return where + row.blurb
}
