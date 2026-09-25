'use client'

import { ROWS, COLUMNS, describeSpot, spot as cleanSpot, type Spot } from '@/lib/sections/spots'

/**
 * NINE BUTTONS IN THE SHAPE OF THE THING THEY CONTROL
 *
 * A pair of dropdowns would have been less code and would have read as
 * "vertical: middle / horizontal: right", which is a sentence a photographer
 * has to assemble in their head before they can picture it. Nine cells laid
 * out like the photograph answers the question by being the answer.
 *
 * Deliberately small — this appears three times in one panel, once per piece
 * of copy, and three large grids would own the screen.
 */
export default function SpotPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: unknown
  onChange: (next: Spot) => void
  disabled?: boolean
}) {
  const current = cleanSpot(value)

  return (
    <div className="spot-grid" role="group" aria-label="Position on the photograph">
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
              disabled={disabled}
              onClick={() => onChange(here)}
            >
              {/* A dot rather than a label: nine words in nine small boxes is
                  noise, and the grid's shape already says which is which. */}
              <span className="spot-dot" aria-hidden />
              <span className="spot-name">{describeSpot(here)}</span>
            </button>
          )
        })
      )}
    </div>
  )
}
