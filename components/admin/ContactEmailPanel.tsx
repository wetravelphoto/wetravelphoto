'use client'

import { useState, useTransition } from 'react'
import { sendTestEmail, updateContactEmail } from '@/app/actions/site'

/**
 * Settings → Contact form messages. Where each message is emailed, with a
 * test button so the photographer can see one arrive. There is nothing else
 * to set up: the email itself is sent by the platform (lib/email.ts).
 */
export default function ContactEmailPanel({
  notify,
  address,
  publicEmail,
  emailReady,
}: {
  notify: boolean
  address: string | null
  publicEmail: string | null
  emailReady: boolean
}) {
  const [on, setOn] = useState(notify)
  const [value, setValue] = useState(address ?? '')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const run = (work: () => Promise<{ ok: boolean; message: string }>) => {
    setMessage(null)
    startTransition(async () => {
      try {
        const r = await work()
        setMessage({ ok: r.ok, text: r.message })
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' })
      }
    })
  }

  return (
    <div>
      <p className="admin-meta" style={{ margin: '0 0 0.85rem', lineHeight: 1.6 }}>
        Every message from your contact form is kept under Messages. It can also be emailed to you
        the moment it arrives. Press Reply in your inbox to answer the visitor directly.
      </p>

      {!emailReady && (
        <p className="admin-meta" style={{ margin: '0 0 0.85rem', color: '#9a5b00', lineHeight: 1.6 }}>
          Email sending is not switched on for this server yet, so messages are only kept under
          Messages for now.
        </p>
      )}

      <label className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Email me each new message
      </label>

      <label className="admin-field">
        Send them to
        <input
          type="email"
          className="admin-input"
          value={value}
          placeholder={publicEmail ?? 'you@example.com'}
          onChange={(e) => setValue(e.target.value)}
          disabled={!on}
        />
        <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
          {publicEmail
            ? `Leave empty to use your public email (${publicEmail}).`
            : 'Any inbox you check: Gmail, Outlook, your own domain.'}
        </span>
      </label>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="admin-btn"
          disabled={pending}
          onClick={() => run(() => updateContactEmail(on, value))}
        >
          Save
        </button>
        <button
          type="button"
          className="admin-btn admin-btn-ghost"
          disabled={pending || !on || !emailReady}
          onClick={() => run(() => sendTestEmail())}
        >
          Send a test email
        </button>
        {message && (
          <span className="admin-meta" style={{ color: message.ok ? undefined : '#b3261e' }}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}
