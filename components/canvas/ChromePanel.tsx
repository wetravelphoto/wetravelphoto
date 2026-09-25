'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { updateDraftChrome } from '@/app/actions/canvas'
import { uploadChromeLogo } from '@/app/actions/branding'
import {
  CHROME_FIELDS,
  CHROME_LIVE,
  FOOTER_LAYOUTS,
  HEADER_LAYOUTS,
  footerFontVars,
  navFontVars,
  type ChromeKey,
  type Part,
} from '@/lib/chrome'
import { FONT_NAMES } from '@/lib/styles/tokens'
import { fontHref } from '@/lib/fonts'
import { imageSrc } from '@/lib/images'

/* eslint-disable @next/next/no-img-element */

/** Sliders and menus: a gesture, saved when it pauses. Text waits a little longer. */
const GESTURE_MS = 250
const TYPING_MS = 450

type Values = Record<ChromeKey, string | number | boolean | null>

export type ChromeLiveMessage = {
  part: Part
  vars?: Record<string, string | null>
  attr?: string
  value?: string
  fonts?: string[]
}

/**
 * THE HEADER OR THE FOOTER, in the right-hand panel.
 *
 * Opened by clicking either one in the preview, or its row at the top or
 * bottom of the section list. Every slider and menu repaints the page as it
 * moves (the standing rule), through the same custom properties and
 * attributes the header and footer are drawn with (CHROME_LIVE in
 * lib/chrome.ts). The save follows on a short pause, into the draft.
 *
 * Sizes are set separately for desktop and phone. The Desktop/Phone switch
 * changes which one the sliders hold, and puts the preview in that width, so
 * the size being set is the size being looked at.
 */
