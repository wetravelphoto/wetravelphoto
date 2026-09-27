'use client'

import { useState } from 'react'
import { FONT_NAMES } from '@/lib/styles/tokens'
import { BASE_DEVICE, type Device } from '@/lib/sections/devices'
import {
  ALIGNS,
  DECORATIONS,
  LIMITS,
  TRANSFORMS,
  WEIGHTS,
  type TextStyle,
} from '@/lib/sections/text-style'

/**
 * TYPOGRAPHY FOR ONE PIECE OF TEXT
 * ════════════════════════════════
 *
 * A button under the box, and a panel behind it. The same shape as the
 * placement picker beside it, for the same reason: a control that governs
 * these particular words belongs under these particular words, not three
 * groups down the panel under a heading that could mean any of them.
 *
 * ── Every control has a quiet state, and starts in it ───────────────────────
 *
 * "Following" is not a value — it is the ABSENCE of one, and the difference
 * matters. A control that opens showing 100% and Inter looks set, and if
 * touching it stored those numbers then a title would stop following the look
 * the first time somebody nudged the slider and dragged it back. So nothing is
 * stored until it is chosen, every control says so on its face, and each one
 * can be handed back individually. Whatever is left unset falls through to the
 * section's typography, then the look, then the site — in CSS, not here; see
 * the `--txt-*` cascade in app/hero.css.
 *
 * ── Size is a percentage of whatever this text would otherwise be ───────────
 *
 * Elementor shows `48`, which is honest and literal and means nothing after a
 * change of look and nothing on a phone. 140% means "half again as big as this
 * text is meant to be", which survives both. Stored as the multiplier; shown
 * as the percentage, because nobody thinks in 1.4.
 *
 * ── It holds the choice while the save is in the air ────────────────────────
 *
 * Every control is driven from local state, so a slider moves with the mouse
 * rather than waiting for a round trip; the stored value takes over again the
 * moment it changes underneath, which is how Undo reaches these.
 */
