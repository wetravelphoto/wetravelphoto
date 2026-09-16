import { COVER_FONTS, getFont } from '@/lib/fonts'

/**
 * GLOBAL STYLES
 * ═════════════
 *
 * Every colour, typeface and measure the site uses, in one place, set once.
 *
 * The same contract as lib/sections/registry.ts and for the same reason:
 * defaults are merged under stored values at read time, so a site saved before
 * a token existed gets the new one without a migration, and a renderer never
 * sees undefined. Never remove a key; adding one is free; bump `version` only
 * when an existing key changes meaning.
 *
 * ── What this is NOT ────────────────────────────────────────────────────────
 *
 * It is not a CSS editor. The whole premise is "enough freedom to feel unique,
 * enough structure that it is hard to look bad", and an open colour picker on
 * seven slots is how you get a site with maroon body text on a teal ground.
 *
 * So the first thing the panel offers is a PAIRING and a PALETTE — combinations
 * chosen to work — and the individual values sit underneath for when someone
 * knows what they want. The easy path is a good one; the precise path is still
 * there.
 *
 * Pure data: no React, no database, imported by both server and client.
 */

export const TOKENS_VERSION = 1

export type StyleTokens = {
  // ── Colour ───────────────────────────────────────────────────────────────
  /** Page background. */
  surface: string
  /** Bands that need to sit apart from the page — intro, footer. */
  surface_alt: string
  /** Headings and anything that has to be read first. */
  ink: string
  /** Body copy. Softer than ink or long paragraphs get heavy. */
  ink_soft: string
  /** Captions, dates, counts. */
  ink_mute: string
  /** Over-lines, links, the one thing on a page allowed to be warm. */
  accent: string
  /** Hairlines. Stored as an opacity against ink rather than its own colour, so it stays right when ink changes. */
  line_opacity: number

  // ── Typography ───────────────────────────────────────────────────────────
  /** Headings. A name from lib/fonts.ts. */
  display_font: string
  /** Body copy. */
  body_font: string
  /**
   * Letterspacing on headings, in em.
   *
   * There is deliberately no global type SCALE here: lib/type-styles.ts
   * already gives every section its own --sec-scale, and a second multiplier
   * on top of it would be two controls fighting over one number.
   */
  heading_tracking: number
  heading_case: 'uppercase' | 'none'

  // ── Measure ──────────────────────────────────────────────────────────────
  /** Widest the content ever gets, in px. */
  container: number
  /** Vertical breathing room between sections. 1 is the design's own rhythm. */
  rhythm: number

  // ── Buttons ──────────────────────────────────────────────────────────────
  button_shape: 'square' | 'soft' | 'pill'
  button_case: 'uppercase' | 'none'
}

export const DEFAULT_TOKENS: StyleTokens = {
  // Lifted from app/globals.css, so a site that has never opened this panel
  // renders byte-identically to how it did before the panel existed.
  surface: '#FAF9F6',
  surface_alt: '#F0EEE8',
  ink: '#14100E',
  ink_soft: '#4A4642',
  ink_mute: '#8A857E',
  accent: '#B5602C',
  line_opacity: 0.12,

  display_font: 'Oswald',
  body_font: 'Karla',
  heading_tracking: 0.02,
  heading_case: 'uppercase',

  container: 1240,
  rhythm: 1,

  button_shape: 'square',
  button_case: 'uppercase',
}

// ── Presets ──────────────────────────────────────────────────────────────────
// The good default. Each one is a combination somebody would choose on purpose,
// not a random walk through the font list.

export type Pairing = {
  id: string
  name: string
  note: string
  display: string
  body: string
  heading_case: StyleTokens['heading_case']
  heading_tracking: number
}

