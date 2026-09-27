'use client'

import { SHOWN, SHOWN_LABEL, type Shown } from '@/lib/sections/shown'

/**
 * WHICH SIZES THIS PIECE OF TEXT APPEARS ON
 * ═════════════════════════════════════════
 *
 * A button that earns its place on a desktop can be the third thing over a
 * photograph on a phone; a short line that only works on a small screen has
 * nowhere to go on a wide one.
 *
 * ── Three answers, and no fourth ────────────────────────────────────────────
 *
 * There is no "hide everywhere". Text that should never appear is text that
 * should be deleted, and an editor that lets you hide something everywhere
 * hands you a site with invisible content in it and no way to notice. Each of
 * the three is a real answer to "where does this belong".
 *
 * ── Not governed by the switcher at the top ─────────────────────────────────
 *
 * Every other control in the panel edits the size the editor is pointed at.
 * This one is ABOUT the sizes, so it has to show all of them at once — a
 * control that only offered "hide this here" would take two visits to say
 * something you can say in one word. It is the one tab of Customize that does
 * not carry the size badge, for that reason.
 */
export default function ShownPicker({
  value,
  label,
  onChange,
}: {
  value: Shown
  /** Only for the screen reader: the field above already says it on screen. */
  label: string
  onChange: (next: Shown) => void
}) {
  return (
      <div className="shown-pop" role="group" aria-label={`Where ${label} appears`}>
        {SHOWN.map((option) => (
          <button
            key={option}
            type="button"
            className="shown-choice"
            data-active={value === option || undefined}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {SHOWN_LABEL[option]}
          </button>
        ))}
        <p className="shown-note">
          Hidden is hidden — it is taken out of the page, not made invisible, so
          nothing reads it out or finds it in a search.
        </p>
      </div>
  )
}
