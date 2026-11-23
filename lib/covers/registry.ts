/**
 * THE CLIENT-GALLERY COVER STYLES — a closed registry
 * ═══════════════════════════════════════════════════
 *
 * The fourteen styles Gonzalo approved on 2026-11-22
 * (.ai-handoff/cover-designs/README.md), under the semantic keys listed
 * there. Closed and enumerable in the shape of `SECTIONS`: every style says
 * which orientation it suits, how many photographs it takes, the crop of its
 * photograph slot on a wide and a narrow screen, and which controls it uses.
 * The editor offers only those controls; the renderer reads only these
 * values. Nothing here is CSS a photographer can write.
 *
 * Built so each style can later become a variant of a Scene (PROJECT-CONTEXT
 * §4): a style is a presentation recipe — slots, controls, defaults — and its
 * component composes existing pieces. Content (title, eyebrow, the photograph)
 * lives on the album, never on the style, so switching styles keeps it.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 * `albums.cover_preset` already holds the legacy layout keys
 * (lib/cover-layouts.ts — anchor, center, … plate, … journal, and the column
 * default `bottom_left`). Those stay valid and keep their current rendering
 * (components/CoverRenderer.tsx), byte for byte.
 *
 * The semantic keys below are the approved names, and one of them — `plate` —
 * is ALSO a legacy layout. So a new style is never stored under its bare key:
 * it is stored as `v2:<key>` (`coverPresetValue`), every one of them, and only
 * a prefixed value resolves to a style (`coverStyle`). A bare value — legacy
 * `plate` included — is always the legacy layout. No stored value can mean
 * both, and no existing row is rewritten. Never remove or repurpose a key or
 * the prefix; adding a key is free.
 */
import { COVER_LAYOUTS } from '@/lib/cover-layouts'

export const COVER_STYLE_KEYS = [
  'lightbox',
  'cinemascope',
  'panorama_band',
  'portrait_split',
  'diptych',
  'museum_print',
  'chapter',
  'full_bleed',
  'folio',
  'marquee',
  'colophon',
  'overlay',
  'plate',
  'frontispiece',
] as const

export type CoverStyleKey = (typeof COVER_STYLE_KEYS)[number]

export type CoverOrientation = 'landscape' | 'portrait'

/** The controls a style can use. `background` is on every style. */
export type CoverControl = 'title' | 'eyebrow' | 'date' | 'button' | 'font' | 'size' | 'titleColor' | 'background'

// ── Title fonts ─────────────────────────────────────────────────────────────

/**
 * The six title faces the approved designs offer, each at the one weight the
 * designs use. Stored in the existing `albums.cover_font` column by name; a
 * legacy name there (Bebas Neue, Jost, …) is simply not one of these, and a
 * new-style cover then uses the style's own default face.
 */
