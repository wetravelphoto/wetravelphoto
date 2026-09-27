import type React from 'react'
import { COVER_FONTS } from '@/lib/fonts'
import { BASE_DEVICE, DEVICES, DEVICE_PREFIX, deviceKey, type Device } from '@/lib/sections/devices'

/**
 * TYPOGRAPHY FOR ONE PIECE OF TEXT
 * ════════════════════════════════
 *
 * Until now typography was chosen per SECTION, in three roles — heading, body
 * and over-line. That is a coarse instrument: a section with two headings has
 * one control for both, and a control three groups down the panel from the
 * words it governs is a control nobody finds. This is the finer one. Every
 * piece of text a renderer marks as editable can carry its own.
 *
 * ── It borrows the one good property of the old model ───────────────────────
 *
 * **Silence.** Only what has actually been chosen is stored, and only what is
 * stored is written. Everything else is absent, so the value falls through to
 * the section's typography, then to the look, then to the site. An earlier
 * version of the section model returned a value for every key and, because
 * they were always set, the global typeface could not reach the headings at
 * all. Two controls over one number is only safe while one of them stays quiet
 * until used.
 *
 * ── Two decisions, taken 2026-09-27 ─────────────────────────────────────────
 *
 * **Size is a multiplier, not pixels.** Elementor shows `48`, which is honest
 * and literal, and it is also a number that means nothing after a look change
 * and nothing on a phone. `1.4` means "half again as big as whatever this text
 * is meant to be", which survives both. The panel shows it as a percentage.
 *
 * **A look does not take these away.** Everywhere else in this codebase
 * typography is design and a look owns it. Here it is treated as the
 * photographer's work: somebody who spent ten minutes on a title's letter
 * spacing should not lose it to one click on a new look. The cost is that a
 * heavily tuned site restyles less dramatically, which is what the per-element
 * reset is for.
 *
 * ── Everything here ends up in an inline style attribute ────────────────────
 *
 * So nothing is trusted. A font must be one this platform serves, a color
 * must look like a color, every enum is checked against its list and every
 * number is clamped. A settings row is JSON written by a server action and
 * read back — but it is also the sort of thing that gets hand-edited in a
 * database console at 2am, and `font-family: x; behavior: url(...)` is not a
 * sentence this file will ever emit.
 */

export type TextStyle = {
  /** A font NAME from lib/fonts.ts — never a stack, so nothing arbitrary is emitted. */
  family?: string
  /** Multiplier on whatever size this text would otherwise be. */
  size?: number
  weight?: number
  transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  style?: 'normal' | 'italic'
  decoration?: 'none' | 'underline' | 'line-through'
  lineHeight?: number
  /** em */
  letterSpacing?: number
  /** em */
  wordSpacing?: number
  color?: string
  align?: 'left' | 'center' | 'right' | 'justify'

  /*
   * ── A BUTTON IS TEXT WITH A BOX ROUND IT ──────────────────────────────────
   *
   * These ride in the same bag as the rest and are shown only for a field the
   * registry marks `button`. That is a deliberate choice over a bag of their
   * own: a button's box has to follow the same rules its words already do —
   * per element, per size, only-what-was-chosen-is-stored, and surviving a
   * change of look — and every one of those is already built here. A second
   * bag would be a second copy of all of it, free to drift.
   *
   * The cost is that a heading could technically carry a corner radius. It
   * would do nothing, because no heading's stylesheet reads it.
   */

  /** px. Corner roundness. */
  radius?: number
  /** em, so the gap round the words scales with them rather than with nothing. */
  padX?: number
  padY?: number
  /** px. A border thinner than a pixel is a border nobody asked for. */
  borderWidth?: number
  borderColor?: string
  /** Under the pointer: the fill behind the words, and the words. */
  hoverBg?: string
  hoverColor?: string
}

export const TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'] as const
export const STYLES = ['normal', 'italic'] as const
export const DECORATIONS = ['none', 'underline', 'line-through'] as const
export const ALIGNS = ['left', 'center', 'right', 'justify'] as const
export const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

