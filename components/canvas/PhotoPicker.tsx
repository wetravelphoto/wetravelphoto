'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { imageSrc } from '@/lib/images'
import {
  forgetSiteImage,
  listPickerImages,
  listPickerSources,
  registerSiteImage,
  type PickerImage,
  type PickerSource,
} from '@/app/actions/images'

/* eslint-disable @next/next/no-img-element */

/**
 * THE EDITOR'S PHOTO PICKER
 * ═════════════════════════
 *
 * Choose a photograph, or add one without leaving the page you are building.
 * Before this, a picture had to be uploaded into a gallery in Admin first —
 * which meant leaving the editor, and which put pictures that were never meant
 * to be seen as work (an About portrait, a texture) into a public gallery.
 *
 * Two sources, and the order says which is which: **Uploads** — everything
 * added from here, for the site itself — then each gallery, so the public work
 * can be reused without being duplicated.
 *
 * **Files go straight to R2** with a short-lived signed URL, so a
 * full-resolution photograph is not capped by the request size limit the way a
 * server upload would be. Only after the file has landed does the browser ask
 * the server to register it, and that is where the key is checked against this
 * site's own prefix.
 *
 * **Uploading is not publishing.** Registering returns a path; the caller
 * writes it into the draft like any other setting, so the photograph reaches
 * the live site on Publish and a Discard leaves nothing but an unused file.
 *
 * Drawn in the editor's own `--cv-*` chrome. The old picker was the admin's,
 * whose stylesheet the editor does not load, so in here it had no modal
 * backdrop and no styled controls at all.
 */

/** What the signed-upload route accepts (app/api/upload-url/route.ts). */
const ACCEPT = 'image/jpeg,image/png,image/webp,image/tiff,image/avif'
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/avif']
const MAX_BYTES = 60 * 1024 * 1024

type Progress = { done: number; total: number } | null

