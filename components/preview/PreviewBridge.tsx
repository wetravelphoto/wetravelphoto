'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * THE WIRE BETWEEN THE CANVAS AND THE PAGE
 * ════════════════════════════════════════
 *
 * Runs inside the preview iframe. Three jobs:
 *
 *   · a click tells the editor what was hit — the section, and the individual
 *     setting if the click landed on one
 *   · the editor can ask for a re-render, or for a section to be highlighted
 *     and scrolled to
 *   · the editor can patch a single piece of text straight into the page while
 *     it is being typed
 *
 * ON THE PATCH, which is the one thing here that could become a lie. The rule
 * is in lib/sections/editable.ts and it is narrow on purpose: a patch only ever
 * writes a string into an element that has NO element children, so it can only
 * express the case where the server's output is that same string. Anything
 * else — a heading that changes the layout, a number, an image, a paragraph
 * that splits — is left to the refresh that follows a moment later. The patch
 * buys the feel of typing directly onto the page; the refresh is what keeps it
 * honest.
 *
 * Both windows are same-origin, and every message is checked against that
 * before it is read or sent. A preview frame is not a place to accept
 * instructions from an arbitrary opener.
 */

type Outbound =
  | { source: 'wtp-preview'; type: 'ready'; page: string }
  | {
      source: 'wtp-preview'
      type: 'select'
      id: string
      sectionType: string
      /** The setting that was clicked, when the click landed on one. */
      field?: string
    }
  | { source: 'wtp-preview'; type: 'clear' }

type Inbound = {
  source?: string
  type?: string
  id?: string
  field?: string
  value?: string
  vars?: Record<string, string>
  fonts?: string[]
  index?: number
}

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

      // Nothing in the preview navigates. A click here means "select this", and
      // following the link would take the editor's iframe somewhere the editor
      // has no way to come back from.
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

      // The nearest tagged setting, if the click landed inside one. Searched
      // from the click outwards and stopped at the section, so a click on the
      // section's background selects the section and nothing more.
      const marked = target?.closest<HTMLElement>('[data-field]')
      const field =
        marked && node.contains(marked) ? (marked.getAttribute('data-field') ?? undefined) : undefined

      // The type, not the label: the editor has the registry and can name it
      // itself, and sending a display string over the wire would mean two
      // places deciding what a section is called.
      send({
        source: 'wtp-preview',
        type: 'select',
        id,
        sectionType: node.getAttribute('data-section-type') ?? '',
        field,
      })
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return
      const data = event.data as Inbound | null
      if (!data || data.source !== 'wtp-canvas') return

      if (data.type === 'refresh') {
        router.refresh()
        return
      }

      if (data.type === 'patch' && data.id && data.field) {
        const node = document.querySelector<HTMLElement>(
          `.pv-section[data-section-id="${CSS.escape(data.id)}"] [data-field="${CSS.escape(data.field)}"]`
        )

        // No element children means the element's whole content is this
        // setting's text, so writing the string in is exactly what the server
        // would have rendered. If it has children — the intro's body, which the
        // renderer splits into paragraphs — this is not a case a patch can
        // express, and the refresh handles it instead.
        if (node && node.childElementCount === 0) node.textContent = data.value ?? ''
        return
      }

      if (data.type === 'styles' && data.vars) {
        // The same narrow exception as the text patch: these ARE the custom
        // properties the page is drawn from, so setting them is the identity
        // rather than a second renderer. They go on .pv-root, which is where
        // the preview route writes them on the server too — so the refresh
        // that follows lands on the same element and nothing flickers back.
        const root = document.querySelector<HTMLElement>('.pv-root')
        if (root) {
          for (const [name, value] of Object.entries(data.vars)) {
            root.style.setProperty(name, value)
          }
        }

        // A typeface the preview has not loaded would fall back silently, which
        // looks exactly like a broken font picker.
        for (const href of data.fonts ?? []) {
          if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) continue
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = href
          document.head.appendChild(link)
        }
        return
      }

      if (data.type === 'hero-story') {
        // The hero rotates on its own, so the editor has to be able to say
        // which story to hold on. Sent as a DOM event rather than handed to the
        // hero directly: this file has no business importing a section, and the
        // hero has no business knowing an editor exists.
        window.dispatchEvent(
          new CustomEvent('wtp:hero-story', { detail: { index: data.index ?? null } })
        )
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
    // which drops the outline — and the selection has not changed, so losing it
    // on every keystroke would be wrong. Watching the DOM rather than guessing
    // at refresh timing is what makes this reliable: whenever the sections are
    // rebuilt, the outline goes back where it was.
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