export const COVER_TITLE_FONTS = [
  { name: 'Bodoni Moda', stack: "'Bodoni Moda', Didot, serif", weight: 400, italic: true, serif: true },
  { name: 'Cormorant Garamond', stack: "'Cormorant Garamond', Garamond, serif", weight: 400, italic: true, serif: true },
  { name: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", weight: 400, italic: true, serif: true },
  { name: 'Archivo Black', stack: "'Archivo Black', 'Arial Black', sans-serif", weight: 400, italic: false, serif: false },
  { name: 'Inter Tight', stack: "'Inter Tight', Arial, sans-serif", weight: 800, italic: false, serif: false },
  { name: 'Oswald', stack: "Oswald, 'Arial Narrow', sans-serif", weight: 500, italic: false, serif: false },
] as const

export type CoverTitleFont = (typeof COVER_TITLE_FONTS)[number]
export type CoverFontName = CoverTitleFont['name']

export function titleFont(name: string | null | undefined): CoverTitleFont | null {
  return COVER_TITLE_FONTS.find((f) => f.name === name) ?? null
}

/**
 * The stylesheet for ONE face — the selected one, and nothing else, so a
 * cover loads exactly the family it draws. Google's css2 endpoint refuses a
 * weight axis a single-weight family does not have (Archivo Black), which
 * would leave the browser on a fallback face without a word.
 */
export function titleFontHref(font: CoverTitleFont): string {
  const family = font.name.replace(/ /g, '+')
  if (font.name === 'Archivo Black') return `https://fonts.googleapis.com/css2?family=${family}&display=swap`
  const axis = font.italic ? `:ital,wght@0,${font.weight};1,${font.weight}` : `:wght@${font.weight}`
  return `https://fonts.googleapis.com/css2?family=${family}${axis}&display=swap`
}

// ── Styles ──────────────────────────────────────────────────────────────────

/**
 * A photograph slot's crop, width ÷ height, on a wide screen and on a phone.
 * Held between 4:5 and 2:1 — the approved rule (most photographs are 3:2) —
 * except where `fillsScreen` says the slot is the whole screen, which relies
 * on the focal point instead.
 */
export type SlotAspect = { readonly wide: number; readonly narrow: number }

export type CoverStyle = {
  readonly key: CoverStyleKey
  /** The design's number in the approved set, for the record. */
  readonly number: string
  readonly label: string
  /** The orientations of cover photograph this style was drawn for. Others still work; the picker marks them. */
  readonly suits: readonly CoverOrientation[]
  /** How many photographs the style draws. `diptych` takes a second. */
  readonly photos: 1 | 2
  /** `lightbox` blurs the album's own photographs behind the cover. */
  readonly usesAlbumBackdrop: boolean
  readonly controls: readonly CoverControl[]
  readonly slot: SlotAspect
  /** True when the photograph slot is the whole screen (focal point does the work). */
  readonly fillsScreen: boolean
  readonly defaults: { readonly font: CoverFontName; readonly titleColor: string; readonly background: string }
  /** Swatches offered for the title colour and the background; a custom colour is always allowed too. */
  readonly titleColors: readonly string[]
  readonly backgrounds: readonly string[]
}

const ALL: readonly CoverControl[] = ['title', 'eyebrow', 'date', 'button', 'font', 'size', 'titleColor', 'background']
const NO_EYEBROW: readonly CoverControl[] = ALL.filter((c) => c !== 'eyebrow')

const DARK_BG = ['#12100E', '#1E2620', '#2B2622', '#0A0A09'] as const
const LIGHT_BG = ['#FAF9F6', '#F6F1E8', '#EDE6DA', '#E9ECE8'] as const
const LIGHT_INK = ['#FAF9F6', '#FFFFFF', '#E8D9C4', '#141210'] as const
const DARK_INK = ['#141210', '#3B2F2A', '#6E1E1E', '#2F3B33'] as const

const CROP = { min: 0.8, max: 2 } as const

export const COVER_STYLES: Readonly<Record<CoverStyleKey, CoverStyle>> = {
  lightbox: {
    key: 'lightbox', number: '01', label: 'Lightbox',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: true, controls: ALL,
    slot: { wide: 2, narrow: 1.5 }, fillsScreen: false,
    defaults: { font: 'Cormorant Garamond', titleColor: '#FAF9F6', background: '#12100E' },
    titleColors: LIGHT_INK, backgrounds: DARK_BG,
  },
  cinemascope: {
    key: 'cinemascope', number: '02', label: 'Cinemascope',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: false, controls: NO_EYEBROW,
    slot: { wide: 2, narrow: 1.5 }, fillsScreen: false,
    defaults: { font: 'Oswald', titleColor: '#F4F1EA', background: '#0A0A09' },
    titleColors: ['#F4F1EA', '#FFFFFF', '#E8D9C4', '#141210'], backgrounds: ['#0A0A09', '#1E2620', '#2B2622', '#FAF9F6'],
  },
  panorama_band: {
    key: 'panorama_band', number: '03', label: 'Panorama band',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 2, narrow: 1.5 }, fillsScreen: false,
    defaults: { font: 'Cormorant Garamond', titleColor: '#141210', background: '#FAF9F6' },
    titleColors: DARK_INK, backgrounds: LIGHT_BG,
  },
  portrait_split: {
    key: 'portrait_split', number: '04', label: 'Portrait split',
    suits: ['portrait'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 0.8, narrow: 0.8 }, fillsScreen: false,
    defaults: { font: 'Oswald', titleColor: '#141210', background: '#F3EFE8' },
    titleColors: DARK_INK, backgrounds: ['#F3EFE8', '#FAF9F6', '#EDE6DA', '#E9ECE8'],
  },
  diptych: {
    key: 'diptych', number: '05', label: 'Diptych',
    suits: ['portrait'], photos: 2, usesAlbumBackdrop: false, controls: NO_EYEBROW,
    slot: { wide: 0.8, narrow: 0.8 }, fillsScreen: false,
    defaults: { font: 'Cormorant Garamond', titleColor: '#F4F1EA', background: '#1A1714' },
    titleColors: ['#F4F1EA', '#FFFFFF', '#E8D9C4', '#D49A6A'], backgrounds: ['#1A1714', '#1E2620', '#0A0A09', '#3A2A22'],
  },
  museum_print: {
    key: 'museum_print', number: '06', label: 'Museum print',
    suits: ['portrait'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 0.8, narrow: 0.8 }, fillsScreen: false,
    defaults: { font: 'Cormorant Garamond', titleColor: '#F3EFE7', background: '#1E2620' },
    titleColors: ['#F3EFE7', '#FFFFFF', '#E8D9C4', '#141210'], backgrounds: ['#1E2620', '#1A1714', '#2B2622', '#3B2F2A'],
  },
  chapter: {
    key: 'chapter', number: '07', label: 'Chapter',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 1.18, narrow: 1.18 }, fillsScreen: false,
    defaults: { font: 'Cormorant Garamond', titleColor: '#141210', background: '#FAF9F6' },
    titleColors: DARK_INK, backgrounds: LIGHT_BG,
  },
  full_bleed: {
    key: 'full_bleed', number: '08', label: 'Full bleed',
    suits: ['portrait'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 1.6, narrow: 390 / 844 }, fillsScreen: true,
    defaults: { font: 'Oswald', titleColor: '#FAF9F6', background: '#12100E' },
    titleColors: LIGHT_INK, backgrounds: DARK_BG,
  },
  folio: {
    key: 'folio', number: '09', label: 'Folio',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 1.5, narrow: 1.5 }, fillsScreen: false,
    defaults: { font: 'Bodoni Moda', titleColor: '#141210', background: '#F6F1E8' },
    titleColors: DARK_INK, backgrounds: ['#F6F1E8', '#FAF9F6', '#EDE6DA', '#E9ECE8'],
  },
  marquee: {
    key: 'marquee', number: '10', label: 'Marquee',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 2, narrow: 1.5 }, fillsScreen: false,
    defaults: { font: 'Archivo Black', titleColor: '#111111', background: '#FAF9F6' },
    titleColors: ['#111111', '#6E1E1E', '#9A5A33', '#2F3B33'], backgrounds: ['#FAF9F6', '#F6F1E8', '#EDE6DA', '#FFFFFF'],
  },
  colophon: {
    key: 'colophon', number: '11', label: 'Colophon',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 1.5, narrow: 1.5 }, fillsScreen: false,
    defaults: { font: 'Bodoni Moda', titleColor: '#F6EFE6', background: '#2B2622' },
    titleColors: ['#F6EFE6', '#FFFFFF', '#E8D9C4', '#141210'], backgrounds: ['#2B2622', '#1E2620', '#5B1A1A', '#F6F1E8'],
  },
  overlay: {
    key: 'overlay', number: '12', label: 'Overlay',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 1.6, narrow: 1.5 }, fillsScreen: false,
    defaults: { font: 'Bodoni Moda', titleColor: '#FAF9F6', background: '#12100E' },
    titleColors: LIGHT_INK, backgrounds: ['#12100E', '#1E2620', '#2B2622', '#F6F1E8'],
  },
  plate: {
    key: 'plate', number: '13', label: 'Plate',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 1.5, narrow: 1.5 }, fillsScreen: false,
    defaults: { font: 'Cormorant Garamond', titleColor: '#F2EEE7', background: '#161412' },
    titleColors: ['#F2EEE7', '#FFFFFF', '#D9B48F', '#141210'], backgrounds: ['#161412', '#1E2620', '#2B2622', '#F6F1E8'],
  },
  frontispiece: {
    key: 'frontispiece', number: '14', label: 'Frontispiece',
    suits: ['landscape'], photos: 1, usesAlbumBackdrop: false, controls: ALL,
    slot: { wide: 1.5, narrow: 1.5 }, fillsScreen: false,
    defaults: { font: 'Playfair Display', titleColor: '#1F1A16', background: '#FAF9F6' },
    titleColors: ['#1F1A16', '#6E1E1E', '#2F3B33', '#9A5A33'], backgrounds: ['#FAF9F6', '#F6F1E8', '#EDE6DA', '#FFFFFF'],
  },
}

