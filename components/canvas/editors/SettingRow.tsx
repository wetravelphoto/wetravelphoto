'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * ONE LINE THAT SAYS WHAT IT IS AND WHAT IT IS SET TO
 * ═══════════════════════════════════════════════════
 *
 *     Aa  Typography                      140% · Bold · Oswald  ›
 *     ⊕   Position                              Bottom centre  ›
 *
 * A text box used to be followed by two controls that each explained
 * themselves differently — one a grid of dots, one a button with a badge —
 * and between them they took more vertical space than the writing they
 * governed. A panel with six text boxes in it was mostly controls.
 *
 * So both collapse to this: the name on the left, the CURRENT VALUE on the
 * right, and the detail behind a click. The value on the right is the point.
 * A row that only says "Typography" makes you open it to find out whether
 * anything is set; a row that says "140% · Bold · Oswald" has already
 * answered, and a row that says "Following" has answered too.
 *
 * Every row is the same height and the same shape, so a stack of them reads
 * as a list rather than as a pile of different widgets.
 */
export default function SettingRow({
  icon,
  name,
  /** What it is set to, in words. The row's whole reason for existing. */
  summary,
  /** True when this is following the look rather than set — draws quieter. */
  quiet = false,
  children,
}: {
  icon: React.ReactNode
  name: string
  summary: string
  quiet?: boolean
  /** The panel behind the row. Only mounted while it is open. */
  children: React.ReactNode
}) {
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
    // The settings form's own change handler is stopped here: without it,
    // dragging a slider inside one of these would queue a save of every other
    // field in the panel on every frame of the drag.
    <div className="ed-row-wrap" ref={box} onChange={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="ed-row"
        aria-expanded={open}
        aria-label={`${name}: ${summary}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ed-row-icon" aria-hidden>
          {icon}
        </span>
        <span className="ed-row-name">{name}</span>
        <span className="ed-row-value" data-quiet={quiet || undefined}>
          {summary}
        </span>
        <span className="ed-row-caret" aria-hidden>
          ›
        </span>
      </button>

      {open && <div className="ed-row-pop">{children}</div>}
    </div>
  )
}
