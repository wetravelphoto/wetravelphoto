import { getFont } from '@/lib/fonts'

export type SectionStyle = {
  font?: string
  color?: string
  scale?: number
}

export type TypeStyles = Record<string, SectionStyle>

export const STYLED_SECTIONS = ['hero', 'intro', 'journal', 'contact'] as const
export type StyledSection = (typeof STYLED_SECTIONS)[number]

const DEFAULT_COLORS: Record<string, string> = {
  hero: '#FAF9F6',
  intro: '#14100E',
  journal: '#14100E',
  contact: '#FAF9F6',
}

export function styleFor(styles: TypeStyles | null, section: StyledSection): Required<SectionStyle> {
  const s = styles?.[section] ?? {}
  return {
    font: s.font || 'Oswald',
    color: s.color || DEFAULT_COLORS[section] || '#14100E',
    scale: s.scale ?? 1,
  }
}

/**
 * Section typography is applied as CSS variables so a single wrapper can
 * restyle every heading inside it without prop-drilling.
 */
export function styleVars(styles: TypeStyles | null, section: StyledSection): React.CSSProperties {
  const { font, color, scale } = styleFor(styles, section)
  const f = getFont(font)

  return {
    ['--sec-font' as string]: f.stack,
    ['--sec-weight' as string]: f.weight,
    ['--sec-case' as string]: f.uppercase ? 'uppercase' : 'none',
    ['--sec-track' as string]: f.tracking,
    ['--sec-color' as string]: color,
    ['--sec-scale' as string]: String(scale),
  }
}