export function isCoverStyleKey(value: unknown): value is CoverStyleKey {
  return typeof value === 'string' && (COVER_STYLE_KEYS as readonly string[]).includes(value)
}

// ── What is stored ──────────────────────────────────────────────────────────

/** Every new style's `cover_preset` starts with this; no legacy value does. */
export const COVER_STYLE_PREFIX = 'v2:'

/** The `cover_preset` value that stores a style: `v2:<key>`. */
export function coverPresetValue(key: CoverStyleKey): string {
  return `${COVER_STYLE_PREFIX}${key}`
}

/**
 * The registry entry for a stored `cover_preset`, or null for a legacy (or
 * unknown) value — null is what routes an album to the legacy renderer. Only
 * an exact `v2:<key>` resolves: legacy `plate` is the legacy Plate layout, and
 * a bare `lightbox` (never written by this code) is not a style either.
 */
export function coverStyle(preset: string | null | undefined): CoverStyle | null {
  if (typeof preset !== 'string' || !preset.startsWith(COVER_STYLE_PREFIX)) return null
  const key = preset.slice(COVER_STYLE_PREFIX.length)
  return isCoverStyleKey(key) ? COVER_STYLES[key] : null
}

/** The legacy presets (lib/cover-layouts.ts), plus the column's own default. */
export const LEGACY_COVER_PRESETS: ReadonlySet<string> = new Set([...COVER_LAYOUTS.map((l) => l.value), 'bottom_left'])

