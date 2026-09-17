import { DEFAULT_TOKENS, FONT_NAMES, type StyleTokens } from '@/lib/styles/tokens'

/**
 * WHAT MAY BE WRITTEN INTO A TOKEN
 * ════════════════════════════════
 *
 * The canvas's style controls reach the server through a server action, and a
 * server action is a public endpoint — anything can post anything to it. So the
 * values are checked here rather than trusted because the panel drew them.
 *
 * Rejection is silent and per-key: a bad value is DROPPED, not defaulted, so
 * one malformed field cannot take the rest of the save down with it.
 *
 * The reason to drop rather than pass through is specific and worth keeping:
 * an unparseable value reaches the page as an invalid custom property, and CSS
 * treats an invalid custom property as unset. An unset `--ink` is invisible
 * text on the live site.
 */

const HEX = /^#[0-9a-f]{6}$/i

const COLOURS = ['surface', 'surface_alt', 'ink', 'ink_soft', 'ink_mute', 'accent'] as const

/** Min and max for every number a person can set. */
const RANGES: Record<string, [number, number]> = {
  line_opacity: [0, 0.5],
  heading_tracking: [-0.05, 0.3],
  container: [900, 1800],
  rhythm: [0.6, 1.6],
}

const ENUMS: Record<string, readonly string[]> = {
  heading_case: ['uppercase', 'none'],
  button_shape: ['square', 'soft', 'pill'],
  button_case: ['uppercase', 'none'],
}

export function sanitizeTokens(input: unknown): Partial<StyleTokens> {
  if (!input || typeof input !== 'object') return {}

  const raw = input as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const key of COLOURS) {
    const value = raw[key]
    if (typeof value === 'string' && HEX.test(value.trim())) out[key] = value.trim()
  }

  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const value = Number(raw[key])
    if (!Number.isFinite(value)) continue
    const clamped = Math.min(max, Math.max(min, value))
    out[key] = key === 'container' ? Math.round(clamped) : clamped
  }

  for (const [key, allowed] of Object.entries(ENUMS)) {
    const value = raw[key]
    if (typeof value === 'string' && allowed.includes(value)) out[key] = value
  }

  // A typeface has to be one this site can actually load. An arbitrary string
  // would reach the page as a font-family that resolves to nothing, and the
  // fallback would be silent.
  for (const key of ['display_font', 'body_font'] as const) {
    const value = raw[key]
    if (typeof value === 'string' && FONT_NAMES.includes(value)) out[key] = value
  }

  return out as Partial<StyleTokens>
}

/**
 * Stores only what differs from the defaults.
 *
 * A site on the defaults keeps an empty object, which is what makes "reset" a
 * real state rather than a snapshot of whatever the defaults happened to be on
 * the day it was saved. It is also what lets a future release change a default
 * and have every site that never overrode it follow along.
 */
export function trimToDefaults(tokens: StyleTokens): Record<string, unknown> {
  const trimmed: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(tokens)) {
    if (value !== DEFAULT_TOKENS[key as keyof StyleTokens]) trimmed[key] = value
  }

  return trimmed
}