export default function ChromePanel({
  resizer,
  part,
  values: stored,
  publicUrl,
  siteTitle,
  ownerName,
  device,
  onDevice,
  onLive,
  onSettled,
  onSaved,
  onEditMenu,
  onClose,
  flushRef,
}: {
  resizer: React.ReactNode
  part: Part
  values: Values
  publicUrl: string
  siteTitle: string
  ownerName: string | null
  device: 'desktop' | 'tablet' | 'phone'
  onDevice: (device: 'desktop' | 'phone') => void
  onLive: (message: ChromeLiveMessage) => void
  onSettled: (part: Part) => void
  onSaved: () => void
  onEditMenu: () => void
  onClose: () => void
  flushRef?: React.MutableRefObject<(() => Promise<void>) | null>
}) {
  // Held locally so a slider follows the hand; re-synced when the stored
  // values change underneath (a refresh after Undo, another tab).
  const signature = JSON.stringify(stored)
  const [values, setValues] = useState<Values>(stored)
  const [seen, setSeen] = useState(signature)
  if (signature !== seen) {
    setSeen(signature)
    setValues(stored)
  }

  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queued = useRef<Partial<Values>>({})
  const inflight = useRef(new Set<Promise<unknown>>())

  const phone = device === 'phone'

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const changes = queued.current
    queued.current = {}
    if (Object.keys(changes).length === 0) return

    setError(null)
    startTransition(async () => {
      const work = updateDraftChrome(changes)
      inflight.current.add(work)
      try {
        await work
        onSaved()
        if (Object.keys(queued.current).length === 0) onSettled(part)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that.')
      } finally {
        inflight.current.delete(work)
      }
    })
  }

  // Undo waits for anything still on its way.
  useEffect(() => {
    if (!flushRef) return
    flushRef.current = async () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const changes = queued.current
      queued.current = {}
      if (Object.keys(changes).length) await updateDraftChrome(changes)
      await Promise.allSettled([...inflight.current])
    }
    return () => {
      flushRef.current = null
    }
  }, [flushRef])

  // Closing the panel with a change still waiting: send it.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      const changes = queued.current
      queued.current = {}
      if (Object.keys(changes).length) updateDraftChrome(changes).catch(() => {})
    }
  }, [])

  /** One value: shown at once, painted on the page if it can be, saved after a pause. */
  const set = (key: ChromeKey, value: string | number | boolean | null, wait = GESTURE_MS) => {
    setValues((v) => ({ ...v, [key]: value }))

    const live = CHROME_LIVE[key]
    if (live && value !== null) {
      if ('var' in live) onLive({ part, vars: { [live.var]: `${value}${live.unit ?? ''}` } })
      else onLive({ part, attr: live.attr, value: String(value) })
    }
    if (key === 'header_nav_font' && typeof value === 'string') {
      onLive({ part, vars: navFontVars(value), fonts: [fontHref(value)] })
    }
    if (key === 'footer_font' && typeof value === 'string') {
      onLive({ part, vars: footerFontVars(value), fonts: [fontHref(value)] })
    }

    queued.current = { ...queued.current, [key]: value }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, wait)
  }

  const num = (key: ChromeKey, fallback: number) => {
    const v = values[key]
    return typeof v === 'number' ? v : fallback
  }
  const str = (key: ChromeKey) => (typeof values[key] === 'string' ? (values[key] as string) : '')

  /**
   * A size slider that holds the desktop or the phone value, per the switch.
   * A plain function, not a component: a component defined in here would be a
   * new type on every render, and React would rebuild the slider under the
   * pointer mid-drag.
   */
  const size = (
    label: string,
    desktop: ChromeKey,
    mobile: ChromeKey,
    fallback: [number, number],
    unit: 'px' | '×'
  ) => {
    const key = phone ? mobile : desktop
    const spec = CHROME_FIELDS[key] as { min: number; max: number }
    const value = num(key, phone ? fallback[1] : fallback[0])
    return (
      <label className="cv-slider">
        <span className="cv-slider-head">
          <span>
            {label} · {phone ? 'phone' : 'desktop'}
          </span>
          <span className="cv-slider-value">
            {unit === 'px' ? `${value}px` : `${value.toFixed(2)}×`}
          </span>
        </span>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={unit === 'px' ? 1 : 0.05}
          value={value}
          onChange={(e) => set(key, Number(e.target.value))}
        />
      </label>
    )
  }

  const header = part === 'header'
  const year = new Date().getFullYear()

  return (
    <aside className="cv-inspector" aria-label={header ? 'Header settings' : 'Footer settings'}>
      {resizer}
      <div className="cv-insp-head">
        <div>
          <p className="cv-insp-label">{header ? 'Header' : 'Footer'}</p>
          <p className="cv-insp-blurb">
            {header
              ? 'The bar at the top of every page: your logo and the menu.'
              : 'The bottom of every page: logo, links, newsletter and copyright.'}
          </p>
        </div>
        <button type="button" className="cv-ico" onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </div>

      {error && <p className="cv-insp-error">{error}</p>}

      <div className="cv-insp-form cv-seo" onBlur={flush}>
        <div className="cv-chrome-devices" role="group" aria-label="Sizes for">
          {(['desktop', 'phone'] as const).map((d) => (
            <button
              key={d}
              type="button"
              className="cv-chrome-device"
              data-on={phone ? d === 'phone' : d === 'desktop'}
              onClick={() => onDevice(d)}
            >
              {d === 'desktop' ? 'Desktop sizes' : 'Phone sizes'}
            </button>
          ))}
        </div>

        <ChromeLogo
          slot={part}
          path={header ? (values.logo_header_path as string | null) : (values.logo_footer_path as string | null)}
          publicUrl={publicUrl}
          onChange={(path) => set(header ? 'logo_header_path' : 'logo_footer_path', path, 0)}
        />

        {header ? (
          <>
            {size('Logo height', 'logo_header_height', 'logo_header_height_mobile', [34, 26], 'px')}

            <label className="admin-field">
              Layout
              <select value={str('header_align') || 'split'} onChange={(e) => set('header_align', e.target.value)}>
                {HEADER_LAYOUTS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              Menu typeface
              <select value={str('header_nav_font') || 'Oswald'} onChange={(e) => set('header_nav_font', e.target.value)}>
                {FONT_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            {size('Menu size', 'header_nav_scale', 'header_nav_scale_mobile', [1, 1], '×')}

            <div className="admin-field">
              Menu
              <button type="button" className="cv-btn" onClick={onEditMenu} style={{ alignSelf: 'flex-start' }}>
                Edit pages &amp; menu…
              </button>
              <span className="admin-meta">Which pages and links are in the menu, in what order.</span>
            </div>
          </>
        ) : (
          <>
            {size('Logo height', 'logo_footer_height', 'logo_footer_height_mobile', [130, 90], 'px')}

            <label className="admin-field">
              Layout
              <select value={str('footer_align') || 'left'} onChange={(e) => set('footer_align', e.target.value)}>
                {FOOTER_LAYOUTS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-field">
              Typeface
              <select value={str('footer_font') || 'Karla'} onChange={(e) => set('footer_font', e.target.value)}>
                {FONT_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            {size('Text size', 'footer_scale', 'footer_scale_mobile', [1, 1], '×')}

            <label className="admin-field">
              Copyright line
              <input
                type="text"
                value={str('footer_copy')}
                maxLength={200}
                placeholder={`© ${year} ${ownerName || siteTitle}. All photographs are my own.`}
                onChange={(e) => set('footer_copy', e.target.value, TYPING_MS)}
              />
              <span className="admin-meta">Leave empty to use the line shown in grey.</span>
            </label>

            <p className="cv-seo-group">Newsletter</p>

            <label className="toggle-row cv-seo-toggle">
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={values.show_newsletter !== false}
                  onChange={(e) => set('show_newsletter', e.target.checked, 0)}
                />
                <span />
              </span>
              <span>Show the signup block</span>
            </label>

            {values.show_newsletter !== false && (
              <>
                <label className="admin-field">
                  Heading
                  <input
                    type="text"
                    value={str('newsletter_heading')}
                    maxLength={80}
                    placeholder="Field notes by email"
                    onChange={(e) => set('newsletter_heading', e.target.value, TYPING_MS)}
                  />
                </label>
                <label className="admin-field">
                  Text
                  <textarea
                    rows={2}
                    value={str('newsletter_body')}
                    maxLength={240}
                    placeholder="An occasional note when new work goes up."
                    onChange={(e) => set('newsletter_body', e.target.value, TYPING_MS)}
                  />
                </label>
              </>
            )}
          </>
        )}
      </div>

      <div className="cv-insp-foot">
        <span className="cv-insp-state">
          {pending ? 'Saving…' : 'On every page. Saved to the draft; goes live with Publish.'}
        </span>
      </div>
    </aside>
  )
}

/**
 * The header or footer logo: upload, replace, or go back to the built-in one.
 * Uploading stores the file and hands back its key, which is saved into the
 * draft like any other value — the live site keeps its logo until Publish.
 */
function ChromeLogo({
  slot,
  path,
  publicUrl,
  onChange,
}: {
  slot: Part
  path: string | null
  publicUrl: string
  onChange: (path: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const upload = async (chosen: File | undefined) => {
    if (!chosen) return
    setBusy(true)
    setMessage(null)
    const data = new FormData()
    data.append('slot', slot)
    data.append('file', chosen)
    try {
      const result = await uploadChromeLogo(data)
      if (result.ok) onChange(result.path)
      else setMessage(result.message)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not upload that file.')
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  return (
    <div className="admin-field">
      Logo
      <div className="cv-mark-preview" data-tone={slot} data-empty={!path}>
        {path ? (
          <img src={imageSrc(publicUrl, path)} alt="" />
        ) : (
          <span className="cv-mark-none">The logo that came with your site</span>
        )}
      </div>
      <div className="cv-mark-actions">
        <button type="button" className="cv-btn cv-btn-ghost" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? 'Uploading…' : path ? 'Replace…' : 'Upload your own…'}
        </button>
        {path && (
          <button type="button" className="cv-btn cv-btn-ghost" disabled={busy} onClick={() => onChange(null)}>
            Use the built-in logo
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept="image/svg+xml,image/png,image/webp,image/jpeg"
          hidden
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>
      <span className="admin-meta">SVG, PNG, WebP or JPEG, up to 2 MB. A transparent background works best.</span>
      {message && <span className="cv-insp-error">{message}</span>}
    </div>
  )
}
