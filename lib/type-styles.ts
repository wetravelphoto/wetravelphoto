import { getFont } from '@/lib/fonts'

/**
 * A section's typography: what it has chosen for its heading, its body text and
 * its over-line (the small line above a heading). Every key is optional —
 * anything not chosen follows the site's own type from Style mode.
 */
export type SectionStyle = {
  font?: string
  color?: string
  scale?: number
  bodyFont?: string
  bodyColor?: string
  bodyScale?: number
  eyebrowFont?: string
  eyebrowColor?: string
  eyebrowScale?: number
}

export const SECTION_STYLE_KEYS = [
  'font',
  'color',
  'scale',
  'bodyFont',
  'bodyColor',
  'bodyScale',
  'eyebrowFont',
  'eyebrowColor',
  'eyebrowScale',
] as const

export type TypeStyles = Record<string, SectionStyle>

/**
 * The four old SHARED groups. Before 2026-09-21 typography was stored per
 * group in site_settings.type_styles, so every intro-group section on the site
 * — the intro, the About block, the gallery carousel — shared one setting, and
 * changing one silently changed the others. Now each section carries its own
 * (see sectionStyle below); these groups are only read as the fallback for a
 * section that has never had its own set.
 */
export const STYLED_SECTIONS = ['hero', 'intro', 'journal', 'contact'] as const
export type StyledSection = (typeof STYLED_SECTIONS)[number]

/**
 * The hero is the one section whose colour is not a palette decision.
 *
 * Its words sit on a photograph rather than on the page, so they need to be
 * light whatever the palette is doing — a dark palette would otherwise put dark
 * text over a dark picture. Every other section falls through to the global
 * tokens when nothing is set.
 */
const OVER_IMAGE: Record<string, string> = {
  hero: '#FAF9F6',
}

/**
 * Which old shared group a section drew its typography from, if any.
 *
 * Only the layouts that actually applied a group before per-section typography
 * existed inherit from it — the gallery and journal GRIDS never did, so they
 * inherit nothing, and a site with an intro override does not suddenly see it
 * on its Galleries page. The renderers and the editor's panel both ask here,
 * so what the panel shows is what the page draws.
 */
export function legacyTypeGroup(type: string, settings: Record<string, unknown>): StyledSection | null {
  switch (type) {
    case 'hero':
      return 'hero'
    case 'intro':
    case 'about':
      return 'intro'
    case 'galleries':
      return settings.layout === 'grid' ? null : 'intro'
    case 'journal':
      return settings.layout === 'grid' ? null : 'journal'
    case 'contact':
      return 'contact'
    default:
      return null
  }
}

/**
 * SECTION TYPOGRAPHY IS AN OVERRIDE, NOT A DEFAULT
 * ════════════════════════════════════════════════
 *
 * Only what has actually been chosen is returned. Everything else comes back
 * undefined, and the variable is left unset so the CSS fallback —
 * `var(--sec-font, var(--font-display))` — reaches the global token.
 *
 * An earlier version returned a value for every key, and because they were
 * always SET, the global typeface in Style mode could not reach the section
 * headings at all. Two controls over one number is only safe when one of them
 * is genuinely silent until used. This is the silence.
 */
function clean(s: SectionStyle, overImage: string | undefined): SectionStyle {
  return {
    font: s.font || undefined,
    color: s.color || overImage || undefined,
    scale: typeof s.scale === 'number' ? s.scale : undefined,
    bodyFont: s.bodyFont || undefined,
    bodyColor: s.bodyColor || overImage || undefined,
    bodyScale: typeof s.bodyScale === 'number' ? s.bodyScale : undefined,
    eyebrowFont: s.eyebrowFont || undefined,
    eyebrowColor: s.eyebrowColor || undefined,
    eyebrowScale: typeof s.eyebrowScale === 'number' ? s.eyebrowScale : undefined,
  }
}

/** A group's style, as the old shared setting stored it. */
export function styleFor(styles: TypeStyles | null, section: StyledSection): SectionStyle {
  return clean(styles?.[section] ?? {}, OVER_IMAGE[section])
}

