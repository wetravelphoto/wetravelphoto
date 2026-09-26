'use client'

import { useEffect, useRef, useState } from 'react'
import { ROWS, COLUMNS, describeSpot, spot as cleanSpot, type Spot } from '@/lib/sections/spots'

/**
 * WHERE THIS SITS ON THE PICTURE
 * ══════════════════════════════
 *
 * A button under the text box it belongs to, reading the current place, which
 * opens a grid.
 *
 * The first version was three bare grids stacked in a "Placement" group, and
 * it had two faults that only showed up in use. Nothing said which grid was
 * which — a `custom` field renders only what its editor returns, with no
 * label and no note (components/admin/SectionFields.tsx), so HeroFocal and
 * MarkImage draw their own headings and this one drew none. And a control
 * three groups away from the words it moves makes you hold the connection in
 * your head.
 *
 * Sitting under its own text box fixes both at once: it needs no label,
 * because what it belongs to is directly above it.
 *
 * The button says the place in words. A dot in a grid is quick to set and
 * useless to read at a glance, and this is read far more often than it is
 * changed.
 */
export default function SpotPicker({
  value,
  onChange,
  label,
}: {
  value: unknown
  /** Fires on the click, not after the save — the preview moves immediately. */
  onChange: (next: Spot) => void
  /** Only for the screen reader: the field above already says it on screen. */
  label: string
}) {
  const current = cleanSpot(value)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Closing on an outside click or Escape, which any popover has to do and
  // which is the whole reason this is a client component.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="spot-field" ref={box}>
      <button
        type="button"
        className="spot-open"
        aria-expanded={open}
        aria-label={`${label} position: ${describeSpot(current)}. Choose a place, or drag it on the picture.`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="spot-open-icon" aria-hidden>
          <span className="spot-open-dot" data-row={current.split('-')[0]} data-col={current.split('-')[1]} />
        </span>
        <span className="spot-open-text">{describeSpot(current)}</span>
        <span className="spot-open-hint" aria-hidden>
          or drag it
        </span>
      </button>

      {open && (
        <div className="spot-pop" role="group" aria-label={`${label} position`}>
          {ROWS.map((row) =>
            COLUMNS.map((column) => {
              const here = `${row}-${column}` as Spot
              const active = here === current
              return (
                <button
                  key={here}
                  type="button"
                  className="spot-cell"
                  data-active={active || undefined}
                  aria-pressed={active}
                  title={describeSpot(here)}
                  onClick={() => {
                    onChange(here)
                    setOpen(false)
                  }}
                >
                  <span className="spot-dot" aria-hidden />
                  <span className="spot-name">{describeSpot(here)}</span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
