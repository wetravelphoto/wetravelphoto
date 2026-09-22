export type CoverFont = {
  name: string
  stack: string
  weight: string
  uppercase: boolean
  tracking: string
  category: 'condensed' | 'sans' | 'serif' | 'display' | 'mono'
}

export const COVER_FONTS: CoverFont[] = [
  { name: 'Oswald', stack: "'Oswald', sans-serif", weight: '400', uppercase: true, tracking: '0.02em', category: 'condensed' },
  { name: 'Bebas Neue', stack: "'Bebas Neue', sans-serif", weight: '400', uppercase: true, tracking: '0.04em', category: 'condensed' },
  { name: 'Anton', stack: "'Anton', sans-serif", weight: '400', uppercase: true, tracking: '0.01em', category: 'condensed' },
  { name: 'Archivo Black', stack: "'Archivo Black', sans-serif", weight: '400', uppercase: true, tracking: '0em', category: 'display' },
  { name: 'Barlow Condensed', stack: "'Barlow Condensed', sans-serif", weight: '500', uppercase: true, tracking: '0.06em', category: 'condensed' },
  { name: 'Fjalla One', stack: "'Fjalla One', sans-serif", weight: '400', uppercase: true, tracking: '0.02em', category: 'condensed' },
  { name: 'Inter', stack: "'Inter', sans-serif", weight: '600', uppercase: false, tracking: '-0.01em', category: 'sans' },
  { name: 'Karla', stack: "'Karla', sans-serif", weight: '600', uppercase: false, tracking: '0em', category: 'sans' },
  { name: 'Space Grotesk', stack: "'Space Grotesk', sans-serif", weight: '500', uppercase: false, tracking: '-0.01em', category: 'sans' },
  { name: 'Work Sans', stack: "'Work Sans', sans-serif", weight: '500', uppercase: false, tracking: '0em', category: 'sans' },
  { name: 'Jost', stack: "'Jost', sans-serif", weight: '400', uppercase: true, tracking: '0.14em', category: 'sans' },
  { name: 'Cormorant Garamond', stack: "'Cormorant Garamond', serif", weight: '400', uppercase: false, tracking: '0.01em', category: 'serif' },
  { name: 'Playfair Display', stack: "'Playfair Display', serif", weight: '500', uppercase: false, tracking: '0em', category: 'serif' },
  { name: 'Lora', stack: "'Lora', serif", weight: '500', uppercase: false, tracking: '0em', category: 'serif' },
  { name: 'EB Garamond', stack: "'EB Garamond', serif", weight: '500', uppercase: false, tracking: '0.01em', category: 'serif' },
  { name: 'Libre Baskerville', stack: "'Libre Baskerville', serif", weight: '400', uppercase: false, tracking: '0em', category: 'serif' },
  { name: 'Spectral', stack: "'Spectral', serif", weight: '400', uppercase: false, tracking: '0em', category: 'serif' },
  { name: 'Italiana', stack: "'Italiana', serif", weight: '400', uppercase: true, tracking: '0.16em', category: 'display' },
  { name: 'Marcellus', stack: "'Marcellus', serif", weight: '400', uppercase: true, tracking: '0.1em', category: 'display' },
  { name: 'JetBrains Mono', stack: "'JetBrains Mono', monospace", weight: '500', uppercase: true, tracking: '0.08em', category: 'mono' },
]

/**
 * Families published at a single weight. Google's css2 endpoint returns a 400
 * if you ask for a weight axis these don't have, so the stylesheet never
 * loads and the browser quietly falls back to a default face.
 */
const SINGLE_WEIGHT = new Set([
  'Bebas Neue',
  'Anton',
  'Archivo Black',
  'Fjalla One',
  'Italiana',
  'Marcellus',
])

export function getFont(name: string | null): CoverFont {
  return COVER_FONTS.find((f) => f.name === name) ?? COVER_FONTS[0]
}

export function fontHref(name: string): string {
  const font = getFont(name)
  const family = font.name.replace(/ /g, '+')

  // Ask for the weight only where the family actually offers a choice
  const axis = SINGLE_WEIGHT.has(font.name) ? '' : `:wght@${font.weight}`

  return `https://fonts.googleapis.com/css2?family=${family}${axis}&display=swap`
}

export const TITLE_COLORS = [
  '#FAF9F6',
  '#FFFFFF',
  '#14100E',
  '#E8B48C',
  '#B5602C',
  '#C9D6D2',
  '#8A9A8C',
  '#D8CFC2',
]

/**
 * The typeface the ADMIN and the EDITOR are drawn in — not one of the site's,
 * on purpose: the tools must not change shape when a photographer changes
 * their site's type. Three weights, because the chrome needs regular text as
 * well as labels and buttons.
 */
export const UI_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'