/** Ranges the panel offers and the sanitiser enforces. Shared so they cannot drift. */
export const LIMITS = {
  size: { min: 0.4, max: 4, step: 0.05 },
  lineHeight: { min: 0.8, max: 2.4, step: 0.05 },
  letterSpacing: { min: -0.1, max: 0.5, step: 0.005 },
  wordSpacing: { min: -0.2, max: 1, step: 0.01 },
  // 0 is a square corner and a real answer; the top is a pill on any button
  // this site draws.
  radius: { min: 0, max: 40, step: 1 },
  padX: { min: 0, max: 6, step: 0.1 },
  padY: { min: 0, max: 3, step: 0.05 },
  borderWidth: { min: 0, max: 6, step: 0.5 },
} as const

/** The half of a TextStyle that only means anything on a button. */
export const BUTTON_KEYS = [
  'radius',
  'padX',
  'padY',
  'borderWidth',
  'borderColor',
  'hoverBg',
  'hoverColor',
] as const satisfies readonly (keyof TextStyle)[]

/** `#abc`, `#aabbcc`, `#aabbccdd`. Anything else is not a color as far as this is concerned. */
const COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function num(value: unknown, range: { min: number; max: number }): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? clamp(n, range.min, range.max) : undefined
}

function oneOf<T extends readonly string[]>(value: unknown, list: T): T[number] | undefined {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined
}

/**
 * A stored value, cleaned. Returns null when nothing survives, so a caller can
 * tell "this text has no styling of its own" from "it has styling that happens
 * to be empty" without inspecting the object.
 */
export function sanitizeTextStyle(input: unknown): TextStyle | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const out: TextStyle = {}

  if (typeof raw.family === 'string' && COVER_FONTS.some((f) => f.name === raw.family)) {
    out.family = raw.family
  }

  const size = num(raw.size, LIMITS.size)
  if (size !== undefined) out.size = size

  const weight = typeof raw.weight === 'number' ? raw.weight : Number(raw.weight)
  if ((WEIGHTS as readonly number[]).includes(weight)) out.weight = weight

  const transform = oneOf(raw.transform, TRANSFORMS)
  if (transform) out.transform = transform

  const style = oneOf(raw.style, STYLES)
  if (style) out.style = style

  const decoration = oneOf(raw.decoration, DECORATIONS)
  if (decoration) out.decoration = decoration

  const lineHeight = num(raw.lineHeight, LIMITS.lineHeight)
  if (lineHeight !== undefined) out.lineHeight = lineHeight

  const letterSpacing = num(raw.letterSpacing, LIMITS.letterSpacing)
  if (letterSpacing !== undefined) out.letterSpacing = letterSpacing

  const wordSpacing = num(raw.wordSpacing, LIMITS.wordSpacing)
  if (wordSpacing !== undefined) out.wordSpacing = wordSpacing

  if (typeof raw.color === 'string' && COLOUR.test(raw.color)) out.color = raw.color

  const align = oneOf(raw.align, ALIGNS)
  if (align) out.align = align

  // The button's box. Same treatment as everything above: clamped, checked,
  // and absent unless it was actually chosen.
  const radius = num(raw.radius, LIMITS.radius)
  if (radius !== undefined) out.radius = radius

  const padX = num(raw.padX, LIMITS.padX)
  if (padX !== undefined) out.padX = padX

  const padY = num(raw.padY, LIMITS.padY)
  if (padY !== undefined) out.padY = padY

  const borderWidth = num(raw.borderWidth, LIMITS.borderWidth)
  if (borderWidth !== undefined) out.borderWidth = borderWidth

  if (typeof raw.borderColor === 'string' && COLOUR.test(raw.borderColor)) {
    out.borderColor = raw.borderColor
  }
  if (typeof raw.hoverBg === 'string' && COLOUR.test(raw.hoverBg)) out.hoverBg = raw.hoverBg
  if (typeof raw.hoverColor === 'string' && COLOUR.test(raw.hoverColor)) {
    out.hoverColor = raw.hoverColor
  }

  return Object.keys(out).length > 0 ? out : null
}

/** Where a section keeps them: `settings.text`, keyed by the field's own name. */
export type TextStyles = Record<string, TextStyle>

/** A key must look like a field name — this ends up in a CSS attribute selector. */
const FIELD_KEY = /^[a-z][a-z0-9_]*$/

/**
 * A whole bag, cleaned. The save action runs this before the value is stored
 * and every reader runs it again on the way out, because a row can also be
 * written by an older release or by hand. An entry that survives to nothing is
 * dropped rather than kept as `{}`: an empty override and no override mean the
 * same thing, and only one of them should be in the database.
 */
