'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { LIVE_ATTRS } from '@/lib/sections/registry'
import { readShortcut, type Shortcut } from '@/lib/canvas-keys'

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
  /** "+ Add a section below" was clicked under the section with this id. */
  | { source: 'wtp-preview'; type: 'add-after'; id: string }
  /**
   * A piece of hero copy was dragged to one of the nine places. The preview
   * has already moved the node — see the drag below for why that is allowed —
   * so this is the editor's cue to save it, not to redraw anything.
   */
  | { source: 'wtp-preview'; type: 'spot'; id: string; field: string; value: string }
  /**
   * A shortcut pressed while the preview had focus. The preview only names
   * the key; the editor decides what it means. See lib/canvas-keys.ts.
   */
  | { source: 'wtp-preview'; type: 'shortcut'; name: Shortcut }

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
  /** Header/footer repaint: which of the two. */
  part?: string
}

/**
 * One value the editor has painted on and the server has not yet caught up
 * with. `apply` writes it wherever it belongs and reports nothing; calling it
 * again when the value is already there writes nothing, which is what stops
 * the re-render watcher below from feeding itself.
 */
type Pending = { section: string; apply: () => void }

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
      // The header and footer are selected as "__header" / "__footer".
      document.querySelectorAll('[data-chrome]').forEach((el) => {
        el.classList.toggle('is-selected', `__${el.getAttribute('data-chrome')}` === id)
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
      // The click a completed drag leaves behind. Letting it through would
      // select the section at the moment of the drop, which reads as the
      // editor arguing with you.
      if (swallowClick) {
        swallowClick = false
        event.preventDefault()
        event.stopPropagation()
        return
      }

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

      // The selected section's "+ Add a section below" button: asks the editor
      // to open its section picker, and selects nothing.
      const add = target?.closest<HTMLElement>('.pv-add')
      if (add) {
        const after = add.getAttribute('data-add-after')
        if (after) send({ source: 'wtp-preview', type: 'add-after', id: after })
        return
      }

      if (!node) {
        // The header or the footer: not sections, but selectable all the same.
        const chrome = target?.closest<HTMLElement>('[data-chrome]')
        const part = chrome?.getAttribute('data-chrome')
        if (part === 'header' || part === 'footer') {
          paint(`__${part}`)
          send({ source: 'wtp-preview', type: 'select', id: `__${part}`, sectionType: part })
          return
        }

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


    /**
     * DRAGGING A TITLE TO A PLACE
     * ═══════════════════════════
     *
     * The title, subtitle and button each sit in one of nine containers over
     * the photograph (lib/sections/spots.ts). Dragging one picks it up and
     * drops it into another.
     *
     * **What this must NOT do: move the node.** The first version called
     * `to.appendChild(el)` on the drop, reasoning that the next render puts
     * the element in that very container, so the move was the identity.
     * Visually true, mechanically false. Those elements are rendered by
     * React, and React holds a tree of where it believes each one lives.
     * Re-parenting one behind its back means the next reconciliation tries to
     * remove a child from a parent that no longer has it, throws, and takes
     * the whole preview down to the error page — which is exactly the React
     * #441 this project has chased twice before.
     *
     * So nothing here is re-parented. The element is carried by a
     * `transform`, which is paint and not structure, and it STAYS carried
     * after the drop — parked over the place it was dropped on — until the
     * server's render arrives and puts the real element there. Then the
     * transform is dropped. No snap back, and React's tree is never touched.
     *
     * **Geometry, not hit-testing.** The grid is `pointer-events: none` so the
     * photograph stays clickable between the words, which means
     * elementsFromPoint does not return the places. Measuring their rectangles
     * avoids fighting that, and avoids the dragged element shadowing its own
     * drop target.
     *
     * **A drag is not a click.** Five pixels of movement separates them, and a
     * real drag swallows the click that follows so the section does not get
     * selected out from under the drop.
     */
    const DRAG_SLOP = 5
    let drag: {
      el: HTMLElement
      field: string
      section: string
      from: HTMLElement
      startX: number
      startY: number
      live: boolean
    } | null = null
    let swallowClick = false

    /**
     * Elements sitting under a transform, waiting for the server to catch up.
     * Cleared by the observer below the moment the real element appears in the
     * place it was dropped on, which is the only signal that the round trip
     * has landed.
     */
    const parked = new Map<HTMLElement, string>()

    const places = (el: HTMLElement): HTMLElement[] => {
      const grid = el.closest('.hero-spots')
      return grid ? Array.from(grid.querySelectorAll<HTMLElement>('.hero-spot')) : []
    }

    const placeAt = (el: HTMLElement, x: number, y: number): HTMLElement | null => {
      for (const place of places(el)) {
        const r = place.getBoundingClientRect()
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return place
      }
      return null
    }

    const endDrag = () => {
      if (!drag) return
      const grid = drag.el.closest('.hero-spots')
      grid?.removeAttribute('data-dragging')
      places(drag.el).forEach((p) => p.removeAttribute('data-over'))
      drag.el.classList.remove('is-spot-dragging')
      if (!parked.has(drag.el)) drag.el.style.transform = ''
      drag = null
    }

    const onPointerDown = (event: PointerEvent) => {
      /*
       * Disarm first, always.
       *
       * The flag is set on a drop so the click that follows does not also
       * select the section. But a drag that starts on the title and ends over
       * an empty place is a press and a release on two different elements, and
       * the browser fires no click at all — so the flag would still be armed
       * when the photographer next clicked something, and that click would
       * vanish. Clearing it here means a stale flag can never outlive the
       * gesture that set it.
       */
      swallowClick = false

      if (event.button !== 0) return
      const target = event.target as HTMLElement | null
      const handle = target?.closest<HTMLElement>('[data-spot-drag]')
      if (!handle) return
      const section = handle.closest<HTMLElement>('.pv-section')
      const field = handle.getAttribute('data-spot-drag')
      const from = handle.closest<HTMLElement>('.hero-spot')
      const id = section?.getAttribute('data-section-id')
      if (!field || !from || !id || !SAFE_WORD.test(field)) return

      /*
       * Stop the browser doing its own thing with the press.
       *
       * Without this, pressing a title began a text selection that smeared
       * across the picture as you moved, and pressing the button — which is a
       * real <a> — began a native link drag. Neither is recoverable once
       * started. These elements are not typed into (the panel owns the text,
       * and the patch writes it back in), so there is no caret to protect.
       */
      event.preventDefault()

      drag = { el: handle, field, section: id, from, startX: event.clientX, startY: event.clientY, live: false }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return

      if (!drag.live) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_SLOP) return
        drag.live = true
        drag.el.closest('.hero-spots')?.setAttribute('data-dragging', '')
        drag.el.classList.add('is-spot-dragging')
      }

      /*
       * Carry it with the pointer.
       *
       * `transform` rather than anything that moves the element in the
       * layout: the places are found by measuring their rectangles, and an
       * element that reflowed as it was dragged would move the very targets
       * it is being dropped into. A transform paints somewhere else and
       * changes no geometry at all.
       */
      drag.el.style.transform = `translate(${event.clientX - drag.startX}px, ${event.clientY - drag.startY}px)`

      // A drag must not also select text under the pointer.
      event.preventDefault()

      const over = placeAt(drag.el, event.clientX, event.clientY)
      for (const place of places(drag.el)) {
        if (place === over) place.setAttribute('data-over', '')
        else place.removeAttribute('data-over')
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!drag) return
      if (!drag.live) {
        drag = null
        return
      }

      const { el, field, section, from } = drag
      const to = placeAt(el, event.clientX, event.clientY)
      const spot = to?.getAttribute('data-spot')

      /*
       * Compared against where it is GOING, not where it still sits.
       *
       * A parked element has not been re-parented, so its DOM parent is the
       * place it came from while it is drawn over the place it was dropped
       * on. Dragging it again before the render lands and comparing parents
       * would call a drop back onto its own current position a move, and save
       * it again for nothing.
       */
      const already = parked.get(el) ?? from.getAttribute('data-spot')
      const landed = Boolean(spot && spot !== already)

      // Parked BEFORE the drag is torn down, because endDrag clears the
      // transform of anything that is not parked — and clearing it here is
      // precisely the snap back this is meant to avoid.
      if (landed && spot) parked.set(el, spot)

      endDrag()
      swallowClick = true

      if (!landed || !spot) return

      send({ source: 'wtp-preview', type: 'spot', id: section, field, value: spot })
    }

    // A drag ends when the pointer leaves the window too, or nothing would
    // ever clear the highlight.
    const onPointerCancel = () => {
      const wasLive = drag?.live === true
      endDrag()
      if (wasLive) swallowClick = true
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

      /*
       * A placement chosen in the panel used to be applied here by moving the
       * element. It is not any more, for the reason set out by the drag above:
       * these nodes belong to React. The panel sends its save without waiting
       * for a debounce instead, and the element arrives with the render.
       */


      if (data.type === 'live' && data.id && data.field && SAFE_WORD.test(data.field)) {
        const id = data.id
        const field = data.field
        const value = data.value ?? ''
        const cssVar = data.var && SAFE_VAR.test(data.var) ? data.var : null
        const attr = data.attr && SAFE_ATTR.test(data.attr) ? data.attr : null
        if (!cssVar && !attr) return

        const written = cssVar ? `${value}${data.unit ?? ''}` : value

        const apply = () => {
          // The section's own wrapper counts too: spacing, background and
          // visibility are painted on it rather than on anything inside.
          const box = document.querySelector<HTMLElement>(
            `.pv-section[data-section-id="${CSS.escape(id)}"]`
          )
          if (!box) return
          const targets = [box, ...box.querySelectorAll<HTMLElement>(`[data-live~="${field}"]`)]
          targets
            .filter((el) => el.matches(`[data-live~="${field}"]`))
            .forEach((el) => {
              if (cssVar) setVar(el, cssVar, written)
              else if (attr && el.getAttribute(attr) !== written) el.setAttribute(attr, written)
            })
        }

        pending.set(`field:${id}:${field}`, { section: id, apply })
        apply()
        return
      }

      if (data.type === 'type-vars' && data.id && data.vars) {
        // One section's typography, on the element its renderer writes the
        // variables on (tagged data-type-root). Per section: changing the
        // intro's heading no longer touches every other section.
        const id = data.id
        const vars = Object.entries(data.vars).filter(([name]) => SAFE_VAR.test(name))

        const apply = () => {
          document
            .querySelectorAll<HTMLElement>(
              `.pv-section[data-section-id="${CSS.escape(id)}"] [data-type-root]`
            )
            .forEach((el) => vars.forEach(([name, value]) => setVar(el, name, value)))
        }

        loadFonts(data.fonts)
        pending.set(`type:${id}`, { section: id, apply })
        apply()
        return
      }

      if (data.type === 'chrome-live' && (data.part === 'header' || data.part === 'footer')) {
        // A header or footer value as it moves: custom properties on the
        // element, or one attribute. Kept as pending like a section's, keyed
        // "__header" / "__footer", until the editor says the save has landed.
        const part = data.part
        const vars = Object.entries(data.vars ?? {}).filter(([name]) => SAFE_VAR.test(name))
        const attr = data.attr && SAFE_ATTR.test(data.attr) ? data.attr : null
        const value = data.value ?? ''

        const apply = () => {
          document.querySelectorAll<HTMLElement>(`[data-chrome="${part}"]`).forEach((el) => {
            vars.forEach(([name, v]) => setVar(el, name, v))
            if (attr && el.getAttribute(attr) !== value) el.setAttribute(attr, value)
          })
        }

        loadFonts(data.fonts)
        pending.set(`chrome:${part}:${attr ?? vars.map(([n]) => n).join(',')}`, { section: `__${part}`, apply })
        apply()
        return
      }

      if (data.type === 'settle') {
        // The save holding these values has landed and its re-render is on the
        // way, so the server is the source of truth for them again.
        // Without an id, every section: Undo replaces the whole draft, so
        // nothing painted on ahead of the server is still true.
        for (const [key, entry] of pending) {
          if (!data.id || entry.section === data.id) {
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

        if (id === '__header') {
          window.scrollTo({ top: 0, behavior: 'smooth' })
        } else if (id === '__footer') {
          document.querySelector('[data-chrome="footer"]')?.scrollIntoView({ behavior: 'smooth', block: 'end' })
        } else if (id) {
          document
            .querySelector(`.pv-section[data-section-id="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    }

    // Shortcuts pressed with the preview focused belong to the editor, which
    // is a different document and would never hear them. The preview only
    // names the key (lib/canvas-keys.ts) and hands it over.
    const onKey = (event: KeyboardEvent) => {
      const name = readShortcut(event)
      if (!name) return

      // The arrows still scroll the page when nothing is selected, and
      // Delete with nothing selected is not ours to swallow either.
      if (!selected.current && name !== 'undo' && name !== 'redo') return

      event.preventDefault()
      send({ source: 'wtp-preview', type: 'shortcut', name })
    }

    // Capture phase, so a section that stops propagation on its own clicks
    // (the lightbox, the carousel arrows) cannot swallow the selection.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey)
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
      if ((!selected.current && pending.size === 0 && parked.size === 0) || queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        if (selected.current) paint(selected.current)
        pending.forEach((entry) => entry.apply())

        /*
         * Release anything parked whose place has caught up.
         *
         * A dropped element keeps its transform so it does not jump back to
         * where it came from while the save is in flight. The render that
         * lands it in the right container is the signal to let go — and if
         * React replaced the node outright, it is no longer in the document
         * and there is nothing to let go of.
         */
        parked.forEach((want, el) => {
          const now = el.closest('.hero-spot')?.getAttribute('data-spot')
          if (!el.isConnected || now === want) {
            el.style.transform = ''
            parked.delete(el)
          }
        })
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
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('message', onMessage)
      observer.disconnect()
      if (queued) cancelAnimationFrame(queued)
    }
  }, [page, router])

  return null
}
