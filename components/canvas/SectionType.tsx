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
 * showing Oswald because the site is". A section that merely inherits keeps
 * following when the global style changes; one that has been set does not.
 *
 * THIS SECTION ONLY. Typography used to be stored per shared group, so the
 * intro, the About block and the gallery carousel all changed together. Each
 * section now carries its own; this panel edits that and nothing else.
 *
 * Three rows: the heading, the body text, and the over-line (the small line
 * above a heading) — the last only for sections that have one.
 *
 * The panel follows the hand: it holds the choice locally while the save is on
 * its way, so a slider moves with the mouse instead of waiting for a round trip.
 * The stored value takes over again whenever it changes underneath.
 */
export default function SectionType({
  style,
  base,
  hasEyebrow,
  onChange,
}: {
  /** What is actually in effect — absent keys follow the site. */
  style: SectionStyle
  /** What this section falls back to: the site's own tokens. */
  base: { font: string; color: string; bodyFont: string; bodyColor: string }
  /** Whether this section has an over-line to style. */
  hasEyebrow: boolean
  /** The complete new style (null keys removed), or null to follow the site. */
  onChange: (next: SectionStyle | null) => void
}) {
  const stored = JSON.stringify(style)
  const [local, setLocal] = useState<SectionStyle>(style)
  const [seen, setSeen] = useState(stored)
  if (stored !== seen) {
    setSeen(stored)
    setLocal(style)
  }

  const change = (changes: Partial<Record<keyof SectionStyle, string | number | null>>) => {
    const next: SectionStyle = { ...local }
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined || value === '') delete next[key as keyof SectionStyle]
      else Object.assign(next, { [key]: value })
    }
    setLocal(next)
    onChange(Object.keys(next).length > 0 ? next : null)
  }

  const overridden = Object.keys(local).length > 0

  return (
    // Kept out of the settings form's change handler, which would otherwise
    // queue a save of every other field on each drag of a slider here.
    <div className="cv-type" onChange={(e) => e.stopPropagation()}>
      <div className="cv-type-top">
        <p className="cv-type-note">Only what you change stops following the site&apos;s style.</p>
        {overridden && (
          <button
            type="button"
            className="cv-type-clear"
            onClick={() => {
              setLocal({})
              onChange(null)
            }}
          >
            Follow the site
          </button>
        )}
      </div>

      <Row
        label="Heading"
        font={local.font}
        colour={local.color}
        scale={local.scale}
        baseFont={base.font}
        baseColour={base.color}
        onFont={(v) => change({ font: v })}
        onColour={(v) => change({ color: v })}
        onScale={(v) => change({ scale: v })}
      />

      <Row
        label="Body"
        font={local.bodyFont}
        colour={local.bodyColor}
        scale={local.bodyScale}
        baseFont={base.bodyFont}
        baseColour={base.bodyColor}
        onFont={(v) => change({ bodyFont: v })}
        onColour={(v) => change({ bodyColor: v })}
        onScale={(v) => change({ bodyScale: v })}
      />

      {hasEyebrow && (
        <Row
          label="Over-line"
          font={local.eyebrowFont}
          colour={local.eyebrowColor}
          scale={local.eyebrowScale}
          baseFont={base.font}
          baseColour={base.color}
          onFont={(v) => change({ eyebrowFont: v })}
          onColour={(v) => change({ eyebrowColor: v })}
          onScale={(v) => change({ eyebrowScale: v })}
        />
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
