'use client'

import { useState } from 'react'
import { sendMessage } from '@/app/actions/contact'

export default function ContactForm({ variant = 'boxed' }: { variant?: 'boxed' | 'line' }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setStatus('sending')
    setError(null)

    const result = await sendMessage(formData)

    if (result.ok) {
      setStatus('sent')
    } else {
      setStatus('idle')
      setError(result.error ?? 'Something went wrong.')
    }
  }

  if (status === 'sent') {
    return (
      <div className="contact-sent">
        <p className="display" style={{ fontSize: '1.3rem', margin: '0 0 0.5rem' }}>
          Message sent
        </p>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
          Thanks — I&apos;ll get back to you.
        </p>
      </div>
    )
  }

  return (
    <form action={handleSubmit} className="contact-fields">
      <div className="contact-field-row">
        <input type="text" name="name" placeholder="Name" required autoComplete="name" />
        <input type="email" name="email" placeholder="Email" required autoComplete="email" />
      </div>

      <input type="text" name="subject" placeholder="Subject" autoComplete="off" />
      <textarea name="message" placeholder="Message" required rows={5} />

      {/* Hidden from people, tempting to bots */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: 'absolute', left: '-9999px' }}
        aria-hidden="true"
      />

      {error && <p className="contact-error">{error}</p>}

      <div className="contact-submit-row">
        <button type="submit" disabled={status === 'sending'}>
          <span>{status === 'sending' ? 'Sending' : 'Send inquiry'}</span>
          <svg width="20" height="10" viewBox="0 0 20 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            <path d="M0 5h18M14 1l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <span className="contact-note">Response within 48 hours.</span>
      </div>
    </form>
  )
}
