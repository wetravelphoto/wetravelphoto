'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * THE WIRE BETWEEN THE CANVAS AND THE PAGE
 * ════════════════════════════════════════
 *
 * Runs inside the preview iframe. Two jobs:
 *
 *   · a click anywhere in the page tells the editor which section was hit
 *   · the editor can ask for a re-render, or ask for a section to be
 *     highlighted and scrolled to
 *
 * "Changes appear instantly" is done with router.refresh() rather than by
 * patching the DOM from the editor's copy of the settings. Refresh re-runs the
 * server components, so what appears is what the real renderer produces from
 * what is really in the draft. Optimistic DOM patching would be faster by a
 * few hundred milliseconds and would drift from the page it claims to be
 * showing — which is the one thing a preview must never do.
 *
 * Both windows are same-origin, and every message is checked against that
 * before it is read or sent. A preview frame is not a place to accept
 * instructions from an arbitrary opener.
 */

type Outbound =
  | { source: 'wtp-preview'; type: 'ready'; page: string }
  | { source: 'wtp-preview'; type: 'select'; id: string; sectionType: string }
  | { source: 'wtp-preview'; type: 'clear' }

export default function PreviewBridge({ page }: { page: string }) {
  const router = useRouter()
  const selected = useRef<string | null>(null)

  useEffect(() => {
    const origin = window.location.origin
    if (window.parent === window) return // opened directly, not in the canvas

    const send = (message: Outbound) => window.parent.postMessage(message, origin)

    const paint = (id: string | null) => {
      selected.current = id
      document.querySelectorAll('.pv-section').forEach((el) => {
        el.classList.toggle('is-selected', el.getAttribute('data-section-id') === id)
      })
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const node = target?.closest<HTMLElement>('.pv-section')

      // Nothing in the preview navigates. A click here means "select this",
      // and following the link would take the editor's iframe somewhere the
      // editor has no way to come back from.
      const link = target?.closest('a, button')
      if (link) {
        event.preventDefault()
        event.stopPropagation()
      }

      if (!node) {
        paint(null)
        send({ source: 'wtp-preview', type: 'clear' })
        return
      }

      const id = node.getAttribute('data-section-id') ?? ''
      paint(id)

      // The type, not the label: the editor has the registry and can name it
      // itself, and sending a display string over the wire would mean two
      // places deciding what a section is called.
      send({
        source: 'wtp-preview',
        type: 'select',
        id,
        sectionType: node.getAttribute('data-section-type') ?? '',
      })
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return
      const data = event.data as { source?: string; type?: string; id?: string } | null
      if (!data || data.source !== 'wtp-canvas') return

      if (data.type === 'refresh') {
        router.refresh()
        return
      }

      if (data.type === 'select') {
        const id = data.id ?? null
        paint(id)

        if (id) {
          document
            .querySelector(`.pv-section[data-section-id="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    }

    // Capture phase, so a section that stops propagation on its own clicks
    // (the lightbox, the carousel arrows) cannot swallow the selection.
    document.addEventListener('click', onClick, true)
    window.addEventListener('message', onMessage)

    // router.refresh() replaces the rendered sections with fresh elements,
    // which drops the outline — and the selection has not changed, so losing
    // it on every keystroke would be wrong. Watching the DOM rather than
    // guessing at refresh timing is what makes this reliable: whenever the
    // sections are rebuilt, the outline goes back where it was.
    let queued = 0
    const observer = new MutationObserver(() => {
      if (!selected.current || queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        paint(selected.current)
      })
    })

    observer.observe(document.body, { childList: true, subtree: true })

    send({ source: 'wtp-preview', type: 'ready', page })

    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('message', onMessage)
      observer.disconnect()
      if (queued) cancelAnimationFrame(queued)
    }
  }, [page, router])

  return null
}
