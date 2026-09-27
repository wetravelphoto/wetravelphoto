import { COVER_FONTS } from '@/lib/fonts'

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
 * So nothing is trusted. A font must be one this platform serves, a colour
 * must look like a colour, every enum is checked against its list and every
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
} as const

/** `#abc`, `#aabbcc`, `#aabbccdd`. Anything else is not a colour as far as this is concerned. */
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

  return Object.keys(out).length > 0 ? out : null
}

/** Where a section keeps them: `settings.text`, keyed by the field's own name. */
export type TextStyles = Record<string, TextStyle>

export function textStyles(settings: Record<string, unknown>): TextStyles {
  const bag = settings.text
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return {}
  const out: TextStyles = {}
  for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
    const clean = sanitizeTextStyle(value)
    if (clean) out[key] = clean
  }
  return out
}

export function textStyleFor(settings: Record<string, unknown>, field: string): TextStyle | null {
  return textStyles(settings)[field] ?? null
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

  return vars
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
] as const

/** Which fonts a page has to load because a piece of its text asked for one. */
export function textFonts(settings: Record<string, unknown>): string[] {
  return Array.from(
    new Set(
      Object.values(textStyles(settings))
        .map((s) => s.family)
        .filter((f): f is string => typeof f === 'string')
    )
  )
}
