'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addSamples, removeSamples } from '@/app/actions/sites'

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
export default function SampleNotice({ present = true }: { present?: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  // ── The samples are not here ──────────────────────────────────────────────
  // Either they were removed on purpose, or the seeding failed quietly when
  // the site was made. Offering to put them back is also how the reason for a
  // failure gets seen at all.
  if (!present) {
    return (
      <div className="admin-panel" style={{ marginBottom: '1.25rem' }}>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          <p className="admin-meta" style={{ margin: 0, lineHeight: 1.65, flex: 1, minWidth: 260 }}>
            {result
              ? result.message
              : 'This site has no photographs yet. Six samples can be added so you can see what it will look like — they are not yours, and one button takes them away again.'}
          </p>
          <button
            type="button"
            className="admin-btn admin-btn-ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await addSamples()
                setResult(r)
                if (r.ok) router.refresh()
              })
            }
            style={{ whiteSpace: 'nowrap' }}
          >
            {pending ? 'Adding…' : 'Add sample photographs'}
          </button>
        </div>
      </div>
    )
  }

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

        <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* The "put them on the homepage" offer lives in the dashboard
              checklist, where it is seen. One place for it, not two. */}
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
        </span>
      </div>
    </div>
  )
}
