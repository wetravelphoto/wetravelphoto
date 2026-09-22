'use client'

import { useState } from 'react'
import { subscribe } from '@/app/actions/newsletter'

export default function NewsletterForm({ variant = 'default' }: { variant?: 'default' | 'footer' }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handle(formData: FormData) {
    setStatus('sending')
    const result = await subscribe(formData)
    setMessage(result.message)
    setStatus(result.ok ? 'done' : 'idle')
  }

  const className = variant === 'footer' ? 'footer-signup-form' : 'newsletter-form'

  if (status === 'done') {
    return (
      <p style={{ fontSize: '0.85rem', opacity: 0.8, margin: 0 }}>
        {message ?? 'Thanks — you’re on the list.'}
      </p>
    )
  }

  return (
    <form action={handle}>
      <div className={className}>
        <input type="email" name="email" placeholder="you@example.com" required aria-label="Email address" />
        {/* Hidden from people, tempting to bots */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px' }}
        />
        <button type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? '…' : 'Join'}
        </button>
      </div>
      {message && <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.75 }}>{message}</p>}
    </form>
  )
}