export const PAIRINGS: Pairing[] = [
  {
    id: 'field-notes',
    name: 'Field Notes',
    note: 'Condensed capitals over a quiet sans. Editorial.',
    display: 'Oswald',
    body: 'Karla',
    heading_case: 'uppercase',
    heading_tracking: 0.02,
  },
  {
    id: 'salt',
    name: 'Salt',
    note: 'One strong sans doing both jobs. Modern, confident.',
    display: 'Archivo Black',
    body: 'Work Sans',
    heading_case: 'none',
    heading_tracking: -0.01,
  },
  {
    id: 'atelier',
    name: 'Atelier',
    note: 'Wide-set serif capitals over a book face. Gallery.',
    display: 'Marcellus',
    body: 'EB Garamond',
    heading_case: 'uppercase',
    heading_tracking: 0.12,
  },
  {
    id: 'archive',
    name: 'Archive',
    note: 'Small, plain, out of the way. For a body of work.',
    display: 'Inter',
    body: 'Inter',
    heading_case: 'none',
    heading_tracking: 0,
  },
  {
    id: 'plate',
    name: 'Plate',
    note: 'Display serif with a grotesk beneath it. Warm and printed.',
    display: 'Playfair Display',
    body: 'Space Grotesk',
    heading_case: 'none',
    heading_tracking: 0,
  },
  {
    id: 'bulletin',
    name: 'Bulletin',
    note: 'Tall condensed capitals, tight. Loud without shouting.',
    display: 'Bebas Neue',
    body: 'Jost',
    heading_case: 'uppercase',
    heading_tracking: 0.06,
  },
]

export type Palette = {
  id: string
  name: string
  note: string
  surface: string
  surface_alt: string
  ink: string
  ink_soft: string
  ink_mute: string
  accent: string
}

export const PALETTES: Palette[] = [
  {
    id: 'paper',
    name: 'Paper',
    note: 'Warm off-white and near-black. What the site uses now.',
    surface: '#FAF9F6',
    surface_alt: '#F0EEE8',
    ink: '#14100E',
    ink_soft: '#4A4642',
    ink_mute: '#8A857E',
    accent: '#B5602C',
  },
  {
    id: 'bone',
    name: 'Bone',
    note: 'Cooler and flatter. Lets colour photographs shout.',
    surface: '#F7F7F5',
    surface_alt: '#EDEDEA',
    ink: '#1A1A19',
    ink_soft: '#4C4C4A',
    ink_mute: '#8C8C88',
    accent: '#3F5A52',
  },
  {
    id: 'salt',
    name: 'Salt',
    note: 'Pure white, hard black. Nothing between you and the picture.',
    surface: '#FFFFFF',
    surface_alt: '#F4F4F4',
    ink: '#000000',
    ink_soft: '#3D3D3D',
    ink_mute: '#8A8A8A',
    accent: '#1A1A1A',
  },
  {
    id: 'dusk',
    name: 'Dusk',
    note: 'Dark ground. Best with a small, tightly edited set.',
    surface: '#15161A',
    surface_alt: '#1D1F24',
    ink: '#F2F1EE',
    ink_soft: '#BFBDB7',
    ink_mute: '#807E79',
    accent: '#C8A06A',
  },
  {
    id: 'sand',
    name: 'Sand',
    note: 'Desert warmth. Earth tones and long light.',
    surface: '#F6F1E8',
    surface_alt: '#EDE4D5',
    ink: '#2A211A',
    ink_soft: '#5A4C40',
    ink_mute: '#968676',
    accent: '#A85A2B',
  },
  {
    id: 'tide',
    name: 'Tide',
    note: 'Cold blue-grey. Water, weather and northern places.',
    surface: '#F4F6F7',
    surface_alt: '#E6EBED',
    ink: '#121A1E',
    ink_soft: '#3F4E55',
    ink_mute: '#7C8A91',
    accent: '#2E6B7A',
  },
]

export const BUTTON_RADIUS: Record<StyleTokens['button_shape'], string> = {
  square: '0px',
  soft: '4px',
  pill: '999px',
}

// ── Reading and writing ──────────────────────────────────────────────────────

export type StoredTokens = Partial<Record<keyof StyleTokens, unknown>> | null | undefined

