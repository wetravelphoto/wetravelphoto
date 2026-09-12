'use client'

import { useState } from 'react'
import { TITLE_COLORS } from '@/lib/fonts'
import FontSelect from '@/components/admin/FontSelect'
import type { SectionStyle } from '@/lib/type-styles'

type Full = Required<SectionStyle>

/** Font, size and colour for a section's headings and its body text. */
export default function TypographyControls({
  value,
  onChange,
}: {
  value: Full
  onChange: (next: Full) => void
}) {
  const [tab, setTab] = useState<'heading' | 'body'>('heading')

  const isHeading = tab === 'heading'
  const font = isHeading ? value.font : value.bodyFont
  const color = isHeading ? value.color : value.bodyColor
  const scale = isHeading ? value.scale : value.bodyScale

  function set(patch: Partial<Full>) {
    onChange({ ...value, ...patch })
  }

  function setFont(next: string) {
    set(isHeading ? { font: next } : { bodyFont: next })
  }

  function setColor(next: string) {
    set(isHeading ? { color: next } : { bodyColor: next })
  }

  function setScale(next: number) {
    set(isHeading ? { scale: next } : { bodyScale: next })
  }

  return (
    <div className="type-controls">
      <div className="type-tabs">
        <button type="button" onClick={() => setTab('heading')} data-active={isHeading}>
          Headings
        </button>
        <button type="button" onClick={() => setTab('body')} data-active={!isHeading}>
          Body text
        </button>
      </div>

      <FontSelect
        name={isHeading ? 'heading_font_display' : 'body_font_display'}
        value={font}
        onChange={setFont}
      />

      <label className="admin-field">
        Size — {Math.round(scale * 100)}%
        <input
          type="range"
          min="0.6"
          max="1.8"
          step="0.05"
          value={scale}
          onChange={(e) => setScale(parseFloat(e.target.value))}
          style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
        />
      </label>

      <div className="admin-field">
        Colour
        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {TITLE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={c}
              style={{
                width: 24,
                height: 24,
                background: c,
                border: color === c ? '2px solid var(--admin-accent)' : '0.5px solid var(--admin-line)',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 32, height: 24, padding: 0, border: '0.5px solid var(--admin-line)', background: 'none' }}
          />
        </div>
      </div>
    </div>
  )
}
