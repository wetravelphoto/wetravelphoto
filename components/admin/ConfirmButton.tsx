'use client'

import { useState } from 'react'

export default function ConfirmButton({
  label,
  confirmLabel = 'Sure?',
  className = 'admin-btn admin-btn-sm admin-btn-danger',
}: {
  label: string
  confirmLabel?: string
  className?: string
}) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.preventDefault()
          setArmed(true)
          // Reset if they walk away without confirming
          setTimeout(() => setArmed(false), 4000)
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <button type="submit" className={className} style={{ fontWeight: 600 }}>
      {confirmLabel}
    </button>
  )
}
