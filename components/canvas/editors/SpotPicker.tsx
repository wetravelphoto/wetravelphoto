'use client'

import { ROWS, COLUMNS, describeSpot, type Spot, type SpotPair } from '@/lib/sections/spots'
import SettingRow from '@/components/canvas/editors/SettingRow'
import { BASE_DEVICE, type Device } from '@/lib/sections/devices'

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
 * ── One place per size ──────────────────────────────────────────────────────
 *
 * A phone is a different picture from the same photograph, so each piece of
 * copy can sit somewhere else on it. The phone follows the desktop until it is
 * moved, and moving it on the phone never moves it on the desktop — the same
 * rule as typography, for the same reason: you cannot break the desktop site
 * by tidying the phone one.
 *
 * Which size is being placed is not chosen here. It is the one switcher at the
 * top of the editor, which is also the preview's width, so the place being set
 * is the place being looked at.
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
  pair,
  device,
  deviceName,
  onChange,
  onFollow,
  label,
}: {
  /** Both sizes' places, and which the phone actually resolves to. */
  pair: SpotPair
  /** Which size is being placed. The switcher at the top decides. */
  device: Device
  deviceName: string
  /** Fires on the click, not after the save — the preview moves immediately. */
  onChange: (next: Spot) => void
  /** Hands the phone's place back so it follows the desktop again. */
  onFollow: () => void
  /** Only for the screen reader: the field above already says it on screen. */
  label: string
}) {
  const current = device === BASE_DEVICE ? pair.desktop : pair.effectiveMobile
  const following = device !== BASE_DEVICE && pair.mobile === null

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
      quiet={following}
    >
      <div
        className="spot-pop"
        role="group"
        aria-label={`${label} position on ${deviceName.toLowerCase()}`}
      >
        {/* Said plainly, because a phone showing the desktop's place looks
            exactly like a phone that was put there on purpose. */}
        {following && (
          <p className="spot-follow">Following the desktop. Pick a place to change it here only.</p>
        )}
        {device !== BASE_DEVICE && !following && (
          <button type="button" className="spot-unfollow" onClick={onFollow}>
            Follow the desktop again
          </button>
        )}
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
