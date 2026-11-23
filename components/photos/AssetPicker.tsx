'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import styles from './AssetPicker.module.css'
import {
  ALT_MAX,
  CAPTION_MAX,
  UPLOAD_ACCEPT,
  badgeFor,
  buildResult,
  cameraFacts,
  canRemoveFromSource,
  checkUploadFile,
  confirmBlock,
  gridPhase,
  initPicker,
  itemFor,
  itemKey,
  keepsInherited,
  NO_PREVIEWS,
  pickBlock,
  pickerReducer,
  placementAlt,
  previewOf,
  previewReducer,
  refsToResolve,
  selectedIndex,
  takeOutPrompt,
  visibleKeys,
  type OrientationFilter,
  type PickerAdapter,
  type PickerCapabilities,
  type PickerCurrent,
  type PickerInit,
  type PickerItem,
  type PickerMode,
  type PickerResult,
  type PickerSlot,
  type PickerSort,
  type PickerSource,
  type PickerState,
  type TakeOutAsk,
  type ViewSource,
} from '@/lib/photos/picker-state'

/* eslint-disable @next/next/no-img-element */

/**
 * THE PHOTO PICKER — album rail
 * ═════════════════════════════
 *
 * The approved direction C: the library and every gallery down a rail on the
 * left, the photographs uncropped in a grid, and a compact details drawer
 * under the grid that folds to one line. One component for every place a
 * photograph is chosen; the caller says what kind of place it is.
 *
 * It reads and uploads only through `adapter`, so nothing in here knows about
 * Supabase, R2 or a server action, and nothing in here is a boundary: what a
 * caller restricts (membership only, one gallery) shapes the screen, and the
 * server still decides what may be saved.
 *
 * Choosing is not saving. Nothing reaches the caller until Use / Add, and the
 * caller writes the result into its draft like any other setting.
 */

export type AssetPickerProps = {
  /** Read once when the dialog opens; a new object on a later render is not picked up. */
  adapter: PickerAdapter
  mode: PickerMode
  slot: PickerSlot
  /** What the slot holds now, as stored. Restored even when it is not on the first page. */
  current?: readonly PickerCurrent[]
  capabilities?: PickerCapabilities
  /** Open on this source — a story's linked gallery, say. Defaults to all photographs. */
  initialSource?: ViewSource
  title?: string
  confirmLabel?: string
  /** Called with the choice. The caller closes the picker. */
  onConfirm: (result: PickerResult) => void
  onClose: () => void
}