/**
 * A `cover_preset` from a form, as it may be stored: a prefixed style or a
 * legacy layout, exactly — anything else is null (the save then keeps what the
 * album has).
 */
export function storableCoverPreset(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (coverStyle(value)) return value
  return LEGACY_COVER_PRESETS.has(value) ? value : null
}

/** True when a slot's crop obeys the approved bounds (or the slot is the whole screen). */
export function cropWithinBounds(style: CoverStyle): boolean {
  const inside = (a: number) => a >= CROP.min - 1e-9 && a <= CROP.max + 1e-9
  return inside(style.slot.wide) && (style.fillsScreen || inside(style.slot.narrow))
}

// ── Values ──────────────────────────────────────────────────────────────────

/** Title size, as the multiplier the approved designs use: 60–160 %. */
export const TITLE_SCALE = { min: 0.6, max: 1.6, step: 0.05 } as const
/** Reframe zoom, the database's own range (albums_cover_zoom_range): 100–250 %. */
export const COVER_ZOOM = { min: 1, max: 2.5, step: 0.01 } as const

const HEX = /^#[0-9A-Fa-f]{6}$/

/** A colour exactly as albums_cover_background_hex accepts it, or null. Never a CSS fragment. */
export function hexColor(value: unknown): string | null {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toUpperCase() : null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function clampTitleScale(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? clamp(n, TITLE_SCALE.min, TITLE_SCALE.max) : 1
}

/** NULL / non-finite → 1 (no zoom). */
export function clampZoom(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(n) ? clamp(n, COVER_ZOOM.min, COVER_ZOOM.max) : 1
}

/** 0–1, defaulting to the centre — the meaning `cover_focal_x/y` always had. */
export function clampFocal(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(n) ? clamp(n, 0, 1) : 0.5
}

/** Landscape / portrait from a photograph's own size; unknown → null (treated as landscape, the common case). */
export function orientationOf(width: number | null | undefined, height: number | null | undefined): CoverOrientation | null {
  if (!width || !height) return null
  if (width === height) return null
  return width > height ? 'landscape' : 'portrait'
}

/** Whether a style suits a photograph of this orientation. An unknown orientation suits everything. */
export function suitsOrientation(style: CoverStyle, orientation: CoverOrientation | null): boolean {
  return orientation === null || style.suits.includes(orientation)
}
