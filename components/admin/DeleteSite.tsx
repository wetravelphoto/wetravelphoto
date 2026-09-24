'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteSite } from '@/app/actions/sites'

/**
 * Deleting a site, which nothing can undo.
 *
 * The confirmation is the address, typed. Not "are you sure": a dialogue
 * nobody reads is worse than no dialogue, because it turns a mistake into a
 * mistake somebody has approved. Typing `ana.lensgrid.co` cannot happen by
 * accident, and the act of typing it is also the act of reading which site
 * this is.
 *
 * Closed by default, so the list of sites is a list rather than a row of
 * loaded guns.
 *
 * LAYOUT — the part that went wrong once and is worth stating:
 * both states are BLOCKS occupying the same place in the list item, one
 * under the site's name and address. Closed, the button is pushed to the
 * right edge by its own row; open, the form fills that row. Neither is ever
 * a child of the "1 person" cell, which is `white-space: nowrap` — a
 * width:100% form in there widened the cell past the panel and the whole
 * confirmation escaped the card.
 */
export default function DeleteSite({ tenantId, host }: { tenantId: string; host: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  if (!open) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="admin-btn admin-btn-sm admin-btn-danger"
        >
          Delete
        </button>
      </div>
    )
  }

  return (
    <form
      action={(formData) => {
        setError('')
        startTransition(async () => {
          const r = await deleteSite(formData)
          if (r.ok) {
            setOpen(false)
            setTyped('')
            router.refresh()
          } else {
            setError(r.message)
          }
        })
      }}
      style={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        marginTop: '0.75rem',
        padding: '0.85rem 0.9rem',
        borderRadius: 10,
        border: '0.5px solid rgba(163, 50, 36, 0.35)',
        background: 'rgba(163, 50, 36, 0.04)',
        boxSizing: 'border-box',
      }}
    >
      <input type="hidden" name="tenant_id" value={tenantId} />

      <p
        className="admin-meta"
        style={{ margin: '0 0 0.6rem', lineHeight: 1.65, overflowWrap: 'anywhere' }}
      >
        This removes the site, its galleries, its photographs, its stored files and the accounts
        that sign in to it. It cannot be undone. Type <strong>{host}</strong> to confirm.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', minWidth: 0 }}>
        <input
          type="text"
          name="confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={host}
          autoComplete="off"
          className="admin-input"
          // flexBasis rather than minWidth: the field may shrink below its
          // preferred size in a narrow window instead of forcing the row wider
          // than the panel.
          style={{ flex: '1 1 220px', minWidth: 0, marginTop: 0, boxSizing: 'border-box' }}
        />
        <button
          type="submit"
          className="admin-btn admin-btn-danger"
          disabled={pending || typed.trim().toLowerCase() !== host.toLowerCase()}
        >
          {pending ? 'Deleting…' : 'Delete this site'}
        </button>
        <button
          type="button"
          className="admin-btn admin-btn-ghost"
          onClick={() => {
            setOpen(false)
            setTyped('')
            setError('')
          }}
        >
          Cancel
        </button>
      </div>

      {error && (
        <p style={{ color: '#a33224', fontSize: '0.78rem', margin: '0.7rem 0 0', lineHeight: 1.6 }}>
          {error}
        </p>
      )}
    </form>
  )
}