const SORTS: Array<[PickerSort, string]> = [
  ['recent', 'Recently uploaded'],
  ['oldest', 'Oldest first'],
]
const SHAPES: Array<[OrientationFilter, string]> = [
  ['any', 'Any shape'],
  ['landscape', 'Landscape'],
  ['portrait', 'Portrait'],
  ['square', 'Square'],
]

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function dateText(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function shapeText(item: PickerItem): string | null {
  if (!item.orientation) return null
  return item.orientation.charAt(0).toUpperCase() + item.orientation.slice(1)
}

function nameOf(item: PickerItem | null): string {
  return item?.title || (item?.kind === 'sample' ? 'Sample photograph' : 'Untitled photograph')
}

const arStyle = (item: PickerItem | null): CSSProperties =>
  ({ '--ar': item?.width && item?.height ? String(item.width / item.height) : '1.5' }) as CSSProperties

function Icon({ name }: { name: 'x' | 'up' | 'check' | 'chev' }) {
  if (name === 'chev') {
    return (
      <svg className={`${styles.icon} ${styles.chev}`} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'x') {
    return (
      <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'up') {
    return (
      <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function AssetPicker(props: AssetPickerProps) {
  const { mode, slot, capabilities, onConfirm, onClose } = props
  const [adapter] = useState(props.adapter)

  // The picker's starting point is fixed for the life of the dialog; a caller
  // re-rendering with a new array does not restart the session.
  const [init] = useState<PickerInit>(() => ({
    mode,
    slot,
    capabilities,
    current: props.current,
    initialSource: props.initialSource,
  }))
  const [s, dispatch] = useReducer(pickerReducer, init, initPicker)
  // Previews whose bytes did not arrive, by URL. A separate reducer on
  // purpose: it cannot touch the selection, the text or whether Use is allowed.
  const [previews, dispatchPreview] = useReducer(previewReducer, NO_PREVIEWS)
  // The latest state, for callbacks that outlive the render that made them.
  const state = useRef(s)
  useLayoutEffect(() => {
    state.current = s
  })

  const uid = useId()
  const ids = {
    title: `${uid}-title`,
    for: `${uid}-for`,
    why: `${uid}-why`,
    det: `${uid}-det`,
    alt: `${uid}-alt`,
    altHint: `${uid}-alth`,
    cap: `${uid}-cap`,
  }

  const dialog = useRef<HTMLDialogElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const opener = useRef<Element | null>(null)
  const seq = useRef(0)
  const alive = useRef(false)
  const aborts = useRef(new Set<AbortController>())
  const files = useRef(new Map<string, File>())
  const started = useRef(new Set<string>())
  const uploadSeq = useRef(0)
  const initialFocusDone = useRef(false)
  const downOnBackdrop = useRef(false)
  /** The tile that holds the tab stop; arrows move it without choosing anything. */
  const [cursor, setCursor] = useState<string | null>(null)
  // The details under the grid start folded to their one-line bar, and stay
  // as the photographer last left them: choosing another photograph does not
  // open them again.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [live, setLive] = useState('')
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  /** The photograph whose "Take out of Uploads" is asking to be confirmed, and the source it was asked in. */
  const [askRemove, setAskRemove] = useState<TakeOutAsk | null>(null)

  const announce = useCallback((text: string) => {
    setLive('')
    window.setTimeout(() => alive.current && setLive(text), 30)
  }, [])

  const controller = () => {
    const ac = new AbortController()
    aborts.current.add(ac)
    return ac
  }
  const settle = (ac: AbortController) => aborts.current.delete(ac)

  /* --------------------------- reads ---------------------------- */

  const loadSources = useCallback(() => {
    const req = ++seq.current
    const ac = controller()
    dispatch({ type: 'sourcesRequested', req })
    adapter
      .listSources(ac.signal)
      .then((list) => alive.current && dispatch({ type: 'sourcesLoaded', req, list }))
      .catch(() => alive.current && dispatch({ type: 'sourcesFailed', req }))
      .finally(() => settle(ac))
  }, [adapter])

  const loadView = useCallback(
    (patch: { source?: ViewSource; orientation?: OrientationFilter; sort?: PickerSort }) => {
      const cur = state.current.view
      const source = patch.source ?? cur.source
      const changing = source.id !== cur.source.id
      const orientation = patch.orientation ?? (changing ? 'any' : cur.orientation)
      const sort = patch.sort ?? cur.sort
      const req = ++seq.current
      const ac = controller()
      dispatch({ type: 'viewRequested', req, source, orientation, sort })
      adapter
        .listItems({ source: source.id, orientation, sort, cursor: null }, ac.signal)
        .then((page) => alive.current && dispatch({ type: 'pageLoaded', req, items: page.items, cursor: page.nextCursor }))
        .catch(() => alive.current && dispatch({ type: 'pageFailed', req }))
        .finally(() => settle(ac))
    },
    [adapter]
  )

  const loadMore = useCallback(() => {
    const v = state.current.view
    if (v.status !== 'ready' || !v.cursor || v.more === 'loading') return
    const req = ++seq.current
    const ac = controller()
    dispatch({ type: 'moreRequested', req })
    adapter
      .listItems({ source: v.source.id, orientation: v.orientation, sort: v.sort, cursor: v.cursor }, ac.signal)
      .then((page) => alive.current && dispatch({ type: 'pageLoaded', req, items: page.items, cursor: page.nextCursor }))
      .catch(() => alive.current && dispatch({ type: 'pageFailed', req }))
      .finally(() => settle(ac))
  }, [adapter])

  const resolveCurrent = useCallback(() => {
    const refs = refsToResolve(init)
    if (!refs.length) return
    const req = ++seq.current
    const ac = controller()
    dispatch({ type: 'resolveRequested', req })
    adapter
      .resolveCurrent(refs, ac.signal)
      .then((items) => alive.current && dispatch({ type: 'resolved', req, items }))
      .catch(() => alive.current && dispatch({ type: 'resolveFailed', req }))
      .finally(() => settle(ac))
  }, [adapter, init])

  /* ------------------------ open and close ----------------------- */

  useEffect(() => {
    alive.current = true
    const set = aborts.current
    if (!opener.current) opener.current = document.activeElement
    const d = dialog.current
    if (d && !d.open) d.showModal()
    closeBtn.current?.focus()
    loadSources()
    loadView({})
    resolveCurrent()
    return () => {
      // Closing abandons every read and upload in flight; a reply that still
      // arrives finds `alive` false and changes nothing.
      alive.current = false
      set.forEach((ac) => ac.abort())
      set.clear()
      if (d?.open) d.close()
      const back = opener.current
      if (back instanceof HTMLElement && back.isConnected) back.focus()
    }
  }, [loadSources, loadView, resolveCurrent])

  // After an upload lands somewhere other than what is on screen.
  useEffect(() => {
    if (!s.switchTo) return
    const target = s.sources.list.find((x) => x.id === s.switchTo)
    dispatch({ type: 'switchHandled' })
    if (target) loadView({ source: { id: target.id, kind: target.kind, label: target.label } })
  }, [s.switchTo, s.sources.list, loadView])

  /* ---------------------------- uploads -------------------------- */

  const queueFiles = useCallback(
    (chosen: File[]) => {
      if (!adapter.upload || !state.current.upload) return
      const list = chosen.filter(Boolean)
      if (!list.length) return
      const wrong = list.map(checkUploadFile).find(Boolean)
      if (wrong) {
        dispatch({ type: 'notice', text: wrong, bad: true })
        announce(wrong)
        return
      }
      const jobs = list.map((f) => {
        const id = `${uid}-up-${++uploadSeq.current}`
        files.current.set(id, f)
        return { id, name: f.name || 'photograph' }
      })
      // One file is "I want this one"; several is stocking up. In a set, every
      // one joins it in the order chosen.
      const autoSelect = state.current.mode === 'multiple' || jobs.length === 1
      dispatch({ type: 'uploadsQueued', jobs, autoSelect })
      announce(`Uploading ${plural(jobs.length, 'photograph')}.`)
    },
    [adapter, announce, uid]
  )

  // One upload at a time, in the order chosen. A failure does not stop the rest.
  useEffect(() => {
    const upload = adapter.upload
    if (!upload) return
    if (s.uploads.some((j) => j.status === 'uploading' || j.status === 'processing')) return
    const job = s.uploads.find((j) => j.status === 'queued')
    if (!job) return
    const file = files.current.get(job.id)
    const { id, attempt } = job
    const tag = `${id}#${attempt}`
    if (!file || started.current.has(tag)) return
    started.current.add(tag)
    dispatch({ type: 'uploadStarted', id, attempt })
    const ac = controller()
    upload(file, {
      uploadId: id,
      attempt,
      signal: ac.signal,
      onProgress: (f) =>
        alive.current &&
        dispatch({ type: 'uploadProgress', id, attempt, progress: f == null ? null : Math.max(0, Math.min(100, Math.round(f * 100))) }),
      onProcessing: () => alive.current && dispatch({ type: 'uploadProcessing', id, attempt }),
    })
      .then((item) => {
        if (!alive.current) return
        files.current.delete(id)
        dispatch({ type: 'uploadSucceeded', id, attempt, item })
        announce(`${nameOf(item)} uploaded${job.autoSelect ? ' and selected' : ''}. Nothing is published until you publish.`)
      })
      .catch((e: unknown) => {
        if (!alive.current || ac.signal.aborted) return
        const message = e instanceof Error && e.message ? e.message : 'The upload did not finish.'
        dispatch({ type: 'uploadFailed', id, attempt, message })
        announce(`${job.name}: upload didn’t finish. Try again or dismiss.`)
      })
      .finally(() => settle(ac))
  }, [s.uploads, adapter, announce])

  /* ----------------------- announcements ------------------------- */

  const lastView = useRef<string>('')
  useEffect(() => {
    if (s.view.status !== 'ready') return
    const tag = `${s.view.req}:${s.view.keys.length}`
    if (lastView.current === tag) return
    lastView.current = tag
    const n = visibleKeys(s).length
    announce(
      !n && s.view.cursor
        ? `${s.view.source.label}: none found yet. More to look through.`
        : `${s.view.source.label}: ${plural(n, 'photograph')} shown${s.view.cursor ? ', more available' : ''}.`
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.view.status, s.view.req, s.view.keys.length])

  /* ------------------------ initial focus ------------------------ */

  useEffect(() => {
    if (initialFocusDone.current || s.view.status === 'loading') return
    if (s.resolve.status === 'loading') return
    initialFocusDone.current = true
    const d = dialog.current
    // Only if the photographer has not already moved somewhere.
    if (!d || (document.activeElement !== closeBtn.current && document.activeElement !== d)) return
    const tile =
      d.querySelector<HTMLElement>('[data-tile][tabindex="0"]') ??
      d.querySelector<HTMLElement>('[data-retry]')
    tile?.focus()
  }, [s.view.status, s.resolve.status])

  /* --------------------------- derived --------------------------- */

  const sel = s.selection
  const visible = visibleKeys(s)
  const block = confirmBlock(s)
  const inheritedLabel = slot.inherited?.label ?? null
  const following = s.hasInherited && s.currentCount === 0
  const focusItem = itemFor(s, s.focus)
  const focusEntry = s.focus ? sel.find((e) => e.key === s.focus) ?? null : null
  const sourcesReady = s.sources.status === 'ready'
  const activeSource: PickerSource | null = s.sources.list.find((x) => x.id === s.view.source.id) ?? null

  // Exactly one tile is in the tab order; arrows move between them.
  const rovingKey = useMemo(() => {
    if (cursor && visible.includes(cursor)) return cursor
    if (s.focus && visible.includes(s.focus)) return s.focus
    const chosen = visible.find((k) => sel.some((e) => e.key === k))
    return chosen ?? visible[0] ?? null
  }, [cursor, s.focus, visible, sel])

  /* --------------------------- actions --------------------------- */

  const pick = (key: string) => {
    const item = s.known[key]
    if (!item) return
    const why = pickBlock(item, s.identity, s.albumIds)
    const k = itemKey(item, s.identity)
    dispatch({ type: 'pick', key })
    if (why || !k) return announce(`${nameOf(item)}: ${why ?? 'can’t be used here.'}`)
    if (s.mode === 'single') return announce(`${nameOf(item)} selected. Press ${confirmText()} to confirm.`)
    const i = selectedIndex(s, k)
    if (i >= 0) announce(`${nameOf(item)} removed. ${plural(sel.length - 1, 'photograph')} selected.`)
    else announce(`${nameOf(item)} added as number ${sel.length + 1}.`)
  }

  const remove = (key: string) => {
    const i = selectedIndex(s, key)
    if (i < 0) return
    const item = s.known[key]
    dispatch({ type: 'remove', key })
    announce(`${item ? nameOf(item) : 'Photograph'} removed from the set. ${plural(sel.length - 1, 'photograph')} selected.`)
    // Keep focus inside the tray rather than dropping it on the body.
    window.setTimeout(() => {
      const d = dialog.current
      const next = d?.querySelector<HTMLElement>(`[data-trm="${CSS.escape(sel[i + 1]?.key ?? sel[i - 1]?.key ?? '')}"]`)
      ;(next ?? d?.querySelector<HTMLElement>('[data-tray]'))?.focus()
    }, 0)
  }

  /**
   * Take a photograph out of the Uploads source on screen. Not a deletion:
   * the photograph stays in the library, in the selection and on every page;
   * only this source's list changes. The server decides whether it may.
   */
  const takeOut = (key: string) => {
    const cur = state.current
    const item = cur.known[key]
    if (!adapter.removeFromSource || !item || !canRemoveFromSource(cur, key)) return
    const source = cur.view.source
    const req = ++seq.current
    const ac = controller()
    dispatch({ type: 'removeRequested', key, req })
    adapter
      .removeFromSource(item, { id: source.id, kind: source.kind }, ac.signal)
      .then(() => {
        if (!alive.current) return
        dispatch({ type: 'removeSucceeded', key, req })
        setAskRemove((a) => (a?.key === key ? null : a))
        announce(`${nameOf(item)} taken out of ${source.label}. It is still in All photographs.`)
        // Its tile has gone from this list; keep focus in the dialog.
        window.setTimeout(() => {
          const d = dialog.current
          ;(d?.querySelector<HTMLElement>('[data-tile][tabindex="0"]') ?? d?.querySelector<HTMLElement>('[data-src][aria-current="true"]'))?.focus()
        }, 0)
      })
      .catch((e: unknown) => {
        if (!alive.current || ac.signal.aborted) return
        const message = e instanceof Error && e.message ? e.message : 'It could not be taken out just now.'
        dispatch({ type: 'removeFailed', key, req, message })
        announce(`${nameOf(item)} is still in ${source.label}. ${message}`)
      })
      .finally(() => settle(ac))
  }

  const chooseSource = (src: PickerSource) => {
    if (src.id === s.view.source.id && s.view.status !== 'error') return
    loadView({ source: { id: src.id, kind: src.kind, label: src.label } })
  }

  const confirm = () => {
    const result = buildResult(s)
    if (result) onConfirm(result)
  }

  function confirmText(): string {
    const n = sel.length
    if (s.mode === 'multiple') return n ? `Add ${plural(n, 'photograph')}` : 'Add photographs'
    if (keepsInherited(s) && inheritedLabel) return `Keep following ${inheritedLabel.toLowerCase()}`
    return props.confirmLabel ?? 'Use photograph'
  }

  /* ---------------------------- keys ----------------------------- */

  const onDialogKey = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Tab') {
      // Focus stays in the dialog: past the last control it comes back to the first.
      const d = dialog.current
      if (!d) return
      const all = Array.from(d.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (!all.length) return
      const first = all[0]
      const last = all[all.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === d)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  const onGridKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(e.key)) return
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-tile]')
    if (!from) return
    e.preventDefault()
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-tile]'))
    const i = all.indexOf(from)
    let to: HTMLElement | null = null
    if (e.key === 'Home') to = all[0]
    else if (e.key === 'End') to = all[all.length - 1]
    else if (e.key === 'ArrowLeft') to = all[i - 1] ?? null
    else if (e.key === 'ArrowRight') to = all[i + 1] ?? null
    else {
      const r = from.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const up = e.key === 'ArrowUp'
      const rows = all.filter((el) => {
        const q = el.getBoundingClientRect()
        return up ? q.bottom <= r.top + 2 : q.top >= r.bottom - 2
      })
      if (rows.length) {
        const tops = rows.map((el) => el.getBoundingClientRect().top)
        const edge = up ? Math.max(...tops) : Math.min(...tops)
        const row = rows.filter((el) => Math.abs(el.getBoundingClientRect().top - edge) < 4)
        row.sort((a, b) => {
          const ra = a.getBoundingClientRect()
          const rb = b.getBoundingClientRect()
          return Math.abs(ra.left + ra.width / 2 - cx) - Math.abs(rb.left + rb.width / 2 - cx)
        })
        to = row[0] ?? null
      }
    }
    if (to) {
      setCursor(to.getAttribute('data-tile'))
      to.focus()
      to.scrollIntoView({ block: 'nearest' })
    }
  }

  const onRailKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-src]')
    if (!from) return
    e.preventDefault()
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-src]'))
    const i = all.indexOf(from)
    const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
    const to = e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : all[i + (back ? -1 : 1)]
    to?.focus()
  }

  /* ---------------------------- pieces --------------------------- */

  const previewFailed = (url: string) => previewOf(previews, url).failed

  /** A display image that reports a failed load instead of showing a broken picture. */
  const preview = (url: string, extra: { className?: string; lazy?: boolean } = {}) => {
    const { attempt, failed } = previewOf(previews, url)
    if (failed) return null
    return (
      <img
        // A new attempt is a new element, so the browser asks again.
        key={`${url}#${attempt}`}
        src={url}
        alt=""
        loading={extra.lazy ? 'lazy' : undefined}
        decoding="async"
        className={extra.className}
        onError={() => dispatchPreview({ type: 'previewFailed', url, attempt })}
      />
    )
  }

  const retryPreview = (url: string, name: string, className?: string) => (
    <button
      type="button"
      className={`${styles.btn} ${styles.btnSm} ${className ?? ''}`}
      aria-label={`Retry the preview of ${name}`}
      onClick={() => {
        dispatchPreview({ type: 'previewRetry', url })
        announce(`Loading the preview of ${name} again.`)
      }}
    >
      Retry preview
    </button>
  )

  const railItem = (src: PickerSource) => {
    const on = src.id === s.view.source.id
    const count = sourcesReady && src.count != null ? src.count : null
    return (
      <li key={src.id}>
        <button
          type="button"
          className={styles.ritem}
          data-src={src.id}
          aria-current={on ? 'true' : undefined}
          aria-label={src.label + (count == null ? '' : `, ${plural(count, 'photograph')}`)}
          onClick={() => chooseSource(src)}
        >
          <span className={styles.th} aria-hidden="true">
            {(src.coverUrl && preview(src.coverUrl, { lazy: true })) || <i className={`${styles.glyph} ${styles['glyph-any']}`} />}
          </span>
          <span className={styles.nm}>
            {src.label}
            {src.detail && <small>{src.detail}</small>}
          </span>
          {count != null && <span className={styles.n}>{count}</span>}
        </button>
      </li>
    )
  }

  const library = s.sources.list.filter((x) => x.kind === 'all' || x.kind === 'uploads' || x.kind === 'document')
  const albums = s.sources.list.filter((x) => x.kind === 'album')
  const samples = s.sources.list.filter((x) => x.kind === 'samples')

  const rail = (
    <nav className={styles.rail} aria-label="Library and galleries">
      <div className={styles.railScroll} onKeyDown={onRailKey}>
        {s.sources.status === 'loading' && <p className={styles.railNote}>Loading your galleries…</p>}
        {s.sources.status === 'error' && (
          <div className={styles.railNote} role="alert">
            <p>Your galleries didn’t load.</p>
            <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={loadSources}>
              Try again
            </button>
          </div>
        )}
        {library.length > 0 && (
          <>
            <h3>Library</h3>
            <ul>{library.map(railItem)}</ul>
          </>
        )}
        {albums.length > 0 && (
          <>
            <h3>Galleries</h3>
            <ul>{albums.map(railItem)}</ul>
          </>
        )}
        {samples.length > 0 && (
          <>
            <h3>Samples</h3>
            <ul>{samples.map(railItem)}</ul>
          </>
        )}
      </div>
      {s.upload && adapter.upload && (
        <div className={styles.railFoot}>
          <button type="button" className={styles.btn} onClick={() => fileInput.current?.click()}>
            <Icon name="up" />
            <span>Upload</span>
          </button>
          <p>{s.upload.note}</p>
          <input
            ref={fileInput}
            type="file"
            accept={UPLOAD_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              queueFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </div>
      )}
    </nav>
  )

  const contextNote = (() => {
    if (s.role === 'decorative') {
      return (
        <>
          <b>Decorative.</b> This photograph sits behind the words and screen readers skip it, so no description is used
          here.
        </>
      )
    }
    if (s.hasInherited && inheritedLabel) {
      const who = inheritedLabel.toLowerCase()
      if (following) {
        return s.editableAlt ? (
          <>
            <b>This follows {who}</b> while it has no photograph of its own, so {who}’s photograph is highlighted. Keep it
            with a blank description to go on following. Pick another, or write a description, to give it its own choice.
          </>
        ) : (
          <>
            <b>This follows {who}</b> while it has no photograph of its own, so {who}’s photograph is highlighted. Keep it
            to go on following, or pick another to give it its own choice.
          </>
        )
      }
      return (
        <>
          <b>This has its own choice.</b> {inheritedLabel}’s photograph and description are untouched. To follow {who}{' '}
          again, use the panel.
        </>
      )
    }
    if (!s.editableAlt) {
      // A content placement that keeps a path and nothing else: still content.
      return (
        <>
          <b>The photograph’s own description is used here.</b> This place keeps no description of its own.
        </>
      )
    }
    return null
  })()

  const stateBlock = (title: string, body: string, action?: ReactNode, err = false) => (
    <div className={`${styles.state} ${err ? styles.stateErr : ''}`} role={err ? 'alert' : undefined}>
      <div className={styles.frame} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  )

  const tile = (key: string) => {
    const item = s.known[key]
    if (!item) return null
    const k = itemKey(item, s.identity)
    const idx = k ? selectedIndex(s, k) : -1
    const pressed = idx >= 0
    const why = pickBlock(item, s.identity, s.albumIds)
    const badge = badgeFor(s, key, inheritedLabel)
    const parts = [nameOf(item)]
    if (item.orientation) parts.push(item.orientation)
    if (item.originLabel) parts.push(item.originLabel.toLowerCase())
    if (item.kind === 'sample') parts.push('built-in sample')
    if (badge) parts.push(badge.text.toLowerCase())
    if (s.mode === 'multiple' && pressed) parts.push(`number ${idx + 1} in the set`)
    if (why) parts.push(why.replace(/\.$/, ''))
    const unavailable = item.readiness === 'unavailable'
    const noPreview = !unavailable && previewFailed(item.displayUrl)
    if (noPreview) parts.push('preview didn’t load')
    return (
      <li key={key} className={styles.cell} style={arStyle(item)}>
        <button
          type="button"
          className={`${styles.tile} ${unavailable ? styles.missing : ''} ${why && !unavailable ? styles.blocked : ''}`}
          data-tile={key}
          tabIndex={key === rovingKey ? 0 : -1}
          aria-pressed={pressed}
          aria-disabled={why ? true : undefined}
          aria-label={parts.join(', ')}
          onClick={() => pick(key)}
          onFocus={() => setCursor(key)}
        >
          {unavailable ? (
            <span className={styles.missingText}>
              <span>
                <b>File unavailable</b>
                {nameOf(item)}
              </span>
            </span>
          ) : noPreview ? (
            <span className={styles.noPreview}>
              <span>
                <b>Preview didn’t load</b>
                {nameOf(item)}
              </span>
            </span>
          ) : (
            preview(item.displayUrl, { lazy: true, className: item.width && item.height ? undefined : styles.contain })
          )}
          <span className={styles.mark} aria-hidden="true">
            {s.mode === 'multiple' ? (pressed ? idx + 1 : '') : <Icon name="check" />}
          </span>
          <span className={`${styles.cap} ${badge ? styles.capOn : ''}`} aria-hidden="true">
            <span className={styles.capT}>{nameOf(item)}</span>
            {badge && <span className={styles.cur}>{badge.text}</span>}
          </span>
        </button>
        {/* Beside the tile, not inside it: a button cannot hold a button. */}
        {noPreview && retryPreview(item.displayUrl, nameOf(item), styles.retryPreview)}
      </li>
    )
  }

  const jobTile = (j: PickerState['uploads'][number]) => {
    if (j.status === 'failed') {
      return (
        <li key={j.id} className={styles.cell} style={{ '--ar': '1.5' } as CSSProperties}>
          <div className={`${styles.job} ${styles.jobFailed}`} role="group" aria-label={`${j.name}, upload didn’t finish`}>
            <b>Upload didn’t finish</b>
            <span>
              {j.name}: {j.error}
            </span>
            <span className={styles.row}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSm}`}
                data-retry
                onClick={() => {
                  dispatch({ type: 'uploadRetry', id: j.id })
                  announce(`Trying ${j.name} again.`)
                }}
              >
                Try again
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSm} ${styles.btnQuiet}`}
                onClick={() => {
                  files.current.delete(j.id)
                  dispatch({ type: 'uploadDismiss', id: j.id })
                  window.setTimeout(() => dialog.current?.querySelector<HTMLElement>('[data-tile], [data-src]')?.focus(), 0)
                }}
              >
                Dismiss
              </button>
            </span>
          </div>
        </li>
      )
    }
    const label =
      j.status === 'queued' ? 'Waiting…' : j.status === 'processing' ? 'Preparing sizes…' : j.progress == null ? 'Uploading…' : `Uploading ${j.progress}%`
    return (
      <li key={j.id} className={styles.cell} style={{ '--ar': '1.5' } as CSSProperties}>
        <div className={styles.job}>
          <b>{j.name}</b>
          <span>{label}</span>
          <div
            className={styles.prog}
            role="progressbar"
            aria-label={`Uploading ${j.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={j.progress ?? undefined}
          >
            <i style={{ width: `${j.progress ?? (j.status === 'processing' ? 100 : 0)}%` }} />
          </div>
        </div>
      </li>
    )
  }

  const moreControl = (label: string, retry = false) => {
    const v = s.view
    return (
      <div className={styles.more}>
        {v.more === 'error' && (
          <p className={styles.bad} role="alert">
            More photographs didn’t load.
          </p>
        )}
        <button type="button" className={styles.btn} data-retry={retry || undefined} disabled={v.more === 'loading'} onClick={loadMore}>
          {v.more === 'loading' ? 'Loading…' : v.more === 'error' ? 'Try again' : label}
        </button>
      </div>
    )
  }

  const gridArea = (() => {
    const v = s.view
    const phase = gridPhase(s)
    if (phase === 'loading') {
      return (
        <>
          <p className={styles.srOnly}>Loading photographs…</p>
          <ul className={styles.grid} aria-busy="true" aria-label="Loading photographs">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className={`${styles.cell} ${styles.skel}`} style={{ '--ar': '1.5' } as CSSProperties} />
            ))}
          </ul>
        </>
      )
    }
    if (phase === 'error') {
      return stateBlock(
        'Your photographs didn’t load',
        'This is a problem reading the library, not an empty library. Nothing on your page has changed.',
        <button type="button" className={styles.btn} data-retry onClick={() => loadView({})}>
          Try again
        </button>,
        true
      )
    }
    const jobs = s.uploads
    if (phase === 'searching') {
      // Nothing matched in the stretch read so far, and the source has more.
      return (
        <div className={styles.state}>
          <div className={styles.frame} aria-hidden="true" />
          <h3>{v.orientation !== 'any' ? `No ${v.orientation} photographs found yet` : 'No photographs found yet'}</h3>
          <p>Only part of {v.source.label} has been looked through so far. There are more photographs to check.</p>
          {moreControl('Keep looking', true)}
        </div>
      )
    }
    if (phase === 'empty') {
      const name = v.source.label
      if (v.orientation !== 'any') {
        return stateBlock(
          `No ${v.orientation} photographs ${v.source.kind === 'all' ? 'yet' : `in ${name}`}`,
          'Shape comes from each photograph’s recorded size.',
          <button type="button" className={styles.btn} data-retry onClick={() => loadView({ orientation: 'any' })}>
            Show every shape
          </button>
        )
      }
      if (v.source.kind === 'album') {
        const all = s.sources.list.find((x) => x.kind === 'all')
        return stateBlock(
          `${name} has no photographs yet`,
          `Add photographs from the gallery’s own page.${s.upload ? ` Uploading here does not add them to ${name}.` : ''}`,
          all ? (
            <button type="button" className={styles.btn} data-retry onClick={() => chooseSource(all)}>
              Show all photographs
            </button>
          ) : undefined
        )
      }
      if (v.source.kind === 'uploads') return stateBlock('No uploads yet', 'Photographs uploaded from the editor appear here.')
      if (v.source.kind === 'document') {
        return stateBlock(
          'Nothing from pages or stories yet',
          'Photographs that are in no gallery and not in Uploads appear here: those uploaded inside a story, custom gallery covers, and older photographs used on a page.'
        )
      }
      if (v.source.kind === 'samples') return stateBlock('No samples here', 'There are no built-in sample photographs to show.')
      return stateBlock(
        'Your library is empty',
        s.upload ? 'Upload a photograph to use it here, or add photographs to a gallery first.' : 'Add photographs to a gallery first.'
      )
    }
    return (
      <>
        <ul className={styles.grid} aria-label={v.source.label + (v.orientation !== 'any' ? `, ${v.orientation}` : '')} onKeyDown={onGridKey}>
          {jobs.map(jobTile)}
          {visible.map(tile)}
        </ul>
        {v.cursor && moreControl('Show more')}
      </>
    )
  })()

  const placement = (key: string, item: PickerItem) => {
    const why = pickBlock(item, s.identity, s.albumIds)
    if (item.readiness === 'unavailable') {
      return (
        <p className={styles.bad}>
          {why}
          {s.mode === 'multiple' && selectedIndex(s, key) >= 0 ? ' Remove it from the set to continue.' : ''}
        </p>
      )
    }
    if (why) return <p className={styles.hint}>{why}</p>
    if (selectedIndex(s, key) < 0) {
      const set = s.mode === 'multiple'
      return (
        <p className={styles.hint}>
          {s.editableAlt
            ? set
              ? 'Add it to the set to give it a description for this placement.'
              : 'Choose it to give it a description for this placement.'
            : set
              ? 'Add it to the set to use it here.'
              : 'Choose it to use it here.'}
        </p>
      )
    }
    const t = s.text[key] ?? { alt: '', caption: '' }
    const sameAsInherited = s.hasInherited && !!inheritedLabel && key === s.inheritedKey
    const who = inheritedLabel?.toLowerCase() ?? ''
    // Blank is the ONE blank rule (placementAlt → isNonBlankText), not a trim:
    // words of only invisible characters are said to be blank, because they are.
    const own = placementAlt(s, key)
    const blank = !own && t.alt.length > 0 ? 'Only spaces or invisible characters, which count as blank' : 'Blank'
    let hint: { text: string; warn?: boolean }
    if (own) hint = { text: sameAsInherited || s.hasInherited ? `Used only here. ${inheritedLabel} keeps its own description.` : 'Used only here. The photograph’s own description is unchanged.' }
    else if (sameAsInherited && following) hint = { text: `${blank}, so this goes on following ${who}, including ${who}’s description.` }
    else if (item.canonicalAlt) hint = { text: `${blank}, so this placement uses the photograph’s description.` }
    else hint = { text: `${blank}, and this photograph has no description yet. Screen readers will have nothing to say here.`, warn: true }
    return (
      <>
        {sameAsInherited && (
          <div className={styles.callout}>
            <b>Same photograph as {who}.</b>{' '}
            {!s.editableAlt
              ? following
                ? `Keep it and this goes on following ${who}.`
                : `This keeps its own choice. ${inheritedLabel}’s choice is untouched.`
              : following
                ? `Leave the description blank and this goes on following ${who}. Write one and this gets its own choice, with that description here only.`
                : `This keeps its own choice and its own description. ${inheritedLabel}’s description is untouched.`}
          </div>
        )}
        {s.role === 'decorative' ? (
          <div className={styles.callout}>
            <b>Decorative.</b> Screen readers skip this image, so no description is used here. The photograph’s own
            description stays as it is everywhere else.
          </div>
        ) : !s.editableAlt ? (
          // Content that keeps no description of its own. It is NOT decorative,
          // and nothing here says what a screen reader does with it: that is the
          // page's business. Only what is true of the stored choice is said.
          <div className={styles.callout} data-canonical-only>
            <b>Uses the photograph’s own description.</b> This place keeps no description of its own, so none is written
            here. Where a description is used for it, it is the photograph’s.
            {!item.canonicalAlt && (
              <span className={`${styles.hint} ${styles.warn} ${styles.calloutLine}`}>
                This photograph has no description yet, so there is none to use.
              </span>
            )}
          </div>
        ) : (
          <div className={styles.ov}>
            <span className={styles.count} aria-hidden="true">
              {t.alt.length}/{ALT_MAX}
            </span>
            <label htmlFor={ids.alt}>Description for this placement</label>
            <textarea
              id={ids.alt}
              key={`alt-${key}`}
              value={t.alt}
              maxLength={ALT_MAX}
              rows={3}
              aria-describedby={ids.altHint}
              placeholder={
                sameAsInherited && following
                  ? `Leave blank to keep following ${who}`
                  : item.canonicalAlt
                    ? 'Leave blank to use the photograph’s description'
                    : 'Describe what this photograph shows here'
              }
              onChange={(e) => dispatch({ type: 'setText', key, field: 'alt', value: e.target.value })}
            />
            <p className={`${styles.hint} ${hint.warn ? styles.warn : ''}`} id={ids.altHint}>
              {hint.text}
            </p>
          </div>
        )}
        {s.captions && (
          <div className={styles.ov}>
            <label htmlFor={ids.cap}>Caption</label>
            <input
              id={ids.cap}
              key={`cap-${key}`}
              type="text"
              value={t.caption}
              maxLength={CAPTION_MAX}
              onChange={(e) => dispatch({ type: 'setText', key, field: 'caption', value: e.target.value })}
            />
          </div>
        )}
      </>
    )
  }

  /**
   * "Take out of Uploads", quietly, in the details — only where the adapter
   * offers it and the photograph is listed in the Uploads on screen. Two
   * steps: the first says what it does and does not do; the second asks.
   * `takeOutPrompt` decides what shows and which source it names: a request
   * names the source it was made in, not whichever is on screen now.
   */
  const takeOutControl = (key: string) => {
    if (!adapter.removeFromSource) return null
    const p = takeOutPrompt(s, key, askRemove)
    if (p.show === 'none') return null
    const from = p.label
    const pending = p.show === 'pending'
    if (p.show === 'offer') {
      return (
        <div className={styles.takeOut}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSm} ${styles.btnQuiet}`}
            onClick={() => setAskRemove({ key, sourceId: s.view.source.id })}
          >
            Take out of {from}…
          </button>
        </div>
      )
    }
    return (
      <div className={`${styles.takeOut} ${styles.callout}`} role="group" aria-label={`Take out of ${from}`}>
        <p>
          <b>Take it out of {from}?</b> Only this list changes. The photograph stays in All photographs, in this choice
          and on every page that uses it, and no file is deleted.
        </p>
        {p.show === 'error' && (
          <p className={styles.bad} role="alert">
            It is still in {from}. {p.error}
          </p>
        )}
        <span className={styles.row}>
          <button type="button" className={`${styles.btn} ${styles.btnSm}`} data-take-out disabled={pending} onClick={() => takeOut(key)}>
            {pending ? 'Taking out…' : p.show === 'error' ? 'Try again' : `Take out of ${from}`}
          </button>
          {!pending && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${styles.btnQuiet}`}
              onClick={() => {
                setAskRemove(null)
                if (s.removals[key]) dispatch({ type: 'removeDismissed', key })
              }}
            >
              Keep it
            </button>
          )}
        </span>
      </div>
    )
  }

  const drawer = (() => {
    if (!s.focus) return null
    // A selection that could not be found or checked has no item to show.
    if (!focusItem) {
      if (!focusEntry) return null
      const msg =
        focusEntry.status === 'resolving'
          ? 'Checking the current photograph…'
          : focusEntry.status === 'error'
            ? 'The current photograph couldn’t be checked.'
            : 'The current photograph can’t be found. It may have been removed.'
      return (
        <section className={styles.drawer} aria-label="Selected photograph">
          <div className={styles.drawerBar}>
            <span className={`${styles.th} ${styles.thMissing}`} aria-hidden="true" />
            <span className={`${styles.txt} ${focusEntry.status === 'resolving' ? '' : styles.bad}`}>{msg}</span>
            {focusEntry.status === 'error' && (
              <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={resolveCurrent}>
                Try again
              </button>
            )}
            {s.mode === 'multiple' && focusEntry.status !== 'resolving' && (
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnQuiet}`} onClick={() => remove(focusEntry.key)}>
                Remove from the set
              </button>
            )}
          </div>
        </section>
      )
    }
    const item = focusItem
    const facts = [item.width && item.height ? `${item.width} × ${item.height}` : null, item.originLabel].filter(Boolean).join(' · ')
    const pos = s.mode === 'multiple' ? selectedIndex(s, s.focus) : -1
    const when = dateText(item.uploadedAt)
    const shape = shapeText(item)
    const noPreview = item.readiness === 'ready' && previewFailed(item.displayUrl)
    const camera = item.readiness === 'ready' ? cameraFacts(item.camera) : []
    // Where this place keeps a description of its own, the box is in the details too: say so on the control.
    const withDescription = s.role !== 'decorative' && s.editableAlt
    return (
      <section className={styles.drawer} aria-label="Selected photograph">
        <div className={styles.drawerBar}>
          <span className={`${styles.th} ${noPreview ? styles.thNoPreview : ''}`} aria-hidden="true">
            {item.readiness === 'ready' && preview(item.displayUrl)}
          </span>
          <span className={styles.txt}>
            <b>{nameOf(item)}</b>
            {facts}
          </span>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSm} ${styles.detToggle}`}
            aria-expanded={drawerOpen}
            aria-controls={ids.det}
            data-details-toggle
            onClick={() => setDrawerOpen((o) => !o)}
          >
            <span>{drawerOpen ? 'Hide details' : withDescription ? 'Show details & description' : 'Show details'}</span>
            <Icon name="chev" />
          </button>
        </div>
        {/* Kept in the page while folded, so the toggle always names a real region. */}
        <div className={styles.drawerBody} id={ids.det} hidden={!drawerOpen}>
          <figure className={styles.fig}>
            {item.readiness !== 'ready' ? (
              <span className={styles.hint}>File unavailable</span>
            ) : noPreview ? (
              <span className={styles.figFail}>
                <span className={styles.hint}>Preview didn’t load</span>
                {retryPreview(item.displayUrl, nameOf(item))}
              </span>
            ) : (
              preview(item.displayUrl)
            )}
          </figure>
          <div>
            {s.mode === 'multiple' && (
              <p className={styles.pos}>{pos >= 0 ? `Photograph ${pos + 1} of ${sel.length} in this set` : 'Not in the set'}</p>
            )}
            <div className={styles.canon}>
              <span className={styles.lbl}>Photograph’s description</span>
              {item.canonicalAlt ? <p>{item.canonicalAlt}</p> : <p className={styles.none}>None yet</p>}
              <p className={styles.hint}>Belongs to the photograph and is shared wherever it appears. It isn’t edited here.</p>
            </div>
            {camera.length > 0 && (
              <dl className={styles.cam} aria-label="Camera settings" data-camera>
                {camera.map((c) => (
                  <div key={c.label}>
                    <dt className={styles.srOnly}>{c.label}</dt>
                    <dd>{c.text}</dd>
                  </div>
                ))}
              </dl>
            )}
            {noPreview && (
              <p className={styles.hint}>
                Only the preview is missing, often for a moment on a slow connection. The photograph’s record is fine,
                and it can still be used.
              </p>
            )}
            {(shape || when) && (
              <p className={styles.hint}>
                {[shape, when ? `uploaded ${when}` : null].filter(Boolean).join(', ')}.
              </p>
            )}
            {item.kind === 'sample' && (
              <p className={styles.sample}>A built-in sample photograph. It is not one of your uploads and has no library record.</p>
            )}
            {takeOutControl(s.focus)}
          </div>
          <div>{placement(s.focus, item)}</div>
        </div>
      </section>
    )
  })()

  const tray =
    s.mode === 'multiple' ? (
      <div className={styles.tray} role="group" aria-label="Selected photographs, in order" tabIndex={-1} data-tray>
        <p className={styles.trayCount}>
          <b>{sel.length}</b>selected, in this order
        </p>
        {sel.length ? (
          <ol>
            {sel.map((e, i) => {
              const item = s.known[e.key]
              const bad = !item || e.status !== 'ready' || item.readiness === 'unavailable'
              const name = item ? nameOf(item) : e.status === 'resolving' ? 'Checking…' : 'Photograph not found'
              const noPreview = !bad && !!item && previewFailed(item.displayUrl)
              return (
                <li key={e.key}>
                  <button
                    type="button"
                    className={`${styles.tthumb} ${bad ? styles.tthumbBad : ''} ${noPreview ? styles.tthumbNoPreview : ''}`}
                    aria-current={s.focus === e.key ? 'true' : undefined}
                    aria-label={`${i + 1}. ${name}${bad && item ? ', file unavailable' : ''}${noPreview ? ', preview didn’t load' : ''}. Show it below the photographs`}
                    onClick={() => dispatch({ type: 'focus', key: e.key })}
                  >
                    {item && item.readiness === 'ready' && preview(item.displayUrl)}
                    <span className={styles.tn} aria-hidden="true">
                      {i + 1}
                    </span>
                  </button>
                  <button type="button" className={styles.trm} data-trm={e.key} aria-label={`Remove ${name} from the set`} onClick={() => remove(e.key)}>
                    ×
                  </button>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className={styles.trayEmpty}>Pick photographs in the order they should appear.</p>
        )}
      </div>
    ) : null

  const sub = (() => {
    if (s.view.status !== 'ready') return ''
    const bits: string[] = []
    if (activeSource?.count != null) bits.push(plural(activeSource.count, 'photograph'))
    else if (s.view.source.kind === 'document') bits.push('Used on pages, in stories or as covers')
    if (activeSource?.detail) bits.push(activeSource.detail)
    return bits.join(' · ')
  })()

  return (
    <dialog
      ref={dialog}
      className={styles.root}
      aria-labelledby={ids.title}
      aria-describedby={ids.for}
      data-drop={dragging ? 'true' : undefined}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={onDialogKey}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === dialog.current
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself. Both ends
        // of it must: a selection dragged out of the description box and
        // released outside must not close the picker.
        if (e.target === dialog.current && downOnBackdrop.current) onClose()
        downOnBackdrop.current = false
      }}
      onDragEnter={(e) => {
        if (!s.upload || !adapter.upload) return
        e.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(e) => s.upload && adapter.upload && e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1
        if (dragDepth.current <= 0) setDragging(false)
      }}
      onDrop={(e) => {
        if (!s.upload || !adapter.upload) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        queueFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <div className={styles.box}>
        <header className={styles.head}>
          <div className={styles.titles}>
            <h2 id={ids.title}>{props.title ?? (mode === 'multiple' ? 'Choose photographs' : 'Choose a photograph')}</h2>
            <p className={styles.for} id={ids.for}>
              {slot.label}
            </p>
          </div>
          <button ref={closeBtn} type="button" className={styles.x} onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>

        <div className={styles.split}>
          {rail}
          <div className={styles.main}>
            <div className={styles.chead}>
              <h3>{s.view.source.label}</h3>
              {sub && <span className={styles.sub}>{sub}</span>}
              <span className={styles.spacer} />
              <div className={styles.orient} role="group" aria-label="Shape">
                {SHAPES.map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={styles.or}
                    aria-pressed={s.view.orientation === v}
                    aria-label={label}
                    title={label}
                    onClick={() => s.view.orientation !== v && loadView({ orientation: v })}
                  >
                    <i className={`${styles.glyph} ${styles[`glyph-${v}`]}`} aria-hidden="true" />
                    <span className={styles.orLbl}>{v === 'any' ? 'Any' : label}</span>
                  </button>
                ))}
              </div>
              <label className={styles.sort}>
                <span>Sort</span>
                <select value={s.view.sort} onChange={(e) => loadView({ sort: e.target.value as PickerSort })}>
                  {SORTS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {s.notice && (
              <p className={`${styles.note} ${s.notice.bad ? styles.noteBad : ''}`} role={s.notice.bad ? 'alert' : undefined}>
                <span className={styles.dot} aria-hidden="true" />
                <span>{s.notice.text}</span>
              </p>
            )}
            {contextNote && (
              <p className={`${styles.note} ${s.role === 'decorative' || !s.editableAlt ? styles.noteQuiet : ''}`}>
                <span className={styles.dot} aria-hidden="true" />
                <span>{contextNote}</span>
              </p>
            )}
            <div className={styles.scroll}>{gridArea}</div>
            {drawer}
          </div>
        </div>

        {tray}

        <footer className={styles.foot}>
          <p className={styles.route}>{s.upload?.route ?? ''}</p>
          <p className={`${styles.why} ${block?.bad ? styles.bad : ''}`} id={ids.why}>
            {block?.text ?? ''}
          </p>
          <div className={styles.btns}>
            <button type="button" className={`${styles.btn} ${styles.btnQuiet}`} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={!!block}
              aria-describedby={block ? ids.why : undefined}
              onClick={confirm}
            >
              {confirmText()}
            </button>
          </div>
        </footer>
        {dragging && <div className={styles.drop}>Drop to upload</div>}
        <div className={styles.srOnly} role="status" aria-live="polite">
          {live}
        </div>
      </div>
    </dialog>
  )
}
