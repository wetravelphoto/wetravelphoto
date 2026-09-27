'use client'

import { ROWS, COLUMNS, describeSpot, spot as cleanSpot, type Spot } from '@/lib/sections/spots'
import SettingRow from '@/components/canvas/editors/SettingRow'

/**
 * WHERE THIS SITS ON THE PICTURE
 * ══════════════════════════════
 *
 * One line under the text box it belongs to, reading the current place, which
 * opens a grid of the fifteen.
 *
 * The first version was three bare grids stacked in a "Placement" group, and
 * it had two faults that only showed up in use. Nothing said which grid was
 * which, and a control three groups away from the words it moves makes you
 * hold the connection in your head. Sitting under its own text box fixes both.
 *
 * ── Why it survived the drag ────────────────────────────────────────────────
 *
 * Dragging the words on the photograph is the better gesture and does the
 * same job, so this looked like a candidate for deletion. Three things kept
 * it: the drag is pointer-only, so this is the only way to move text from a
 * keyboard; the row SAYS where the element is, which dragging cannot do
 * without hunting for it on the picture; and a drop target on a phone-width
 * preview is small. As one line that answers the question without being
 * opened, it costs almost nothing to keep.
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

  return (
    <SettingRow
      icon={
        <span className="spot-open-icon" aria-hidden>
          <span
            className="spot-open-dot"
            data-row={current.split('-')[0]}
            data-col={current.split('-')[1]}
          />
        </span>
      }
      name="Position"
      summary={describeSpot(current)}
    >
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
                onClick={() => onChange(here)}
              >
                <span className="spot-dot" aria-hidden />
                <span className="spot-name">{describeSpot(here)}</span>
              </button>
            )
          })
        )}
        <p className="spot-hint">Or drag it on the photograph.</p>
      </div>
    </SettingRow>
  )
}
