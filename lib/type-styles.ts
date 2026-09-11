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

const DEFAULT_HEADING: Record<string, string> = {
  hero: '#FAF9F6',
  intro: '#14100E',
  journal: '#14100E',
  contact: '#14100E',
}

const DEFAULT_BODY: Record<string, string> = {
  hero: '#FAF9F6',
  intro: '#4A4642',
  journal: '#4A4642',
  contact: '#4A4642',
}

export function styleFor(styles: TypeStyles | null, section: StyledSection): Required<SectionStyle> {
  const s = styles?.[section] ?? {}
  return {
    font: s.font || 'Oswald',
    color: s.color || DEFAULT_HEADING[section] || '#14100E',
    scale: s.scale ?? 1,
    bodyFont: s.bodyFont || 'Karla',
    bodyColor: s.bodyColor || DEFAULT_BODY[section] || '#4A4642',
    bodyScale: s.bodyScale ?? 1,
  }
}

/**
 * Section typography is applied as CSS variables, so one wrapper restyles
 * every heading and paragraph inside it without threading props through.
 */
export function styleVars(styles: TypeStyles | null, section: StyledSection): React.CSSProperties {
  const { font, color, scale, bodyFont, bodyColor, bodyScale } = styleFor(styles, section)
  const heading = getFont(font)
  const body = getFont(bodyFont)

  return {
    ['--sec-font' as string]: heading.stack,
    ['--sec-weight' as string]: heading.weight,
    ['--sec-case' as string]: heading.uppercase ? 'uppercase' : 'none',
    ['--sec-track' as string]: heading.tracking,
    ['--sec-color' as string]: color,
    ['--sec-scale' as string]: String(scale),

    ['--sec-body-font' as string]: body.stack,
    ['--sec-body-weight' as string]: body.weight,
    ['--sec-body-color' as string]: bodyColor,
    ['--sec-body-scale' as string]: String(bodyScale),
  }
}
