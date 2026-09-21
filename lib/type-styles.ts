import { getFont } from '@/lib/fonts'

export type SectionStyle = {
  font?: string
  color?: string
  scale?: number
  bodyFont?: string
  bodyColor?: string
  bodyScale?: number
}

export type TypeStyles = Record<string, SectionStyle>

export const STYLED_SECTIONS = ['hero', 'intro', 'journal', 'contact'] as const
export type StyledSection = (typeof STYLED_SECTIONS)[number]

/**
 * The hero is the one section whose colour is not a palette decision.
 *
 * Its words sit on a photograph rather than on the page, so they need to be
 * light whatever the palette is doing — a dark palette would otherwise put dark
 * text over a dark picture. Every other section falls through to the global
 * tokens when nothing is set here.
 */
const OVER_IMAGE: Record<string, string> = {
  hero: '#FAF9F6',
}

/**
 * SECTION TYPOGRAPHY IS AN OVERRIDE, NOT A DEFAULT
 * ════════════════════════════════════════════════
 *
 * Only what has actually been chosen is returned. Everything else comes back
 * undefined, and styleVars leaves that variable unset so the CSS fallback —
 * `var(--sec-font, var(--font-display))` — reaches the global token.
 *
 * This used to return a value for every key, defaulting font to 'Oswald' and
 * colour to a hard-coded hex per section. Those defaults were copies of the
 * global defaults, so nothing looked wrong: but because they were always SET,
 * `--sec-font` always won, and the global typeface and colour in Style mode
 * could not reach the intro, journal, contact or hero headings — the largest
 * type on the page. The picker moved and the headings did not.
 *
 * Two controls over one number is only safe when one of them is genuinely
 * silent until used. This is the silence.
 */
export function styleFor(styles: TypeStyles | null, section: StyledSection): SectionStyle {
  const s = styles?.[section] ?? {}

  return {
    font: s.font || undefined,
    color: s.color || OVER_IMAGE[section] || undefined,
    scale: s.scale,
    bodyFont: s.bodyFont || undefined,
    bodyColor: s.bodyColor || OVER_IMAGE[section] || undefined,
    bodyScale: s.bodyScale,
  }
}

/**
 * Section typography is applied as CSS variables, so one wrapper restyles
 * every heading and paragraph inside it without threading props through.
 *
 * A variable that is not set is OMITTED rather than written as empty: CSS
 * treats an empty custom property as a value, and `var(--sec-font, fallback)`
 * would then resolve to nothing instead of the fallback.
 */
export function styleVars(styles: TypeStyles | null, section: StyledSection): React.CSSProperties {
  const { font, color, scale, bodyFont, bodyColor, bodyScale } = styleFor(styles, section)
  const vars: Record<string, string> = {}

  if (font) {
    const heading = getFont(font)
    vars['--sec-font'] = heading.stack
    vars['--sec-weight'] = heading.weight
    vars['--sec-case'] = heading.uppercase ? 'uppercase' : 'none'
    vars['--sec-track'] = heading.tracking
  }

  if (color) vars['--sec-color'] = color
  if (scale !== undefined) vars['--sec-scale'] = String(scale)

  if (bodyFont) {
    const body = getFont(bodyFont)
    vars['--sec-body-font'] = body.stack
    vars['--sec-body-weight'] = body.weight
  }

  if (bodyColor) vars['--sec-body-color'] = bodyColor
  if (bodyScale !== undefined) vars['--sec-body-scale'] = String(bodyScale)

  return vars as React.CSSProperties
}
