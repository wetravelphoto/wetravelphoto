'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import PhotoPicker from '@/components/canvas/PhotoPicker'
import { updateDraftPageSeo } from '@/app/actions/canvas'
import {
  DESCRIPTION_LIMIT,
  TITLE_LIMIT,
  composeTitle,
  type PageSeo,
  type ResolvedSeo,
} from '@/lib/seo'

/** Typing is saved this long after the last keystroke, like section text. */
const DEBOUNCE_MS = 450

/**
 * THE PAGE'S OWN SETTINGS — what shows when no section is selected.
 *
 * Today that is search and sharing (lib/seo.ts): the title and description a
 * search result shows, the picture a shared link shows, and whether search
 * engines should list the page at all. Every field starts empty and shows,
 * greyed, what the page will use if it stays empty — so leaving it alone is a
 * visible, reasonable choice rather than a gap.
 *
 * The two previews underneath (a search result and a shared link) follow the
 * typing on the spot; they are drawn here, not in the page, because neither
 * of them is part of the page.
 *
 * Saves are debounced into the draft like every other edit, so they publish
 * with Publish and undo with Undo.
 */
export default function PageSettings({
  resizer,
  page,
  pageLabel,
  path,
  seo,
  resolved,
  siteTitle,
  siteHost,
  publicUrl,
  onSaved,
  flushRef,
}: {
  resizer: React.ReactNode
  page: string
  pageLabel: string
  /** The page's public address, e.g. "/about". */
  path: string
  /** What is stored for this page (draft first). */
  seo: PageSeo
  /** What the page uses where nothing is stored. */
  resolved: ResolvedSeo
  siteTitle: string
  /** The site's address without the scheme, for the previews. */
  siteHost: string
  publicUrl: string
  onSaved: () => void
  flushRef?: React.MutableRefObject<(() => Promise<void>) | null>
}) {
  const [values, setValues] = useState<PageSeo>(seo)
  const [picking, setPicking] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queued = useRef<PageSeo | null>(null)
  const inflight = useRef(new Set<Promise<unknown>>())

  const send = (next: PageSeo) => {
    setError(null)
    startTransition(async () => {
      const work = updateDraftPageSeo(page, next)
      inflight.current.add(work)
      try {
        await work
        onSaved()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save that.')
      } finally {
        inflight.current.delete(work)
      }
    })
  }

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const next = queued.current
    queued.current = null
    if (next) send(next)
  }

  /** Change one value: shown at once, saved after the pause (or now). */
  const change = (patch: Partial<PageSeo>, now = false) => {
    const next = { ...values, ...patch }
    setValues(next)
    queued.current = next
    if (timer.current) clearTimeout(timer.current)
    if (now) flush()
    else timer.current = setTimeout(flush, DEBOUNCE_MS)
  }

  // Undo waits for anything typed here to be written first.
  useEffect(() => {
    if (!flushRef) return
    flushRef.current = async () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const next = queued.current
      queued.current = null
      if (next) await updateDraftPageSeo(page, next)
      await Promise.allSettled([...inflight.current])
    }
    return () => {
      flushRef.current = null
    }
  }, [flushRef, page])

  // Leaving the page (or the panel) with a keystroke still waiting: send it.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      const next = queued.current
      queued.current = null
      if (next) updateDraftPageSeo(page, next).catch(() => {})
    }
  }, [page])

  const title = values.title ?? ''
  const description = values.description ?? ''

  // What the two previews show: the typed value, or the automatic one.
  const shownTitle = title.trim() ? composeTitle(page, title.trim(), siteTitle) : resolved.auto.title
  const shownDescription = description.trim() || resolved.auto.description
  const shareTitle = title.trim() || resolved.auto.shareTitle
  const image = values.image ?? resolved.auto.image
  const imageNote = values.image
    ? 'Chosen for this page.'
    : resolved.auto.imageFrom === 'photo'
      ? 'Automatic: the first photograph on this page.'
      : resolved.auto.imageFrom === 'site'
        ? "Automatic: the homepage's share image."
        : page === 'home'
          ? 'None yet. This one is also used by any page without a photograph of its own.'
          : 'None yet. Choose one, or set one on the homepage for every page.'

  return (
    <aside className="cv-inspector" aria-label={`${pageLabel} page settings`}>
      {resizer}
      <div className="cv-insp-head">
        <div>
          <p className="cv-insp-label">{pageLabel} · Page settings</p>
          <p className="cv-insp-blurb">
            Click a section to edit it. Here: how this page appears in search results and when
            someone shares a link to it.
          </p>
        </div>
      </div>

      {error && <p className="cv-insp-error">{error}</p>}

      <div className="cv-insp-form cv-seo" onBlur={flush}>
        <p className="cv-seo-group">Search &amp; sharing</p>

        <label className="admin-field">
          <span className="cv-seo-label">
            Title
            <Count value={shownTitle} limit={TITLE_LIMIT} />
          </span>
          <input
            type="text"
            value={title}
            placeholder={resolved.auto.title}
            maxLength={120}
            onChange={(e) => change({ title: e.target.value })}
          />
          <span className="admin-meta">
            {page === 'home'
              ? 'Shown in the browser tab and as the headline of a search result.'
              : `The site's name is added after it: “… — ${siteTitle}”.`}
          </span>
        </label>

        <label className="admin-field">
          <span className="cv-seo-label">
            Description
            <Count value={shownDescription} limit={DESCRIPTION_LIMIT} />
          </span>
          <textarea
            rows={3}
            value={description}
            placeholder={resolved.auto.description}
            maxLength={320}
            onChange={(e) => change({ description: e.target.value })}
          />
          <span className="admin-meta">
            A sentence or two about the page. Search engines may use their own instead.
          </span>
        </label>

        <div className="admin-field">
          Share image
          <div className="cv-seo-image">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${publicUrl}/${image}`} alt="" />
            ) : (
              <span className="cv-seo-image-empty">No image</span>
            )}
          </div>
          <span className="admin-meta">{imageNote}</span>
          <div className="cv-seo-image-tools">
            <button type="button" className="cv-btn" onClick={() => setPicking(true)}>
              {values.image ? 'Change' : 'Choose or upload'}
            </button>
            {values.image && (
              <button
                type="button"
                className="cv-btn cv-btn-ghost"
                onClick={() => change({ image: undefined }, true)}
              >
                Use automatic
              </button>
            )}
          </div>
        </div>

        <label className="toggle-row cv-seo-toggle">
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={values.noindex === true}
              onChange={(e) => change({ noindex: e.target.checked || undefined }, true)}
            />
            <span />
          </span>
          <span>
            Hide from search engines
            <span className="admin-meta">
              {' '}
              — the page stays on the site and in the menu; it is just not listed on Google.
            </span>
          </span>
        </label>

        <p className="cv-seo-group">Preview</p>

        <div className="cv-seo-serp" aria-label="How a search result may look">
          <span className="cv-seo-serp-url">
            {siteHost}
            {path === '/' ? '' : ` › ${path.replace(/^\//, '')}`}
          </span>
          <span className="cv-seo-serp-title">{clip(shownTitle, TITLE_LIMIT)}</span>
          <span className="cv-seo-serp-desc">{clip(shownDescription, DESCRIPTION_LIMIT)}</span>
          {values.noindex && <span className="cv-seo-serp-hidden">Hidden from search engines</span>}
        </div>

        <div className="cv-seo-card" aria-label="How a shared link may look">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${publicUrl}/${image}`} alt="" />
          ) : (
            <span className="cv-seo-card-noimg" />
          )}
          <span className="cv-seo-card-text">
            <span className="cv-seo-card-host">{siteHost.toUpperCase()}</span>
            <span className="cv-seo-card-title">{shareTitle}</span>
            <span className="cv-seo-card-desc">{clip(shownDescription, 110)}</span>
          </span>
        </div>
      </div>

      <div className="cv-insp-foot">
        <span className="cv-insp-state">
          {pending ? 'Saving…' : 'Saved to the draft; goes live with Publish.'}
        </span>
      </div>

      {picking && (
        <PhotoPicker
          publicUrl={publicUrl}
          title="Share image"
          onClose={() => setPicking(false)}
          onPick={(path) => {
            setPicking(false)
            change({ image: path }, true)
          }}
        />
      )}
    </aside>
  )
}

/** A character count that turns amber past the point search engines cut. */
function Count({ value, limit }: { value: string; limit: number }) {
  return (
    <span className="cv-seo-count" data-over={value.length > limit}>
      {value.length}/{limit}
    </span>
  )
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
}
