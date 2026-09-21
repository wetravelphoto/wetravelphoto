'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { LIVE_ATTRS } from '@/lib/sections/registry'

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
 *   · the editor can set a design value — a size, a position, a section's
 *     typography — straight onto the page while a slider or menu is moving
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
 * THE LIVE DESIGN VALUES follow the same rule, declared per field in the
 * registry (LiveSpec): one CSS custom property or one data attribute, which the
 * renderer writes on an element tagged `data-live`. Setting it here is the
 * identity, not a second renderer.
 *
 * They add one problem text does not have. A slider is dragged for a while,
 * saves go out during the drag, and the re-render for a save made halfway
 * through can arrive after the thumb has moved on — snapping the mark back to
 * a size the photographer has already left. So each live value is kept as
 * PENDING and put back whenever the page re-renders, until the editor says the
 * save that contains it has landed ('settle').
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
  vars?: Record<string, string | null>
  fonts?: string[]
  index?: number
  /** Live field: the custom property it sets, and its unit. */
  var?: string
  unit?: string
  /** Live field: the data attribute it sets. */
  attr?: string
  /** A section typography group: 'hero', 'intro', 'journal', 'contact'. */
  group?: string
}

/**
 * One value the editor has painted on and the server has not yet caught up
 * with. `apply` writes it wherever it belongs and reports nothing; calling it
 * again when the value is already there writes nothing, which is what stops
 * the re-render watcher below from feeding itself.
 */
type Pending = { section: string | null; group: string | null; apply: () => void }

// Anything else arriving in these slots is refused rather than set: a message
// that could name any attribute could name `onclick`.
const SAFE_VAR = /^--[a-z][a-z0-9-]*$/
const SAFE_ATTR = /^data-[a-z][a-z0-9-]*$/
const SAFE_WORD = /^[a-z][a-z0-9_]*$/

function setVar(el: HTMLElement, name: string, value: string | null) {
  if (value === null || value === '') {
    if (el.style.getPropertyValue(name) !== '') el.style.removeProperty(name)
  } else if (el.style.getPropertyValue(name) !== value) {
    el.style.setProperty(name, value)
  }
}

export default function PreviewBridge({ page }: { page: string }) {
  const router = useRouter()
  const selected = useRef<string | null>(null)

  useEffect(() => {
    const origin = window.location.origin
    if (window.parent === window) return // opened directly, not in the canvas

    const send = (message: Outbound) => window.parent.postMessage(message, origin)

    const pending = new Map<string, Pending>()

    const paint = (id: string | null) => {
      selected.current = id
      document.querySelectorAll('.pv-section').forEach((el) => {
        el.classList.toggle('is-selected', el.getAttribute('data-section-id') === id)
      })
    }

    // A typeface the preview has not loaded would fall back silently, which
    // looks exactly like a broken font picker. Only stylesheets from the font
    // service are accepted.
    const loadFonts = (hrefs: string[] | undefined) => {
      for (const href of hrefs ?? []) {
        if (!href.startsWith('https://fonts.googleapis.com/')) continue
        if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) continue
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        document.head.appendChild(link)
      }
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

      if (data.type === 'live' && data.id && data.field && SAFE_WORD.test(data.field)) {
        const id = data.id
        const field = data.field
        const value = data.value ?? ''
        const cssVar = data.var && SAFE_VAR.test(data.var) ? data.var : null
        const attr = data.attr && SAFE_ATTR.test(data.attr) ? data.attr : null
        if (!cssVar && !attr) return

        const written = cssVar ? `${value}${data.unit ?? ''}` : value

        const apply = () => {
          document
            .querySelectorAll<HTMLElement>(
              `.pv-section[data-section-id="${CSS.escape(id)}"] [data-live~="${field}"]`
            )
            .forEach((el) => {
              if (cssVar) setVar(el, cssVar, written)
              else if (attr && el.getAttribute(attr) !== written) el.setAttribute(attr, written)
            })
        }

        pending.set(`field:${id}:${field}`, { section: id, group: null, apply })
        apply()
        return
      }

      if (data.type === 'type-vars' && data.group && SAFE_WORD.test(data.group) && data.vars) {
        const group = data.group
        const vars = Object.entries(data.vars).filter(([name]) => SAFE_VAR.test(name))

        const apply = () => {
          document
            .querySelectorAll<HTMLElement>(`[data-type-group="${group}"]`)
            .forEach((el) => vars.forEach(([name, value]) => setVar(el, name, value)))
        }

        loadFonts(data.fonts)
        pending.set(`type:${group}`, { section: null, group, apply })
        apply()
        return
      }

      if (data.type === 'settle') {
        // The save holding these values has landed and its re-render is on the
        // way, so the server is the source of truth for them again.
        for (const [key, entry] of pending) {
          if ((data.id && entry.section === data.id) || (data.group && entry.group === data.group)) {
            pending.delete(key)
          }
        }
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
            if (value !== null) root.style.setProperty(name, value)
          }
        }

        loadFonts(data.fonts)
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
    //
    // The same watcher puts back any live value a re-render overwrote (see
    // PENDING at the top). Attributes are watched as well as elements, because
    // a re-render that keeps the element but changes its style or data-align
    // is exactly the case that snaps a slider back.
    let queued = 0
    const observer = new MutationObserver(() => {
      if ((!selected.current && pending.size === 0) || queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        if (selected.current) paint(selected.current)
        pending.forEach((entry) => entry.apply())
      })
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', ...LIVE_ATTRS],
    })

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
