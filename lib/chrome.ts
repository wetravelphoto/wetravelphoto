import { FONT_NAMES } from '@/lib/styles/tokens'
import { getFont } from '@/lib/fonts'
import type { SiteSettings } from '@/lib/site'

/**
 * THE HEADER AND THE FOOTER ("the site's chrome")
 * ═══════════════════════════════════════════════
 *
 * Every page shares them, so they are not sections. They are edited in the
 * canvas all the same: click the header or footer in the preview, or its row
 * at the top or bottom of the section list.
 *
 * The values are the site_settings columns they always were (so nothing that
 * reads them changes). While unpublished they sit in the draft's `chrome`
 * object, laid over the live settings, and Publish writes them back, like
 * everything else the canvas edits.
 *
 * This file is the one list of what can be set, with each value's limits.
 * Pure: used by the server actions, the draft store and the editor panel.
 */

type Spec =
  | { part: Part; kind: 'image' }
  | { part: Part; kind: 'int'; min: number; max: number }
  | { part: Part; kind: 'decimal'; min: number; max: number }
  | { part: Part; kind: 'choice'; options: readonly string[] }
  | { part: Part; kind: 'font' }
  | { part: Part; kind: 'text'; max: number }
  | { part: Part; kind: 'toggle' }

export type Part = 'header' | 'footer'

export const HEADER_LAYOUTS = [
  { value: 'split', label: 'Logo left, menu right' },
  { value: 'center', label: 'Logo centred, menu below' },
  { value: 'left', label: 'Logo and menu both left' },
] as const

export const FOOTER_LAYOUTS = [
  { value: 'left', label: 'Three columns' },
  { value: 'center', label: 'Stacked and centred' },
] as const

export const CHROME_FIELDS = {
  logo_header_path: { part: 'header', kind: 'image' },
  logo_header_height: { part: 'header', kind: 'int', min: 16, max: 110 },
  logo_header_height_mobile: { part: 'header', kind: 'int', min: 14, max: 90 },
  header_align: { part: 'header', kind: 'choice', options: HEADER_LAYOUTS.map((l) => l.value) },
  header_nav_font: { part: 'header', kind: 'font' },
  header_nav_scale: { part: 'header', kind: 'decimal', min: 0.7, max: 1.8 },
  header_nav_scale_mobile: { part: 'header', kind: 'decimal', min: 0.7, max: 1.8 },

  logo_footer_path: { part: 'footer', kind: 'image' },
  logo_footer_height: { part: 'footer', kind: 'int', min: 40, max: 280 },
  logo_footer_height_mobile: { part: 'footer', kind: 'int', min: 30, max: 220 },
  footer_align: { part: 'footer', kind: 'choice', options: FOOTER_LAYOUTS.map((l) => l.value) },
  footer_font: { part: 'footer', kind: 'font' },
  footer_scale: { part: 'footer', kind: 'decimal', min: 0.7, max: 1.6 },
  footer_scale_mobile: { part: 'footer', kind: 'decimal', min: 0.7, max: 1.6 },
  footer_copy: { part: 'footer', kind: 'text', max: 200 },
  show_newsletter: { part: 'footer', kind: 'toggle' },
  newsletter_heading: { part: 'footer', kind: 'text', max: 80 },
  newsletter_body: { part: 'footer', kind: 'text', max: 240 },
} as const satisfies Record<string, Spec>

export type ChromeKey = keyof typeof CHROME_FIELDS
export type ChromeValues = Partial<Record<ChromeKey, string | number | boolean | null>>

export const CHROME_KEYS = Object.keys(CHROME_FIELDS) as ChromeKey[]

const STORAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,300}$/

export function isChromeKey(key: string): key is ChromeKey {
  return Object.prototype.hasOwnProperty.call(CHROME_FIELDS, key)
}

/**
 * One value, cleaned, or undefined when it cannot be stored. Everything
 * arrives from a browser or a JSON column, so nothing is trusted: numbers are
 * clamped to their slider's range, choices checked against their list,
 * pictures must be a storage key in the site's own bucket.
 */
