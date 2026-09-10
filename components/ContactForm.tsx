'use client'

import { useState } from 'react'
import { sendMessage } from '@/app/actions/contact'

export default function ContactForm() {
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
      <div style={{ border: '0.5px solid var(--line)', padding: '2rem', textAlign: 'center' }}>
        <p className="display" style={{ fontSize: '1.2rem', margin: '0 0 0.5rem' }}>
          Message sent
        </p>
        <p className="meta" style={{ margin: 0 }}>
          Thanks — I&apos;ll get back to you.
        </p>
      </div>
    )
  }

  const field: React.CSSProperties = {
    width: '100%',
    padding: '0.7rem',
    border: '0.5px solid var(--line)',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: '0.92rem',
    color: 'var(--ink)',
    marginBottom: '0.75rem',
  }

  return (
    <form action={handleSubmit}>
      <input type="text" name="name" placeholder="Your name" required style={field} autoComplete="name" />
      <input type="email" name="email" placeholder="Your email" required style={field} autoComplete="email" />
      <textarea name="message" placeholder="Message" required rows={6} style={{ ...field, resize: 'vertical' }} />

      {/* Honeypot — hidden from people, tempting to bots */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true" />

      {error && <p style={{ color: 'var(--ember)', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>{error}</p>}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="display"
        style={{
          padding: '0.75rem 1.75rem',
          background: 'var(--ink)',
          color: 'var(--surface)',
          border: 'none',
          fontSize: '0.8rem',
          letterSpacing: '0.1em',
          cursor: status === 'sending' ? 'wait' : 'pointer',
          opacity: status === 'sending' ? 0.6 : 1,
        }}
      >
        {status === 'sending' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}
