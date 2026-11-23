'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { resendInvitation } from '@/app/actions/sites'
import type { InvitationStatus } from '@/lib/invitations'

export type Invitee = { userId: string; email: string; role: string; status: InvitationStatus }

/**
 * Each person on a site, with whether they have accepted — and, while they
 * have not, Resend. Changing an invitation's address is deliberately not
 * offered: we cannot prove the old invitation is revoked without risking an
 * accepted account. The action checks for a platform admin itself.
 */
export default function SiteInvitations({ tenantId, people }: { tenantId: string; people: Invitee[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: '0.6rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
      {people.map((p) => (
        <Person key={p.userId} tenantId={tenantId} person={p} />
      ))}
    </ul>
  )
}

const LABEL: Record<InvitationStatus, string> = { accepted: 'Accepted', pending: 'Invitation pending', unknown: 'Status unknown' }

function Person({ tenantId, person }: { tenantId: string; person: Invitee }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  function resend() {
    setResult(null)
    const fd = new FormData()
    fd.set('tenant_id', tenantId)
    fd.set('user_id', person.userId)
    startTransition(async () => {
      const r = await resendInvitation(fd)
      setResult({ ok: r.ok, text: r.message })
      if (r.ok) router.refresh()
    })
  }

  return (
    <li className="admin-meta" style={{ lineHeight: 1.5 }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 0.75rem' }}>
        <span style={{ overflowWrap: 'anywhere', color: 'var(--admin-ink, inherit)' }}>{person.email}</span>
        <span
          style={{
            fontSize: '0.72rem',
            padding: '0.05rem 0.45rem',
            border: '0.5px solid var(--admin-line)',
            color: person.status === 'pending' ? '#9a5b00' : undefined,
          }}
        >
          {LABEL[person.status]}
        </span>
        {person.status === 'pending' && (
          <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" disabled={pending} onClick={resend}>
            {pending ? 'Sending…' : 'Resend invitation'}
          </button>
        )}
      </span>

      {person.status === 'pending' && (
        <span style={{ display: 'block', marginTop: '0.35rem' }}>
          Resend goes to this address. Changing an invitation&apos;s email isn&apos;t available yet.
        </span>
      )}

      {result && (
        <span style={{ display: 'block', marginTop: '0.35rem', color: result.ok ? undefined : '#b3261e' }}>{result.text}</span>
      )}
    </li>
  )
}
