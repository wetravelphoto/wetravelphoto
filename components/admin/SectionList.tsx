'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  FAMILIES,
  SECTIONS,
  sectionDef,
  type SectionDef,
  type SectionSettings,
} from '@/lib/sections/registry'
import {
  addSection,
  removeSection,
  reorderSections,
  setSectionVisible,
  updateSectionSettings,
} from '@/app/actions/sections'
import SectionFields from '@/components/admin/SectionFields'

export type SectionRow = {
  id: string
  type: string
  visible: boolean
  settings: SectionSettings
}

/**
 * The page as a list of sections: drag to reorder, switch to hide, click to
 * open its settings. This is the piece the visual editor's left rail becomes —
 * same actions, same order, drawn against a live preview instead of a list.
 */
export default function SectionList({
  page,
  sections,
  publicUrl,
  legacy,
}: {
  page: string
  sections: SectionRow[]
  publicUrl: string
  legacy: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [order, setOrder] = useState(sections)
  const [openId, setOpenId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (work: () => Promise<unknown>) => {
    setError(null)
    startTransition(async () => {
      try {
        await work()
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.')
      }
    })
  }

  const move = (id: string, delta: number) => {
    const from = order.findIndex((s) => s.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= order.length) return

    const next = [...order]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)

    setOrder(next)
    run(() => reorderSections(page, next.map((s) => s.id)))
  }

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const from = order.findIndex((s) => s.id === dragId)
    const to = order.findIndex((s) => s.id === targetId)
    if (from < 0 || to < 0) return

    const next = [...order]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)

    setDragId(null)
    setOrder(next)
    run(() => reorderSections(page, next.map((s) => s.id)))
  }

  const used = new Set(order.map((s) => s.type))

  return (
    <div className="sec-list-wrap">
      {legacy && (
        <p className="sec-legacy">
          This page is still described by the old settings. Reordering or editing anything here
          saves it as sections — the page will look exactly the same afterwards.
        </p>
      )}

      {error && <p className="sec-error">{error}</p>}

      <ol className="sec-list" data-busy={pending}>
        {order.map((row, i) => {
          const def = sectionDef(row.type)
          if (!def) return null
          const open = openId === row.id

          return (
            <li
              key={row.id}
              className="sec-row"
              data-open={open}
              data-hidden={!row.visible}
              data-dragging={dragId === row.id}
              draggable
              onDragStart={() => setDragId(row.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(row.id)}
            >
              <div className="sec-head">
                <span className="sec-grip" aria-hidden="true">
                  ⠿
                </span>

                <button
                  type="button"
                  className="sec-name"
                  onClick={() => setOpenId(open ? null : row.id)}
                  aria-expanded={open}
                >
                  <span className="sec-label">{def.label}</span>
                  <span className="sec-blurb">{summarize(def, row.settings)}</span>
                </button>

                <div className="sec-tools">
                  <button
                    type="button"
                    className="sec-icon"
                    onClick={() => move(row.id, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="sec-icon"
                    onClick={() => move(row.id, 1)}
                    disabled={i === order.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="sec-icon"
                    onClick={() => run(() => setSectionVisible(page, row.id, !row.visible))}
                    aria-label={row.visible ? 'Hide this section' : 'Show this section'}
                    title={row.visible ? 'Hide' : 'Show'}
                  >
                    {row.visible ? '◉' : '○'}
                  </button>
                  {!def.permanent && (
                    <button
                      type="button"
                      className="sec-icon sec-icon-danger"
                      onClick={() => {
                        if (confirm(`Remove the ${def.label} section from this page?`)) {
                          run(() => removeSection(page, row.id))
                        }
                      }}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {open && (
                <form
                  className="sec-panel"
                  action={updateSectionSettings.bind(null, page, row.id)}
                  autoComplete="off"
                >
                  <SectionFields def={def} settings={row.settings} publicUrl={publicUrl} />
                  <div className="sec-panel-foot">
                    <button type="submit" className="admin-btn admin-btn-sm">
                      Save {def.label.toLowerCase()}
                    </button>
                  </div>
                </form>
              )}
            </li>
          )
        })}
      </ol>

      <button type="button" className="sec-add" onClick={() => setPicking(true)}>
        + Add a section
      </button>

      {picking && (
        <AddSection
          used={used}
          onClose={() => setPicking(false)}
          onPick={(type) => {
            setPicking(false)
            run(() => addSection(page, type))
          }}
        />
      )}
    </div>
  )
}

/** A one-line reminder of what this section is currently showing. */
function summarize(def: SectionDef, settings: SectionSettings): string {
  for (const key of ['heading', 'title', 'label']) {
    const value = settings[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return def.blurb
}

function AddSection({
  used,
  onPick,
  onClose,
}: {
  used: Set<string>
  onPick: (type: string) => void
  onClose: () => void
}) {
  const all = Object.values(SECTIONS)

  return (
    <div className="sec-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sec-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="sec-modal-head">
          <div>
            <h2>Add a section</h2>
            <p className="admin-meta">Sections drop in at the bottom. Drag it where you want it.</p>
          </div>
          <button type="button" className="sec-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sec-modal-body">
          {FAMILIES.map((family) => {
            const members = all.filter((d) => d.family === family)
            if (members.length === 0) return null

            return (
              <div key={family} className="sec-family">
                <p className="sec-family-name">{family}</p>
                <div className="sec-cards">
                  {members.map((def) => {
                    const taken = def.singleton && used.has(def.type)

                    return (
                      <button
                        key={def.type}
                        type="button"
                        className="sec-card"
                        disabled={taken}
                        onClick={() => onPick(def.type)}
                      >
                        <span className="sec-card-name">{def.label}</span>
                        <span className="sec-card-blurb">{def.blurb}</span>
                        {taken ? (
                          <span className="sec-card-note">Already on this page</span>
                        ) : (
                          def.requires && <span className="sec-card-note">{def.requires}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
