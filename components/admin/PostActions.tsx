'use client'

import { useFormStatus } from 'react-dom'
import { useEffect, useState } from 'react'

/** Sticky save bar with real feedback on submit. */
export default function PostActions({
  status,
  title,
  slug,
}: {
  status: string
  title?: string
  slug?: string
}) {
  const { pending } = useFormStatus()
  const [saved, setSaved] = useState<string | null>(null)
  const [wasPending, setWasPending] = useState(false)

  useEffect(() => {
    if (pending) {
      setWasPending(true)
      setSaved(null)
    } else if (wasPending) {
      setWasPending(false)
      setSaved('Saved')
      const timer = setTimeout(() => setSaved(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [pending, wasPending])

  return (
    <div className="editor-actions">
      {title && (
        <span
          style={{
            fontFamily: 'var(--admin-font)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontSize: '0.85rem',
            marginRight: 'auto',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '40%',
          }}
        >
          {title}
        </span>
      )}

      <span className="admin-tag" data-tone={status === 'published' ? 'live' : undefined}>
        {status}
      </span>

      {status === 'published' && slug && (
        <a
          href={`/journal/${slug}`}
          target="_blank"
          rel="noopener"
          className="admin-btn admin-btn-ghost admin-btn-sm"
        >
          View ↗
        </a>
      )}

      <button type="submit" name="status" value="draft" disabled={pending} className="admin-btn admin-btn-ghost">
        Save draft
      </button>
      <button type="submit" name="status" value="published" disabled={pending} className="admin-btn">
        {status === 'published' ? 'Update' : 'Publish'}
      </button>

      {pending && (
        <span className="save-toast" data-tone="working">
          Saving…
        </span>
      )}
      {saved && <span className="save-toast">✓ {saved}</span>}
    </div>
  )
}