export default function TextStylePanel({
  label,
  value,
  /** What this text looks like when it follows: shown, never stored. */
  base,
  device,
  inheriting,
  onChange,
}: {
  /** The field above. Named here for the screen reader and the panel heading. */
  label: string
  /**
   * The EFFECTIVE style on the size being edited — the desktop values with
   * this size's overrides laid over them. Not what is stored: on a phone the
   * caller works out the difference before writing it, so that a value still
   * following desktop keeps following it. See `overrideAgainst`.
   */
  value: TextStyle | null
  base: { font: string; color: string }
  /** Which size these controls are editing. Set by the switcher at the top. */
  device: Device
  /** True when this size has no values of its own and is showing desktop's. */
  inheriting: boolean
  /** The complete new style, or null to follow again. */
  onChange: (next: TextStyle | null) => void
}) {
  const stored = JSON.stringify(value ?? {})
  const [local, setLocal] = useState<TextStyle>(value ?? {})
  const [seen, setSeen] = useState(stored)
  if (stored !== seen) {
    setSeen(stored)
    setLocal(value ?? {})
  }

  /**
   * One or more keys at once. `null` REMOVES a key rather than storing a null,
   * which is the whole "silence" property: a key that is absent follows, a key
   * that is present overrides, and there is no third state to get wrong.
   */
  const change = (changes: Partial<Record<keyof TextStyle, string | number | null>>) => {
    const next: TextStyle = { ...local }
    for (const [key, v] of Object.entries(changes)) {
      if (v === null || v === undefined || v === '') delete next[key as keyof TextStyle]
      else Object.assign(next, { [key]: v })
    }
    setLocal(next)
    onChange(Object.keys(next).length > 0 ? next : null)
  }

  const set = Object.keys(local).length

  return (
      <div className="txt-pop" role="group" aria-label={`Typography for ${label}`}>
        {set > 0 && (
          <div className="txt-pop-head">
            <button
              type="button"
              className="txt-clear"
              onClick={() => {
                setLocal({})
                onChange(null)
              }}
            >
              {device === BASE_DEVICE ? 'Back to the look' : 'Back to desktop'}
            </button>
          </div>
        )}

        {/*
          * Said plainly rather than left to be discovered. Somebody editing
          * the phone is looking at controls full of numbers they did not set
          * here, and the difference between "this is the phone's" and "this
          * is the desktop's, showing through" is the whole model.
          */}
        {device !== BASE_DEVICE && inheriting && (
          <p className="txt-pop-inherit">
            Following the desktop version. Change anything here and only that
            one thing stops following.
          </p>
        )}

        <Block name="Alignment">
          <Segments
            label="Alignment"
            options={ALIGNS.map((a) => ({
              value: a,
              label: ALIGN_NAME[a],
              draw: <AlignIcon align={a} />,
            }))}
            value={local.align}
            onChange={(v) => change({ align: v })}
          />
        </Block>

        <Block name="Typography">
          <label className="txt-row">
            <span className="txt-row-name">Typeface</span>
            <select
              value={local.family ?? ''}
              onChange={(e) => change({ family: e.target.value || null })}
            >
              <option value="">Following ({base.font})</option>
              {FONT_NAMES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <Slider
            name="Size"
            value={local.size}
            limits={LIMITS.size}
            /* 1 is the same as not overriding, so it clears rather than
               storing a number whose only effect is to stop inheritance. */
            neutral={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => change({ size: v })}
          />

          <label className="txt-row">
            <span className="txt-row-name">Weight</span>
            <select
              value={local.weight ?? ''}
              onChange={(e) => change({ weight: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Following</option>
              {WEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {w} — {WEIGHT_NAME[w]}
                </option>
              ))}
            </select>
          </label>

          <Segments
            label="Capitals"
            options={TRANSFORMS.map((t) => ({
              value: t,
              label: TRANSFORM_NAME[t],
              icon: TRANSFORM_ICON[t],
            }))}
            value={local.transform}
            onChange={(v) => change({ transform: v })}
          />

          <Segments
            label="Style"
            options={[
              { value: 'normal', label: 'Upright', icon: 'A' },
              { value: 'italic', label: 'Italic', icon: 'A', italic: true },
            ]}
            value={local.style}
            onChange={(v) => change({ style: v })}
          />

          <Segments
            label="Decoration"
            options={DECORATIONS.map((d) => ({
              value: d,
              label: DECORATION_NAME[d],
              icon: DECORATION_ICON[d],
            }))}
            value={local.decoration}
            onChange={(v) => change({ decoration: v })}
          />

          <Slider
            name="Line height"
            value={local.lineHeight}
            limits={LIMITS.lineHeight}
            format={(v) => v.toFixed(2)}
            onChange={(v) => change({ lineHeight: v })}
          />

          <Slider
            name="Letter spacing"
            value={local.letterSpacing}
            limits={LIMITS.letterSpacing}
            neutral={0}
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(3)}em`}
            onChange={(v) => change({ letterSpacing: v })}
          />

          <Slider
            name="Word spacing"
            value={local.wordSpacing}
            limits={LIMITS.wordSpacing}
            neutral={0}
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}em`}
            onChange={(v) => change({ wordSpacing: v })}
          />
        </Block>

        <Block name="Color">
          <div className="txt-color">
            <input
              type="color"
              value={local.color ?? base.color}
              onChange={(e) => change({ color: e.target.value })}
              aria-label={`${label} color`}
            />
            <span className="txt-color-name">{local.color ?? 'Following'}</span>
            {local.color && (
              <button type="button" className="txt-clear" onClick={() => change({ color: null })}>
                clear
              </button>
            )}
          </div>
        </Block>
      </div>
  )
}

/**
 * The row's right-hand side: what this text is actually set to.
 *
 * Size, weight and typeface first, because that is the order somebody reads a
 * type spec in and they are what people change. At most THREE parts, because
 * a row that wraps has stopped being a row — the rest is one click away, and
 * the row's job is to answer "has anything been done to this" without being
 * opened, not to be a complete account.
 *
 * Anything set that is not one of the three still gets named rather than
 * hidden, so a title whose only change is its alignment reads "Right" and not
 * the useless "Adjusted".
 */
export function describeTextStyle(style: TextStyle, followingFont: string): string {
  if (Object.keys(style).length === 0) {
    // Naming what it follows is more use than "Default": it answers "what
    // typeface is this?" without opening anything.
    return `Following ${followingFont}`
  }

  const parts = [
    style.size !== undefined ? `${Math.round(style.size * 100)}%` : null,
    style.weight !== undefined ? WEIGHT_NAME[style.weight as (typeof WEIGHTS)[number]] : null,
    style.family ?? null,
    style.transform ? TRANSFORM_NAME[style.transform] : null,
    style.style === 'italic' ? 'Italic' : null,
    style.decoration && style.decoration !== 'none' ? DECORATION_NAME[style.decoration] : null,
    style.align ? ALIGN_NAME[style.align] : null,
    style.color ?? null,
    style.letterSpacing !== undefined ? 'Tracking' : null,
    style.lineHeight !== undefined ? 'Line height' : null,
    style.wordSpacing !== undefined ? 'Word spacing' : null,
  ].filter((p): p is string => p !== null)

  return parts.slice(0, 3).join(' · ')
}