/** The section's own stored choice, or null if it has never had one. */
export function ownStyle(settings: Record<string, unknown>): SectionStyle | null {
  const own = settings.type
  return own && typeof own === 'object' && !Array.isArray(own) ? (own as SectionStyle) : null
}

/**
 * What a section's typography actually is: its own choice if it has one,
 * otherwise whatever its old shared group said (see legacyTypeGroup).
 */
export function sectionStyle(
  type: string,
  settings: Record<string, unknown>,
  styles: TypeStyles | null
): SectionStyle {
  const group = legacyTypeGroup(type, settings)
  const over = group ? OVER_IMAGE[group] : undefined
  const own = ownStyle(settings)

  if (own) return clean(own, over)
  return group ? styleFor(styles, group) : clean({}, over)
}

/**
 * Every variable varsFor can write. The editor needs the full list to repaint
 * a section live: a variable the new choice no longer sets has to be REMOVED,
 * not left behind from the previous one.
 */
export const SEC_VARS = [
  '--sec-font',
  '--sec-weight',
  '--sec-case',
  '--sec-track',
  '--sec-color',
  '--sec-scale',
  '--sec-body-font',
  '--sec-body-weight',
  '--sec-body-color',
  '--sec-body-scale',
  '--sec-eyebrow-font',
  '--sec-eyebrow-weight',
  '--sec-eyebrow-color',
  '--sec-eyebrow-scale',
] as const

/**
 * A style as CSS variables, so one wrapper restyles every heading, paragraph
 * and over-line inside it without threading props through.
 *
 * A variable that is not set is OMITTED rather than written as empty: CSS
 * treats an empty custom property as a value, and `var(--sec-font, fallback)`
 * would then resolve to nothing instead of the fallback.
 */
export function varsFor(style: SectionStyle): Record<string, string> {
  const vars: Record<string, string> = {}

  if (style.font) {
    const heading = getFont(style.font)
    vars['--sec-font'] = heading.stack
    vars['--sec-weight'] = heading.weight
    vars['--sec-case'] = heading.uppercase ? 'uppercase' : 'none'
    vars['--sec-track'] = heading.tracking
  }
  if (style.color) vars['--sec-color'] = style.color
  if (style.scale !== undefined) vars['--sec-scale'] = String(style.scale)

  if (style.bodyFont) {
    const body = getFont(style.bodyFont)
    vars['--sec-body-font'] = body.stack
    vars['--sec-body-weight'] = body.weight
  }
  if (style.bodyColor) vars['--sec-body-color'] = style.bodyColor
  if (style.bodyScale !== undefined) vars['--sec-body-scale'] = String(style.bodyScale)

  if (style.eyebrowFont) {
    const eyebrow = getFont(style.eyebrowFont)
    vars['--sec-eyebrow-font'] = eyebrow.stack
    vars['--sec-eyebrow-weight'] = eyebrow.weight
  }
  if (style.eyebrowColor) vars['--sec-eyebrow-color'] = style.eyebrowColor
  if (style.eyebrowScale !== undefined) vars['--sec-eyebrow-scale'] = String(style.eyebrowScale)

  return vars
}

/** A section's typography as the inline style its root element carries. */
export function sectionVars(
  type: string,
  settings: Record<string, unknown>,
  styles: TypeStyles | null
): React.CSSProperties {
  return varsFor(sectionStyle(type, settings, styles)) as React.CSSProperties
}

/** The old group-keyed form, kept for callers outside the sections. */
export function styleVars(styles: TypeStyles | null, section: StyledSection): React.CSSProperties {
  return varsFor(styleFor(styles, section)) as React.CSSProperties
}

/**
 * Whether a section's typography is its own rather than the site's — set on
 * the section itself, or inherited from an old shared group override. Style
 * mode lists these, because they win over the typeface and colour set there.
 */
export function hasOwnType(
  type: string,
  settings: Record<string, unknown>,
  styles: TypeStyles | null
): boolean {
  const group = legacyTypeGroup(type, settings)
  const own = ownStyle(settings) ?? (group ? styles?.[group] : null)
  return !!own && Object.values(own).some((v) => v !== undefined && v !== null && v !== '')
}