export default function PhotoPicker({
  publicUrl,
  title = 'Choose a photograph',
  onPick,
  onClose,
}: {
  publicUrl: string
  title?: string
  onPick: (path: string) => void
  onClose: () => void
}) {
  const [sources, setSources] = useState<PickerSource[]>([])
  const [source, setSource] = useState('uploads')
  /**
   * What came back, and which source it came back for. Held together rather
   * than as two pieces of state so that switching source shows "Looking…" on
   * the very next render — with a separate flag, the old source's photographs
   * would flash under the new tab's name first.
   */
  const [loaded, setLoaded] = useState<{ source: string; rows: PickerImage[] } | null>(null)
  const images = loaded?.source === source ? loaded.rows : null
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress>(null)
  /** Counts nested dragenter/dragleave, which fire for every child element. */
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let live = true
    listPickerSources()
      .then((rows) => live && setSources(rows))
      .catch(() => live && setError('Could not read your galleries.'))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    let live = true
    listPickerImages(source)
      .then((rows) => live && setLoaded({ source, rows }))
      .catch(() => {
        if (live) {
          setLoaded({ source, rows: [] })
          setError('Could not read those photographs.')
        }
      })
    return () => {
      live = false
    }
  }, [source])

  /**
   * Uploads whatever was chosen or dropped, one at a time so a slow connection
   * is not asked to push five originals at once.
   *
   * One file is almost always "I want this one": it is chosen straight away.
   * Several is a stock-up, so they are added to Uploads and left to pick from.
   */
  const upload = useCallback(
    async (chosen: File[]) => {
      const files = chosen.filter((f) => f.size > 0)
      if (files.length === 0) return

      const wrong = files.find((f) => !TYPES.includes(f.type))
      if (wrong) {
        setError(
          `${wrong.name || 'That file'} is not a kind of photograph this can read. Use JPEG, PNG, WebP, TIFF or AVIF — a phone's HEIC has to be exported first.`
        )
        return
      }
      const big = files.find((f) => f.size > MAX_BYTES)
      if (big) {
        setError(`${big.name || 'That file'} is over 60 MB. Export it a little smaller and try again.`)
        return
      }

      setError(null)
      setProgress({ done: 0, total: files.length })

      const added: PickerImage[] = []
      try {
        for (const [i, f] of files.entries()) {
          setProgress({ done: i, total: files.length })

          const signedResponse = await fetch('/api/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: 'site', contentType: f.type }),
          })
          const signed = await signedResponse.json()
          if (!signedResponse.ok) throw new Error(signed.error ?? 'Could not start the upload.')

          const put = await fetch(signed.url, {
            method: 'PUT',
            headers: { 'Content-Type': f.type },
            body: f,
          })
          if (!put.ok) throw new Error(`Storage would not take the file (${put.status}).`)

          const result = await registerSiteImage(signed.key, signed.base, f.name)
          if (!result.ok) throw new Error(result.message)

          added.push({ id: result.id ?? '', path: result.path, caption: f.name })
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The upload did not finish.')
      } finally {
        setProgress(null)
        if (file.current) file.current.value = ''
      }

      if (added.length === 0) return

      // Whatever happened, show what did arrive. Switching to Uploads first,
      // since that is where they now live.
      setSource('uploads')
      setLoaded((prev) => ({
        source: 'uploads',
        rows: [...added, ...(prev?.source === 'uploads' ? prev.rows : [])],
      }))

      if (added.length === 1 && files.length === 1) onPick(added[0].path)
    },
    [onPick]
  )

  const forget = (image: PickerImage) => {
    if (!confirm(`Take ${image.caption || 'this photograph'} out of Uploads? Pages already using it keep it.`)) return
    setLoaded((prev) => (prev ? { ...prev, rows: prev.rows.filter((i) => i.id !== image.id) } : prev))
    forgetSiteImage(image.id).then((r) => {
      if (!r.ok) setError(r.message)
    })
  }

  const busy = progress !== null

  return (
    <div className="cv-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        className="cv-modal-box cv-pick"
        data-drop={dragging ? 'true' : undefined}
        onClick={(e) => e.stopPropagation()}
        onDragEnter={(e) => {
          e.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current -= 1
          if (dragDepth.current <= 0) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          void upload(Array.from(e.dataTransfer.files))
        }}
      >
        <div className="cv-modal-head">
          <div>
            <h2>{title}</h2>
            <p className="cv-modal-sub">
              Drop a photograph anywhere in this window to add it, or choose one you have already
              used.
            </p>
          </div>
          <button type="button" className="cv-ico" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="cv-pick-bar">
          <div className="cv-pick-sources" role="tablist" aria-label="Where to choose from">
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={source === s.id}
                className="cv-pick-source"
                data-on={source === s.id ? 'true' : undefined}
                onClick={() => setSource(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <button type="button" className="cv-btn" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? `Uploading ${progress.done + 1} of ${progress.total}…` : 'Upload a photograph'}
          </button>
          <input
            ref={file}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => void upload(Array.from(e.target.files ?? []))}
          />
        </div>

        {error && (
          <p className="cv-pick-error" role="alert">
            {error}
          </p>
        )}

        <div className="cv-modal-body">
          {images === null ? (
            <p className="cv-pick-note">Looking…</p>
          ) : images.length === 0 ? (
            <p className="cv-pick-note">
              {source === 'uploads'
                ? 'Nothing here yet. Drop a photograph into this window, or press Upload above — it stays here for next time.'
                : 'This gallery has no photographs yet.'}
            </p>
          ) : (
            <div className="cv-pick-grid">
              {images.map((image) => (
                <div key={image.id || image.path} className="cv-pick-cell">
                  <button
                    type="button"
                    className="cv-pick-photo"
                    onClick={() => onPick(image.path)}
                    title={image.caption ?? undefined}
                  >
                    <img src={imageSrc(publicUrl, image.path)} alt={image.caption ?? ''} loading="lazy" />
                  </button>
                  {source === 'uploads' && image.id && (
                    <button
                      type="button"
                      className="cv-pick-forget"
                      onClick={() => forget(image)}
                      aria-label={`Take ${image.caption || 'this photograph'} out of Uploads`}
                      title="Take out of Uploads"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {dragging && <div className="cv-pick-drop">Drop to add</div>}
      </div>
    </div>
  )
}