export function sanitizeTextStyles(input: unknown): TextStyles {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: TextStyles = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!FIELD_KEY.test(key)) continue
    const clean = sanitizeTextStyle(value)
    if (clean) out[key] = clean
  }
  return out
}

/** One device's bag. The base device's is plain `text`; see `deviceKey`. */
export function textStyles(
  settings: Record<string, unknown>,
  device: Device = BASE_DEVICE
): TextStyles {
  return sanitizeTextStyles(settings[deviceKey('text', device)])
}

/**
 * What a piece of text actually looks like on one device: the base, with that
 * device's overrides laid over it, property by property.
 *
 * Property by property is the point. A phone that set only the size keeps the
 * desktop typeface, weight and color — otherwise setting one control would
 * silently discard the other ten, and nobody would find out until they looked
 * at the site on a phone.
 *
 * This is what the PANEL shows. The page itself never needs it: there the
 * merge is done by CSS at the breakpoint, which is why a value can be resolved
 * differently on two screens without re-rendering.
 */
export function effectiveTextStyle(
  settings: Record<string, unknown>,
  field: string,
  device: Device
): TextStyle | null {
  const base = textStyles(settings, BASE_DEVICE)[field] ?? null
  if (device === BASE_DEVICE) return base
  const own = textStyles(settings, device)[field] ?? null
  if (!base) return own
  if (!own) return base
  return { ...base, ...own }
}

export function textStyleFor(
  settings: Record<string, unknown>,
  field: string,
  device: Device = BASE_DEVICE
): TextStyle | null {
  return textStyles(settings, device)[field] ?? null
}

/**
 * The bag with one entry set or removed, as a new object.
 *
 * Every piece of text in a section shares one settings key, so saving one
 * element's typography means writing the WHOLE bag. Removing rather than
 * storing an empty object is the point: an entry that is absent follows the
 * section, and `{}` would be a third state meaning the same thing.
 */
export function withTextStyle(
  bag: TextStyles,
  field: string,
  next: TextStyle | null
): TextStyles {
  const out = { ...bag }
  if (next && Object.keys(next).length > 0) out[field] = next
  else delete out[field]
  return out
}

/**
 * What one piece of text's OWN entry should become on a narrower device, given
 * what the panel is now showing.
 *
 * The panel shows the effective style — the base with this device's overrides
 * on top — so it hands back a complete object, and most of what is in it is
 * the base showing through. Storing that whole object would silently freeze
 * the inherited half: change the desktop typeface afterwards and the phone
 * would keep the old one, having quietly copied it the moment anything else
 * was touched.
 *
 * So the override is the DIFFERENCE. Only a property that actually differs
 * from the base is kept, and a property set back to the base's value stops
 * being an override rather than becoming a redundant copy of it.
 */
