'use client'

import { COVER_FONTS, TITLE_COLORS, fontHref } from '@/lib/fonts'
import type { SectionStyle } from '@/lib/type-styles'

/** Font, size and colour for one homepage section. */
export default function TypographyControls({
  value,
  onChange,
  colorLabel = 'Heading colour',
}: {
  value: Required<SectionStyle>
  onChange: (next: Required<SectionStyle>) => void
  colorLabel?: string
}) {
  return (
    <div className="type-controls">
      {/* Load the chosen face so the swatch below previews correctly */}
      <link rel="stylesheet" href={fontHref(value.font)} />

      <label className="admin-field">
        Font
        <select
          value={value.font}
          onChange={(e) => onChange({ ...value, font: e.target.value })}
          className="admin-select"
        >
          {COVER_FONTS.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name} — {f.category}
            </option>
          ))}
        </select>
      </label>

      <label className="admin-field">
        Heading size — {Math.round(value.scale * 100)}%
        <input
          type="range"
          min="0.6"
          max="1.8"
          step="0.05"
          value={value.scale}
          onChange={(e) => onChange({ ...value, scale: parseFloat(e.target.value) })}
          style={{ width: '100%', marginTop: '0.35rem', accentColor: 'var(--admin-accent)' }}
        />
      </label>

      <div className="admin-field">
        {colorLabel}
        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {TITLE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...value, color: c })}
              aria-label={c}
              style={{
                width: 24,
                height: 24,
                background: c,
                border: value.color === c ? '2px solid var(--admin-accent)' : '0.5px solid var(--admin-line)',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
          <input
            type="color"
            value={value.color}
            onChange={(e) => onChange({ ...value, color: e.target.value })}
            style={{ width: 32, height: 24, padding: 0, border: '0.5px solid var(--admin-line)', background: 'none' }}
          />
        </div>
      </div>
    </div>
  )
}
