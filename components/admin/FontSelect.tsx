'use client'

import { useState, useRef, useEffect } from 'react'
import { COVER_FONTS, fontHref, getFont } from '@/lib/fonts'

/**
 * A custom dropdown rather than a native select: browsers largely ignore
 * font-family on <option>, so a real select can't preview the faces.
 */
export default function FontSelect({
  name,
  value,
  onChange,
  label = 'Font',
}: {
  name: string
  value: string
  onChange: (next: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const current = getFont(value)

  useEffect(() => {
    if (!open) return

    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }

    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div className="admin-field font-select" ref={wrapRef}>
      {label}

      {/* Load every face so the list renders in the real typefaces */}
      {COVER_FONTS.map((f) => (
        <link key={f.name} rel="stylesheet" href={fontHref(f.name)} />
      ))}

      <div className="font-picker">
        <button type="button" className="font-trigger" onClick={() => setOpen((o) => !o)}>
          <span className="font-trigger-name">{value}</span>
          <span className="font-trigger-sample" style={{ fontFamily: current.stack, fontWeight: current.weight }}>
            Handgloves
          </span>
          <span className="slot-caret">{open ? '▴' : '▾'}</span>
        </button>

        {open && (
          <ul className="font-menu">
            {COVER_FONTS.map((f) => {
              const font = getFont(f.name)
              return (
                <li key={f.name}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(f.name)
                      setOpen(false)
                    }}
                    data-active={f.name === value}
                  >
                    <span className="font-option-name">
                      {f.name}
                      <span className="font-option-category">{f.category}</span>
                    </span>
                    <span
                      className="font-option-sample"
                      style={{
                        fontFamily: font.stack,
                        fontWeight: font.weight,
                        textTransform: font.uppercase ? 'uppercase' : 'none',
                        letterSpacing: font.tracking,
                      }}
                    >
                      Handgloves
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <input type="hidden" name={name} value={value} />
    </div>
  )
}
