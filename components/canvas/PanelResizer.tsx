'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const MIN = 280
const MAX = 720
const KEY = 'wtp.canvas.inspector-width'

/**
 * Drag the inspector's left edge to widen it.
 *
 * The complaint this answers is scrolling: a section with a story picker, a
 * crop and its typography is taller than any fixed panel, and the answer in
 * every tool built for this — Lightroom included — is a column you can widen
 * and sections you can fold. This is the widening half; the folding half is in
 * SectionFields.
 *
 * The width is written to a CSS variable on the shell rather than to React
 * state, so a drag does not re-render the whole editor sixty times a second —
 * and the iframe inside it does not relayout on every frame either.
 *
 * Remembered per browser. Not in the draft: how wide someone likes their panel
 * is not a property of the site, and it should not turn up in a Publish.
 */
export default function PanelResizer() {
  const [dragging, setDragging] = useState(false)
  const shell = useRef<HTMLElement | null>(null)

  const apply = useCallback((width: number) => {
    const clamped = Math.min(MAX, Math.max(MIN, width))
    shell.current?.style.setProperty('--cv-insp', `${clamped}px`)
    return clamped
  }, [])

  useEffect(() => {
    shell.current = document.querySelector<HTMLElement>('.cv-shell')

    try {
      const saved = Number(localStorage.getItem(KEY))
      if (Number.isFinite(saved) && saved > 0) apply(saved)
    } catch {
      // Private browsing, blocked storage — the default width is fine.
    }
  }, [apply])

  useEffect(() => {
    if (!dragging) return

    // Measured from the right edge of the window, because that is the edge the
    // panel is pinned to.
    const onMove = (e: PointerEvent) => apply(window.innerWidth - e.clientX)

    const onUp = (e: PointerEvent) => {
      const final = apply(window.innerWidth - e.clientX)
      setDragging(false)
      try {
        localStorage.setItem(KEY, String(final))
      } catch {
        // Nothing to do; the width still applies for this session.
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    // The iframe swallows pointer events once the cursor crosses into it, which
    // would strand the drag. Blocking them for the duration keeps the pointer
    // reporting to this window all the way across.
    const previous = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = previous
    }
  }, [dragging, apply])

  return (
    <div
      className="cv-grip-x"
      data-dragging={dragging}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the settings panel"
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()

        // Reachable without a mouse. 20px a press: enough to matter, not enough
        // to overshoot.
        const el = shell.current
        const current = el
          ? parseInt(getComputedStyle(el).getPropertyValue('--cv-insp'), 10) || 320
          : 320

        apply(e.key === 'ArrowLeft' ? current + 20 : current - 20)
      }}
    />
  )
}
