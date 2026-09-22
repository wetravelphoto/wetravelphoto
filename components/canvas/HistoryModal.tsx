'use client'

import { useEffect, useState, useTransition } from 'react'
import { getVersions, restoreVersion } from '@/app/actions/history'
import type { VersionRow } from '@/lib/drafts/versions'

/**
 * VERSION HISTORY — every Publish, newest first (lib/drafts/versions.ts).
 *
 * "Restore" puts that version into the DRAFT: the editor then shows it, and
 * nothing goes live until Publish. Undo takes a restore straight back out.
 * The newest version is what is live now, so it has nothing to restore.
 */
export default function HistoryModal({
  hasDraft,
  onClose,
  onRestored,
}: {
  hasDraft: boolean
  onClose: () => void
  onRestored: (label: string) => void
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    getVersions()
      .then((r) => {
        setVersions(r.versions)
        setMissing(r.missing)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the history.'))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

  const restore = (v: VersionRow) => {
    const warning = hasDraft
      ? 'This replaces your unpublished changes with this version. Undo brings them back. Nothing goes live until you Publish.'
      : 'This opens this version in the editor. Nothing goes live until you Publish, and Undo takes it back.'
    if (!confirm(warning)) return
    setError(null)
    startTransition(async () => {
      try {
        await restoreVersion(v.id)
        onRestored(`Restored the version from ${when(v.createdAt)}. Look it over, then Publish, or Undo.`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not restore that version.')
      }
    })
  }

  return (
    <div className="cv-modal" role="dialog" aria-modal="true" aria-label="Version history" onClick={onClose}>
      <div className="cv-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="cv-modal-head">
          <div>
            <h2>Version history</h2>
            <p className="cv-modal-sub">
              The site as it was after each Publish. Restoring one opens it in the editor as your
              draft; the live site does not change until you Publish.
            </p>
          </div>
          <button type="button" className="cv-ico" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="cv-insp-error">{error}</p>}

        <div className="cv-modal-body" data-busy={pending}>
          {versions === null && !error && <p className="cv-hint">Loading…</p>}
          {missing && (
            <p className="cv-hint">
              History is not set up yet. Run db/migrations/2026-09-22_versions_and_review.sql in
              Supabase.
            </p>
          )}
          {versions && versions.length === 0 && !missing && (
            <p className="cv-hint">
              Nothing yet. Each time you Publish, the site is kept here, starting with how it was
              before your first publish.
            </p>
          )}
          {versions && versions.length > 0 && (
            <ul className="cv-versions">
              {versions.map((v, i) => (
                <li key={v.id} className="cv-version" data-live={i === 0}>
                  <span className="cv-version-text">
                    <span className="cv-version-when">{when(v.createdAt)}</span>
                    <span className="cv-version-note">
                      {v.kind === 'baseline' ? 'Starting point. ' : ''}
                      {v.note}
                    </span>
                  </span>
                  {i === 0 ? (
                    <span className="cv-pm-tag">Live now</span>
                  ) : (
                    <button type="button" className="cv-btn cv-btn-ghost" disabled={pending} onClick={() => restore(v)}>
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
