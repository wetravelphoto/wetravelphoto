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

  const line = variant === 'line'

  if (status === 'sent') {
    return (
      <div className={line ? 'contact-sent' : ''} style={line ? undefined : boxedSent}>
        <p className="display" style={{ fontSize: '1.3rem', margin: '0 0 0.5rem' }}>
          Message sent
        </p>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
          Thanks — I&apos;ll get back to you.
        </p>
      </div>
    )
  }

  const boxedField: React.CSSProperties = {
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
    <form action={handleSubmit} className={line ? 'contact-form-line' : ''}>
      <input
        type="text"
        name="name"
        placeholder="Your name"
        required
        style={line ? undefined : boxedField}
        autoComplete="name"
      />
      <input
        type="email"
        name="email"
        placeholder="Your email"
        required
        style={line ? undefined : boxedField}
        autoComplete="email"
      />
      <textarea
        name="message"
        placeholder="Tell me about it"
        required
        rows={line ? 3 : 6}
        style={line ? undefined : { ...boxedField, resize: 'vertical' }}
      />

      {/* Hidden from people, tempting to bots */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: 'absolute', left: '-9999px' }}
        aria-hidden="true"
      />

      {error && <p style={{ color: 'var(--ember)', fontSize: '0.82rem', margin: '0.75rem 0 0' }}>{error}</p>}

      <button
        type="submit"
        disabled={status === 'sending'}
        className={line ? undefined : 'display'}
        style={
          line
            ? undefined
            : {
                padding: '0.75rem 1.75rem',
                background: 'var(--ink)',
                color: 'var(--surface)',
                border: 'none',
                fontSize: '0.8rem',
                letterSpacing: '0.1em',
                cursor: 'pointer',
              }
        }
      >
        {status === 'sending' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}

const boxedSent: React.CSSProperties = {
  border: '0.5px solid var(--line)',
  padding: '2rem',
  textAlign: 'center',
}
