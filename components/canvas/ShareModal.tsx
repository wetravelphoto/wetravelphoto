'use client'

import { useEffect, useState, useTransition } from 'react'
import { createShare, getShares, revokeShare, type ShareRow } from '@/app/actions/history'

/**
 * REVIEW LINKS — let someone without an account see the unpublished changes.
 *
 * Each link is private (a long random address), read-only, expires on its
 * own, and can be switched off here at any time. It shows the draft as it is
 * when opened, so the reviewer sees new edits after a reload. See
 * lib/drafts/review.ts for how it is checked.
 */
export default function ShareModal({ onClose }: { onClose: () => void }) {
  const [shares, setShares] = useState<ShareRow[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const load = () =>
    getShares()
      .then((r) => {
        setShares(r.shares)
        setMissing(r.missing)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the links.'))

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const linkFor = (token: string) => `${window.location.origin}/review/${token}`

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(token))
      setCopied(token)
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000)
    } catch {
      setError('Could not copy. Select the link and copy it by hand.')
    }
  }

  const create = () => {
    setError(null)
    startTransition(async () => {
      try {
        const { token } = await createShare(days, note)
        setNote('')
        await load()
        await copy(token)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create the link.')
      }
    })
  }

  const revoke = (id: string) => {
    if (!confirm('Switch this link off? Anyone who has it will no longer be able to open it.')) return
    startTransition(async () => {
      try {
        await revokeShare(id)
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not switch the link off.')
      }
    })
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="cv-modal" role="dialog" aria-modal="true" aria-label="Share a preview" onClick={onClose}>
      <div className="cv-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="cv-modal-head">
          <div>
            <h2>Share a preview</h2>
            <p className="cv-modal-sub">
              A private link to your unpublished changes, for a partner or client to look at before
              you Publish. They don&apos;t need an account and can&apos;t change anything.
            </p>
          </div>
          <button type="button" className="cv-ico" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="cv-insp-error">{error}</p>}

        <div className="cv-modal-body" data-busy={pending}>
          {missing ? (
            <p className="cv-hint">
              Review links are not set up yet. Run db/migrations/2026-09-22_versions_and_review.sql in
              Supabase.
            </p>
          ) : (
            <>
              <div className="cv-share-new">
                <input
                  type="text"
                  value={note}
                  maxLength={60}
                  placeholder="Who it's for (optional), e.g. Ana"
                  onChange={(e) => setNote(e.target.value)}
                  aria-label="Who the link is for"
                />
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Valid for">
                  <option value={3}>Valid 3 days</option>
                  <option value={7}>Valid 7 days</option>
                  <option value={14}>Valid 14 days</option>
                  <option value={30}>Valid 30 days</option>
                </select>
                <button type="button" className="cv-btn cv-btn-go" disabled={pending} onClick={create}>
                  Create link
                </button>
              </div>
              <p className="cv-pm-hint">
                The link is copied as soon as it is made. It shows your changes as they are when it is
                opened, so after more edits the reviewer just reloads.
              </p>

              <p className="cv-family-name">Active links</p>
              {shares === null && <p className="cv-hint">Loading…</p>}
              {shares && shares.length === 0 && <p className="cv-hint">No active links.</p>}
              {shares && shares.length > 0 && (
                <ul className="cv-versions">
                  {shares.map((s) => (
                    <li key={s.id} className="cv-version">
                      <span className="cv-version-text">
                        <span className="cv-version-when">{s.note || 'Preview link'}</span>
                        <span className="cv-version-note">
                          Made {date(s.createdAt)} · works until {date(s.expiresAt)}
                        </span>
                        <input className="cv-share-url" readOnly value={linkFor(s.token)} onFocus={(e) => e.target.select()} aria-label="Link" />
                      </span>
                      <span className="cv-pm-actions">
                        <button type="button" className="cv-btn" onClick={() => copy(s.token)}>
                          {copied === s.token ? 'Copied' : 'Copy link'}
                        </button>
                        <button type="button" className="cv-btn cv-btn-ghost cv-btn-bad" onClick={() => revoke(s.id)}>
                          Switch off
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