export function cleanChromeValue(key: ChromeKey, value: unknown): string | number | boolean | null | undefined {
  const spec: Spec = CHROME_FIELDS[key]
  switch (spec.kind) {
    case 'image':
      // null: no picture of their own, so the built-in logo is used.
      if (value === null || value === '') return null
      return typeof value === 'string' && STORAGE_KEY.test(value) && !value.includes('..') ? value : undefined
    case 'int': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? Math.round(Math.min(spec.max, Math.max(spec.min, n))) : undefined
    }
    case 'decimal': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? Math.round(Math.min(spec.max, Math.max(spec.min, n)) * 100) / 100 : undefined
    }
    case 'choice':
      return typeof value === 'string' && spec.options.includes(value) ? value : undefined
    case 'font':
      return typeof value === 'string' && (FONT_NAMES as readonly string[]).includes(value) ? value : undefined
    case 'text':
      if (value === null) return null
      if (typeof value !== 'string') return undefined
      return value.replace(/\s+/g, ' ').trim().slice(0, spec.max) || null
    case 'toggle':
      return typeof value === 'boolean' ? value : undefined
  }
}

/** A set of values, cleaned; unknown keys and bad values are dropped. */
export function sanitizeChrome(input: unknown): ChromeValues {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: ChromeValues = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isChromeKey(key)) continue
    const clean = cleanChromeValue(key, value)
    if (clean !== undefined) out[key] = clean
  }
  return out
}

/** Which of the two a set of changed keys belongs to, for the Undo label. */
export function chromeLabel(keys: string[]): string {
  const parts = new Set(keys.filter(isChromeKey).map((k) => CHROME_FIELDS[k].part))
  if (parts.size === 1) return parts.has('header') ? 'Header' : 'Footer'
  return 'Header & footer'
}

/** The values as they are in effect, for the editor's panel. */
export function chromeFrom(settings: SiteSettings): Record<ChromeKey, string | number | boolean | null> {
  return Object.fromEntries(
    CHROME_KEYS.map((key) => [key, (settings as unknown as Record<string, unknown>)[key] ?? null])
  ) as Record<ChromeKey, string | number | boolean | null>
}

/**
 * The CSS custom properties a menu or footer typeface sets. Shared by the
 * header/footer renderers and the editor's instant repaint, so the preview
 * sets exactly what the server is about to render.
 */
export function navFontVars(name: string | null): Record<string, string> {
  const font = getFont(name || 'Oswald')
  return {
    '--nav-font': font.stack,
    '--nav-weight': font.weight,
    '--nav-case': font.uppercase ? 'uppercase' : 'none',
    '--nav-track': font.tracking,
  }
}

export function footerFontVars(name: string | null): Record<string, string> {
  const font = getFont(name || 'Karla')
  return { '--footer-font': font.stack, '--footer-weight': font.weight }
}

/**
 * The fields the editor can repaint on the spot, and how: a custom property
 * (with its unit) or an attribute, on the header or the footer element.
 * Anything else waits for the refresh.
 */
export const CHROME_LIVE: Partial<Record<ChromeKey, { var: string; unit?: string } | { attr: string }>> = {
  logo_header_height: { var: '--logo-h', unit: 'px' },
  logo_header_height_mobile: { var: '--logo-h-mobile', unit: 'px' },
  header_nav_scale: { var: '--nav-scale' },
  header_nav_scale_mobile: { var: '--nav-scale-mobile' },
  header_align: { attr: 'data-align' },
  logo_footer_height: { var: '--footer-logo-h', unit: 'px' },
  logo_footer_height_mobile: { var: '--footer-logo-h-mobile', unit: 'px' },
  footer_scale: { var: '--footer-scale' },
  footer_scale_mobile: { var: '--footer-scale-mobile' },
  footer_align: { attr: 'data-align' },
}
