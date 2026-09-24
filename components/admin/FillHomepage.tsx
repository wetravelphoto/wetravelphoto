'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addSamples } from '@/app/actions/sites'

/**
 * Offers to put the sample photographs on the homepage.
 *
 * Only ever shown when the sample gallery exists and the first screen has no
 * photograph on it — which happens on a site seeded before the homepage was
 * part of the samples. It sits in the checklist rather than on the galleries
 * page because the checklist is the first thing anybody sees, and this is
 * exactly the kind of thing nobody goes looking for.
 */
export default function FillHomepage() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  if (message) {
    return (
      <p className="admin-meta" style={{ margin: 0, padding: '0.72rem 0.95rem', lineHeight: 1.6 }}>
        {message}
      </p>
    )
  }

  return (
    <div className="start-step" style={{ cursor: 'default' }}>
      <span className="start-tick" aria-hidden />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="start-title">Put the photographs on your homepage</span>
        <span className="start-detail">
          Your sample gallery is here, but the first screen is still empty. This fills the hero,
          the intro, the about page and the contact block — and leaves anything you have already
          written exactly as it is.
        </span>
      </span>
      <button
        type="button"
        className="start-go"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await addSamples()
            setMessage(r.message)
            if (r.ok) router.refresh()
          })
        }
        style={{ background: 'none', cursor: pending ? 'wait' : 'pointer' }}
      >
        {pending ? 'Filling…' : 'Fill it in →'}
      </button>
    </div>
  )
}
