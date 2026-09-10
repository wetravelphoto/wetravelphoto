'use client'

import { useState } from 'react'
import { subscribe } from '@/app/actions/newsletter'

export default function NewsletterForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handle(formData: FormData) {
    setStatus('sending')
    const result = await subscribe(formData)
    setMessage(result.message)
    setStatus(result.ok ? 'done' : 'idle')
  }

  if (status === 'done') {
    return (
      <p style={{ fontSize: '0.92rem', opacity: 0.85, margin: 0 }}>
        {message ?? 'Thanks — you’re on the list.'}
      </p>
    )
  }

  return (
    <form action={handle}>
      <div className="newsletter-form">
        <input type="email" name="email" placeholder="you@example.com" required aria-label="Email address" />
        <button type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Joining…' : 'Join'}
        </button>
      </div>
      {message && <p style={{ fontSize: '0.78rem', marginTop: '0.6rem', opacity: 0.8 }}>{message}</p>}
    </form>
  )
}