export function overrideAgainst(base: TextStyle | null, next: TextStyle | null): TextStyle | null {
  if (!next) return null
  const out: TextStyle = {}
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue
    if (base && base[key as keyof TextStyle] === value) continue
    Object.assign(out, { [key]: value })
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * The CSS for one piece of text.
 *
 * Emitted as custom properties rather than as the real properties, because the
 * real ones are already being set by the section's stylesheet and an inline
 * `font-size` would win over a media query — a title sized on a desktop would
 * then keep that exact size on a phone, which is the whole trap the multiplier
 * avoids. The stylesheet reads these instead, so the cascade stays where the
 * cascade belongs.
 *
 * Nothing unset is written, which is what keeps this an override.
 */
export function textStyleVars(style: TextStyle | null): Record<string, string> {
  if (!style) return {}
  const vars: Record<string, string> = {}

  if (style.family) {
    const font = COVER_FONTS.find((f) => f.name === style.family)
    if (font) vars['--txt-font'] = font.stack
  }
  if (style.size !== undefined) vars['--txt-scale'] = String(style.size)
  if (style.weight !== undefined) vars['--txt-weight'] = String(style.weight)
  if (style.transform) vars['--txt-case'] = style.transform
  if (style.style) vars['--txt-style'] = style.style
  if (style.decoration) vars['--txt-decoration'] = style.decoration
  if (style.lineHeight !== undefined) vars['--txt-leading'] = String(style.lineHeight)
  if (style.letterSpacing !== undefined) vars['--txt-track'] = `${style.letterSpacing}em`
  if (style.wordSpacing !== undefined) vars['--txt-word'] = `${style.wordSpacing}em`
  if (style.color) vars['--txt-color'] = style.color
  if (style.align) vars['--txt-align'] = style.align

  if (style.radius !== undefined) vars['--txt-radius'] = `${style.radius}px`
  if (style.padX !== undefined) vars['--txt-pad-x'] = `${style.padX}em`
  if (style.padY !== undefined) vars['--txt-pad-y'] = `${style.padY}em`
  if (style.borderWidth !== undefined) vars['--txt-border-w'] = `${style.borderWidth}px`
  if (style.borderColor) vars['--txt-border-c'] = style.borderColor
  if (style.hoverBg) vars['--txt-hover-bg'] = style.hoverBg
  if (style.hoverColor) vars['--txt-hover-ink'] = style.hoverColor

  return vars
}

/**
 * ONE PIECE OF TEXT'S PROPERTIES FOR EVERY DEVICE, AS ONE STYLE ATTRIBUTE.
 *
 * An inline style attribute cannot carry a media query, so it carries both
 * sets at once under different prefixes and one global rule picks between
 * them at the breakpoint (see app/globals.css, and DEVICE_PREFIX). The
 * alternative was a `<style>` element per section, which is a second
 * stylesheet to keep in step with the first.
 */
export function deviceTextStyleVars(
  settings: Record<string, unknown>,
  field: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const device of DEVICES) {
    const style = textStyles(settings, device)[field]
    if (!style) continue
    for (const [name, value] of Object.entries(textStyleVars(style))) {
      // --txt-scale under the mobile prefix is --txtm-scale.
      out[DEVICE_PREFIX[device] + name.slice('--txt-'.length)] = value
    }
  }
  return out
}

/**
 * READY-MADE PROPS, KEYED BY FIELD — NOT STYLES.
 *
 * For the components that take shaped props rather than the settings bag: the
 * two heroes, the contact block, the Instagram feed. They cannot build these
 * themselves, because it takes every device's bag and all they are given is
 * their own words.
 *
 * ── Why props and not a style object ────────────────────────────────────────
 *
 * This returned `CSSProperties` at first, and every one of those four
 * components did `style={own('title')}` — which is not enough, and failed
 * silently. The custom properties only become the `--txt-*` a stylesheet reads
 * because of a rule keyed on `[data-txt]` (app/globals.css); without the
 * attribute the properties sit on the element and nothing looks at them. The
 * hero's title, subtitle and button carried their typography for a week and
 * ignored all of it.
 *
 * Returning the attribute WITH the style makes the mistake unavailable: the
 * only way to use this is to spread it, and spreading it brings both.
 */
export type TextProps = { 'data-txt': string; style: React.CSSProperties }
export type TextVars = Record<string, TextProps>

export function textVarsByField(
  settings: Record<string, unknown>,
  fields: readonly string[]
): TextVars {
  const out: TextVars = {}
  for (const field of fields) {
    out[field] = {
      'data-txt': '',
      style: deviceTextStyleVars(settings, field) as React.CSSProperties,
    }
  }
  return out
}

/** Which fonts a page has to load: every device's, since one page serves all. */
export function allTextFonts(settings: Record<string, unknown>): string[] {
  return Array.from(new Set(DEVICES.flatMap((d) => textFonts(settings, d))))
}

/** Every custom property this can set, for the preview's live patching. */
export const TEXT_VARS = [
  '--txt-font',
  '--txt-scale',
  '--txt-weight',
  '--txt-case',
  '--txt-style',
  '--txt-decoration',
  '--txt-leading',
  '--txt-track',
  '--txt-word',
  '--txt-color',
  '--txt-align',
  '--txt-radius',
  '--txt-pad-x',
  '--txt-pad-y',
  '--txt-border-w',
  '--txt-border-c',
  '--txt-hover-bg',
  '--txt-hover-ink',
] as const

/** Which fonts a page has to load because a piece of its text asked for one. */
export function textFonts(
  settings: Record<string, unknown>,
  device: Device = BASE_DEVICE
): string[] {
  return Array.from(
    new Set(
      Object.values(textStyles(settings, device))
        .map((s) => s.family)
        .filter((f): f is string => typeof f === 'string')
    )
  )
}
