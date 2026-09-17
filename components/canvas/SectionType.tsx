'use client'

import { useState } from 'react'
import { FONT_NAMES } from '@/lib/styles/tokens'
import type { SectionStyle } from '@/lib/type-styles'

/**
 * One section's typography, as an OVERRIDE of the site's.
 *
 * Every control has a "Follow the site" state and starts there, and the
 * inherited value is shown next to it — so the panel is honest about the
 * difference between "this section is set to Oswald" and "this section is
 * showing Oswald because the site is". That distinction is the whole point:
 * a section that merely inherits keeps following when the global style
 * changes, and one that has been set does not.
 *
 * CLEARING IS `null`, NOT `undefined`. These values cross a server action
 * boundary, and an explicitly-undefined property is not something every
 * serializer preserves — a dropped key would read as "no change" and the
 * override could never be removed. null survives, and the action maps it back.
 */
export default function SectionType({
  group,
  style,
  base,
  onChange,
}: {
  group: string
  /** What is actually stored — absent keys are inherited, not defaulted. */
  style: SectionStyle
  /** What this section falls back to: the site's own tokens. */
  base: { font: string; color: string; bodyFont: string; bodyColor: string }
  onChange: (changes: Record<string, unknown>) => void
}) {
  const overridden = Object.keys(style).length > 0
  // Folds like every other group, and starts folded: it is the thing you reach
  // for least and the longest thing in the panel when it is open.
  const [shut, setShut] = useState(true)

  return (
    <div className="sec-group cv-type-group">
      <div className="cv-type-head">
        <button
          type="button"
          className="cv-fold"
          aria-expanded={!shut}
          onClick={() => setShut(!shut)}
        >
          <span className="cv-fold-arrow" aria-hidden="true">
            ▾
          </span>
          Typography
          {overridden && <span className="cv-type-dot" aria-label="Overridden" />}
        </button>

        {overridden && !shut && (
          <button
            type="button"
            className="cv-type-clear"
            onClick={() =>
              onChange({
                font: null,
                color: null,
                scale: null,
                bodyFont: null,
                bodyColor: null,
                bodyScale: null,
              })
            }
          >
            Follow the site
          </button>
        )}
      </div>

      {shut ? null : (
        <>
      <p className="cv-type-note">
        Only what you change here stops following the site&apos;s style. Shared by every{' '}
        {group} section on the page.
      </p>

      <Row
        label="Heading"
        font={style.font}
        colour={style.color}
        scale={style.scale}
        baseFont={base.font}
        baseColour={base.color}
        onFont={(v) => onChange({ font: v })}
        onColour={(v) => onChange({ color: v })}
        onScale={(v) => onChange({ scale: v })}
      />

      <Row
        label="Body"
        font={style.bodyFont}
        colour={style.bodyColor}
        scale={style.bodyScale}
        baseFont={base.bodyFont}
        baseColour={base.bodyColor}
        onFont={(v) => onChange({ bodyFont: v })}
        onColour={(v) => onChange({ bodyColor: v })}
        onScale={(v) => onChange({ bodyScale: v })}
      />
        </>
      )}
    </div>
  )
}

function Row({
  label,
  font,
  colour,
  scale,
  baseFont,
  baseColour,
  onFont,
  onColour,
  onScale,
}: {
  label: string
  font?: string
  colour?: string
  scale?: number
  baseFont: string
  baseColour: string
  onFont: (value: string | null) => void
  onColour: (value: string | null) => void
  onScale: (value: number | null) => void
}) {
  return (
    <div className="cv-type-row">
      <p className="cv-type-row-label">{label}</p>

      <label className="admin-field">
        Typeface
        <select value={font ?? ''} onChange={(e) => onFont(e.target.value || null)}>
          <option value="">Follow the site ({baseFont})</option>
          {FONT_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className="cv-colour-row">
        <input
          type="color"
          value={colour ?? baseColour}
          onChange={(e) => onColour(e.target.value)}
          aria-label={`${label} colour`}
        />
        <span className="cv-colour-name">Colour</span>
        {colour ? (
          <button type="button" className="cv-type-clear" onClick={() => onColour(null)}>
            clear
          </button>
        ) : (
          <span className="cv-colour-hex">following</span>
        )}
      </div>

      <label className="cv-slider">
        <span className="cv-slider-head">
          <span>Size</span>
          <span className="cv-slider-value">
            {scale === undefined ? 'following' : `${scale.toFixed(2)}×`}
          </span>
        </span>
        <input
          type="range"
          min={0.6}
          max={2}
          step={0.05}
          value={scale ?? 1}
          onChange={(e) => {
            const v = Number(e.target.value)
            // Exactly 1 is the same as not overriding, so it clears instead of
            // storing a value that does nothing but stop inheritance.
            onScale(v === 1 ? null : v)
          }}
        />
      </label>
    </div>
  )
}
