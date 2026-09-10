import type { CSSProperties } from 'react'

export type CoverPreset = {
  value: string
  label: string
  /** Where the title block sits within the cover */
  container: CSSProperties
  /** Styling applied to the title text itself */
  title?: CSSProperties
  /** Optional decorative element rendered behind or around the title */
  decoration?: 'none' | 'frame' | 'rules' | 'block' | 'left_bar' | 'underline' | 'boxed'
  /** Eyebrow (location) placement relative to the title */
  eyebrowBelow?: boolean
  align: 'left' | 'center' | 'right'
}

const fill: CSSProperties = { position: 'absolute', display: 'flex', flexDirection: 'column' }

export const COVER_PRESETS: CoverPreset[] = [
  {
    value: 'bottom_left',
    label: 'Anchor',
    container: { ...fill, inset: 0, justifyContent: 'flex-end', alignItems: 'flex-start', padding: '6%' },
    align: 'left',
    decoration: 'none',
  },
  {
    value: 'center',
    label: 'Center',
    container: { ...fill, inset: 0, justifyContent: 'center', alignItems: 'center', padding: '8%' },
    align: 'center',
    decoration: 'none',
  },
  {
    value: 'center_rules',
    label: 'Stripe',
    container: { ...fill, inset: 0, justifyContent: 'center', alignItems: 'center', padding: '8%' },
    align: 'center',
    decoration: 'rules',
  },
  {
    value: 'framed',
    label: 'Frame',
    container: { ...fill, inset: 0, justifyContent: 'center', alignItems: 'center', padding: '8%' },
    align: 'center',
    decoration: 'frame',
  },
  {
    value: 'boxed',
    label: 'Plate',
    container: { ...fill, inset: 0, justifyContent: 'center', alignItems: 'center', padding: '8%' },
    align: 'center',
    decoration: 'boxed',
  },
  {
    value: 'left_bar',
    label: 'Margin',
    container: { ...fill, inset: 0, justifyContent: 'center', alignItems: 'flex-start', padding: '8%' },
    align: 'left',
    decoration: 'left_bar',
  },
  {
    value: 'top_left',
    label: 'Masthead',
    container: { ...fill, inset: 0, justifyContent: 'flex-start', alignItems: 'flex-start', padding: '7%' },
    align: 'left',
    decoration: 'none',
  },
  {
    value: 'top_center',
    label: 'Crest',
    container: { ...fill, inset: 0, justifyContent: 'flex-start', alignItems: 'center', padding: '7%' },
    align: 'center',
    decoration: 'none',
  },
  {
    value: 'bottom_center',
    label: 'Footer',
    container: { ...fill, inset: 0, justifyContent: 'flex-end', alignItems: 'center', padding: '6%' },
    align: 'center',
    decoration: 'none',
  },
  {
    value: 'bottom_right',
    label: 'Corner',
    container: { ...fill, inset: 0, justifyContent: 'flex-end', alignItems: 'flex-end', padding: '6%' },
    align: 'right',
    decoration: 'none',
  },
  {
    value: 'underline',
    label: 'Rule',
    container: { ...fill, inset: 0, justifyContent: 'flex-end', alignItems: 'flex-start', padding: '6%' },
    align: 'left',
    decoration: 'underline',
  },
  {
    value: 'block',
    label: 'Banner',
    container: { ...fill, inset: 0, justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 },
    align: 'left',
    decoration: 'block',
  },
  {
    value: 'eyebrow_below',
    label: 'Journal',
    container: { ...fill, inset: 0, justifyContent: 'flex-end', alignItems: 'flex-start', padding: '6%' },
    align: 'left',
    eyebrowBelow: true,
    decoration: 'none',
  },
  {
    value: 'center_wide',
    label: 'Expedition',
    container: { ...fill, inset: 0, justifyContent: 'center', alignItems: 'center', padding: '6%' },
    align: 'center',
    title: { letterSpacing: '0.2em' },
    decoration: 'none',
  },
  {
    value: 'stacked_left',
    label: 'Field note',
    container: { ...fill, inset: 0, justifyContent: 'flex-end', alignItems: 'flex-start', padding: '6%' },
    align: 'left',
    title: { lineHeight: 0.92 },
    decoration: 'none',
  },
]

export function getPreset(value: string | null): CoverPreset {
  return COVER_PRESETS.find((p) => p.value === value) ?? COVER_PRESETS[0]
}
