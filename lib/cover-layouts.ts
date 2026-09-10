/**
 * Cover layouts change the whole composition of the cover — not just
 * where the title sits. `kind` drives the structure; the rest tunes it.
 */

export type CoverLayout = {
  value: string
  label: string
  /** Structural family */
  kind: 'fullbleed' | 'split' | 'card' | 'banner' | 'inset'
  /** For fullbleed: where the text block anchors */
  anchor?: 'bottom-left' | 'bottom-center' | 'center' | 'top-center' | 'top-left' | 'bottom-right'
  /** For split: which side the photo occupies */
  photoSide?: 'left' | 'right'
  /** Decorative treatment around the text */
  decoration?: 'none' | 'frame' | 'rules' | 'plate' | 'left-bar' | 'underline' | 'banner-bar'
  /** Text sits on a light panel rather than over the photo */
  lightText?: boolean
  align: 'left' | 'center' | 'right'
  /** Photo aspect inside card layouts */
  cardAspect?: string
}

export const COVER_LAYOUTS: CoverLayout[] = [
  {
    value: 'anchor',
    label: 'Anchor',
    kind: 'fullbleed',
    anchor: 'bottom-left',
    align: 'left',
    decoration: 'none',
  },
  {
    value: 'center',
    label: 'Center',
    kind: 'fullbleed',
    anchor: 'center',
    align: 'center',
    decoration: 'none',
  },
  {
    value: 'stripe',
    label: 'Stripe',
    kind: 'fullbleed',
    anchor: 'center',
    align: 'center',
    decoration: 'rules',
  },
  {
    value: 'frame',
    label: 'Frame',
    kind: 'inset',
    anchor: 'center',
    align: 'center',
    decoration: 'frame',
  },
  {
    value: 'plate',
    label: 'Plate',
    kind: 'fullbleed',
    anchor: 'center',
    align: 'center',
    decoration: 'plate',
  },
  {
    value: 'masthead',
    label: 'Masthead',
    kind: 'fullbleed',
    anchor: 'top-center',
    align: 'center',
    decoration: 'none',
  },
  {
    value: 'corner',
    label: 'Corner',
    kind: 'fullbleed',
    anchor: 'bottom-right',
    align: 'right',
    decoration: 'none',
  },
  {
    value: 'margin',
    label: 'Margin',
    kind: 'fullbleed',
    anchor: 'bottom-left',
    align: 'left',
    decoration: 'left-bar',
  },
  {
    value: 'banner_bar',
    label: 'Banner',
    kind: 'fullbleed',
    anchor: 'bottom-center',
    align: 'left',
    decoration: 'banner-bar',
  },
  // Structural layouts — photo and text share the page
  {
    value: 'novel',
    label: 'Novel',
    kind: 'split',
    photoSide: 'right',
    align: 'left',
    lightText: true,
    decoration: 'none',
  },
  {
    value: 'novel_left',
    label: 'Reverse',
    kind: 'split',
    photoSide: 'left',
    align: 'left',
    lightText: true,
    decoration: 'none',
  },
  {
    value: 'divider',
    label: 'Divider',
    kind: 'split',
    photoSide: 'right',
    align: 'left',
    lightText: true,
    decoration: 'underline',
  },
  {
    value: 'gallery_card',
    label: 'Portfolio',
    kind: 'card',
    align: 'center',
    lightText: true,
    cardAspect: '4 / 5',
    decoration: 'none',
  },
  {
    value: 'wide_card',
    label: 'Editorial',
    kind: 'card',
    align: 'center',
    lightText: true,
    cardAspect: '16 / 9',
    decoration: 'rules',
  },
  {
    value: 'journal',
    label: 'Journal',
    kind: 'banner',
    align: 'left',
    lightText: true,
    decoration: 'none',
  },
]

export function getLayout(value: string | null): CoverLayout {
  return COVER_LAYOUTS.find((l) => l.value === value) ?? COVER_LAYOUTS[0]
}