/**
 * The read-time guarantee. Defaults fill every gap, so a site saved before a
 * token existed is indistinguishable from one saved today.
 */
export function resolveTokens(stored: StoredTokens, version = TOKENS_VERSION): StyleTokens {
  void version // no migrations yet; the hook is here for when there are
  const merged = { ...DEFAULT_TOKENS, ...(stored ?? {}) } as Record<string, unknown>

  // A value of the wrong type — hand-edited JSON, a half-finished migration —
  // falls back rather than reaching the page as `NaN px`.
  const out = { ...DEFAULT_TOKENS }
  for (const key of Object.keys(DEFAULT_TOKENS) as (keyof StyleTokens)[]) {
    const value = merged[key]
    const fallback = DEFAULT_TOKENS[key]

    if (typeof fallback === 'number') {
      const n = Number(value)
      if (Number.isFinite(n)) (out[key] as number) = n
    } else if (typeof value === 'string' && value.trim() !== '') {
      ;(out[key] as string) = value
    }
  }

  return out
}

/**
 * The tokens as CSS custom properties.
 *
 * Set as an inline style on <html> rather than injected as a <style> block:
 * inline custom properties on the element beat any `:root` rule in a
 * stylesheet, whatever order the stylesheets happen to load in. The defaults in
 * app/globals.css stay exactly where they are and act as the fallback for
 * anything not set here.
 */
export function cssVariables(tokens: StyleTokens): Record<string, string> {
  const display = getFont(tokens.display_font)
  const body = getFont(tokens.body_font)

  return {
    '--surface': tokens.surface,
    '--surface-alt': tokens.surface_alt,
    '--ink': tokens.ink,
    '--ink-soft': tokens.ink_soft,
    '--ink-mute': tokens.ink_mute,
    '--ember': tokens.accent,
    // Derived from ink so a hairline stays right when the palette flips dark.
    '--line': withAlpha(tokens.ink, tokens.line_opacity),

    // next/font sets these for the bundled pair; a chosen family overrides
    // them with its own stack, loaded from Google at runtime.
    '--font-display': display.stack,
    '--font-body': body.stack,

    '--heading-track': `${tokens.heading_tracking}em`,
    '--heading-case': tokens.heading_case,

    '--container': `${tokens.container}px`,
    '--rhythm': String(tokens.rhythm),

    '--button-radius': BUTTON_RADIUS[tokens.button_shape] ?? '0px',
    '--button-case': tokens.button_case,
  }
}

/** #RRGGBB plus an opacity, as rgba(). Falls back to the input if unparseable. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return hex

  const int = parseInt(match[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  const a = Math.min(1, Math.max(0, alpha))

  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * Which Google families need loading at runtime.
 *
 * Oswald and Karla are bundled through next/font in app/layout.tsx, so a site
 * on the defaults pays nothing. Anything else costs one stylesheet — the same
 * trade the gallery covers already make.
 */
export const BUNDLED_FONTS = ['Oswald', 'Karla']

export function fontsToLoad(tokens: StyleTokens): string[] {
  return [tokens.display_font, tokens.body_font]
    .filter((name) => !BUNDLED_FONTS.includes(name))
    .filter((name, i, all) => all.indexOf(name) === i)
}

/** Every family offered, for a select. */
export const FONT_NAMES = COVER_FONTS.map((f) => f.name)

/** Which preset the current values match, if any. */
export function matchingPairing(tokens: StyleTokens): string | null {
  return (
    PAIRINGS.find(
      (p) => p.display === tokens.display_font && p.body === tokens.body_font
    )?.id ?? null
  )
}

export function matchingPalette(tokens: StyleTokens): string | null {
  return (
    PALETTES.find(
      (p) =>
        p.surface.toLowerCase() === tokens.surface.toLowerCase() &&
        p.ink.toLowerCase() === tokens.ink.toLowerCase() &&
        p.accent.toLowerCase() === tokens.accent.toLowerCase()
    )?.id ?? null
  )
}