function Block({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="txt-block">
      <p className="txt-block-name">{name}</p>
      {children}
    </div>
  )
}

/**
 * A row of choices where clicking the one already chosen hands it back.
 *
 * That is the only affordance that makes "following" reachable again without a
 * second control beside every row — and it reads correctly: pressing an active
 * button off is what a toggle does.
 */
function Segments<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string; icon?: string; draw?: React.ReactNode; italic?: boolean }[]
  value: T | undefined
  onChange: (next: T | null) => void
}) {
  return (
    <div className="txt-row">
      <span className="txt-row-name">{label}</span>
      <div className="txt-seg" role="group" aria-label={label}>
        {options.map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              className="txt-seg-btn"
              data-active={active || undefined}
              data-italic={option.italic || undefined}
              data-case={option.value}
              aria-pressed={active}
              title={active ? `${option.label} — click to follow again` : option.label}
              onClick={() => onChange(active ? null : option.value)}
            >
              {option.draw ?? <span aria-hidden>{option.icon}</span>}
              <span className="txt-seg-name">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A slider that can be UNSET, which a range input cannot be on its own: it
 * always has a position. So the position is a lie until the value exists, the
 * readout says "following" rather than a number, and the readout is the button
 * that gives the value back.
 */
function Slider({
  name,
  value,
  limits,
  neutral,
  format,
  onChange,
}: {
  name: string
  value: number | undefined
  limits: { min: number; max: number; step: number }
  /** A value that means the same as not overriding; choosing it clears instead. */
  neutral?: number
  format: (value: number) => string
  onChange: (next: number | null) => void
}) {
  const shown = value ?? neutral ?? (limits.min + limits.max) / 2
  return (
    <label className="txt-row txt-slider">
      <span className="txt-row-name">{name}</span>
      <span className="txt-slider-body">
        <input
          type="range"
          min={limits.min}
          max={limits.max}
          step={limits.step}
          value={shown}
          data-following={value === undefined || undefined}
          onChange={(e) => {
            const next = Number(e.target.value)
            onChange(neutral !== undefined && next === neutral ? null : next)
          }}
        />
        {value === undefined ? (
          <span className="txt-slider-value is-following">following</span>
        ) : (
          <button
            type="button"
            className="txt-slider-value"
            title="Follow the look again"
            onClick={() => onChange(null)}
          >
            {format(value)}
          </button>
        )}
      </span>
    </label>
  )
}

const ALIGN_NAME: Record<(typeof ALIGNS)[number], string> = {
  left: 'Left',
  center: 'Centre',
  right: 'Right',
  justify: 'Justified',
}

/**
 * FOUR LINES THAT ARE ACTUALLY ALIGNED.
 *
 * These were the ≡ character in all four buttons — the same glyph whatever the
 * alignment, so the control said "alignment" without saying which, and at
 * 0.7rem it was a smudge in the middle of a button.
 *
 * Drawn instead, at the width of the button: the lines are ragged on the side
 * the text is ragged on, which is the whole idea and is not something a
 * character can express. `preserveAspectRatio="none"` lets them stretch with
 * the button rather than sitting in a small square inside it.
 */
function AlignIcon({ align }: { align: (typeof ALIGNS)[number] }) {
  const rows = [1, 0.62, 1, 0.62]
  return (
    <svg
      className="txt-align-icon"
      viewBox="0 0 24 14"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {rows.map((w, i) => {
        const width = align === 'justify' ? 24 : w * 24
        const x = align === 'right' ? 24 - width : align === 'center' ? (24 - width) / 2 : 0
        return <rect key={i} x={x} y={i * 3.6 + 0.6} width={width} height="1.8" rx="0.9" />
      })}
    </svg>
  )
}

const TRANSFORM_NAME: Record<(typeof TRANSFORMS)[number], string> = {
  none: 'As written',
  uppercase: 'Capitals',
  lowercase: 'Lower case',
  capitalize: 'Title Case',
}

const TRANSFORM_ICON: Record<(typeof TRANSFORMS)[number], string> = {
  none: 'Aa',
  uppercase: 'AA',
  lowercase: 'aa',
  capitalize: 'Aa',
}

const DECORATION_NAME: Record<(typeof DECORATIONS)[number], string> = {
  none: 'Plain',
  underline: 'Underlined',
  'line-through': 'Struck through',
}

const DECORATION_ICON: Record<(typeof DECORATIONS)[number], string> = {
  none: 'A',
  underline: 'A',
  'line-through': 'A',
}

const WEIGHT_NAME: Record<(typeof WEIGHTS)[number], string> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi-bold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
}
