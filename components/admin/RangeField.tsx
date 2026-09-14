'use client'

import { useState } from 'react'

/**
 * A range slider whose label tracks the handle.
 *
 * The editors that live in client components keep their own state and read
 * live already. This exists for sliders rendered inside a *server* component,
 * where an uncontrolled <input type="range"> leaves the label frozen at
 * whatever the server rendered.
 *
 * `unit` rather than a formatter function — props crossing the server/client
 * boundary have to be serialisable.
 */
export default function RangeField({
  name,
  label,
  defaultValue,
  min,
  max,
  step = 0.05,
  unit = 'percent',
  note,
}: {
  name: string
  label: string
  defaultValue: number
  min: number
  max: number
  step?: number
  unit?: 'percent' | 'px' | 'none'
  note?: string
}) {
  const [value, setValue] = useState(defaultValue)

  const display =
    unit === 'percent'
      ? `${Math.round(value * 100)}%`
      : unit === 'px'
        ? `${Math.round(value)}px`
        : String(value)

  return (
    <label className="admin-field">
      {label} — {display}
      <input
        type="range"
        name={name}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value))}
        style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
      />
      {note && (
        <span className="admin-meta" style={{ display: 'block', marginTop: '0.3rem' }}>
          {note}
        </span>
      )}
    </label>
  )
}
