'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { applyLook, captureLook, revertTo, takeUpdate } from '@/app/actions/templates'

export type LookCard = {
  slug: string
  name: string
  blurb: string | null
  version: number
  tier: string | null
  origin: string
  isCurrent: boolean
}

export type HistoryCard = {
  id: string
  action: 'apply' | 'update' | 'revert'
  name: string | null
  version: number | null
  createdAt: string
  note: string | null
}

export type UpdateOffer = {
  fromVersion: number
  toVersion: number
  changes: string[]
}

const ACTION_LABEL: Record<string, string> = {
  apply: 'Changed look',
  update: 'Took an update',
  revert: 'Undid a change',
}

export default function DesignPanel({
  looks,
  current,
  update,
  history,
}: {
  looks: LookCard[]
  current: { name: string; slug: string; version: number } | null
  update: UpdateOffer | null
  history: HistoryCard[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)

  const run = (work: () => Promise<unknown>, said?: string) => {
    setError(null)
    setNote(null)
    startTransition(async () => {
      try {
        await work()
        if (said) setNote(said)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.')
      }
    })
  }

  return (
    <div className="look-wrap" data-busy={pending}>
      {error && <p className="look-error">{error}</p>}
      {note && <p className="look-note">{note}</p>}

      {/* ── An update, waiting ─────────────────────────────────────────── */}
      {update && current && (
        <section className="look-update">
          <div>
            <p className="look-update-head">
              {current.name} version {update.toVersion} is available
            </p>
            <p className="admin-meta" style={{ margin: '0.3rem 0 0.7rem' }}>
              You are on version {update.fromVersion}. Nothing changes until you say so.
            </p>
            <ul className="look-changes">
              {update.changes.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn-sm"
            disabled={pending}
            onClick={() => run(() => takeUpdate(), 'Updated. The previous version is in the history below.')}
          >
            Take the update
          </button>
        </section>
      )}

      {/* ── The looks ──────────────────────────────────────────────────── */}
      <section>
        <div className="look-section-head">
          <h2 className="look-h2">Looks</h2>
          <p className="admin-meta">
            Your photographs, writing and prices stay exactly where they are. Only the design
            changes, and every change can be undone.
          </p>
        </div>

        <div className="look-grid">
          {looks.map((look) => (
            <div key={look.slug} className="look-card" data-current={look.isCurrent}>
              <div className="look-card-top">
                <span className="look-card-name">{look.name}</span>
                {look.isCurrent && <span className="look-chip">In use</span>}
              </div>
              {look.blurb && <p className="look-card-blurb">{look.blurb}</p>}
              <p className="look-card-meta">
                Version {look.version}
                {look.origin === 'tenant' && ' · yours'}
                {/* A tier is declared on the row but gates nothing today. */}
                {look.tier && ` · ${look.tier}`}
              </p>

              {!look.isCurrent && (
                <button
                  type="button"
                  className="admin-btn admin-btn-sm admin-btn-ghost"
                  disabled={pending}
                  onClick={() => {
                    if (
                      confirm(
                        `Switch to ${look.name}? Your photographs and writing stay; the design changes. You can undo it afterwards.`
                      )
                    ) {
                      run(
                        () => applyLook(look.slug),
                        `Now using ${look.name}. Undo it from the history below if it is not right.`
                      )
                    }
                  }}
                >
                  Use this look
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Capture ────────────────────────────────────────────────────── */}
      <section className="look-capture">
        {capturing ? (
          <form
            action={(formData) => run(() => captureLook(formData), 'Saved as a draft look.')}
            className="look-capture-form"
          >
            <p className="look-h3">Save this design as a look</p>
            <p className="admin-meta" style={{ margin: '0 0 0.8rem', lineHeight: 1.6 }}>
              Takes the section order, the switches and the typography — not your words or
              photographs. Saved as a draft until you publish it.
            </p>
            <label className="admin-field">
              Name
              <input type="text" name="name" placeholder="Salt" required />
            </label>
            <label className="admin-field">
              One line about it
              <input
                type="text"
                name="blurb"
                placeholder="One photograph filling the screen, type set hard into the corner."
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
              <button type="submit" className="admin-btn admin-btn-sm" disabled={pending}>
                Save the look
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-sm admin-btn-ghost"
                onClick={() => setCapturing(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="look-capture-open" onClick={() => setCapturing(true)}>
            + Save this design as a look
          </button>
        )}
      </section>

      {/* ── The way back ───────────────────────────────────────────────── */}
      <section>
        <div className="look-section-head">
          <h2 className="look-h2">History</h2>
          <p className="admin-meta">
            Every design change keeps the page as it was beforehand. Undoing is a restore, not a
            guess — and an undo can itself be undone.
          </p>
        </div>

        {history.length === 0 ? (
          <p className="admin-meta">Nothing yet. This fills up the first time you change a look.</p>
        ) : (
          <ol className="look-history">
            {history.map((row) => (
              <li key={row.id}>
                <div>
                  <span className="look-history-what">
                    {ACTION_LABEL[row.action] ?? row.action}
                    {row.name && ` — ${row.name}`}
                    {row.version ? ` v${row.version}` : ''}
                  </span>
                  <span className="look-history-when">
                    {new Date(row.createdAt).toLocaleString()}
                    {row.note && ` · ${row.note}`}
                  </span>
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn-sm admin-btn-ghost"
                  disabled={pending}
                  onClick={() => {
                    if (confirm('Put the page back exactly as it was before this change?')) {
                      run(() => revertTo(row.id), 'Restored.')
                    }
                  }}
                >
                  Undo
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
