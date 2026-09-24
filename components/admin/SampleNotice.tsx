'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { removeSamples } from '@/app/actions/sites'

/**
 * SAYS OUT LOUD THAT THESE PICTURES ARE NOT YOURS
 *
 * A new site arrives with six photographs in it so that the first screen is a
 * site rather than an outline. The failure this guards against is specific and
 * embarrassing: a photographer showing their new site to a client with
 * somebody else's work still on it.
 *
 * So the notice is loud rather than tasteful, it names whose the photographs
 * are, and the way out is one button and no confirmation dialogue — removing
 * something you were always going to remove should not require a decision.
 */
export default function SampleNotice() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (result?.ok) {
    return (
      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <p className="admin-meta" style={{ margin: 0, lineHeight: 1.6 }}>
          {result.message}
        </p>
      </div>
    )
  }

  return (
    <div
      className="admin-panel"
      style={{
        marginBottom: '1.25rem',
        borderColor: 'rgba(181, 96, 44, 0.4)',
        background: 'rgba(181, 96, 44, 0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 260, flex: 1 }}>
          <p
            style={{
              margin: '0 0 0.35rem',
              fontSize: '0.62rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--admin-accent)',
              fontWeight: 500,
            }}
          >
            Sample gallery
          </p>
          <p className="admin-meta" style={{ margin: 0, lineHeight: 1.65 }}>
            These six photographs are not yours — they are here so your site has something in it
            while you set it up, and they belong to Gonzalo. Take them away whenever you like;
            nothing else is touched.
          </p>
          {result && !result.ok && (
            <p style={{ color: '#a33224', fontSize: '0.78rem', margin: '0.7rem 0 0', lineHeight: 1.6 }}>
              {result.message}
            </p>
          )}
        </div>

        <button
          type="button"
          className="admin-btn admin-btn-ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await removeSamples()
              setResult(r)
              if (r.ok) router.refresh()
            })
          }
          style={{ whiteSpace: 'nowrap' }}
        >
          {pending ? 'Removing…' : 'Remove the samples'}
        </button>
      </div>
    </div>
  )
}
