'use client'

import { useFormStatus } from 'react-dom'
import { useEffect, useState } from 'react'

/**
 * Sticky action bar with real feedback. Must be rendered inside the <form>
 * it belongs to — useFormStatus reads the enclosing form's state.
 */
export default function SaveBar({
  label = 'Save',
  title,
  secondary,
}: {
  label?: string
  title?: string
  secondary?: React.ReactNode
}) {
  const { pending } = useFormStatus()
  const [saved, setSaved] = useState(false)
  const [wasPending, setWasPending] = useState(false)

  useEffect(() => {
    if (pending) {
      setWasPending(true)
      setSaved(false)
    } else if (wasPending) {
      setWasPending(false)
      setSaved(true)
      const timer = setTimeout(() => setSaved(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [pending, wasPending])

  return (
    <div className="save-bar">
      {title && <span className="save-bar-title">{title}</span>}

      <div className="save-bar-actions">
        {pending && <span className="save-toast" data-tone="working">Saving…</span>}
        {saved && <span className="save-toast">✓ Saved</span>}
        {secondary}
        <button type="submit" disabled={pending} className="admin-btn">
          {pending ? 'Saving…' : label}
        </button>
      </div>
    </div>
  )
}
