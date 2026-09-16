'use server'

import { revalidatePath } from 'next/cache'
import { patchSiteSettings } from '@/lib/site-patch'
import { getSiteSettings } from '@/lib/site'
import {
  DEFAULT_TOKENS,
  PAIRINGS,
  PALETTES,
  TOKENS_VERSION,
  resolveTokens,
  type StyleTokens,
} from '@/lib/styles/tokens'

/**
 * Global styles are site-wide, so a save touches every page.
 *
 * 'layout' rather than a path list: the tokens are emitted in the root layout,
 * so a page revalidated on its own would keep the old ones.
 */
function done() {
  revalidatePath('/', 'layout')
  revalidatePath('/admin/design/style')
}

/**
 * Writes only the keys that were actually sent.
 *
 * Merged over what is stored rather than replacing it, so applying a palette
 * does not silently reset the typography — the panel sends one group at a time
 * and each should mean only itself.
 */
async function save(changes: Partial<StyleTokens>) {
  const settings = await getSiteSettings()
  const current = resolveTokens(settings.global_styles, settings.global_styles_version)

  const next: Record<string, unknown> = { ...current, ...changes }

  // Store only what differs from the defaults. A site on the defaults keeps an
  // empty object, which is what makes "reset" a real state rather than a
  // snapshot of whatever the defaults happened to be on the day it was saved.
  const trimmed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(next)) {
    if (value !== DEFAULT_TOKENS[key as keyof StyleTokens]) trimmed[key] = value
  }

  await patchSiteSettings({
    global_styles: trimmed,
    global_styles_version: TOKENS_VERSION,
  })

  done()
}

// ── Presets ──────────────────────────────────────────────────────────────────

export async function applyPairing(id: string) {
  const pairing = PAIRINGS.find((p) => p.id === id)
  if (!pairing) throw new Error(`No pairing called "${id}".`)

  await save({
    display_font: pairing.display,
    body_font: pairing.body,
    heading_case: pairing.heading_case,
    heading_tracking: pairing.heading_tracking,
  })
}

export async function applyPalette(id: string) {
  const palette = PALETTES.find((p) => p.id === id)
  if (!palette) throw new Error(`No palette called "${id}".`)

  await save({
    surface: palette.surface,
    surface_alt: palette.surface_alt,
    ink: palette.ink,
    ink_soft: palette.ink_soft,
    ink_mute: palette.ink_mute,
    accent: palette.accent,
  })
}

// ── Individual values ────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i

export async function updateStyles(formData: FormData) {
  const text = (key: string) => ((formData.get(key) as string) ?? '').trim()

  const colour = (key: keyof StyleTokens) => {
    const value = text(key)
    // A malformed colour is dropped rather than written: an unparseable value
    // reaches the page as an invalid custom property, which CSS treats as
    // "unset" — and an unset --ink is invisible text.
    return HEX.test(value) ? value : undefined
  }

  const number = (key: string, min: number, max: number) => {
    const raw = Number(text(key))
    if (!Number.isFinite(raw)) return undefined
    return Math.min(max, Math.max(min, raw))
  }

  const changes: Partial<StyleTokens> = {}

  for (const key of ['surface', 'surface_alt', 'ink', 'ink_soft', 'ink_mute', 'accent'] as const) {
    const value = colour(key)
    if (value) changes[key] = value
  }

  const lineOpacity = number('line_opacity', 0, 0.5)
  if (lineOpacity !== undefined) changes.line_opacity = lineOpacity

  const display = text('display_font')
  if (display) changes.display_font = display
  const body = text('body_font')
  if (body) changes.body_font = body

  const tracking = number('heading_tracking', -0.05, 0.3)
  if (tracking !== undefined) changes.heading_tracking = tracking

  const headingCase = text('heading_case')
  if (headingCase === 'uppercase' || headingCase === 'none') changes.heading_case = headingCase

  const container = number('container', 900, 1800)
  if (container !== undefined) changes.container = Math.round(container)

  const rhythm = number('rhythm', 0.6, 1.6)
  if (rhythm !== undefined) changes.rhythm = rhythm

  const shape = text('button_shape')
  if (shape === 'square' || shape === 'soft' || shape === 'pill') changes.button_shape = shape

  const buttonCase = text('button_case')
  if (buttonCase === 'uppercase' || buttonCase === 'none') changes.button_case = buttonCase

  await save(changes)
}

/** Back to the values the site shipped with. */
export async function resetStyles() {
  await patchSiteSettings({ global_styles: {}, global_styles_version: TOKENS_VERSION })
  done()
}
