'use client'

import { useState } from 'react'

/**
 * The switch used across the admin, in place of a bare checkbox. Submits as a
 * normal checkbox so server actions read it the same way.
 */
export default function Toggle({
  name,
  label,
  defaultChecked = false,
  note,
  onChange,
}: {
  name: string
  label: string
  defaultChecked?: boolean
  note?: string
  onChange?: (value: boolean) => void
}) {
  const [on, setOn] = useState(defaultChecked)

  return (
    <div className="toggle-row">
      <label className="toggle-switch">
        <input
          type="checkbox"
          name={name}
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked)
            onChange?.(e.target.checked)
          }}
        />
        <span />
      </label>

      <div style={{ minWidth: 0 }}>
        <span className="toggle-label">{label}</span>
        {note && <span className="toggle-note">{note}</span>}
      </div>
    </div>
  )
}
